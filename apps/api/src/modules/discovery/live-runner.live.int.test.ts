import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { createLogger, loadWorkerConfig, type TenantContext } from "@mushin/core";
import { createDbProviderCallSink, providerCallsSince, providerSpendSince } from "@mushin/db";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createBudgetGuard, createProfileScraper, createSearchLimitGuard, createSerperSearch, MemoryStorage, MockLlm, MockPayments } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEnrichmentPipeline } from "../creators/index";
import { TEST_KEY } from "../creators/test-fixtures";
import { createCachedSearch } from "./live/cache";
import { createLiveRunner } from "./live-runner";
import { createDiscoveryService } from "./service";

const live = process.env["LIVE_DISCOVERY_E2E"] === "1";
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

describe.skipIf(!live)("Live Discovery with real Serper, Apify, and local PostgreSQL", () => {
  it("quotes, reserves, searches, extracts, gates, persists and settles a real creator result", async () => {
    if (!config) throw new Error("LIVE_DISCOVERY_E2E must be enabled");
    const initial = await customer();
    const availableBefore = (await billing.summary(initial)).balance.available;
    const search = {
      text: "Pakistani food blogger in Karachi",
      filters: searchFiltersSchema.parse({ platform: "instagram", creatorCity: "Karachi", niches: ["Food"] }),
    };
    const quote = await discovery.createEstimate(initial, { search, maxNew: 5 });
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
    const llm = new MockLlm((request) => {
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
    const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
    const runner = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm, logger, maxAttempts: 1 });
    await runner.run(jobId, initial.workspaceId);

    const job = await discovery.get(initial, jobId);
    expect(job).toMatchObject({ status: "completed", outcome: "succeeded", live: { creditsCharged: expect.any(Number), progress: { persistedResults: expect.any(Number), billableCreators: expect.any(Number) } } });
    if (!job.live) throw new Error("completed live job is missing settlement details");
    const results = await discovery.results(initial, jobId, 0);
    expect(results.results.length).toBeGreaterThan(0);
    expect(results.done).toBe(true);
    for (const result of results.results) {
      expect(result.campaignFit).toMatchObject({ eligible: true, sourceUrl: expect.stringMatching(/^https:\/\//), evidence: expect.arrayContaining([expect.any(String)]) });
    }

    const balance = (await billing.summary(initial)).balance;
    expect(balance.reserved).toBe(0);
    expect(balance.available).toBe(availableBefore - job.live.creditsCharged);
    expect(job.live.creditsCharged).toBe(12 + 10 * job.live.new);
    expect(job.live.creditsCharged).toBeLessThanOrEqual(quote.maxCredits);
    const persisted = await ownerQuery<{ profiles: number; payloads: number; serper: number; apify: number }>(`
      select (select count(*)::int from gcp.creator_profiles p join platform.raw_payloads r on r.creator_id = p.creator_id where r.job_id = '${jobId}') profiles,
        (select count(*)::int from platform.raw_payloads where job_id = '${jobId}') payloads,
        (select count(*)::int from platform.provider_calls where job_id = '${jobId}' and provider = 'serper' and status = 'ok') serper,
        (select count(*)::int from platform.provider_calls where job_id = '${jobId}' and provider = 'apify' and status = 'ok') apify`);
    expect(persisted[0]?.profiles).toBeGreaterThan(0);
    expect(persisted[0]?.payloads).toBeGreaterThan(0);
    expect(persisted[0]?.serper).toBeGreaterThan(0);
    expect(persisted[0]?.apify).toBeGreaterThan(0);
  }, 600_000);
});
