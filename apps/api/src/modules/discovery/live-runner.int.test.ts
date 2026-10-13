import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { FixtureScraper, FixtureWebSearch, MemoryStorage, MockLlm, MockPayments, ProviderError, scraperFixture, type ScrapeRequest, type WebResult } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEnrichmentPipeline, suppress, type EnrichmentPipeline } from "../creators/index";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createCachedSearch } from "./live/cache";
import { createLiveRunner } from "./live-runner";
import { createDiscoveryService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const discovery = createDiscoveryService({ db, billing });
beforeEach(resetTables);
afterAll(() => db.close());

const profile = (username: string, bio = "Bridal makeup artist in Lahore") => {
  const one = structuredClone((scraperFixture("instagram-profile.json") as Record<string, unknown>[])[0] ?? {});
  const posts = Array.isArray(one["latestPosts"]) ? one["latestPosts"] : [];
  one["latestPosts"] = posts.map((post, index) => typeof post === "object" && post !== null ? {
    ...(post as Record<string, unknown>), caption: "Bridal makeup look", hashtags: ["bridal", "makeup"],
    timestamp: new Date(Date.now() - index * 5 * 86_400_000).toISOString(),
  } : post);
  return [{ ...one, username, biography: bio }];
};

/** Instagram replies per handle: a private account for "private_c", a 16-year-old's bio for "minor_m", a normal profile otherwise. */
function igScraper() {
  return new FixtureScraper({
    instagram: (req: ScrapeRequest) =>
      req.handle === "private_c"
        ? { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 }
        : { provider: "apify", raw: profile(req.handle, req.handle === "minor_m" ? "16 years old, makeup lover" : undefined), costUsd: 0.0026 },
  });
}

const links = (...handles: string[]): WebResult[] => {
  // Ordinary success fixtures must clear the production G2 pool threshold (8).
  const pool = [...handles];
  for (let i = 1; pool.length > 0 && pool.length < 8; i++) pool.push(`pool_${i}`);
  return pool.map((h) => ({ title: `${h} | Bridal MUA`, link: `https://www.instagram.com/${h}/`, snippet: "Bridal makeup, Lahore" }));
};

/** The relevance filter keeps everything in order; assessments are valid for whatever range was measured. */
const llm = () =>
  new MockLlm((req) => {
    if (req.feature === "discovery_relevance") {
      const n = (req.input.match(/^\d+\. /gm) ?? []).length;
      return { keep: Array.from({ length: n }, (_, i) => ({ i, reason: "Bridal makeup in Lahore" })) };
    }
    return llmReply(req);
  });

/** A valid creator assessment for whatever range was measured. */
function llmReply(req: { input: string }) {
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
}

function setup(o: { web?: FixtureWebSearch; scraper?: FixtureScraper; wrap?: (p: EnrichmentPipeline) => EnrichmentPipeline; maxAttempts?: number; model?: MockLlm } = {}) {
  const web = o.web ?? new FixtureWebSearch(links("new_a", "new_b"));
  const scraper = o.scraper ?? igScraper();
  const model = o.model ?? llm();
  const base = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm: model, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
  const pipeline = o.wrap ? o.wrap(base) : base;
  const runner = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm: model, logger, ...(o.maxAttempts ? { maxAttempts: o.maxAttempts } : {}) });
  return { runner, web, scraper, pipeline };
}

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;

async function startRun(c: TenantContext, maxNew: 5 | 10 = 10): Promise<string> {
  const estimate = await discovery.createEstimate(c, { search: { text: "bridal makeup", filters: searchFiltersSchema.parse({ platform: "instagram", creatorCity: "Lahore" }) }, maxNew });
  const out = await discovery.start(c, { kind: "live", estimateId: estimate.estimateId });
  if (out.body.status !== "started") throw new Error("expected started");
  return out.body.job.id;
}

describe("live runner", () => {
  it("merges a known creator for free, adds new ones in one Apify run, skips a private one and charges only for what was added", async () => {
    const known = await addCreator(db, { displayName: "Known One", profiles: [{ platform: "instagram", handle: "known_one" }] });
    const c = await customer();
    const { runner, web, scraper, pipeline } = setup({ web: new FixtureWebSearch(links("known_one", "new_a", "new_b", "private_c")) });
    const knownJob = { jobId: randomUUID(), workspaceId: c.workspaceId, platform: "instagram" as const, handle: "known_one", canonicalUrl: "https://instagram.com/known_one", requestId: c.requestId };
    const knownRaw = profile("known_one");
    const knownPayload = await pipeline.archive(knownJob, "apify", knownRaw);
    await pipeline.processProfile(knownJob, knownPayload, knownRaw, { onSaved: async () => undefined });
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    const job = await discovery.get(c, id);
    expect(job).toMatchObject({ status: "completed", outcome: "succeeded", live: { found: 7, new: 6, known: 1, creditsCharged: 72, progress: { persistedResults: 7, qualifiedCreators: 7, billableCreators: 6 } } });
    expect(await balance(c)).toMatchObject({ available: 128, reserved: 0 });
    const res = await discovery.results(c, id, 0);
    expect(res.done).toBe(true);
    expect(res.results.find((r) => r.id === known)).toMatchObject({ isNew: false });
    expect(res.results.filter((r) => r.isNew)).toHaveLength(6);
    expect(scraper.batchCalls).toHaveLength(1);
    expect(scraper.batchCalls[0]?.handles.sort()).toEqual(["new_a", "new_b", "pool_1", "pool_2", "pool_3", "pool_4", "private_c"]);
    expect(web.calls).toHaveLength(3); // role-targeted queries filled the eight-candidate pool
    const payloads = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.raw_payloads where job_id = '${id}'`);
    expect(payloads[0]?.n).toBe(7);
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'notify.discovery_job_finished'`);
    expect(ev[0]?.n).toBe(1);
  });

  it("a run that finds nothing is free", async () => {
    const { runner } = setup({ web: new FixtureWebSearch([]) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "insufficient", live: { found: 0, creditsCharged: 0 } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("keeps searching while most results are shops, then ends insufficient below the G2 pool without extracting", async () => {
    const shops = Array.from({ length: 10 }, (_, index) => ({ title: `Bridal Boutique ${index}`, link: `https://www.instagram.com/boutique_${index}/`, snippet: "Order now, delivery across Pakistan" }));
    const { runner, web, scraper } = setup({ web: new FixtureWebSearch(shops) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    // Ten raw profile URLs used to stop the search after round one; G2 now counts the pool after the cheap G1 gate.
    expect(new Set(web.calls.map((call) => call.query)).size).toBeGreaterThan(3);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "insufficient", live: { creditsCharged: 0 } });
    expect(scraper.batchCalls).toHaveLength(0);
  });

  it("extracts from a viable G1 pool even when relevance review keeps fewer than eight", async () => {
    const eight = Array.from({ length: 8 }, (_, index) => ({ title: `Candidate ${index}`, link: `https://www.instagram.com/candidate_${index}/`, snippet: "Lahore" }));
    const picky = new MockLlm((req) => (req.feature === "discovery_relevance" ? { keep: [{ i: 0, reason: "Bridal makeup in Lahore" }, { i: 1, reason: "Bridal makeup in Lahore" }] } : llmReply(req)));
    const { runner, scraper } = setup({ web: new FixtureWebSearch(eight), model: picky });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(scraper.batchCalls[0]?.handles.sort()).toEqual(["candidate_0", "candidate_1"]);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "succeeded", live: { new: 2, creditsCharged: 12 + 2 * 10 } });
  });

  it("releases the full reservation when fewer than eight candidates pass the cheap G1 gate", async () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({ title: `Candidate ${index}`, link: `https://www.instagram.com/candidate_${index}/`, snippet: "Bridal makeup, Lahore" }));
    const { runner, scraper } = setup({ web: new FixtureWebSearch(seven) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "insufficient", live: { creditsCharged: 0, progress: { profileCandidates: 7, afterDedupe: 7, extractedProfiles: 0 } } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    expect(scraper.batchCalls).toHaveLength(0);
  });

  it("stops at the chosen number of new creators", async () => {
    const { runner, scraper } = setup({ web: new FixtureWebSearch(links("n1", "n2", "n3", "n4", "n5", "n6", "n7")) });
    const c = await customer();
    const id = await startRun(c, 5);
    await runner.run(id, c.workspaceId);
    expect(scraper.batchCalls[0]?.handles).toHaveLength(5);
    expect(await discovery.get(c, id)).toMatchObject({ live: { new: 5, creditsCharged: 62 } });
  });

  it("a new creator flagged as a possible minor is saved but costs nothing (Review Focus 1)", async () => {
    const { runner } = setup({ web: new FixtureWebSearch(links("new_a", "minor_m")) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ live: { new: 7, creditsCharged: 82 } });
    expect((await discovery.results(c, id, 0)).results.map((r) => r.handle).sort()).toEqual(["new_a", "pool_1", "pool_2", "pool_3", "pool_4", "pool_5", "pool_6"]);
  });

  it("candidates on the do-not-re-add list are dropped (Review Focus 5)", async () => {
    await db.withSystem((tx) => suppress(tx, [{ canonicalUrl: "https://instagram.com/new_b", platform: "instagram" }], null));
    const { runner, scraper } = setup();
    const c = await customer();
    await runner.run(await startRun(c), c.workspaceId);
    expect(scraper.batchCalls[0]?.handles.sort()).toEqual(["new_a", "pool_1", "pool_2", "pool_3", "pool_4", "pool_5", "pool_6"]);
  });

  it("a retry reuses cached searches and archived profiles and charges once (Review Focus 2, 3)", async () => {
    let crash = true;
    const { runner, web, scraper } = setup({
      wrap: (p) => ({
        ...p,
        processProfile: async (job, payloadId, raw, hooks) => {
          if (crash && job.handle === "new_b") {
            crash = false;
            throw new Error("worker crashed");
          }
          return p.processProfile(job, payloadId, raw, hooks);
        },
      }),
    });
    const c = await customer();
    const id = await startRun(c);
    await expect(runner.run(id, c.workspaceId)).rejects.toThrow(/crashed/);
    await runner.run(id, c.workspaceId);
    expect(web.calls).toHaveLength(3); // retry reuses the role-targeted queries from cache
    expect(scraper.batchCalls).toHaveLength(1);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", live: { new: 8, creditsCharged: 92 } });
    expect(await balance(c)).toMatchObject({ available: 108, reserved: 0 });
  });

  it("settles a partial result once when a later profile fails permanently", async () => {
    let failed = false;
    const { runner } = setup({
      maxAttempts: 1,
      web: new FixtureWebSearch(links("first_saved", "second_fails")),
      wrap: (p) => ({
        ...p,
        processProfile: async (job, payloadId, raw, hooks) => {
          if (job.handle === "second_fails" && !failed) {
            failed = true;
            throw new Error("provider stopped after the first result");
          }
          return p.processProfile(job, payloadId, raw, hooks);
        },
      }),
    });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "partial", live: { found: 1, new: 1, creditsCharged: 22, progress: { persistedResults: 1, billableCreators: 1 } } });
    expect(await balance(c)).toMatchObject({ available: 178, reserved: 0 });
    expect((await discovery.results(c, id, 0)).results.map((r) => r.handle)).toEqual(["first_saved"]);
  });

  it("does not charge for hidden minor records when a later profile fails", async () => {
    const { runner } = setup({
      maxAttempts: 1,
      web: new FixtureWebSearch(links("minor_m", "second_fails")),
      wrap: (p) => ({
        ...p,
        processProfile: async (job, payloadId, raw, hooks) => {
          if (job.handle === "second_fails") throw new Error("provider stopped after minor review");
          return p.processProfile(job, payloadId, raw, hooks);
        },
      }),
    });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", outcome: "failed", live: { creditsCharged: 0 } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    expect((await discovery.results(c, id, 0)).results).toHaveLength(0);
  });

  it("the Serper limit or a provider outage fails the run and returns everything", async () => {
    const capped = setup({ web: new FixtureWebSearch(new ProviderError(false, "spend_cap", "Monthly Serper limit reached")) });
    const c = await customer();
    const id = await startRun(c);
    await capped.runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE", message: expect.stringMatching(/paused/i) } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });

    const down = setup({ scraper: new FixtureScraper({ instagram: new ProviderError(true, "provider", "Apify answered HTTP 502") }) });
    const c2 = await customer();
    const id2 = await startRun(c2);
    await expect(down.runner.run(id2, c2.workspaceId)).rejects.toThrow(/502/);
    await expect(down.runner.run(id2, c2.workspaceId)).rejects.toThrow(/502/);
    await down.runner.run(id2, c2.workspaceId);
    expect(await discovery.get(c2, id2)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE" } });
    expect(await balance(c2)).toMatchObject({ available: 200, reserved: 0 });
  });
});
