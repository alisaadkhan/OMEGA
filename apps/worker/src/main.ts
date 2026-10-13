import { Redis } from "@upstash/redis";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, providerCallsSince, providerSpendSince, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createBudgetGuard, createYouTubeAudienceSource, createLlm, createObjectStorage, createPayments, createProfileScraper, createSearchIndex, createSearchLimitGuard, createSerperSearch, createYouTubeSearch } from "@mushin/integrations";
import { createAudienceRunner } from "../../api/src/modules/audience/index";
import { createBillingService, createRedisAccessCache, noAccessCache } from "../../api/src/modules/billing/index";
import { createCreatorIndexer, createEnrichmentPipeline, createEraser, createSummaryWriter, getEnrichmentSettings } from "../../api/src/modules/creators/index";
import { createCachedSearch, createDiscoveryRunner, createLiveRunner } from "../../api/src/modules/discovery/index";
import { audienceHandlers } from "./audience-handlers";
import { billingHandlers, notifyHandlers } from "./billing-handlers";
import { creatorHandlers } from "./creator-handlers";
import { discoveryHandlers } from "./discovery-handlers";
import { erasureHandlers } from "./erasure-handlers";
import { startBoss } from "./boss";
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
const cache = config.upstash ? createRedisAccessCache(new Redis({ url: config.upstash.url, token: config.upstash.token }), logger) : noAccessCache;
const billing = createBillingService({ db, payments, cache, logger });
const searchIndex = config.search ? createSearchIndex(config.search, logger) : null;
const indexer = createCreatorIndexer({ db, index: searchIndex, logger });
const llm = createLlm(config.llm, { sink: createDbProviderCallSink(db), logger });
const summaries = createSummaryWriter({ db, llm, logger });
const enrichment = await db.withSystem((tx) => getEnrichmentSettings(tx));
const scraper = createProfileScraper({
  apify: config.scraping.apifyToken
    ? { token: config.scraping.apifyToken, instagramActor: config.scraping.instagramActor, ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}), tiktokActor: config.scraping.tiktokActor, ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}), ...(config.scraping.instagramPostActor ? { instagramPostActor: config.scraping.instagramPostActor } : {}), ...(config.scraping.instagramPostBuild ? { instagramPostBuild: config.scraping.instagramPostBuild } : {}) }
    : null,
  youtubeApiKey: config.scraping.youtubeApiKey,
  tiktokVideos: enrichment.tiktokRecentVideos,
  youtubeVideos: enrichment.recentPosts,
  spendGuard: createBudgetGuard({ budgetUsd: config.scraping.apifyMonthlyBudgetUsd, spentSince: (since) => providerSpendSince(db, "apify", since) }),
  sink: createDbProviderCallSink(db),
  logger,
});
if (!config.scraping.apifyToken) logger.warn("APIFY_TOKEN not set: Instagram and TikTok jobs will fail and refund");
if (!config.scraping.youtubeApiKey) logger.warn("YOUTUBE_API_KEY not set: YouTube jobs will fail and refund");
const pipeline = createEnrichmentPipeline({ db, scraper, storage: createObjectStorage(config.storage, logger), llm, encryptionKey: config.dataEncryptionKey, logger });
const runner = createDiscoveryRunner({ db, billing, pipeline, logger });
const web = createSerperSearch({
  apiKey: config.scraping.serperApiKey,
  limit: createSearchLimitGuard({ limit: config.scraping.serperMonthlySearchLimit, countSince: (since) => providerCallsSince(db, "serper", since) }),
  sink: createDbProviderCallSink(db),
  logger,
});
if (!config.scraping.serperApiKey) logger.warn("SERPER_API_KEY not set: Find New Creators runs will fail and refund");
const searchCache = createCachedSearch({ db, web, ...(config.scraping.youtubeSearch ? { youtube: createYouTubeSearch({ apiKey: config.scraping.youtubeApiKey, sink: createDbProviderCallSink(db), logger }) } : {}) });
const liveRunner = createLiveRunner({ db, billing, pipeline, scraper, search: searchCache, llm, logger, contentResolutionMax: config.scraping.contentResolutionMax, extractionMultiplier: config.scraping.extractionMultiplier, profileConcurrency: config.scraping.profileConcurrency });
// Audience estimates run only for sources the operator enabled (AUDIENCE_SOURCES); otherwise queued jobs are refunded.
const audienceRunner = createAudienceRunner({
  db,
  billing,
  youtube: config.audienceSources.includes("youtube") ? createYouTubeAudienceSource({ apiKey: config.scraping.youtubeApiKey, sink: createDbProviderCallSink(db), logger }) : null,
  logger,
});
if (config.audienceSources.length === 0) logger.info("AUDIENCE_SOURCES not set: audience estimates are off");
const eraser = createEraser({ db, storage: pipeline.storage, logger });
// PostgreSQL search is the default. When configured, Meilisearch is dual-written for rollback during the cutover.
await indexer.ensureSettings().catch((err: unknown) => logger.error({ err }, "could not apply rollback search index settings"));
await pipeline.ensureBuckets().catch((err: unknown) => logger.error({ err }, "could not create the storage buckets"));
const worker = await startWorker({
  db,
  boss,
  logger,
  handlers: { ...defaultHandlers(db), ...billingHandlers(billing), ...notifyHandlers(), ...creatorHandlers({ indexer, summaries }), ...discoveryHandlers({ runner, liveRunner, searchCache, pipeline }), ...erasureHandlers({ eraser }), ...audienceHandlers({ runner: audienceRunner }) },
});
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
