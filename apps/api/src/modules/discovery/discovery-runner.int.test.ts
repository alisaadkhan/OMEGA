import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { FixtureScraper, MemoryStorage, MockLlm, MockPayments, ProviderError, scraperFixture } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEnrichmentPipeline } from "../creators/index";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createDiscoveryRunner } from "./runner";
import { createDiscoveryService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const discovery = createDiscoveryService({ db, billing });
beforeEach(resetTables);
afterAll(() => db.close());

const llm = () =>
  new MockLlm((req) => {
    const m = /Range: (\d+)–(\d+)/.exec(req.input);
    const score = m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : null;
    const signal = /^(\w+) \(/m.exec(req.input.split("<signals>")[1] ?? "")?.[1] ?? "engagement_vs_tier";
    return {
      verdict: score === null ? null : score >= 80 ? "genuine" : score >= 60 ? "mostly genuine" : score >= 40 ? "mixed signals" : "likely inflated",
      score,
      evidence: score === null ? [] : [{ signal, detail: "Measured from recent posts." }],
      watchOuts: [],
      audience: { age: [], gender: null, cities: [], countries: [] },
      niches: [],
      creatorCity: null,
      creatorCountry: null,
      minorSigns: { likely: false, reason: "" },
    };
  });

function runnerWith(scraper: FixtureScraper = FixtureScraper.defaults(), model = llm()) {
  const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm: model, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
  return { runner: createDiscoveryRunner({ db, billing, pipeline, logger }), scraper };
}

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;

async function started(c: TenantContext, url = "https://instagram.com/coke_studio", cost = 50): Promise<string> {
  const out = await discovery.start(c, { kind: "add_by_url", url, confirmedCost: cost });
  if (out.body.status !== "started") throw new Error("expected started");
  return out.body.job.id;
}

describe("job runner", () => {
  it("completes an add-by-URL job, charges the reservation and announces the result", async () => {
    const { runner } = runnerWith();
    const c = await customer();
    const id = await started(c);
    await runner.run(id, c.workspaceId);
    const job = await discovery.get(c, id);
    expect(job).toMatchObject({ status: "completed", outcome: "created", error: null });
    expect(job.creatorId).not.toBeNull();
    expect(await balance(c)).toMatchObject({ available: 150, reserved: 0 });
    const [row] = await ownerQuery<{ credits_charged: number; step: string }>(`select credits_charged, step from wp.discovery_jobs where id = '${id}'`);
    expect(row).toEqual({ credits_charged: 50, step: "saving" });
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'notify.discovery_job_finished'`);
    expect(ev[0]?.n).toBe(1);
  });

  it("charges TikTok the same 50-credit refresh price", async () => {
    const { runner } = runnerWith();
    const c = await customer();
    await runner.run(await started(c, "https://tiktok.com/@cokestudiopakistan", 50), c.workspaceId);
    expect(await balance(c)).toMatchObject({ available: 150, reserved: 0 });
  });

  it("a second job for a profile scraped minutes ago reuses it and refunds (Review Focus 2)", async () => {
    const { runner, scraper } = runnerWith();
    const a = await customer();
    const b = await customer();
    // Both workspaces ask before either job runs (once A's job has saved the creator, B's request would be "known, free").
    const first = await started(a);
    const second = await started(b);
    await runner.run(first, a.workspaceId);
    await runner.run(second, b.workspaceId);
    expect(await discovery.get(b, second)).toMatchObject({ status: "completed", outcome: "reused" });
    expect(await balance(b)).toMatchObject({ available: 200, reserved: 0 });
    expect(scraper.calls).toHaveLength(1);
  });

  it("an add-by-link that turns out to be a creator MUSHIN already had (stale data, refreshed) costs nothing", async () => {
    const { runner } = runnerWith();
    const c = await customer();
    const id = await started(c); // not known yet: the request is accepted and 50 credits are held
    await addCreator(db, { displayName: "Coke Studio", profiles: [{ platform: "instagram", handle: "coke_studio" }] });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '30 days'`);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "refreshed" });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const [row] = await ownerQuery<{ credits_charged: number }>(`select credits_charged from wp.discovery_jobs where id = '${id}'`);
    expect(row?.credits_charged).toBe(0);
  });

  it("an add-by-link for a creator already known is answered free, without a job", async () => {
    await addCreator(db, { displayName: "Coke Studio", profiles: [{ platform: "instagram", handle: "coke_studio" }] });
    const c = await customer();
    const out = await discovery.start(c, { kind: "add_by_url", url: "https://instagram.com/coke_studio", confirmedCost: 50 });
    expect(out.body.status).toBe("known");
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("a private account fails with the reason and refunds", async () => {
    const { runner } = runnerWith(new FixtureScraper({ instagram: { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 } }));
    const c = await customer();
    const id = await started(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", error: { code: "PRIVATE_ACCOUNT", message: expect.stringMatching(/private/) } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("provider down: retries, then fails and refunds (Review Focus 4)", async () => {
    const { runner } = runnerWith(new FixtureScraper({ instagram: new ProviderError(true, "provider", "Apify answered HTTP 502") }));
    const c = await customer();
    const id = await started(c);
    await expect(runner.run(id, c.workspaceId)).rejects.toThrow(/502/);
    await expect(runner.run(id, c.workspaceId)).rejects.toThrow(/502/);
    expect(await balance(c)).toMatchObject({ reserved: 50 });
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE", message: expect.stringMatching(/couldn't fetch/i) } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("spend cap fails cleanly and refunds at once (Review Focus 4)", async () => {
    const { runner } = runnerWith(new FixtureScraper({ instagram: new ProviderError(false, "spend_cap", "Monthly Apify budget reached") }));
    const c = await customer();
    const id = await started(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE", message: expect.stringMatching(/paused/i) } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("charges when only the AI fails, leaving the assessment pending", async () => {
    const { runner } = runnerWith(FixtureScraper.defaults(), new MockLlm(() => ({ nonsense: true })));
    const c = await customer();
    const id = await started(c);
    await runner.run(id, c.workspaceId);
    const job = await discovery.get(c, id);
    expect(job).toMatchObject({ status: "completed", outcome: "created" });
    const [cr] = await ownerQuery<{ assessment_status: string }>(`select assessment_status from gcp.creators where id = '${job.creatorId ?? ""}'`);
    expect(cr?.assessment_status).toBe("pending");
    expect(await balance(c)).toMatchObject({ available: 150 });
  });

  it("does nothing for a job that already finished (duplicate delivery)", async () => {
    const { runner, scraper } = runnerWith();
    const c = await customer();
    const id = await started(c);
    await runner.run(id, c.workspaceId);
    await runner.run(id, c.workspaceId);
    expect(scraper.calls).toHaveLength(1);
    expect(await balance(c)).toMatchObject({ available: 150 });
  });

  it("sweeps jobs stuck past the limit and returns their credits", async () => {
    const { runner } = runnerWith();
    const c = await customer();
    const id = await started(c);
    await ownerQuery(`update wp.discovery_jobs set created_at = now() - interval '2 hours' where id = '${id}'`);
    expect(await runner.sweepStuck()).toBe(1);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", error: { code: "TIMED_OUT" } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });
});
