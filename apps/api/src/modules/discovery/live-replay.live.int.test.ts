/**
 * Opt-in recorded-response replay of the real live runner (quote → reserve → run → persist → trail → settle) on the
 * disposable test database. Search results, relevance decisions and profiles come from files recorded by
 * live-eval.live.int.test.ts in LIVE_EVAL_OUT; nothing is fetched live unless LIVE_REPLAY_ALLOW_LIVE=1 (Serper and the
 * hosted LLM only — paid profile extraction is never replayed live); LIVE_REPLAY_LIVE_LLM=1 allows only the hosted LLM. A recording that does not exist is reported as a
 * replay miss: the search returns no results and the profile reads as not found. The creator assessment step uses a
 * neutral "insufficient data" stub (it does not affect Campaign Fit); results are therefore labelled REPLAY.
 *
 * LIVE_REPLAY_EXTRACT_BUDGET_USD=<n> (default 0) lets profile extraction and Instagram post-author resolution run live
 * for recordings that do not exist, under that hard cap; their responses are recorded for later replays.
 *
 * Extraction multipliers are the production defaults (config); LIVE_REPLAY_MULTIPLIER=instagram=1,youtube=1 overrides some
 * of them (e.g. to reproduce the 1× baseline). The production per-job cost cap (config defaults,
 * per-profile cost estimates) always applies. Profiles fetched per platform are counted, with their estimated cost.
 *
 * LIVE_DISCOVERY_REPLAY=1 LIVE_EVAL_OUT=<dir> [LIVE_REPLAY_BRIEFS=id,id] [LIVE_REPLAY_SIZE=5|10|20] [LIVE_REPLAY_LABEL=x]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { searchFiltersSchema, type LiveSearch } from "@mushin/contracts";
import { createLogger, loadWorkerConfig, sha256Hex, type TenantContext } from "@mushin/core";
import { createDbProviderCallSink, providerCallsSince } from "@mushin/db";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createBudgetGuard, createLlm, createProfileScraper, createSearchLimitGuard, createSerperSearch, MemoryStorage, MockPayments, type Llm, type ProfileScraper, type WebResult, type WebSearch } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEnrichmentPipeline } from "../creators/index";
import { TEST_KEY } from "../creators/test-fixtures";
import { createCachedSearch } from "./live/cache";
import { createLiveRunner } from "./live-runner";
import { createDiscoveryService } from "./service";

const enabled = process.env["LIVE_DISCOVERY_REPLAY"] === "1";
const OUT = process.env["LIVE_EVAL_OUT"] ?? "";
const LABEL = process.env["LIVE_REPLAY_LABEL"] ?? "replay";
const ALLOW_LIVE = process.env["LIVE_REPLAY_ALLOW_LIVE"] === "1";
const LIVE_LLM = ALLOW_LIVE || process.env["LIVE_REPLAY_LIVE_LLM"] === "1";
const SIZE = Number(process.env["LIVE_REPLAY_SIZE"] ?? "5") as 5 | 10 | 15;
const EXTRACT_BUDGET_USD = Number(process.env["LIVE_REPLAY_EXTRACT_BUDGET_USD"] ?? "0");
const ONLY = new Set((process.env["LIVE_REPLAY_BRIEFS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const db = createTestDatabase();
afterAll(() => db.close());

describe.skipIf(!enabled)("Live Discovery recorded-response replay through the real runner", () => {
  it("replays each recorded brief and reports the persisted decision trail and settlement", async () => {
    if (!OUT) throw new Error("LIVE_EVAL_OUT must name the directory recorded by the live evaluation");
    // Each replay starts from an empty catalog on the guarded disposable database; briefs then share it like production.
    await resetTables();
    const config = loadWorkerConfig(process.env);
    const logger = createLogger({ level: (process.env["LIVE_REPLAY_LOG"] as "warn" | undefined) ?? "silent" });
    const sink = createDbProviderCallSink(db);
    const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => undefined });
    const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
    const discovery = createDiscoveryService({ db, billing });
    const recorded = await readJson<{ briefs: { id: string; text: string; filters: Record<string, unknown> }[] }>(join(OUT, "baseline.json"));
    if (!recorded) throw new Error("baseline.json is missing from LIVE_EVAL_OUT");
    await mkdir(join(OUT, "replays"), { recursive: true });
    const misses = { serp: 0, profiles: 0, llm: 0 };
    const live = ALLOW_LIVE && config.scraping.serperApiKey
      ? createSerperSearch({ apiKey: config.scraping.serperApiKey, limit: createSearchLimitGuard({ limit: config.scraping.serperMonthlySearchLimit, countSince: (since) => providerCallsSince(db, "serper", since) }), sink, logger })
      : null;
    const web: WebSearch = {
      async search(q) {
        const file = join(OUT, "serp", `${sha256Hex(`${q.country}|${q.hl}|${q.num}|${q.query}`)}.json`);
        const hit = await readJson<{ results: WebResult[] }>(file);
        if (hit) return hit.results;
        if (!live) {
          misses.serp++;
          return [];
        }
        const results = await live.search(q);
        await writeFile(file, JSON.stringify({ query: q, results, at: new Date().toISOString() }));
        return results;
      },
    };
    const realLlm = LIVE_LLM && config.llm.length > 0 ? createLlm(config.llm, { sink, logger, budget: null }) : null;
    const llm: Llm = {
      async complete(req) {
        if (req.feature === "creator_assessment") {
          // Neutral stub: no score, no evidence; the replay does not evaluate assessments.
          return { value: req.schema.parse({ verdict: null, score: null, evidence: [], watchOuts: [], audience: { age: [], gender: null, cities: [], countries: [] }, niches: [], creatorCity: null, creatorCountry: null, minorSigns: { likely: false, reason: "" } }), model: "replay-stub" };
        }
        const file = join(OUT, "llm", `${sha256Hex(`${req.feature}|${req.system}|${req.input}`)}.json`);
        const hit = await readJson<{ value: unknown }>(file);
        if (hit) return { value: req.schema.parse(hit.value), model: "replay" };
        if (!realLlm) {
          misses.llm++;
          throw new Error("no recorded relevance decision for this prompt (replay miss)");
        }
        const out = await realLlm.complete(req);
        await writeFile(file, JSON.stringify({ value: out.value }));
        return out;
      },
    } as Llm;
    const spend = { usd: 0, liveProfiles: 0, livePosts: 0 };
    const real = EXTRACT_BUDGET_USD > 0 && config.scraping.apifyToken
      ? createProfileScraper({
          apify: { token: config.scraping.apifyToken, instagramActor: config.scraping.instagramActor, tiktokActor: config.scraping.tiktokActor,
            ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}),
            ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}),
            ...(config.scraping.instagramPostActor ? { instagramPostActor: config.scraping.instagramPostActor } : {}),
            ...(config.scraping.instagramPostBuild ? { instagramPostBuild: config.scraping.instagramPostBuild } : {}) },
          youtubeApiKey: config.scraping.youtubeApiKey, tiktokVideos: 6, youtubeVideos: 12,
          // Hard cap for this replay: the guard counts what this process has spent.
          spendGuard: createBudgetGuard({ budgetUsd: EXTRACT_BUDGET_USD, perRunUsd: 0.02, spentSince: async () => spend.usd }),
          sink, logger,
        })
      : null;
    await mkdir(join(OUT, "posts"), { recursive: true });
    for (const p of ["instagram", "tiktok", "youtube"]) await mkdir(join(OUT, "raw", p), { recursive: true });
    const fetchedBy: Record<string, number> = { instagram: 0, tiktok: 0, youtube: 0 };
    const scraper: ProfileScraper = {
      async fetchProfile() {
        throw new Error("single-profile fetch is not replayed");
      },
      async fetchProfiles(req) {
        const profiles: { handle: string; raw: unknown }[] = [];
        const missing: string[] = [];
        fetchedBy[req.platform] = (fetchedBy[req.platform] ?? 0) + req.handles.length;
        for (const handle of req.handles) {
          const h = handle.replace(/^@/, "").toLowerCase();
          const hit = await readJson<{ raw: unknown }>(join(OUT, "raw", req.platform, `${h}.json`));
          if (hit) profiles.push({ handle: h, raw: hit.raw });
          else missing.push(h);
        }
        if (missing.length > 0 && real) {
          try {
            const batch = await real.fetchProfiles({ platform: req.platform, handles: missing });
            spend.usd += batch.costUsd;
            spend.liveProfiles += missing.length;
            for (const h of missing) {
              const raw = batch.profiles.find((p) => p.handle === h)?.raw ?? [];
              await writeFile(join(OUT, "raw", req.platform, `${h}.json`), JSON.stringify({ raw, fetchedAt: new Date().toISOString() }));
              profiles.push({ handle: h, raw });
            }
            return { provider: req.platform === "youtube" ? "youtube" : "apify", profiles, costUsd: batch.costUsd };
          } catch {
            // Over the replay budget: these stay misses.
          }
        }
        for (const h of missing) {
          misses.profiles++;
          profiles.push({ handle: h, raw: [] });
        }
        return { provider: req.platform === "youtube" ? "youtube" : "apify", profiles, costUsd: 0 };
      },
      async resolveInstagramPostOwners(req) {
        const codeOf = (u: string) => /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(u)?.[1] ?? "x";
        const owners: { url: string; owner: string | null }[] = [];
        const missing: string[] = [];
        for (const url of req.urls) {
          const hit = await readJson<{ owner: string | null }>(join(OUT, "posts", `${codeOf(url)}.json`));
          if (hit) owners.push({ url, owner: hit.owner });
          else missing.push(url);
        }
        if (missing.length > 0 && real?.resolveInstagramPostOwners) {
          try {
            const r = await real.resolveInstagramPostOwners({ urls: missing });
            spend.usd += r.costUsd;
            spend.livePosts += missing.length;
            for (const o of r.owners) {
              await writeFile(join(OUT, "posts", `${codeOf(o.url)}.json`), JSON.stringify({ owner: o.owner, at: new Date().toISOString() }));
              owners.push(o);
            }
            return { owners, costUsd: r.costUsd };
          } catch {
            // Over the replay budget: unresolved.
          }
        }
        for (const url of missing) owners.push({ url, owner: null });
        return { owners, costUsd: 0 };
      },
    };
    const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
    const runner = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm, logger, maxAttempts: 1, contentResolutionMax: config.scraping.contentResolutionMax, extractionMultiplier: { ...config.scraping.extractionMultiplier, ...Object.fromEntries((process.env["LIVE_REPLAY_MULTIPLIER"] ?? "").split(",").filter(Boolean).map((pair) => { const [p, m] = pair.split("="); return [p, Number(m)]; })) }, jobCostCap: config.scraping.jobCostCap });

    const report: unknown[] = [];
    for (const brief of recorded.briefs.filter((b) => ONLY.size === 0 || ONLY.has(b.id))) {
      const before = { ...misses };
      const fetchedBefore = { ...fetchedBy };
      const ws = await createTestWorkspace();
      await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
      const c: TenantContext = { ...ws, requestId: `replay-${randomUUID().slice(0, 8)}`, role: "owner" };
      const search: LiveSearch = { text: brief.text, filters: searchFiltersSchema.parse(brief.filters) };
      const quote = await discovery.createEstimate(c, { search, maxNew: SIZE });
      const started = await discovery.start(c, { kind: "live", estimateId: quote.estimateId });
      if (started.body.status !== "started") throw new Error("expected a confirmed live job");
      const jobId = started.body.job.id;
      const t0 = Date.now();
      await runner.run(jobId, c.workspaceId).catch(() => undefined);
      const job = await discovery.get(c, jobId);
      const results = await discovery.results(c, jobId, 0);
      const trail = await ownerQuery<{ platform: string; stage: string; decision: string; reason: string | null; candidate_key: string; occurrences: number; creator_id: string | null }>(
        `select platform, stage, decision, reason, candidate_key, occurrences, creator_id from wp.discovery_candidates where job_id = '${jobId}'`);
      const byOutcome: Record<string, number> = {};
      for (const r of trail) {
        const k = `${r.platform}:${r.stage}:${r.decision}:${r.reason ?? "-"}`;
        byOutcome[k] = (byOutcome[k] ?? 0) + 1;
      }
      const balance = (await billing.summary(c)).balance;
      const entry = {
        id: brief.id, mode: "REPLAY", size: SIZE, status: job.status, outcome: job.outcome, delivered: results.results.length,
        // In the order the customer sees them (result rank), not trail order.
        deliveredHandles: results.results.map((res) => trail.find((r) => r.decision === "delivered" && r.creator_id === res.id)?.candidate_key ?? `${res.platform}:${res.handle}`),
        // Every candidate and its last decision, so the rating packet can pool fetched-but-not-delivered profiles.
        candidates: trail.map((r) => ({ key: r.candidate_key, platform: r.platform, stage: r.stage, decision: r.decision, reason: r.reason })),
        credits: { quoted: quote.maxCredits, charged: job.live?.creditsCharged ?? 0, reservedAfter: balance.reserved },
        trailRows: trail.length, pendingAfter: trail.filter((r) => r.decision === "pending").length, duplicates: trail.reduce((n, r) => n + r.occurrences - 1, 0),
        spendUsdSoFar: Math.round(spend.usd * 10000) / 10000, livePostsSoFar: spend.livePosts, liveProfilesSoFar: spend.liveProfiles,
        fetched: Object.fromEntries(Object.entries(fetchedBy).map(([p, n]) => [p, n - (fetchedBefore[p] ?? 0)])),
        estimatedExtractionUsd: Math.round(Object.entries(fetchedBy).reduce((sum, [p, n]) => sum + (n - (fetchedBefore[p] ?? 0)) * (config.scraping.jobCostCap.profileUsd[p as "instagram" | "tiktok" | "youtube"] ?? 0), 0) * 10000) / 10000,
        byOutcome, misses: { serp: misses.serp - before.serp, profiles: misses.profiles - before.profiles, llm: misses.llm - before.llm }, ms: Date.now() - t0,
      };
      report.push(entry);
      process.stdout.write(`${JSON.stringify({ replay: { id: entry.id, outcome: entry.outcome, delivered: entry.delivered, trailRows: entry.trailRows, pendingAfter: entry.pendingAfter, misses: entry.misses } })}\n`);
      await writeFile(join(OUT, "replays", `${LABEL}.json`), JSON.stringify({ label: LABEL, size: SIZE, at: new Date().toISOString(), briefs: report }, null, 1));
      expect(entry.pendingAfter).toBe(0);
      expect(balance.reserved).toBe(0);
    }
  }, 3_600_000);
});
