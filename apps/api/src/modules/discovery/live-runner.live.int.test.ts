import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { createLogger, loadWorkerConfig, type TenantContext } from "@mushin/core";
import { createDbProviderCallSink, providerCallsSince, providerSpendSince } from "@mushin/db";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createBudgetGuard, createLlm, createProfileScraper, createSearchLimitGuard, createSerperSearch, MemoryStorage, MockLlm, MockPayments } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEnrichmentPipeline, standardize } from "../creators/index";
import { TEST_KEY } from "../creators/test-fixtures";
import { evaluateCampaignFit } from "./fit";
import { createCachedSearch } from "./live/cache";
import { collectCandidates } from "./live/candidates";
import { createLiveRunner } from "./live-runner";
import { createDiscoveryService } from "./service";

const live = process.env["LIVE_DISCOVERY_E2E"] === "1";
const realLlm = process.env["LIVE_DISCOVERY_REAL_LLM_E2E"] === "1";
const selectedPlatform = process.env["LIVE_DISCOVERY_PLATFORM"];
const platforms = ["instagram", "tiktok", "youtube"] as const;
type TestPlatform = (typeof platforms)[number];
const platform: TestPlatform | "all" | null = selectedPlatform === "all" ? "all" : platforms.includes(selectedPlatform as TestPlatform) ? selectedPlatform as TestPlatform : null;
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const sink = createDbProviderCallSink(db);
const config = live ? loadWorkerConfig(process.env) : null;
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => undefined });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const discovery = createDiscoveryService({ db, billing });

beforeEach(async () => {
  if (live) await resetTables();
});
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  const workspace = await createTestWorkspace();
  await db.withTenant(workspace, (tx) => billing.startTrial(tx, workspace.workspaceId));
  return { ...workspace, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}

describe.skipIf(!live || !realLlm || !platform)("Live Discovery platform end-to-end with real providers and local PostgreSQL", () => {
  it(`discovers, persists, delivers and settles ${platform ?? "an explicitly selected platform"}`, async () => {
    if (!config) throw new Error("LIVE_DISCOVERY_E2E must be enabled");
    if (!platform) throw new Error("LIVE_DISCOVERY_PLATFORM must be instagram, tiktok, youtube, or all");
    if (!realLlm) throw new Error("LIVE_DISCOVERY_REAL_LLM_E2E=1 is required; fixtures do not verify the real workflow");
    if (!config.scraping.serperApiKey || config.llm.length === 0) throw new Error("Real Serper and hosted LLM credentials are required");
    if (platform === "youtube" ? !config.scraping.youtubeApiKey : platform === "all" ? (!config.scraping.apifyToken || !config.scraping.youtubeApiKey) : !config.scraping.apifyToken) throw new Error("Platform extraction credentials are missing");
    const initial = await customer();
    const availableBefore = (await billing.summary(initial)).balance.available;
    const platformFilter = platform === "all" ? {} : { platform };
    const briefs: Record<TestPlatform | "all", { text: string; filters: Record<string, unknown> }> = {
      instagram: { text: "Pakistani food blogger in Karachi", filters: { ...platformFilter, creatorCity: "Karachi", niches: ["Food"] } },
      tiktok: { text: "Pakistani travel vlogger in Karachi", filters: { ...platformFilter, creatorCity: "Karachi", niches: ["Travel"] } },
      youtube: { text: "لاہور میں کھانے کے بلاگر", filters: { ...platformFilter, creatorCountry: "PK", niches: ["Food"] } },
      all: { text: "Lahore ke khana bloggers", filters: { creatorCity: "Lahore", creatorCountry: "PK", niches: ["Food"] } },
    };
    const selectedBrief = briefs[platform];
    const search = { text: selectedBrief.text, filters: searchFiltersSchema.parse(selectedBrief.filters) };
    const maxNew = 5;
    const quote = await discovery.createEstimate(initial, { search, maxNew });
    const confirmation = await discovery.start(initial, { kind: "live", estimateId: quote.estimateId });
    if (confirmation.body.status !== "started") throw new Error("expected a confirmed live job");
    const jobId = confirmation.body.job.id;
    expect((await billing.summary(initial)).balance.reserved).toBe(quote.maxCredits);

    const scraper = createProfileScraper({
      apify: config.scraping.apifyToken
        ? {
            token: config.scraping.apifyToken,
            instagramActor: config.scraping.instagramActor,
            ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}),
            tiktokActor: config.scraping.tiktokActor,
            ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}),
          }
        : null,
      youtubeApiKey: config.scraping.youtubeApiKey,
      tiktokVideos: 3,
      youtubeVideos: 3,
      spendGuard: createBudgetGuard({ budgetUsd: config.scraping.apifyMonthlyBudgetUsd, spentSince: (since) => providerSpendSince(db, "apify", since) }),
      sink,
      logger,
    });
    const web = createSerperSearch({
      apiKey: config.scraping.serperApiKey,
      limit: createSearchLimitGuard({ limit: config.scraping.serperMonthlySearchLimit, countSince: (since) => providerCallsSince(db, "serper", since) }),
      sink,
      logger,
    });
    const llm = realLlm
      ? createLlm(config.llm, { sink, logger })
      : new MockLlm((request) => {
      if (request.feature === "discovery_relevance") {
        const count = (request.input.match(/^\d+\. /gm) ?? []).length;
        return { keep: Array.from({ length: count }, (_, i) => ({ i, reason: "Public Instagram profile returned for the targeted food-creator search" })) };
      }
      const range = /Range: (\d+)–(\d+)/.exec(request.input);
      const score = range ? Math.round((Number(range[1]) + Number(range[2])) / 2) : null;
      return {
        verdict: score === null ? null : score >= 80 ? "genuine" : score >= 60 ? "mostly genuine" : score >= 40 ? "mixed signals" : "likely inflated",
        score,
        evidence: score === null ? [] : [{ signal: "posting_regularity", detail: "Measured from sampled public posts." }],
        watchOuts: [],
        audience: { age: [], gender: null, cities: [], countries: [] },
        niches: [],
        creatorCity: null,
        creatorCountry: null,
        minorSigns: { likely: false, reason: "" },
      };
      });
    const storage = new MemoryStorage();
    const pipeline = createEnrichmentPipeline({ db, scraper, storage, llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
    const cached = createCachedSearch({ db, web });
    const observedQueries: { platform: string; query: string; hl: string; round: number }[] = [];
    const observedGroups: { platform: TestPlatform; results: Awaited<ReturnType<typeof cached.search>> }[] = [];
    const searchAdapter = {
      async search(q: Parameters<typeof cached.search>[0], ctx: Parameters<typeof cached.search>[1]) {
        observedQueries.push({ platform: q.platform, query: q.query, hl: q.hl, round: q.round });
        const found = await cached.search(q, ctx);
        observedGroups.push({ platform: q.platform, results: found });
        return found;
      },
    };
    const startedAt = Date.now();
    const runner = createLiveRunner({ db, billing, pipeline, scraper, search: searchAdapter, llm, logger, maxAttempts: 2 });
    await runner.run(jobId, initial.workspaceId);

    const job = await discovery.get(initial, jobId);
    const results = await discovery.results(initial, jobId, 0);
    const elapsedMs = Date.now() - startedAt;
    const uniqueCandidates = collectCandidates(observedGroups);
    const payloads = await ownerQuery<{ platform: TestPlatform; canonical_url: string; storage_key: string; creator_id: string | null; fetched_at: Date | string; visible: boolean }>(`select r.platform, r.canonical_url, r.storage_key, r.creator_id, r.fetched_at,
      coalesce(c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null), false) visible
      from platform.raw_payloads r left join gcp.creators c on c.id = r.creator_id where r.job_id = '${jobId}' order by r.fetched_at`);
    const deliveredCreatorIds = new Set((await ownerQuery<{ creator_id: string }>(`select creator_id from wp.discovery_results where job_id = '${jobId}'`)).map((row) => row.creator_id));
    const excludedReasons: Record<string, number> = {};
    const byPlatform: Record<TestPlatform, { extractionAttempts: number; standardizedProfiles: number; delivered: number; excludedReasons: Record<string, number> }> = {
      instagram: { extractionAttempts: 0, standardizedProfiles: 0, delivered: 0, excludedReasons: {} },
      tiktok: { extractionAttempts: 0, standardizedProfiles: 0, delivered: 0, excludedReasons: {} },
      youtube: { extractionAttempts: 0, standardizedProfiles: 0, delivered: 0, excludedReasons: {} },
    };
    const reject = (p: TestPlatform, reason: string) => {
      excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
      byPlatform[p].excludedReasons[reason] = (byPlatform[p].excludedReasons[reason] ?? 0) + 1;
    };
    for (const payload of payloads) {
      byPlatform[payload.platform].extractionAttempts++;
      const bytes = await storage.get("raw-payloads", payload.storage_key);
      const candidate = uniqueCandidates.find((item) => item.canonicalUrl === payload.canonical_url);
      if (!bytes || !candidate) { reject(payload.platform, "payload_or_candidate_missing"); continue; }
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const normalized = standardize(payload.platform, candidate.handle, raw, { maxPosts: 12 });
      if (normalized.kind !== "ok") { reject(payload.platform, normalized.kind); continue; }
      byPlatform[payload.platform].standardizedProfiles++;
      const fetchedAt = payload.fetched_at instanceof Date ? payload.fetched_at : new Date(payload.fetched_at);
      const fit = evaluateCampaignFit(search, { ...candidate, reason: null }, normalized.profile, !payload.visible, new Date(), fetchedAt);
      if (!fit.eligible) reject(payload.platform, fit.gate ?? "below_min_fit");
      else if (payload.creator_id && deliveredCreatorIds.has(payload.creator_id)) byPlatform[payload.platform].delivered++;
      else reject(payload.platform, "eligible_not_delivered");
    }
    const providerCalls = await ownerQuery<{ provider: string; operation: string; status: string; count: number; totalMs: number; maxMs: number }>(`
      select provider, operation, status, count(*)::int count, coalesce(sum(latency_ms),0)::int "totalMs", coalesce(max(latency_ms),0)::int "maxMs"
      from platform.provider_calls where job_id = '${jobId}' group by provider, operation, status order by provider, operation, status`);
    process.stdout.write(`${JSON.stringify({ liveDiscoveryRun: { platform, brief: search.text, queries: observedQueries, progress: job.live?.progress,
      status: job.status, outcome: job.outcome, delivered: results.results.length,
      credits: job.live ? { reserved: quote.maxCredits, charged: job.live.creditsCharged, released: quote.maxCredits - job.live.creditsCharged } : null,
      uniqueCandidates: uniqueCandidates.length, duplicateUrlsRejected: Math.max(0, (job.live?.progress.serpResultsSeen ?? 0) - uniqueCandidates.length),
      byPlatform, excludedReasons, providerCalls, elapsedMs } })}\n`);
    expect(job.status).toBe("completed");
    expect(["succeeded", "completed_empty"]).toContain(job.outcome);
    if (!job.live) throw new Error("completed live job is missing settlement details");
    expect(results.done).toBe(true);
    for (const result of results.results) {
      expect(result.campaignFit).toMatchObject({ eligible: true, sourceUrl: expect.stringMatching(/^https:\/\//), evidence: expect.arrayContaining([expect.any(String)]) });
    }

    const balance = (await billing.summary(initial)).balance;
    expect(balance.reserved).toBe(0);
    expect(balance.available).toBe(availableBefore - job.live.creditsCharged);
    const resultCredits = await ownerQuery<{ credits: number }>(`select coalesce(sum(credits), 0)::int credits from wp.discovery_results where job_id = '${jobId}'`);
    expect(job.live.creditsCharged).toBe(results.results.length > 0 ? 12 + (resultCredits[0]?.credits ?? 0) : 0);
    if (results.results.length > 0) expect(job.outcome).toBe("succeeded");
    else expect(job.outcome).toBe("completed_empty");
    expect(job.live.creditsCharged).toBeLessThanOrEqual(quote.maxCredits);
    const persisted = await ownerQuery<{ profiles: number; payloads: number; serper: number; apify: number; youtube: number; llm: number }>(`
      select (select count(*)::int from gcp.creator_profiles p join platform.raw_payloads r on r.creator_id = p.creator_id where r.job_id = '${jobId}') profiles,
        (select count(*)::int from platform.raw_payloads where job_id = '${jobId}') payloads,
        (select count(*)::int from platform.provider_calls where job_id = '${jobId}' and provider = 'serper' and status = 'ok') serper,
        (select count(*)::int from platform.provider_calls where job_id = '${jobId}' and provider = 'apify' and status = 'ok') apify,
        (select count(*)::int from platform.provider_calls where job_id = '${jobId}' and provider = 'youtube' and status = 'ok') youtube,
        (select count(*)::int from platform.provider_calls where job_id = '${jobId}' and provider in ('groq','ollama') and status = 'ok') llm`);
    expect(persisted[0]?.profiles).toBeGreaterThan(0);
    expect(persisted[0]?.payloads).toBeGreaterThan(0);
    expect(persisted[0]?.serper).toBeGreaterThan(0);
    if (platform === "youtube") expect(persisted[0]?.youtube).toBeGreaterThan(0);
    else if (platform === "all") expect((persisted[0]?.apify ?? 0) + (persisted[0]?.youtube ?? 0)).toBeGreaterThan(0);
    else expect(persisted[0]?.apify).toBeGreaterThan(0);
    expect(persisted[0]?.llm).toBeGreaterThan(0);
    expect(observedQueries.length).toBeGreaterThan(0);
  }, 600_000);
});
