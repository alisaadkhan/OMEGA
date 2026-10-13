import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments, ProviderError, type YouTubeAudienceSource } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { addCreator } from "../creators/test-fixtures";
import { createAudienceRunner } from "./runner";
import { createAudienceService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const audience = createAudienceService({ db, billing, sources: ["youtube"] });
beforeEach(resetTables);
afterAll(() => db.close());

/** Recent videos whose commenters c0…cN declare the given countries (null = none). */
class FakeYouTube implements YouTubeAudienceSource {
  calls = 0;
  failWith: Error | null = null;
  constructor(private readonly countries: (string | null)[]) {}
  async sampleComments() {
    this.calls += 1;
    if (this.failWith) throw this.failWith;
    const comments = this.countries.map((_, i) => ({ authorId: `UCfan${String(i).padStart(18, "0")}`, text: `great video number ${i}` }));
    // 50 commenters per recent video, so the per-video cap (60) does not bind.
    const videos = Array.from({ length: Math.ceil(comments.length / 50) }, (_, v) => ({ id: `video${String(v).padStart(6, "0")}`, publishedAt: "2026-10-01T00:00:00Z", commentsOff: false, comments: comments.slice(v * 50, v * 50 + 50) }));
    return { channelId: "UCcreator", videosConsidered: videos.length, videos, quotaUnits: 3 };
  }
  async channelCountries({ channelIds }: { channelIds: string[] }) {
    return { countries: new Map(channelIds.map((id) => [id, this.countries[Number(id.slice(5))] ?? null] as const)), quotaUnits: 1 };
  }
}
const pkHeavy = () => [...Array(45).fill("PK"), ...Array(10).fill("AE"), ...Array(5).fill("US"), ...Array(140).fill(null)] as (string | null)[];

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;
const youtubeCreator = (over: Parameters<typeof addCreator>[1] = {}) => addCreator(db, { primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: `chan_${randomUUID().slice(0, 6)}` }], ...over });
const runnerWith = (src: YouTubeAudienceSource | null) => createAudienceRunner({ db, billing, youtube: src, logger });
async function requestAndRun(c: TenantContext, creatorId: string, src: YouTubeAudienceSource) {
  const out = await audience.request(c, creatorId, 5);
  if (out.body.job) await runnerWith(src).run(out.body.job.id, c.workspaceId);
  return out;
}

describe("reading the audience state", () => {
  it("computes and charges nothing, quotes the price and never shows legacy model demographics", async () => {
    const c = await customer();
    const legacy = { age: [{ label: "18–24", value: 52, confidence: "medium" as const }], gender: { female: 81, male: 19, confidence: "medium" as const }, cities: [], countries: [{ code: "PK", value: 88, confidence: "high" as const }], source: "modeled" };
    const id = await youtubeCreator({ snapshot: { verdict: "assessed", authenticityScore: 80, fakeFollowerPct: 3, evidence: [{ signal: "x", detail: "y", weight: 1 }], audience: legacy, modelVersion: "m", confidence: 0.8 } });
    const s = await audience.state(c, id);
    expect(s).toMatchObject({ creatorId: id, platform: "youtube", availability: "available", cost: 5, job: null, estimate: null });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.audience_views`))[0]?.n).toBe(0);
  });

  it("explains why an estimate is unavailable", async () => {
    const c = await customer();
    const ig = await addCreator(db);
    expect(await audience.state(c, ig)).toMatchObject({ platform: null, availability: "platform_unsupported" });
    const minor = await youtubeCreator({ isMinor: true });
    expect(await audience.state(c, minor)).toMatchObject({ availability: "creator_protected" });
    const off = createAudienceService({ db, billing, sources: [] });
    const yt = await youtubeCreator();
    expect(await off.state(c, yt)).toMatchObject({ availability: "source_disabled" });
    await expect(off.request(c, yt, 5)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source_disabled" } });
    await expect(audience.request(c, ig, 5)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "platform_unsupported" } });
    await expect(audience.state(c, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });
});

describe("requesting an estimate", () => {
  it("reserves exactly the confirmed quote, queues the job and refuses a stale price", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    await expect(audience.request(c, id, 4)).rejects.toMatchObject({ code: "CONFLICT", details: { confirmedCost: 4, currentCost: 5 } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const out = await audience.request(c, id, 5);
    expect(out.httpStatus).toBe(202);
    expect(out.body.job).toMatchObject({ status: "queued", cost: 5, creditsCharged: 0 });
    expect(await balance(c)).toMatchObject({ available: 195, reserved: 5 });
    const ev = await ownerQuery<{ event_type: string; payload: { jobId: string } }>(`select event_type, payload from platform.outbox where event_type like 'audience.%'`);
    expect(ev).toEqual([{ event_type: "audience.estimate_requested", payload: { jobId: out.body.job?.id } }]);
  });

  it("simultaneous and repeated requests share one job and one reservation", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    const results = await Promise.all(Array.from({ length: 5 }, () => audience.request(c, id, 5)));
    expect(new Set(results.map((r) => r.body.job?.id)).size).toBe(1);
    expect(results.filter((r) => r.httpStatus === 202)).toHaveLength(1);
    expect(await balance(c)).toMatchObject({ available: 195, reserved: 5 });
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_reservations where action = 'audience_estimate'`))[0]?.n).toBe(1);
  });

  it("counts the plan's monthly audience views (trial: 5 creators) before reserving anything", async () => {
    const c = await customer();
    for (let i = 0; i < 5; i++) await audience.request(c, await youtubeCreator(), 5);
    await expect(audience.request(c, await youtubeCreator(), 5)).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
    expect(await balance(c)).toMatchObject({ available: 175, reserved: 25 });
  });
});

describe("running an estimate", () => {
  it("charges the quote for a country estimate built from aggregates only", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    const src = new FakeYouTube(pkHeavy());
    await requestAndRun(c, id, src);
    expect(await balance(c)).toMatchObject({ available: 195, reserved: 0 });
    const s = await audience.state(c, id);
    expect(s.job).toMatchObject({ status: "completed", outcome: "estimated", creditsCharged: 5 });
    expect(s.estimate).toMatchObject({
      platform: "youtube",
      outcome: "estimated",
      label: "Modeled estimate — not verified by the platform",
      population: "sampled_recent_commenters",
      sample: { uniqueCommenters: 200, classifiable: 60, coverage: 0.3 },
      country: { status: "estimated", classified: 60, displayStep: 5, confidence: "low" },
      age: { status: "not_estimable" },
      gender: { status: "not_estimable" },
    });
    if (s.estimate?.country.status !== "estimated") throw new Error("expected an estimate");
    expect(s.estimate.country.shares.map((x) => [x.code, x.count])).toEqual([["PK", 45], ["AE", 10], ["US", 5]]);
    // Nothing that identifies a commenter is stored.
    const stored = await ownerQuery<{ result: unknown; quota_units: number }>(`select result, quota_units from gcp.audience_estimates`);
    expect(JSON.stringify(stored)).not.toMatch(/UCfan|great video/);
    expect(stored[0]?.quota_units).toBe(4);
    // Asking again reuses the workspace's result for free, without collecting again.
    const again = await audience.request(c, id, 5);
    expect(again.httpStatus).toBe(200);
    expect(src.calls).toBe(1);
    expect(await balance(c)).toMatchObject({ available: 195, reserved: 0 });
  });

  it("returns the credits when the public evidence is insufficient, and shows why", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    await requestAndRun(c, id, new FakeYouTube([...Array(12).fill("PK"), ...Array(80).fill(null)]));
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const s = await audience.state(c, id);
    expect(s.job).toMatchObject({ status: "completed", outcome: "insufficient", creditsCharged: 0 });
    expect(s.estimate?.country).toMatchObject({ status: "insufficient", classified: 12, required: 30 });
    // Within the 7-day window a repeat request returns the same result instead of paying for the same evidence again.
    expect((await audience.request(c, id, 5)).httpStatus).toBe(200);
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("refunds on a provider failure; transient errors are retried by the queue first", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    const src = new FakeYouTube(pkHeavy());
    src.failWith = new ProviderError(true, "provider", "YouTube answered HTTP 503");
    const out = await audience.request(c, id, 5);
    const jobId = out.body.job?.id ?? "";
    const runner = runnerWith(src);
    await expect(runner.run(jobId, c.workspaceId)).rejects.toThrow(/503/);
    await expect(runner.run(jobId, c.workspaceId)).rejects.toThrow(/503/);
    await runner.run(jobId, c.workspaceId); // third attempt: give up
    expect((await audience.state(c, id)).job).toMatchObject({ status: "failed", creditsCharged: 0, error: { code: "PROVIDER_UNAVAILABLE" } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });

    const quota = new FakeYouTube(pkHeavy());
    quota.failWith = new ProviderError(false, "quota", "YouTube daily quota used up");
    const other = await youtubeCreator();
    await requestAndRun(c, other, quota);
    expect((await audience.state(c, other)).job?.error?.message).toMatch(/daily limit/);
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("refunds queued jobs when the source is switched off, and a repeat run never charges twice", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    const out = await audience.request(c, id, 5);
    await runnerWith(null).run(out.body.job?.id ?? "", c.workspaceId);
    expect((await audience.state(c, id)).job).toMatchObject({ status: "failed", error: { code: "SOURCE_DISABLED" } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const ok = await audience.request(c, id, 5);
    const runner = runnerWith(new FakeYouTube(pkHeavy()));
    await runner.run(ok.body.job?.id ?? "", c.workspaceId);
    await runner.run(ok.body.job?.id ?? "", c.workspaceId); // a duplicate delivery of the same queue message
    expect(await balance(c)).toMatchObject({ available: 195, reserved: 0 });
  });

  it("another workspace reuses a fresh estimate without collecting again, and cannot see it before asking", async () => {
    const a = await customer();
    const b = await customer();
    const id = await youtubeCreator();
    const src = new FakeYouTube(pkHeavy());
    await requestAndRun(a, id, src);
    expect((await audience.state(b, id)).estimate).toBeNull();
    await requestAndRun(b, id, src);
    expect(src.calls).toBe(1);
    expect((await audience.state(b, id)).estimate?.id).toBe((await audience.state(a, id)).estimate?.id);
    expect(await balance(b)).toMatchObject({ available: 195, reserved: 0 });
  });

  it("the sweeper fails stuck jobs and returns their credits", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    await audience.request(c, id, 5);
    await ownerQuery(`update wp.audience_jobs set created_at = now() - interval '1 hour'`);
    expect(await runnerWith(new FakeYouTube(pkHeavy())).sweepStuck()).toBe(1);
    expect((await audience.state(c, id)).job).toMatchObject({ status: "failed", error: { code: "TIMED_OUT" } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("creator erasure removes the creator's estimates and every workspace's jobs", async () => {
    const c = await customer();
    const id = await youtubeCreator();
    await requestAndRun(c, id, new FakeYouTube(pkHeavy()));
    await ownerQuery(`select platform.erase_creator_workspace_rows('${id}'::uuid, '{}'::text[])`);
    const left = await ownerQuery<{ e: number; j: number }>(`select (select count(*)::int from gcp.audience_estimates) e, (select count(*)::int from wp.audience_jobs) j`);
    expect(left).toEqual([{ e: 0, j: 0 }]);
  });
});
