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
import { candidatesFor as repoCandidates } from "./repository";
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

function setup(o: { web?: FixtureWebSearch; scraper?: FixtureScraper; wrap?: (p: EnrichmentPipeline) => EnrichmentPipeline; maxAttempts?: number; model?: MockLlm; contentResolutionMax?: number; extractionMultiplier?: Partial<Record<"instagram" | "tiktok" | "youtube", number>>; profileConcurrency?: number } = {}) {
  const web = o.web ?? new FixtureWebSearch(links("new_a", "new_b"));
  const scraper = o.scraper ?? igScraper();
  const model = o.model ?? llm();
  const base = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm: model, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
  const pipeline = o.wrap ? o.wrap(base) : base;
  const runner = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm: model, logger, ...(o.maxAttempts ? { maxAttempts: o.maxAttempts } : {}), ...(o.contentResolutionMax ? { contentResolutionMax: o.contentResolutionMax } : {}), ...(o.extractionMultiplier ? { extractionMultiplier: o.extractionMultiplier } : {}), ...(o.profileConcurrency ? { profileConcurrency: o.profileConcurrency } : {}) });
  return { runner, web, scraper, pipeline };
}

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;
type TrailRow = { candidate_key: string; stage: string; decision: string; reason: string | null; creator_id: string | null; occurrences: number };
const trailOf = (jobId: string) => ownerQuery<TrailRow>(`select candidate_key, stage, decision, reason, creator_id, occurrences from wp.discovery_candidates where job_id = '${jobId}' order by candidate_key`);
const row = (rows: TrailRow[], handle: string) => rows.find((r) => r.candidate_key === `https://instagram.com/${handle}`);

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
    expect(job).toMatchObject({ status: "completed", outcome: "succeeded", live: { found: 7, new: 6, known: 1, creditsCharged: 110, progress: { persistedResults: 7, qualifiedCreators: 7, billableCreators: 6 } } });
    expect(await balance(c)).toMatchObject({ available: 90, reserved: 0 });
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

    // Every candidate has a terminal decision, and the trail agrees with the persisted, charged results.
    const trail = await trailOf(id);
    expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
    expect(trail.filter((r) => r.decision === "delivered")).toHaveLength(res.results.length);
    expect(new Set(trail.filter((r) => r.decision === "delivered").map((r) => r.creator_id))).toEqual(new Set(res.results.map((r) => r.id)));
    expect(row(trail, "known_one")).toMatchObject({ stage: "delivery", decision: "delivered", reason: "known_creator" });
    expect(row(trail, "new_a")).toMatchObject({ stage: "delivery", decision: "delivered", reason: "new_creator" });
    expect(row(trail, "private_c")).toMatchObject({ stage: "extraction", decision: "rejected", reason: "private_account" });
    // The trail is tenant data: another workspace sees none of it.
    const other = await customer();
    expect(await db.withTenant(other, (tx) => repoCandidates(tx, other.workspaceId, id))).toEqual([]);
    expect(await db.withTenant(c, (tx) => repoCandidates(tx, c.workspaceId, id))).toHaveLength(trail.length);
  });

  it("a stop requested before the run starts costs nothing and calls no provider (JOB-003)", async () => {
    const { runner, web, scraper } = setup();
    const c = await customer();
    const id = await startRun(c);
    expect(await discovery.cancel(c, id)).toMatchObject({ status: "queued", cancelRequested: true });
    expect((await discovery.cancel(c, id)).cancelRequested).toBe(true); // repeating it changes nothing
    await expect(discovery.cancel(await customer(), id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // other workspaces cannot
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "canceled", live: { found: 0, creditsCharged: 0 } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    expect(web.calls).toHaveLength(0);
    expect(scraper.batchCalls).toHaveLength(0);
    // Asking after it finished returns the finished job.
    expect(await discovery.cancel(c, id)).toMatchObject({ status: "completed", outcome: "canceled" });
  });

  it("a stop during extraction keeps and charges only the creators already delivered (JOB-003)", async () => {
    let c: TenantContext | null = null;
    let id = "";
    let asked = false;
    const { runner } = setup({
      // The customer presses Stop right after the first new creator is saved.
      wrap: (p) => ({
        ...p,
        processProfile: async (...args: Parameters<EnrichmentPipeline["processProfile"]>) => {
          const out = await p.processProfile(...args);
          if (!asked && c) {
            asked = true;
            await discovery.cancel(c, id);
          }
          return out;
        },
      }),
    });
    c = await customer();
    id = await startRun(c, 5);
    await runner.run(id, c.workspaceId);
    const job = await discovery.get(c, id);
    expect(job).toMatchObject({ status: "completed", outcome: "canceled", live: { new: 1, creditsCharged: 50 + 10 } });
    expect(job.error?.message).toMatch(/Stopped at your request/);
    expect(await balance(c)).toMatchObject({ available: 200 - 60, reserved: 0 });
    expect((await discovery.results(c, id, 0)).results).toHaveLength(1);
    const trail = await trailOf(id);
    expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
    expect(trail.some((r) => r.reason === "run_canceled")).toBe(true);
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
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "succeeded", live: { new: 2, creditsCharged: 50 + 2 * 10 } });
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
    expect(await discovery.get(c, id)).toMatchObject({ live: { new: 5, creditsCharged: 100 } });
    // Candidates beyond the chosen run size are recorded as not extracted, not silently dropped.
    const trail = await trailOf(id);
    expect(trail.filter((r) => r.reason === "run_size_limit")).toHaveLength(3); // seven links padded to the eight-candidate pool
    expect(trail.filter((r) => r.decision === "delivered")).toHaveLength(5);
    expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
  });

  it("a new creator flagged as a possible minor is saved but costs nothing (Review Focus 1)", async () => {
    const { runner } = setup({ web: new FixtureWebSearch(links("new_a", "minor_m")) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ live: { new: 7, creditsCharged: 120 } });
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
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", live: { new: 8, creditsCharged: 130 } });
    expect(await balance(c)).toMatchObject({ available: 70, reserved: 0 });
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
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "partial", live: { found: 1, new: 1, creditsCharged: 60, progress: { persistedResults: 1, billableCreators: 1 } } });
    expect(await balance(c)).toMatchObject({ available: 140, reserved: 0 });
    expect((await discovery.results(c, id, 0)).results.map((r) => r.handle)).toEqual(["first_saved"]);
  });

  describe("posts and reels as discovery evidence", () => {
    const postResults: WebResult[] = [
      { title: "Bridal makeup look of the week", link: "https://www.instagram.com/reel/AUTHOR0001/", snippet: "My bridal makeup for a Lahore wedding" },
      { title: "Bridal glam reel", link: "https://www.instagram.com/p/NOAUTHOR01/", snippet: "I tried a bridal makeup tutorial" },
      { title: "Bridal Collection 2026", link: "https://www.instagram.com/p/SHOPPOST01/", snippet: "Order now on WhatsApp" },
    ];

    it("recovers a creator from a post's reported author, extracts it like any candidate and records where it came from", async () => {
      const scraper = igScraper();
      scraper.postOwners = (url) => (url.includes("AUTHOR0001") ? "post_author_one" : null);
      const { runner } = setup({ web: new FixtureWebSearch([...links("new_a", "new_b"), ...postResults]), scraper, contentResolutionMax: 10 });
      const c = await customer();
      const id = await startRun(c);
      await runner.run(id, c.workspaceId);
      expect(scraper.postOwnerCalls).toEqual([["https://www.instagram.com/reel/AUTHOR0001/", "https://www.instagram.com/p/NOAUTHOR01/"]]);
      expect(scraper.batchCalls[0]?.handles).toContain("post_author_one");
      expect((await discovery.results(c, id, 0)).results.map((r) => r.handle)).toContain("post_author_one");
      const trail = await ownerQuery<{ candidate_key: string; decision: string; reason: string | null; source: string | null }>(
        `select candidate_key, decision, reason, detail->>'source' source from wp.discovery_candidates where job_id = '${id}'`);
      const byKey = new Map(trail.map((r) => [r.candidate_key, r]));
      expect(byKey.get("https://www.instagram.com/reel/AUTHOR0001/")).toMatchObject({ reason: "content_author_resolved" });
      expect(byKey.get("https://www.instagram.com/p/NOAUTHOR01/")).toMatchObject({ decision: "rejected", reason: "content_author_unresolved" });
      expect(byKey.get("https://www.instagram.com/p/SHOPPOST01/")).toMatchObject({ decision: "rejected", reason: "content_business_cue" });
      expect(byKey.get("https://instagram.com/post_author_one")).toMatchObject({ decision: "delivered", source: "post_author" });
      expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
    });

    it("continues with profile results when post resolution fails or is not configured", async () => {
      const scraper = igScraper();
      scraper.postOwners = () => {
        throw new ProviderError(false, "spend_cap", "Monthly Apify budget reached");
      };
      const { runner } = setup({ web: new FixtureWebSearch([...links("new_a", "new_b"), ...postResults]), scraper, contentResolutionMax: 10 });
      const c = await customer();
      const id = await startRun(c);
      await runner.run(id, c.workspaceId);
      expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "succeeded" });
      expect(row(await trailOf(id), "new_a")).toMatchObject({ decision: "delivered" });
      const failed = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.discovery_candidates where job_id = '${id}' and reason = 'content_resolution_failed'`);
      expect(failed[0]?.n).toBe(2);

      const off = setup({ web: new FixtureWebSearch([...links("new_a"), ...postResults]) });
      const c2 = await customer();
      const id2 = await startRun(c2);
      await off.runner.run(id2, c2.workspaceId);
      expect(off.scraper.postOwnerCalls).toEqual([]);
      const skipped = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.discovery_candidates where job_id = '${id2}' and reason = 'content_resolution_not_needed'`);
      expect(skipped[0]?.n).toBe(2);
    });
  });

  describe("YouTube-native video search", () => {
    const channels = (...handles: string[]): WebResult[] => handles.map((h) => ({ title: `${h} - Bridal makeup tutorial`, link: `https://www.youtube.com/@${h}`, snippet: "Bridal makeup in Lahore" }));
    async function startYouTube(c: TenantContext): Promise<string> {
      const estimate = await discovery.createEstimate(c, { search: { text: "bridal makeup", filters: searchFiltersSchema.parse({ platform: "youtube", creatorCity: "Lahore" }) }, maxNew: 5 });
      const out = await discovery.start(c, { kind: "live", estimateId: estimate.estimateId });
      if (out.body.status !== "started") throw new Error("expected started");
      return out.body.job.id;
    }
    function ytRunner(searchYouTube: (q: { query: string; lang?: string }) => Promise<WebResult[]>) {
      const web = new FixtureWebSearch(channels("web_one", "web_two", "web_three", "web_four", "web_five", "web_six", "web_seven", "web_eight"));
      const scraper = FixtureScraper.defaults();
      const model = llm();
      const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm: model, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
      const cached = createCachedSearch({ db, web });
      const asked: { query: string; lang?: string }[] = [];
      const search = { search: cached.search, searchYouTube: async (q: { query: string; lang?: string }) => { asked.push(q); return searchYouTube(q); } };
      return { runner: createLiveRunner({ db, billing, pipeline, scraper, search, llm: model, logger }), asked };
    }

    it("adds the video search's channels to the candidate pool once, in the first round", async () => {
      const { runner, asked } = ytRunner(async () => channels("native_one", "web_one"));
      const c = await customer();
      const id = await startYouTube(c);
      await runner.run(id, c.workspaceId);
      expect(asked).toEqual([{ query: "bridal makeup Lahore" }]);
      const trail = await ownerQuery<{ candidate_key: string; occurrences: number; query: string }>(`select candidate_key, occurrences, query from wp.discovery_candidates where job_id = '${id}'`);
      expect(trail.find((r) => r.candidate_key === "https://youtube.com/@native_one")).toMatchObject({ query: "youtube_video: bridal makeup Lahore" });
      expect(trail.find((r) => r.candidate_key === "https://youtube.com/@web_one")?.occurrences).toBeGreaterThan(1);
      expect(await discovery.get(c, id)).toMatchObject({ status: "completed" });
    });

    it("continues with web results when the YouTube quota is used up", async () => {
      const { runner } = ytRunner(async () => {
        throw new ProviderError(false, "quota", "YouTube daily quota used up");
      });
      const c = await customer();
      const id = await startYouTube(c);
      await runner.run(id, c.workspaceId);
      expect(await discovery.get(c, id)).toMatchObject({ status: "completed" });
      expect((await trailOf(id)).filter((r) => r.decision === "pending")).toEqual([]);
    });
  });

  describe("extraction waves", () => {
    // Three private accounts first, then good ones: the size (5) is filled only if more profiles may be fetched.
    const scraper = () => new FixtureScraper({
      instagram: (req: ScrapeRequest) => req.handle.startsWith("locked_")
        ? { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 }
        : { provider: "apify", raw: profile(req.handle), costUsd: 0.0026 },
    });
    const pool = () => new FixtureWebSearch(links("locked_1", "locked_2", "locked_3", "open_1", "open_2", "open_3", "open_4", "open_5", "open_6", "open_7"));

    it("keeps today's behaviour by default: the first size-worth of profiles only", async () => {
      const { runner, scraper: s } = setup({ web: pool(), scraper: scraper() });
      const c = await customer();
      const id = await startRun(c, 5);
      await runner.run(id, c.workspaceId);
      expect(s.batchCalls).toHaveLength(1);
      expect(await discovery.get(c, id)).toMatchObject({ live: { new: 2, creditsCharged: 50 + 2 * 10 } });
      expect((await trailOf(id)).filter((r) => r.reason === "run_size_limit")).toHaveLength(5);
    });

    it("with a multiplier fetches the next-best candidates until the size is filled, and charges only what was delivered", async () => {
      const { runner, scraper: s } = setup({ web: pool(), scraper: scraper(), extractionMultiplier: { instagram: 2 } });
      const c = await customer();
      const id = await startRun(c, 5);
      await runner.run(id, c.workspaceId);
      expect(s.batchCalls.map((b) => b.handles.length)).toEqual([5, 3]);
      expect(await discovery.get(c, id)).toMatchObject({ status: "completed", live: { new: 5, creditsCharged: 50 + 5 * 10 } });
      expect(await balance(c)).toMatchObject({ available: 200 - 100, reserved: 0 });
      const trail = await trailOf(id);
      expect(trail.filter((r) => r.decision === "delivered")).toHaveLength(5);
      expect(trail.filter((r) => r.reason === "private_account")).toHaveLength(3);
      expect(trail.filter((r) => r.reason === "run_size_limit")).toHaveLength(2);
      expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
    });

    it("stops safely when the provider budget runs out in an extra wave: keeps and charges only what was delivered", async () => {
      let batches = 0;
      const capped = new FixtureScraper({
        instagram: (req: ScrapeRequest) => req.handle.startsWith("locked_")
          ? { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 }
          : { provider: "apify", raw: profile(req.handle), costUsd: 0.0026 },
      });
      const fetchProfiles = capped.fetchProfiles.bind(capped);
      capped.fetchProfiles = async (req) => {
        if (++batches > 1) throw new ProviderError(false, "spend_cap", "Monthly Apify budget reached");
        return fetchProfiles(req);
      };
      const { runner } = setup({ web: pool(), scraper: capped, extractionMultiplier: { instagram: 2 } });
      const c = await customer();
      const estimate = await discovery.createEstimate(c, { search: { text: "bridal makeup", filters: searchFiltersSchema.parse({ platform: "instagram", creatorCity: "Lahore" }) }, maxNew: 5 });
      const started = await discovery.start(c, { kind: "live", estimateId: estimate.estimateId });
      if (started.body.status !== "started") throw new Error("expected started");
      const id = started.body.job.id;
      await runner.run(id, c.workspaceId);
      expect(batches).toBe(2);
      expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "succeeded", live: { new: 2, creditsCharged: 50 + 2 * 10 } });
      expect(estimate.maxCredits).toBe(100);
      expect(await balance(c)).toMatchObject({ available: 200 - 70, reserved: 0 });
      const trail = await trailOf(id);
      expect(trail.filter((r) => r.reason === "provider_budget_exhausted").length).toBeGreaterThan(0);
      expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
    });

    it("gives extra waves only to platforms with a multiplier: TikTok at 1 is never fetched beyond the size", async () => {
      const mixed = new FixtureScraper({
        instagram: (req: ScrapeRequest) => ({ provider: "apify", raw: req.handle.startsWith("locked_") ? scraperFixture("instagram-private.json") : profile(req.handle), costUsd: 0.0026 }),
        tiktok: { provider: "apify", raw: [], costUsd: 0.018 },
      });
      const tt = (h: string): WebResult => ({ title: `${h} | Bridal MUA`, link: `https://www.tiktok.com/@${h}`, snippet: "Bridal makeup, Lahore" });
      const web = new FixtureWebSearch([...links("locked_1", "locked_2", "open_1", "open_2", "open_3", "open_4"), tt("tok_1"), tt("tok_2"), tt("tok_3"), tt("tok_4"), tt("tok_5")]);
      const { runner } = setup({ web, scraper: mixed, extractionMultiplier: { instagram: 2, tiktok: 1 } });
      const c = await customer();
      const estimate = await discovery.createEstimate(c, { search: { text: "bridal makeup", filters: searchFiltersSchema.parse({ creatorCity: "Lahore" }) }, maxNew: 5 });
      const started = await discovery.start(c, { kind: "live", estimateId: estimate.estimateId });
      if (started.body.status !== "started") throw new Error("expected started");
      await runner.run(started.body.job.id, c.workspaceId);
      const tiktokFetched = mixed.batchCalls.filter((b) => b.platform === "tiktok").flatMap((b) => b.handles);
      const igFetched = mixed.batchCalls.filter((b) => b.platform === "instagram").flatMap((b) => b.handles);
      expect(mixed.batchCalls.filter((b) => b.platform === "tiktok")).toHaveLength(1);
      expect(tiktokFetched.length).toBeLessThanOrEqual(5);
      expect(mixed.batchCalls.filter((b) => b.platform === "instagram").length).toBeGreaterThan(1);
      expect(igFetched.length).toBeLessThanOrEqual(10);
      const job = await discovery.get(c, started.body.job.id);
      expect(job.live?.creditsCharged).toBeLessThanOrEqual(estimate.maxCredits);
      expect(await balance(c)).toMatchObject({ reserved: 0 });
    });

    it("stops at the multiplier cap when too few qualify, and records the cap", async () => {
      const lockedFirst = new FixtureWebSearch(links("locked_1", "locked_2", "locked_3", "locked_4", "locked_5", "locked_6", "open_1", "open_2"));
      const { runner, scraper: s } = setup({ web: lockedFirst, scraper: scraper(), extractionMultiplier: { instagram: 1.4 } });
      const c = await customer();
      const id = await startRun(c, 5);
      await runner.run(id, c.workspaceId);
      expect(s.batchCalls.flatMap((b) => b.handles)).toHaveLength(7);
      expect(await discovery.get(c, id)).toMatchObject({ live: { new: 1 } });
      expect((await trailOf(id)).filter((r) => r.reason === "extraction_cap")).toHaveLength(1);
    });
  });

  it("processes profiles concurrently without colliding result numbers, double results or double charges", async () => {
    const handles = Array.from({ length: 10 }, (_, i) => `para_${i}`);
    let active = 0;
    let peak = 0;
    const { runner } = setup({
      web: new FixtureWebSearch(links(...handles)),
      profileConcurrency: 4,
      wrap: (p) => ({
        ...p,
        processProfile: async (job, payloadId, raw, hooks) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 20));
          try {
            return await p.processProfile(job, payloadId, raw, hooks);
          } finally {
            active--;
          }
        },
      }),
    });
    const c = await customer();
    const id = await startRun(c, 10);
    await runner.run(id, c.workspaceId);
    expect(peak).toBeGreaterThan(1);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", live: { new: 10, creditsCharged: 50 + 10 * 10, progress: { persistedResults: 10, billableCreators: 10 } } });
    const seqs = await ownerQuery<{ seq: number }>(`select seq from wp.discovery_results where job_id = '${id}' order by seq`);
    expect(seqs.map((r) => r.seq)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(await balance(c)).toMatchObject({ available: 200 - 150, reserved: 0 });
  });

  it("skips a known creator whose stored sample cannot be read instead of failing the run", async () => {
    const known = await addCreator(db, { displayName: "Known One", profiles: [{ platform: "instagram", handle: "known_one" }] });
    const { runner } = setup({
      web: new FixtureWebSearch(links("known_one", "new_a")),
      wrap: (p) => ({ ...p, profileForUrl: async () => { throw new Error("archived payload is missing from storage"); } }),
    });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", outcome: "succeeded" });
    const res = await discovery.results(c, id, 0);
    expect(res.results.some((r) => r.id === known)).toBe(false);
    expect(res.results.length).toBeGreaterThan(0);
    expect(row(await trailOf(id), "known_one")).toMatchObject({ stage: "selection", decision: "skipped", reason: "stored_sample_unreadable" });
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
    // Three attempts update the same rows; the selected candidates end as failed by the run, nothing stays pending.
    const trail = await trailOf(id2);
    expect(new Set(trail.map((r) => r.candidate_key)).size).toBe(trail.length);
    expect(trail.filter((r) => r.decision === "pending")).toEqual([]);
    expect(trail.filter((r) => r.reason === "run_failed").length).toBeGreaterThan(0);
  });
});
