/**
 * Runs the worker's 20-day YouTube refresh (apps/api/src/modules/creators/youtube-refresh.ts) against a local
 * catalogue, for when no worker is running: the same due rule (stored YouTube API data 20+ days old and still inside the
 * 30-day limit, active creators), the same pipeline.refreshKnown (official YouTube Data API only), a few channels at a
 * time. A successful refresh saves the new reading and resets the clock; a failed one moves nothing. Then sync the
 * catalogue to staging with load-staging.ts (fresher data wins) and sync-avatars.ts. Owner approval 2026-11-15.
 * No Apify client is built, so nothing paid can run; AI calls (niche) go through the budget gate.
 *
 *   node --env-file=.env --import tsx scripts/catalog/youtube-refresh.ts --db mushin_catalog_v4 [--limit 20] [--concurrency 4] [--cap 2]
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, createDbProviderRunStore, llmSpendSince } from "@mushin/db";
import { createLlm, createProfileScraper, type Llm } from "@mushin/integrations";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createCreatorIndexer, createEnrichmentPipeline, getEnrichmentSettings, REFRESH_AFTER_DAYS } from "../../apps/api/src/modules/creators/index";
import { createBudgetGate } from "./budget";
import { fileStorage } from "./file-storage";

const { values } = parseArgs({ options: { db: { type: "string" }, limit: { type: "string", default: "5000" }, concurrency: { type: "string", default: "4" }, cap: { type: "string", default: "2" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const capUsd = Number(values.cap);
if (!(capUsd > 0 && capUsd <= 25)) throw new Error("--cap must be between 0 and 25 USD");
const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const config = loadWorkerConfig({ ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_FILE: "", SEARCH_PROFILE: "v2", YOUTUBE_API_CALLS: "on" });
if (!config.scraping.youtubeApiKey) throw new Error("YOUTUBE_API_KEY is not set");
const logger = createLogger({ level: "warn", name: "youtube-refresh" });
const db = createDatabase(url, { max: 6, applicationName: "youtube-refresh", caPem: null });
const ownerSql = postgres(url, { max: 2, onnotice: () => {} });
const gate = await createBudgetGate(ownerSql, { capUsd, since: new Date("2026-10-20T00:00:00.000Z") });
const sink = createDbProviderCallSink(db);
const llmRaw = createLlm(config.llm, { sink, logger, budget: { budgetUsd: Math.min(config.llmMonthlyBudgetUsd, capUsd), spentSince: (since) => llmSpendSince(db, since) } });
const llm: Llm = { complete: (req) => gate.guard(0.01, () => llmRaw.complete(req)) };
const enrichment = await db.withSystem((tx) => getEnrichmentSettings(tx));
// YouTube only: without an Apify client an Instagram or TikTok request fails instead of spending.
// The paid-scrape guard refuses every unit, as a second lock.
const noPaidScrapes = { begin: async () => { throw new Error("paid scraping is not allowed in the YouTube refresh"); } };
const scraper = createProfileScraper({ apify: null, youtubeApiKey: config.scraping.youtubeApiKey, tiktokVideos: enrichment.tiktokRecentVideos, youtubeVideos: enrichment.recentPosts, spendGuard: noPaidScrapes, runs: createDbProviderRunStore(db), sink, logger });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const pipeline = createEnrichmentPipeline({ db, scraper, storage: fileStorage(join(root, ".catalog-storage", dbName)), llm, encryptionKey: config.dataEncryptionKey, logger, attributePolicy: config.enrichment.attributePolicy, youtube: { contentEvidence: config.enrichment.youtubeContentEvidence, descriptionContacts: config.enrichment.youtubeDescriptionContacts }, semanticNiche: config.enrichment.semanticNiche });

// The worker's due rule (youtube-refresh.ts): 20+ days old, still inside the 30-day limit, oldest first.
const due = await db.withSystem((tx) =>
  tx.execute<{ canonical_url: string }>(sql`
    select p.canonical_url from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
    where p.platform = 'youtube' and c.status = 'active' and p.followers is not null
      and coalesce(p.last_scraped_at, p.created_at) <= now() - make_interval(days => ${REFRESH_AFTER_DAYS})
      and coalesce(p.last_scraped_at, p.created_at) > now() - interval '30 days'
    order by coalesce(p.last_scraped_at, p.created_at) limit ${Number(values.limit)}`),
);
const report = { due: due.length, refreshed: 0, unavailable: 0, failed: 0, errors: {} as Record<string, number> };
const queue = [...due];
const started = Date.now();
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const handle = decodeURIComponent(new URL(r.canonical_url).pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/^@/, "");
        const out = await pipeline.refreshKnown({ platform: "youtube", handle, canonicalUrl: r.canonical_url });
        if (out.kind === "saved" || out.kind === "reused") report.refreshed++;
        else report.unavailable++;
      } catch (err) {
        report.failed++;
        const k = err instanceof Error ? err.message.replace(/[0-9a-f-]{36}|@[\w.-]+|\d+/g, "#").slice(0, 80) : "unknown";
        report.errors[k] = (report.errors[k] ?? 0) + 1;
      }
      const done = report.refreshed + report.unavailable + report.failed;
      if (done % 100 === 0) console.error(`${done}/${due.length} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  }),
);
// The local search projection follows (the worker does this from the outbox).
await createCreatorIndexer({ db, index: null, logger, sourcePolicy: config.sourcePolicy }).reconcile();
const [units] = await ownerSql<{ calls: number; units: number }[]>`
  select count(*)::int calls, coalesce(sum(units), 0)::int units from platform.provider_calls where provider = 'youtube' and created_at >= ${new Date(started)}`;
console.log(JSON.stringify({ ...report, youtubeCalls: units?.calls, youtubeQuotaUnits: units?.units, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
await ownerSql.end();
await db.close();
