import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, createDbProviderRunStore, createDbReservationLedger, llmSpendSince, providerPaused, recordAlertEvent, recordWorkerHeartbeat, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createApifyClient, createSharedSpendGuard, reconcileApifyRuns, createYouTubeAudienceSource, createLlm, pausableGuard, pausableLlm, createObjectStorage, createPayments, createProfileScraper, createSearchIndex, createSerperSearch, createYouTubeSearch } from "@mushin/integrations";
import { createAudienceRunner } from "../../api/src/modules/audience/index";
import { createBillingService, noAccessCache } from "../../api/src/modules/billing/index";
import { createContactChecker, createCreatorIndexer, createEnrichmentPipeline, createEraser, createSummaryWriter, getEnrichmentSettings, expireYoutubeApiData, lifecycleSweep, refreshDueYoutube, systemMailResolver } from "../../api/src/modules/creators/index";
import { createCachedSearch, createDiscoveryRunner, createLiveRunner } from "../../api/src/modules/discovery/index";
import { audienceHandlers } from "./audience-handlers";
import { billingHandlers, notifyHandlers } from "./billing-handlers";
import { creatorHandlers } from "./creator-handlers";
import { discoveryHandlers } from "./discovery-handlers";
import { contactCheckHandlers, erasureHandlers } from "./erasure-handlers";
import { startBoss } from "./boss";
import { checkProviderStatus } from "./provider-status";
import { defaultHandlers } from "./handlers";
import { startWorker } from "./worker";

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "worker" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
// Queries share the transaction pooler; only pg-boss and LISTEN hold session connections (about 4 in all), so the
// worker fits within the session pooler's small client limit next to the API and one-off scripts.
const db = createDatabase(config.databaseUrl, { max: 5, applicationName: "mushin-worker", caPem: config.databaseCaPem, listenUrl: config.directUrl });
const boss = await startBoss(config.directUrl, logger, config.databaseCaPem);
const payments = createPayments(config.payments, { sink: createDbProviderCallSink(db), logger });
const cache = noAccessCache;
const billing = createBillingService({ db, payments, cache, logger });
const searchIndex = config.search ? createSearchIndex(config.search, logger) : null;
const indexer = createCreatorIndexer({ db, index: searchIndex, logger, sourcePolicy: config.sourcePolicy });
// Every hosted-LLM call is checked against the monthly LLM budget (recorded Gemini + Ollama spend, plus earlier Groq).
const llmSpentSince = (since: Date) => llmSpendSince(db, since);
// Operations can pause a provider family from the staff console (platform.provider_controls); paused means refused.
const llm = pausableLlm(createLlm(config.llm, { sink: createDbProviderCallSink(db), logger, budget: { budgetUsd: config.llmMonthlyBudgetUsd, spentSince: llmSpentSince } }), () => providerPaused(db, "llm"));
const summaries = createSummaryWriter({ db, llm, logger });
const enrichment = await db.withSystem((tx) => getEnrichmentSettings(tx));
const reservations = createDbReservationLedger(db);
const providerRuns = createDbProviderRunStore(db);
const scraper = createProfileScraper({
  apify: config.scraping.apifyToken
    ? { token: config.scraping.apifyToken, instagramActor: config.scraping.instagramActor, ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}), tiktokActor: config.scraping.tiktokActor, ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}), ...(config.scraping.instagramPostActor ? { instagramPostActor: config.scraping.instagramPostActor } : {}), ...(config.scraping.instagramPostBuild ? { instagramPostBuild: config.scraping.instagramPostBuild } : {}) }
    : null,
  youtubeApiKey: config.scraping.youtubeApiKey,
  tiktokVideos: enrichment.tiktokRecentVideos,
  youtubeVideos: enrichment.recentPosts,
  // Audit SRCH-05: the monthly cap is reserved in PostgreSQL, so it holds across every worker process.
  spendGuard: pausableGuard(createSharedSpendGuard({ ledger: reservations, provider: "apify", limit: config.scraping.apifyMonthlyBudgetUsd, perUnit: 0.05, label: "Apify budget (USD)" }), () => providerPaused(db, "apify"), "Apify"),
  // Audit SRCH-04: paid runs are recorded before waiting, resumed on retry, capped by Apify, reconciled hourly.
  runs: providerRuns,
  sink: createDbProviderCallSink(db),
  logger,
});
const reconcileProviderRuns = async () => {
  if (!config.scraping.apifyToken) return;
  const tally = await reconcileApifyRuns({ runs: providerRuns, apify: createApifyClient({ token: config.scraping.apifyToken }), sink: createDbProviderCallSink(db), logger });
  if (tally.settled + tally.aborted + tally.unknown > 0) logger.warn(tally, "reconciled Apify runs left open by an earlier failure");
};
if (!config.scraping.apifyToken) logger.warn("APIFY_TOKEN not set: Instagram and TikTok jobs will fail and refund");
if (!config.scraping.youtubeApiKey) logger.warn("YouTube API calls are off (YOUTUBE_API_CALLS) or YOUTUBE_API_KEY is not set: YouTube jobs fail as not configured and are refunded");
const pipeline = createEnrichmentPipeline({ db, scraper, storage: createObjectStorage(config.storage, logger), llm, encryptionKey: config.dataEncryptionKey, logger, attributePolicy: config.enrichment.attributePolicy, youtube: { contentEvidence: config.enrichment.youtubeContentEvidence, descriptionContacts: config.enrichment.youtubeDescriptionContacts }, semanticNiche: config.enrichment.semanticNiche });
const runner = createDiscoveryRunner({ db, billing, pipeline, logger });
const web = createSerperSearch({
  apiKey: config.scraping.serperApiKey,
  limit: pausableGuard(createSharedSpendGuard({ ledger: reservations, provider: "serper", limit: config.scraping.serperMonthlySearchLimit, perUnit: 1, label: "Serper search limit" }), () => providerPaused(db, "serper"), "Serper"),
  sink: createDbProviderCallSink(db),
  logger,
});
if (!config.scraping.serperApiKey) logger.warn("SERPER_API_KEY not set: Find New Creators runs will fail and refund");
const searchCache = createCachedSearch({ db, web, ...(config.scraping.youtubeSearch ? { youtube: createYouTubeSearch({ apiKey: config.scraping.youtubeApiKey, sink: createDbProviderCallSink(db), logger }) } : {}) });
const liveRunner = createLiveRunner({ searchProfile: config.searchProfile, sourcePolicy: config.sourcePolicy, db, billing, pipeline, scraper, search: searchCache, llm, logger, contentResolutionMax: config.scraping.contentResolutionMax, extractionMultiplier: config.scraping.extractionMultiplier, profileConcurrency: config.scraping.profileConcurrency, jobCostCap: config.scraping.jobCostCap, jobDeadlineMs: config.scraping.jobDeadlineMs });
// Audience estimates run only for sources the operator enabled (AUDIENCE_SOURCES); otherwise queued jobs are refunded.
const audienceRunner = createAudienceRunner({
  db,
  billing,
  youtube: config.audienceSources.includes("youtube") ? createYouTubeAudienceSource({ apiKey: config.scraping.youtubeApiKey, sink: createDbProviderCallSink(db), logger }) : null,
  logger,
});
if (config.audienceSources.length === 0) logger.info("AUDIENCE_SOURCES not set: audience estimates are off");
const eraser = createEraser({ db, storage: pipeline.storage, logger });
const contactChecker = createContactChecker({ db, encryptionKey: config.dataEncryptionKey, resolver: systemMailResolver(), logger });
// PostgreSQL search is the default. When configured, Meilisearch is dual-written for rollback during the cutover.
await indexer.ensureSettings().catch((err: unknown) => logger.error({ err }, "could not apply rollback search index settings"));
// A newly enabled, emptied or restored Meilisearch would otherwise answer "no creators" until the nightly reconcile:
// compare it with PostgreSQL once at start-up (only differences are written). Runs in the background.
void indexer
  .reconcile()
  .then((r) => logger.info(r, "search projections reconciled at start-up"))
  .catch((err: unknown) => logger.error({ err }, "start-up search reconcile failed; the nightly reconcile will retry"));
await pipeline.ensureBuckets().catch((err: unknown) => logger.error({ err }, "could not create the storage buckets"));
const worker = await startWorker({
  db,
  boss,
  logger,
  handlers: { ...defaultHandlers(db, { reconcileProviderRuns, checkProviders: () => checkProviderStatus({ db, config }) }), ...billingHandlers(billing), ...notifyHandlers(), ...creatorHandlers({ indexer, summaries, expireYoutube: () => expireYoutubeApiData(db, pipeline.storage ? { storage: pipeline.storage } : {}),
      refreshYoutube: config.scraping.youtubeApiKey ? () => refreshDueYoutube({ db, refresh: pipeline.refreshKnown, onError: (err, url) => logger.warn({ err, url }, "YouTube refresh failed; retried tomorrow") }) : null,
      alert: (e) => db.withSystem((tx) => recordAlertEvent(tx, e)), sweep: () => lifecycleSweep({ db, apply: true, reproject: (ids) => indexer.sync(ids) }) }), ...discoveryHandlers({ runner, liveRunner, searchCache, pipeline }), ...erasureHandlers({ eraser }), ...contactCheckHandlers({ checker: contactChecker }), ...audienceHandlers({ runner: audienceRunner }) },
});
// Report alive as soon as the queues run: waiting for the first minute cron left Live Discovery refused ("not running")
// for up to two minutes after every start or deploy (found by the break-it browser run, 2026-10-26).
await db.withSystem((tx) => recordWorkerHeartbeat(tx));
logger.info("worker started");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker shutting down");
  await worker.stop();
  await boss.stop({ graceful: true, close: true });
  await db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
