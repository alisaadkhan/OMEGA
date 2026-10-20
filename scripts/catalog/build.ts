/**
 * Operational catalogue build (search-v2; owner decisions 2026-10-20: up to USD 25 on existing provider accounts; build
 * locally first). Uses the production paths only, with real providers from .env, against a LOCAL catalogue database:
 *   refresh   re-fetch existing creators through discovery refresh jobs (fetch → archive → AI assessment → save with
 *             evidence), so niches, city and country come from the creator's own recent content, never invented;
 *   discover  Live Discovery runs over a general niche × city grid (not shaped by the frozen evaluation queries).
 * Every job runs in an internal "MUSHIN catalogue build" workspace with granted credits; provider spend is read from
 * platform.provider_calls and the build stops at --cap (USD). Archived payloads go to a local file store.
 *
 *   node --env-file=.env --import tsx scripts/catalog/build.ts <refresh|discover> --db mushin_catalog_v2 --cap 20
 *        [--platform youtube] [--limit 50] [--niches food,travel] [--cities Lahore,Karachi]
 * The frozen evaluation corpus (mushin_eval_disposable) is refused as a target.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { searchFiltersSchema, type LiveRunSize } from "@mushin/contracts";
import { createLogger, loadWorkerConfig, type TenantContext } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, createDbProviderRunStore, createDbReservationLedger, providerSpendSince } from "@mushin/db";
import { createLlm, createPayments, createProfileScraper, createSerperSearch, createSharedSpendGuard, createYouTubeSearch, type ObjectStorage } from "@mushin/integrations";
import { sql } from "drizzle-orm";
import { createBillingService, noAccessCache } from "../../apps/api/src/modules/billing/index";
import { createCreatorIndexer, createEnrichmentPipeline, getEnrichmentSettings } from "../../apps/api/src/modules/creators/index";
import { createCachedSearch, createDiscoveryRunner, createDiscoveryService, createLiveRunner } from "../../apps/api/src/modules/discovery/index";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { db: { type: "string" }, cap: { type: "string", default: "20" }, platform: { type: "string" }, limit: { type: "string" }, niches: { type: "string" }, cities: { type: "string" }, size: { type: "string", default: "10" } },
});
const mode = positionals[0];
if (mode !== "refresh" && mode !== "discover") throw new Error("usage: build.ts <refresh|discover> --db <catalogue db> --cap <usd>");
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue database (mushin_catalog_*); the frozen corpus is never a target");
const capUsd = Number(values.cap);
if (!(capUsd > 0 && capUsd <= 25)) throw new Error("--cap must be between 0 and 25 USD (owner cap 2026-10-20)");

const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const config = loadWorkerConfig({ ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_FILE: "", SEARCH_PROFILE: "v2" });
const logger = createLogger({ level: "info", name: "catalog-build" });
const db = createDatabase(url, { max: 4, applicationName: "catalog-build", caPem: null });
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Archived provider payloads and avatars, on local disk (never the staging bucket from .env). */
function fileStorage(root: string): ObjectStorage {
  const path = (bucket: string, key: string) => join(root, bucket, ...key.split("/"));
  return {
    async ensureBucket(bucket) {
      mkdirSync(join(root, bucket), { recursive: true });
    },
    async put(bucket, key, body) {
      mkdirSync(dirname(path(bucket, key)), { recursive: true });
      writeFileSync(path(bucket, key), body);
    },
    async get(bucket, key) {
      return existsSync(path(bucket, key)) ? new Uint8Array(readFileSync(path(bucket, key))) : null;
    },
    async remove(bucket, keys) {
      for (const k of keys) rmSync(path(bucket, k), { force: true });
    },
    publicUrl(bucket, key) {
      return `file://${path(bucket, key)}`;
    },
  };
}

const sink = createDbProviderCallSink(db);
const ledger = createDbReservationLedger(db);
const payments = createPayments(config.payments, { sink, logger });
const billing = createBillingService({ db, payments, cache: noAccessCache, logger });
const llm = createLlm(config.llm, { sink, logger, budget: { budgetUsd: Math.min(config.llmMonthlyBudgetUsd, capUsd), spentSince: async (since) => (await providerSpendSince(db, "groq", since)) + (await providerSpendSince(db, "ollama", since)) } });
const enrichment = await db.withSystem((tx) => getEnrichmentSettings(tx));
const scraper = createProfileScraper({
  apify: config.scraping.apifyToken ? { token: config.scraping.apifyToken, instagramActor: config.scraping.instagramActor, ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}), tiktokActor: config.scraping.tiktokActor, ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}) } : null,
  youtubeApiKey: config.scraping.youtubeApiKey,
  tiktokVideos: enrichment.tiktokRecentVideos,
  youtubeVideos: enrichment.recentPosts,
  spendGuard: createSharedSpendGuard({ ledger, provider: "apify", limit: config.scraping.apifyMonthlyBudgetUsd, perUnit: 0.05, label: "Apify budget (USD)" }),
  runs: createDbProviderRunStore(db),
  sink,
  logger,
});
const pipeline = createEnrichmentPipeline({ db, scraper, storage: fileStorage(join(repo, ".catalog-storage", dbName)), llm, encryptionKey: config.dataEncryptionKey, logger });
const web = createSerperSearch({ apiKey: config.scraping.serperApiKey, limit: createSharedSpendGuard({ ledger, provider: "serper", limit: config.scraping.serperMonthlySearchLimit, perUnit: 1, label: "Serper search limit" }), sink, logger });
const search = createCachedSearch({ db, web, ...(config.scraping.youtubeApiKey ? { youtube: createYouTubeSearch({ apiKey: config.scraping.youtubeApiKey, sink, logger }) } : {}) });
const discovery = createDiscoveryService({ db, billing });
const profileRunner = createDiscoveryRunner({ db, billing, pipeline, logger });
// The worker production settings (cost cap, deadline, content resolution), with extra extraction waves at their configured
// maximum (4) for the build: quality over cost, still bounded by the per-job cost cap.
const liveRunner = createLiveRunner({ searchProfile: "v2", sourcePolicy: config.sourcePolicy, db, billing, pipeline, scraper, search, llm, logger, contentResolutionMax: config.scraping.contentResolutionMax, extractionMultiplier: { instagram: 4, youtube: 4, tiktok: 4 }, profileConcurrency: config.scraping.profileConcurrency, jobCostCap: config.scraping.jobCostCap, jobDeadlineMs: config.scraping.jobDeadlineMs });
const indexer = createCreatorIndexer({ db, index: null, logger, sourcePolicy: config.sourcePolicy });

/** The internal build workspace (owner connection: one person, one workspace, generous adjustment credits). */
async function buildWorkspace(): Promise<TenantContext> {
  const owner = createDatabase(url, { max: 1, applicationName: "catalog-build-owner", caPem: null });
  const found = await db.withSystem((tx) => tx.execute<{ id: string; owner_user_id: string }>(sql`select id, owner_user_id from wp.workspaces where name = 'MUSHIN catalogue build' limit 1`)).catch(() => []);
  let ws = found[0];
  if (!ws) {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const pg = (await import("postgres")).default(url, { max: 1, onnotice: () => {} });
    await pg.begin(async (tx) => {
      await tx`insert into wp.users (id, email, display_name) values (${userId}, ${"catalogue-build@mushin.invalid"}, ${"Catalogue build"})`;
      await tx`insert into wp.workspaces (id, name, owner_user_id) values (${workspaceId}, ${"MUSHIN catalogue build"}, ${userId})`;
      await tx`insert into wp.workspace_members (workspace_id, user_id, role) values (${workspaceId}, ${userId}, 'owner')`;
    });
    await pg.end();
    ws = { id: workspaceId, owner_user_id: userId };
  }
  await owner.close();
  const ctx: TenantContext = { userId: ws.owner_user_id, workspaceId: ws.id, requestId: `catalog-build-${Date.now()}`, role: "owner" };
  // Credit actions need a plan, as for every workspace: the standard trial subscription (a no-op once it exists).
  await db.withTenant({ userId: ctx.userId, workspaceId: ctx.workspaceId }, (tx) => billing.startTrial(tx, ctx.workspaceId));
  await db.withWorkspace(ctx.workspaceId, (tx) => billing.engine.grant(tx, ctx.workspaceId, { source: "adjustment", amount: 1_000_000, expiresAt: new Date(Date.now() + 7 * 86_400_000), sourceRef: `catalog-build-${randomUUID()}`, note: "Catalogue build credits (internal)" }));
  return ctx;
}

const started = new Date();
const spentUsd = async () => Number((await db.withSystem((tx) => tx.execute<{ usd: string }>(sql`select coalesce(sum(cost_usd), 0)::text usd from platform.provider_calls where created_at >= ${started.toISOString()}::timestamptz`)))[0]?.usd ?? 0);
const report: Record<string, unknown>[] = [];
const ctx = await buildWorkspace();

if (mode === "refresh") {
  const platform = values.platform ?? "youtube";
  const limit = Number(values.limit ?? 1000);
  const rows = await db.withSystem((tx) => tx.execute<{ id: string }>(sql`select p.creator_id as id from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where c.status = 'active' and p.platform = ${platform} order by p.followers desc nulls last limit ${limit}`));
  logger.info({ creators: rows.length, platform }, "refresh start");
  for (const [i, r] of rows.entries()) {
    if ((await spentUsd()) >= capUsd) {
      logger.warn({ spent: await spentUsd(), capUsd }, "spend cap reached: stopping");
      break;
    }
    const started1 = Date.now();
    try {
      const out = await discovery.start(ctx, { kind: "refresh", creatorId: r.id, confirmedCost: 50 });
      const jobId = out.body.status === "started" ? out.body.job.id : null;
      if (jobId) await profileRunner.run(jobId, ctx.workspaceId).catch((e: Error) => logger.warn({ err: e.message, creatorId: r.id }, "refresh attempt failed"));
      const job = jobId ? await discovery.get(ctx, jobId) : null;
      report.push({ i, creatorId: r.id, status: job?.status ?? out.body.status, outcome: job?.outcome ?? null, error: job?.error?.code ?? null, ms: Date.now() - started1 });
    } catch (err) {
      report.push({ i, creatorId: r.id, status: "refused", error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    }
    if (i % 10 === 0) logger.info({ done: i + 1, of: rows.length, spentUsd: await spentUsd() }, "refresh progress");
  }
} else {
  const niches = (values.niches ?? "food,cooking,beauty,makeup,skincare,fashion,travel,fitness,technology,gaming,education,comedy,finance,lifestyle,agriculture,literature").split(",");
  const cities = (values.cities ?? "Lahore,Karachi,Islamabad,Rawalpindi,Peshawar,Faisalabad,Multan,Quetta").split(",");
  const size = Number(values.size) as LiveRunSize;
  outer: for (const city of cities) {
    for (const niche of niches) {
      if ((await spentUsd()) >= capUsd) {
        logger.warn({ spent: await spentUsd(), capUsd }, "spend cap reached: stopping");
        break outer;
      }
      const t = Date.now();
      try {
        const estimate = await discovery.createEstimate(ctx, { search: { text: niche, filters: searchFiltersSchema.parse({ creatorCity: city }) }, maxNew: size });
        const out = await discovery.start(ctx, { kind: "live", estimateId: estimate.estimateId });
        if (out.body.status !== "started") throw new Error(`not started: ${out.body.status}`);
        const jobId = out.body.job.id;
        for (let attempt = 0; attempt < 3; attempt++) {
          await liveRunner.run(jobId, ctx.workspaceId).catch((e: Error) => logger.warn({ err: e.message, jobId }, "live attempt failed"));
          const j = await discovery.get(ctx, jobId);
          if (j.status === "completed" || j.status === "failed") break;
        }
        const job = await discovery.get(ctx, jobId);
        report.push({ city, niche, status: job.status, outcome: job.outcome, found: job.live?.found ?? 0, new: job.live?.new ?? 0, error: job.error?.code ?? null, ms: Date.now() - t, spentUsd: await spentUsd() });
        logger.info(report.at(-1), "discover");
      } catch (err) {
        report.push({ city, niche, status: "refused", error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
        logger.warn(report.at(-1), "discover refused");
      }
    }
  }
}

// Bring the search projection up to date for everything saved (the worker would do this from the outbox).
await indexer.reconcile();
const byProvider = await db.withSystem((tx) => tx.execute<{ provider: string; calls: number; usd: string }>(sql`select provider, count(*)::int calls, coalesce(sum(cost_usd),0)::text usd from platform.provider_calls where created_at >= ${started.toISOString()}::timestamptz group by 1 order by 1`));
const outDir = join(repo, "docs", "completion", "search-v2-evidence");
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `catalog-build-${mode}-${started.toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify({ mode, db: dbName, capUsd, started: started.toISOString(), finished: new Date().toISOString(), spendByProvider: byProvider, jobs: report }, null, 1)}\n`);
logger.info({ file, spentUsd: await spentUsd(), jobs: report.length }, "catalogue build finished");
await db.close();
