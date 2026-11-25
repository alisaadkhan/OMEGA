/**
 * Operational catalogue build (search-v2; owner decisions 2026-10-20: up to USD 25 on existing provider accounts; build
 * locally first). Uses the production paths only, with real providers from .env, against a LOCAL catalogue database:
 *   refresh   re-fetch existing creators through discovery refresh jobs (fetch → archive → AI assessment → save with
 *             evidence), so niches, city and country come from the creator's own recent content, never invented;
 *   discover  Live Discovery runs over a general niche × city grid (not shaped by the frozen evaluation queries);
 *   seed      adds the handles of a researched seed manifest (docs/completion/seed/*.json) through the add-by-link
 *             path: one fetch each, saved with evidence; Pakistani status comes from the country rule, never the list;
 *   expand    Wave expansion at no search cost: Instagram handles that Pakistani creators in the catalogue list as related
 *             profiles or @mention, ranked by how many of them point there (--min-refs, default 2), fetched through the
 *             add-by-link path; already-known or already-tried handles are skipped, so a run resumes where it stopped;
 *   reassess  completes AI assessments left pending (provider rate limits) from the archived payload, as the worker's
 *             creator.assessment_requested handler does: score, audience and the minor check; no new fetch.
 * Every job runs in an internal "MUSHIN catalogue build" workspace with granted credits; provider spend is read from
 * platform.provider_calls and the build stops at --cap (USD). Archived payloads go to a local file store.
 *
 *   node --env-file=.env --import tsx scripts/catalog/build.ts <refresh|discover> --db mushin_catalog_v2 --cap 20
 *        [--platform youtube] [--limit 50] [--niches food,travel] [--cities Lahore,Karachi]
 * The frozen evaluation corpus (mushin_eval_disposable) is refused as a target.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { searchFiltersSchema, type LiveRunSize } from "@mushin/contracts";
import { createLogger, loadWorkerConfig, type TenantContext } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, createDbProviderRunStore, createDbReservationLedger, llmSpendSince } from "@mushin/db";
import { createLlm, createPayments, createProfileScraper, createSerperSearch, createSharedSpendGuard, createYouTubeSearch, ProviderError, type Llm, type ProfileScraper, type WebSearch } from "@mushin/integrations";
import postgres from "postgres";
import { BudgetExhausted, createBudgetGate } from "./budget";
import { seedMatrix, type SeedPlatform } from "../../apps/api/src/modules/creators/discovery-seeds";
import { fileStorage } from "./file-storage";
import { sql } from "drizzle-orm";
import { createBillingService, noAccessCache } from "../../apps/api/src/modules/billing/index";
import { bulkRefreshProfileCountries, createCreatorIndexer, createEnrichmentPipeline, getEnrichmentSettings, standardize } from "../../apps/api/src/modules/creators/index";
import { createCachedSearch, createDiscoveryRunner, createDiscoveryService, createLiveRunner } from "../../apps/api/src/modules/discovery/index";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { handles: { type: "string" }, "missing-avatars": { type: "boolean", default: false }, "min-refs": { type: "string", default: "2" }, manifest: { type: "string" }, db: { type: "string" }, cap: { type: "string", default: "20" }, platform: { type: "string" }, limit: { type: "string" }, niches: { type: "string" }, cities: { type: "string" }, size: { type: "string", default: "10" }, label: { type: "string", default: "main" }, "llm-dump": { type: "string" }, "llm-answers": { type: "string" }, "include-locked": { type: "boolean", default: false }, matrix: { type: "boolean", default: false }, offset: { type: "string" }, headroom: { type: "string", default: "1" } },
});
const mode = positionals[0];
if (mode !== "refresh" && mode !== "discover" && mode !== "reassess" && mode !== "seed" && mode !== "expand" && mode !== "reprocess") throw new Error("usage: build.ts <refresh|discover|reassess|seed|expand> --db <catalogue db> --cap <usd> [--manifest <seed.json>] [--limit n] [--min-refs n]");
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue database (mushin_catalog_*); the frozen corpus is never a target");
const capUsd = Number(values.cap);
if (!(capUsd > 0 && capUsd <= 25)) throw new Error("--cap must be between 0 and 25 USD (owner cap 2026-10-20)");

const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const config = loadWorkerConfig({ ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_FILE: "", SEARCH_PROFILE: "v2" });
const logger = createLogger({ level: "info", name: "catalog-build" });
const db = createDatabase(url, { max: 4, applicationName: "catalog-build", caPem: null });
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
/** Everything spent under the owner's authorisation is counted (it started on 2026-10-20; all of it in this database). */
const AUTHORISED_SINCE = new Date("2026-10-20T00:00:00.000Z");
const ownerSql = postgres(url, { max: 2, onnotice: () => {} });
const gate = await createBudgetGate(ownerSql, { capUsd, since: AUTHORISED_SINCE });
/** A refused request surfaces as the provider's spend cap: the run fails honestly and returns its credits. */
const gated = <T>(estimateUsd: number, call: () => Promise<T>): Promise<T> =>
  gate.guard(estimateUsd, call).catch((err: unknown) => {
    if (err instanceof BudgetExhausted) throw new ProviderError(false, "spend_cap", err.message);
    throw err;
  });
// Worst-case reservations, each above the recorded unit cost (Serper 0.001/search, AI ~0.0002/call, Apify ~0.03/run).
const COST = { search: 0.002, llmCall: 0.01, apifyPerProfile: 0.05 };

const sink = createDbProviderCallSink(db);
const ledger = createDbReservationLedger(db);
const payments = createPayments(config.payments, { sink, logger });
const billing = createBillingService({ db, payments, cache: noAccessCache, logger });
const llmRaw = createLlm(config.llm, { sink, logger, budget: { budgetUsd: Math.min(config.llmMonthlyBudgetUsd, capUsd), spentSince: (since) => llmSpendSince(db, since) } });
const enrichment = await db.withSystem((tx) => getEnrichmentSettings(tx));
const apifyTokens = config.scraping.apifyTokens;
// APIFY_MONTHLY_BUDGET_USD is per account: each account's own monthly allowance.
const apifyGuard = createSharedSpendGuard({ ledger, provider: "apify", limit: config.scraping.apifyMonthlyBudgetUsd * Math.max(1, apifyTokens.length), perUnit: 0.05, label: "Apify budget (USD)" });
// One scraper per Apify account (owner, 17 Nov: a second key); apifyRoomFor picks the account with room before each run.
let apifyAccount = 0;
const makeScraper = (token: string | null) => createProfileScraper({
  apify: token ? { token, instagramActor: config.scraping.instagramActor, ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}), tiktokActor: config.scraping.tiktokActor, ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}) } : null,
  youtubeApiKey: config.scraping.youtubeApiKey,
  tiktokVideos: enrichment.tiktokRecentVideos,
  youtubeVideos: enrichment.recentPosts,
  spendGuard: apifyGuard,
  runs: createDbProviderRunStore(db),
  sink,
  logger,
});
const scrapers = (apifyTokens.length ? apifyTokens : [null]).map(makeScraper);
const scraperRaw = (): ProfileScraper => scrapers[apifyAccount] ?? (scrapers[0] as ProfileScraper);
const webRaw = createSerperSearch({ apiKey: config.scraping.serperApiKey, limit: createSharedSpendGuard({ ledger, provider: "serper", limit: config.scraping.serperMonthlySearchLimit, perUnit: 1, label: "Serper search limit" }), sink, logger });
// Every paid request goes through the combined gate; YouTube (free quota) passes with a zero estimate.
/**
 * Operator assessment fallback (owner directive 18 Nov: "if the configured providers are unavailable, use your own
 * assessment capabilities … through the existing approved assessment workflow"). --llm-dump <file> records every request
 * the pipeline would send (feature, system prompt, input) and answers "unavailable", so nothing is saved; an operator
 * answers them; --llm-answers <file> replays those answers by request hash through the same schema checks and save path,
 * recorded under the model name "manual:<who>". A request without an answer stays pending. No provider is called.
 */
const requestKey = (feature: string, input: string) => createHash("sha256").update(`${feature}
${input}`).digest("hex");
const dumpFile = values["llm-dump"];
const answersFile = values["llm-answers"];
const answers = answersFile ? (JSON.parse(readFileSync(answersFile, "utf8")) as { model: string; answers: Record<string, unknown> }) : null;
const dumped: { key: string; feature: string; system: string; input: string; creatorId: string | null }[] = [];
const operatorLlm: Llm | null = dumpFile || answers
  ? {
      async complete(req) {
        const key = requestKey(req.feature, req.input);
        if (answers && key in answers.answers) return { value: req.schema.parse(answers.answers[key]), model: answers.model };
        if (dumpFile) dumped.push({ key, feature: req.feature, system: req.system, input: req.input, creatorId: (req.ctx as { creatorId?: string } | undefined)?.creatorId ?? null });
        throw new ProviderError(true, "provider", "operator answer not available yet");
      },
    }
  : null;
process.on("exit", () => {
  if (dumpFile && dumped.length) writeFileSync(dumpFile, JSON.stringify(dumped, null, 1));
});
const llm: Llm = operatorLlm ?? { complete: (req) => gated(COST.llmCall, () => llmRaw.complete(req)) };
const paidUnits = (platform: string, n: number) => (platform === "youtube" ? 0 : n * COST.apifyPerProfile);
/**
 * The local ledger sees only this database's Apify runs; the account's monthly usage (other environments, storage) is
 * read from Apify itself (free, read-only) before every paid scrape, and a scrape that would not fit is refused. An
 * unreadable usage figure refuses too: spend that cannot be verified is not made.
 */
const APIFY_MARGIN_USD = 0.05;
async function apifyRoomFor(estimateUsd: number): Promise<void> {
  if (estimateUsd <= 0) return;
  const full: string[] = [];
  // The current account first, then the next ones: a run starts only on an account whose own allowance it fits.
  for (let i = apifyAccount; i < apifyTokens.length; i++) {
    const r = await fetch("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: `Bearer ${apifyTokens[i] ?? ""}` } }).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } } }) : null;
    const used = j?.data?.current?.monthlyUsageUsd;
    const max = j?.data?.limits?.maxMonthlyUsageUsd;
    if (used === undefined || max === undefined) throw new ProviderError(false, "spend_cap", `Apify account ${i + 1} usage could not be read (${r ? `HTTP ${r.status}` : "no response"}): paid scrape refused`);
    if (used + estimateUsd + APIFY_MARGIN_USD <= max) {
      if (i !== apifyAccount) logger.warn({ from: apifyAccount + 1, to: i + 1 }, "Apify account allowance used: switching account");
      apifyAccount = i;
      return;
    }
    full.push(`account ${i + 1}: ${used.toFixed(2)} of ${max} used`);
  }
  throw new ProviderError(false, "spend_cap", `Every Apify account is at its monthly limit (${full.join("; ") || "no account configured"})`);
}
const apifyGated = <T>(estimateUsd: number, call: () => Promise<T>): Promise<T> => apifyRoomFor(estimateUsd).then(() => gated(estimateUsd, call));
const scraper: ProfileScraper = {
  fetchProfile: (req) => apifyGated(paidUnits(req.platform, 1), () => scraperRaw().fetchProfile(req)),
  fetchProfiles: (req) => apifyGated(paidUnits(req.platform, req.handles.length), () => scraperRaw().fetchProfiles(req)),
  ...(scraperRaw().resolveInstagramPostOwners ? { resolveInstagramPostOwners: (req: Parameters<NonNullable<ProfileScraper["resolveInstagramPostOwners"]>>[0]) => apifyGated(req.urls.length * COST.apifyPerProfile, () => (scraperRaw().resolveInstagramPostOwners as NonNullable<ProfileScraper["resolveInstagramPostOwners"]>)(req)) } : {}),
};
const web: WebSearch = { search: (q) => gated(COST.search, () => webRaw.search(q)) };
const pipeline = createEnrichmentPipeline({ db, scraper, storage: fileStorage(join(repo, ".catalog-storage", dbName)), llm, encryptionKey: config.dataEncryptionKey, logger, attributePolicy: config.enrichment.attributePolicy, youtube: { contentEvidence: config.enrichment.youtubeContentEvidence, descriptionContacts: config.enrichment.youtubeDescriptionContacts }, semanticNiche: config.enrichment.semanticNiche });
const search = createCachedSearch({ db, web, ...(config.scraping.youtubeApiKey ? { youtube: createYouTubeSearch({ apiKey: config.scraping.youtubeApiKey, sink, logger }) } : {}) });
const discovery = createDiscoveryService({ db, billing });
const profileRunner = createDiscoveryRunner({ db, billing, pipeline, logger });
// The worker production settings (cost cap, deadline, content resolution), with extra extraction waves at their configured
// maximum (4) for the build: quality over cost, still bounded by the per-job cost cap.
const liveRunner = createLiveRunner({ searchProfile: "v2", sourcePolicy: config.sourcePolicy, db, billing, pipeline, scraper, search, llm, logger, contentResolutionMax: config.scraping.contentResolutionMax, extractionMultiplier: { instagram: 4, youtube: 4, tiktok: 4 }, profileConcurrency: config.scraping.profileConcurrency, jobCostCap: config.scraping.jobCostCap, jobDeadlineMs: config.scraping.jobDeadlineMs });
const indexer = createCreatorIndexer({ db, index: null, logger, sourcePolicy: config.sourcePolicy });

/** One build workspace per --label, so parallel build processes each have their own live run. */
const workspaceName = `MUSHIN catalogue build ${values.label}`;
/** The internal build workspace (owner connection: one person, one workspace, generous adjustment credits). */
async function buildWorkspace(): Promise<TenantContext> {
  const owner = createDatabase(url, { max: 1, applicationName: "catalog-build-owner", caPem: null });
  // Owner connection: workspaces are row-level secured and invisible to the system role (a re-run made a second one).
  const found = await ownerSql<{ id: string; owner_user_id: string }[]>`select id, owner_user_id from wp.workspaces where name = ${workspaceName} order by created_at limit 1`;
  let ws = found[0];
  if (!ws) {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const pg = (await import("postgres")).default(url, { max: 1, onnotice: () => {} });
    await pg.begin(async (tx) => {
      await tx`insert into wp.users (id, email, display_name) values (${userId}, ${`catalogue-build-${values.label}@mushin.invalid`}, ${"Catalogue build"})`;
      await tx`insert into wp.workspaces (id, name, owner_user_id) values (${workspaceId}, ${workspaceName}, ${userId})`;
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
/** Spend under the authorisation (all providers, all workers) plus requests in flight: the same numbers the gate uses. */
const spentUsd = async () => {
  const s = await gate.status();
  return s.spent + s.open;
};
/**
 * Below this headroom no new job is started (one live run can reserve up to ~USD 1 in flight). --headroom lowers it for
 * a small capped test (owner, 25 Nov: "$1.00 to verify the TikTok flow"): the gate still refuses any call past --cap,
 * so a job that runs out mid-way fails honestly rather than overspending.
 */
const JOB_HEADROOM_USD = Math.max(0, Number(values.headroom));
const report: Record<string, unknown>[] = [];
const ctx = await buildWorkspace();

if (mode === "reassess") {
  // Creators search would show come first (their minor check matters most); the rest by age.
  const rows = await ownerSql<{ id: string }[]>`
    select c.id from gcp.creators c left join gcp.creator_search_documents d on d.creator_id = c.id
    where c.status = 'active' and c.assessment_status = 'pending' order by coalesce(d.eligible, false) desc, c.created_at`;
  logger.info({ creators: rows.length }, "reassess start");
  const outcome: Record<string, number> = {};
  // A rate-limited AI (per-minute token limits shared with other runs) is waited out, not counted as a result; ten
  // creators in a row still unavailable after the waits means a daily limit: stop, a rerun continues.
  let unavailableInARow = 0;
  for (const [i, r] of rows.entries()) {
    if ((await spentUsd()) >= capUsd - JOB_HEADROOM_USD) {
      logger.warn({ spent: await spentUsd(), capUsd }, "spend cap reached: stopping");
      break;
    }
    let result = "";
    for (let attempt = 1; attempt <= 6; attempt++) {
      result = await pipeline.reassess(r.id).catch((e: Error) => `failed: ${e.message.slice(0, 60)}`);
      if (!/unavailable right now/i.test(result)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 15_000 * attempt));
    }
    unavailableInARow = /unavailable right now/i.test(result) ? unavailableInARow + 1 : 0;
    outcome[result] = (outcome[result] ?? 0) + 1;
    if (unavailableInARow >= 10) {
      logger.warn({ done: i + 1, of: rows.length }, "AI unavailable for 10 creators in a row (daily limit?): stopping");
      break;
    }
    if (i % 50 === 0) logger.info({ done: i + 1, of: rows.length, outcome, spentUsd: await spentUsd() }, "reassess progress");
  }
  report.push({ mode, pending: rows.length, outcome });
} else if (mode === "seed") {
  if (!values.manifest) throw new Error("seed needs --manifest <file>");
  const manifest = JSON.parse(readFileSync(values.manifest, "utf8")) as { candidates: { handle: string; url: string }[] };
  const limit = Number(values.limit ?? manifest.candidates.length);
  for (const [i, c] of manifest.candidates.slice(0, limit).entries()) {
    if ((await spentUsd()) >= capUsd - JOB_HEADROOM_USD) {
      logger.warn({ spent: await spentUsd(), capUsd }, "spend cap reached: stopping");
      break;
    }
    const started1 = Date.now();
    try {
      const out = await discovery.start(ctx, { kind: "add_by_url", url: c.url, confirmedCost: 50 });
      const jobId = out.body.status === "started" ? out.body.job.id : null;
      if (jobId) await profileRunner.run(jobId, ctx.workspaceId).catch((e: Error) => logger.warn({ err: e.message, handle: c.handle }, "seed attempt failed"));
      const job = jobId ? await discovery.get(ctx, jobId) : null;
      report.push({ i, handle: c.handle, status: job?.status ?? out.body.status, outcome: job?.outcome ?? null, error: job?.error?.code ?? null, ms: Date.now() - started1 });
    } catch (err) {
      report.push({ i, handle: c.handle, status: "refused", error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    }
    logger.info(report.at(-1), "seed");
  }
} else if (mode === "expand") {
  const minRefs = Number(values["min-refs"] ?? 2);
  const limit = Number(values.limit ?? 200);
  const sources = await db.withSystem((tx) => tx.execute<{ handle: string; storage_key: string }>(sql`
    select p.handle, (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.provider = 'apify' order by r.fetched_at desc limit 1) storage_key
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
    where p.platform = 'instagram' and p.country_status = 'pakistan' and c.status = 'active'`));
  const known = new Set([...(await db.withSystem((tx) => tx.execute<{ h: string }>(sql`select lower(handle) h from gcp.creator_profiles where platform = 'instagram'`)))].map((r) => r.h));
  const triedFile = join(repo, ".catalog-storage", dbName, "expand-tried.json");
  const tried = new Set<string>(existsSync(triedFile) ? (JSON.parse(readFileSync(triedFile, "utf8")) as string[]) : []);
  const refs = new Map<string, Set<string>>();
  for (const src of sources) {
    if (!src.storage_key) continue;
    const file = join(repo, ".catalog-storage", dbName, "raw-payloads", src.storage_key);
    if (!existsSync(file)) continue;
    const std = standardize("instagram", src.handle, JSON.parse(readFileSync(file, "utf8")), { maxPosts: 30 });
    if (std.kind !== "ok") continue;
    for (const h of [...(std.profile.related ?? []), ...std.profile.recentPosts.flatMap((x) => x.mentions ?? [])]) {
      if (known.has(h) || tried.has(h) || h === src.handle.toLowerCase()) continue;
      refs.set(h, (refs.get(h) ?? new Set()).add(src.handle));
    }
  }
  const queue = [...refs.entries()].filter(([, by]) => by.size >= minRefs).sort((a, b) => b[1].size - a[1].size).slice(0, limit);
  let providerFailures = 0;
  logger.info({ sources: sources.length, candidates: refs.size, atLeast2: [...refs.values()].filter((b) => b.size >= 2).length, atLeast3: [...refs.values()].filter((b) => b.size >= 3).length, queued: queue.length, minRefs }, "expand start");
  for (const [i, [h, by]] of queue.entries()) {
    if ((await spentUsd()) >= capUsd - JOB_HEADROOM_USD) {
      logger.warn({ spent: await spentUsd(), capUsd }, "spend cap reached: stopping");
      break;
    }
    let providerDown = false;
    try {
      const out = await discovery.start(ctx, { kind: "add_by_url", url: `https://www.instagram.com/${h}/`, confirmedCost: 50 });
      const jobId = out.body.status === "started" ? out.body.job.id : null;
      if (jobId) await profileRunner.run(jobId, ctx.workspaceId).catch((e: Error) => logger.warn({ err: e.message, handle: h }, "expand attempt failed"));
      const job = jobId ? await discovery.get(ctx, jobId) : null;
      providerDown = job?.error?.code === "PROVIDER_UNAVAILABLE";
      report.push({ i, handle: h, refs: by.size, status: job?.status ?? out.body.status, outcome: job?.outcome ?? null, error: job?.error?.code ?? null });
    } catch (err) {
      report.push({ i, handle: h, refs: by.size, status: "refused", error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    }
    logger.info(report.at(-1), "expand");
    // Only a definite answer (saved, not found, private, below minimum...) marks a handle tried; a provider outage leaves
    // it queued. A flaky connection gets a growing pause (1, 2, 3... up to 5 minutes); eight outages in a row stop the run.
    if (providerDown) {
      if (++providerFailures >= 8) {
        logger.warn({ handle: h }, "provider unavailable eight times in a row: stopping");
        break;
      }
      const pauseMs = Math.min(providerFailures * 60_000, 300_000);
      logger.warn({ handle: h, providerFailures, pauseMs }, "provider unavailable: pausing before the next candidate");
      await new Promise((r) => setTimeout(r, pauseMs));
      continue;
    }
    providerFailures = 0;
    tried.add(h);
    writeFileSync(triedFile, JSON.stringify([...tried]));
  }
} else if (mode === "reprocess") {
  // Pilot (owner unified plan 2026-11-14, Phase 7): the full enrichment pipeline over each handle's newest stored answer
  // (account type, niche, contacts, location, metrics, AI assessment, photo), exactly as a fetch would save it, with no
  // provider call. For when a live fetch is not possible (e.g. the scraper refused the token).
  const platform = (values.platform ?? "instagram") as "instagram" | "tiktok" | "youtube";
  const handleList = (values.handles ?? "").split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  for (const [i, h] of handleList.entries()) {
    const started1 = Date.now();
    const [ref] = await db.withSystem((tx) =>
      tx.execute<{ id: string; storage_key: string; canonical_url: string; handle: string; fetched_at: string }>(sql`
        select r.id, r.storage_key, p.canonical_url, p.handle, r.fetched_at::text fetched_at from gcp.creator_profiles p
        join platform.raw_payloads r on r.creator_id = p.creator_id and r.platform = p.platform
        where p.platform = ${platform} and lower(p.handle) = ${h} and r.delete_after > now() order by r.fetched_at desc limit 1`),
    );
    if (!ref) {
      report.push({ i, handle: h, status: "no stored answer" });
      continue;
    }
    const bytes = await pipeline.storage?.get("raw-payloads", ref.storage_key);
    const raw = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    if (!raw) {
      report.push({ i, handle: h, status: "stored answer file missing" });
      continue;
    }
    const job = { jobId: randomUUID(), workspaceId: ctx.workspaceId, platform, handle: ref.handle, canonicalUrl: ref.canonical_url, requestId: null };
    const out = await pipeline.processProfile(job, ref.id, raw, { onSaved: async () => {} }, { system: true }).catch((e: Error) => ({ kind: "error", message: e.message }));
    // The data is as old as the stored answer: freshness must say so (a save stamps "now").
    await db.withSystem((tx) =>
      tx.execute(sql`update gcp.creator_profiles set last_scraped_at = ${ref.fetched_at}::timestamptz, followers_updated_at = ${ref.fetched_at}::timestamptz, engagement_updated_at = ${ref.fetched_at}::timestamptz
        where platform = ${platform} and lower(handle) = ${h}`),
    );
    report.push({ i, handle: h, status: out.kind, ms: Date.now() - started1 });
    logger.info(report.at(-1), "reprocess");
  }
} else if (mode === "refresh") {
  const platform = values.platform ?? "youtube";
  const limit = Number(values.limit ?? 1000);
  // --missing-avatars: only searchable creators without a stored profile photo (owner rule: every profile keeps its image).
  // --handles a,b,c: only these handles on --platform (pilot runs; owner unified plan 2026-11-14, Phase 7).
  const handleList = (values.handles ?? "").split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const onlyHandles = handleList.length ? sql`and lower(p.handle) in (select jsonb_array_elements_text(${JSON.stringify(handleList)}::jsonb))` : sql``;
  const onlyMissing = values["missing-avatars"] ? sql`and p.platform = c.primary_platform and c.avatar_url is null and exists (select 1 from gcp.creator_search_documents d where d.creator_id = c.id and d.eligible)` : sql``;
  const rows = await db.withSystem((tx) => tx.execute<{ id: string }>(sql`select p.creator_id as id from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where c.status = 'active' and p.platform = ${platform} ${onlyMissing} ${onlyHandles} order by p.followers desc nulls last limit ${limit}`));
  logger.info({ creators: rows.length, platform }, "refresh start");
  // --include-locked (owner directive 18 Nov, "re-scrape all creators"): creators whose every profile fails the Pakistan
  // rule only for a country reason (unknown, stale, conflicting or not Pakistan) are refused by the customer refresh
  // path unless the workspace holds them (BUG-32). The internal build workspace holds them in its own list first, so the
  // same refresh path re-fetches them and their country is re-decided from fresh data. No customer workspace is touched.
  if (values["include-locked"] && rows.length > 0) {
    await db.withTenant({ userId: ctx.userId, workspaceId: ctx.workspaceId }, async (tx) => {
      const [list] = await tx.execute<{ id: string }>(sql`select id from wp.lists where workspace_id = ${ctx.workspaceId} and name = 'Catalogue refresh: location unconfirmed' limit 1`);
      const listId = list?.id ?? (await tx.execute<{ id: string }>(sql`insert into wp.lists (workspace_id, name, description, created_by) values (${ctx.workspaceId}, 'Catalogue refresh: location unconfirmed', 'Internal: lets the catalogue build refresh creators whose location is not confirmed', ${ctx.userId}) returning id`))[0]?.id;
      if (!listId) throw new Error("could not create the internal refresh list");
      const ids = JSON.stringify(rows.map((r) => r.id));
      await tx.execute(sql`insert into wp.list_members (list_id, workspace_id, creator_id, added_by) select ${listId}, ${ctx.workspaceId}, x::uuid, ${ctx.userId} from jsonb_array_elements_text(${ids}::jsonb) x
        where not exists (select 1 from wp.list_members m where m.list_id = ${listId} and m.creator_id = x::uuid)`);
    });
  }
  for (const [i, r] of rows.entries()) {
    if ((await spentUsd()) >= capUsd - JOB_HEADROOM_USD) {
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
  // --platform youtube keeps the grid on free YouTube extraction (Apify account limit reached for the month).
  // --matrix (owner, 24 Nov): the expansion seed matrix instead (16 verticals × cities × regional languages, TikTok and
  // Instagram first); --offset/--limit take a slice. Cells already built are skipped, so a run resumes where it stopped.
  // Afterwards run trash-unqualified.ts so new accounts that do not qualify (under 10k, brands, inactive) leave search.
  type Cell = { city: string | undefined; niche: string; platformFilter: "instagram" | "tiktok" | "youtube" | null };
  const cells: Cell[] = values.matrix
    ? seedMatrix(values.platform ? { platforms: [values.platform as SeedPlatform] } : {})
        .slice(Number(values.offset ?? 0), Number(values.offset ?? 0) + Number(values.limit ?? 100_000))
        .map((c) => ({ city: c.city ?? undefined, niche: c.text, platformFilter: c.platform }))
    : cities.flatMap((city) => niches.map((niche) => ({ city, niche, platformFilter: (values.platform ?? null) as Cell["platformFilter"] })));
  logger.info({ cells: cells.length, matrix: Boolean(values.matrix) }, "discover cells");
  outer: for (const cell of cells) {
    const { city, niche, platformFilter } = cell;
    {
      if ((await spentUsd()) >= capUsd - JOB_HEADROOM_USD) {
        logger.warn({ spent: await spentUsd(), capUsd }, "spend cap reached: stopping");
        break outer;
      }
      const t = Date.now();
      try {
        // A re-launched worker never pays twice for a cell: a cell completed cleanly by any build worker is skipped, and
        // this worker's own unfinished job (a crash mid-run) is resumed instead of starting a new one. A cell that ended
        // on a provider error is run again (searches come from the cache; creators already saved are not re-fetched).
        // Owner connection: workspace jobs are row-level secured, and the system role sees none of them (measured
        // 2026-10-20: the guard saw 0 of 256 build jobs and a retry re-ran completed cells).
        const earlier = await ownerSql<{ id: string; status: string; workspace_id: string }[]>`
            select j.id, j.status, j.workspace_id from wp.discovery_jobs j join wp.workspaces w on w.id = j.workspace_id
            where j.kind = 'live' and w.name like 'MUSHIN catalogue build %' and j.search->>'text' = ${niche} and j.search->'filters'->>'creatorCity' is not distinct from ${city ?? null}
              and (j.search->'filters'->>'platform') is not distinct from ${platformFilter}
              and ((j.status = 'completed' and j.error_code is null) or (j.status in ('queued', 'running') and j.workspace_id = ${ctx.workspaceId}))
            order by (j.status = 'completed') desc, j.created_at desc limit 1`;
        if (earlier[0]?.status === "completed") {
          report.push({ city, niche, status: "skipped", reason: "already built", jobId: earlier[0].id });
          continue;
        }
        let jobId = earlier[0]?.id;
        if (!jobId) {
          const estimate = await discovery.createEstimate(ctx, { search: { text: niche, filters: searchFiltersSchema.parse({ ...(city ? { creatorCity: city } : {}), ...(platformFilter ? { platform: platformFilter } : {}) }) }, maxNew: size });
          const out = await discovery.start(ctx, { kind: "live", estimateId: estimate.estimateId });
          if (out.body.status !== "started") throw new Error(`not started: ${out.body.status}`);
          jobId = out.body.job.id;
        }
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

// New profiles can carry a linked creator's country (linked_profile), and a new creator can give its country to profiles
// already saved: one save sees only itself, so every country is re-decided once after a seed or expand run (≈ 2 s).
if (mode === "seed" || mode === "expand") {
  const ids = [...(await db.withSystem((tx) => tx.execute<{ id: string }>(sql`select id from gcp.creators where status = 'active'`)))].map((r) => r.id);
  let changed = 0;
  for (let i = 0; i < ids.length; i += 500) changed += (await db.withSystem((tx) => bulkRefreshProfileCountries(tx, ids.slice(i, i + 500), { source: "backfill" }))).length;
  logger.info({ changed }, "profile countries re-decided across links");
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
await ownerSql.end();
