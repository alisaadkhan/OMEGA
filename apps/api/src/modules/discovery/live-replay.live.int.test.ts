/**
 * Opt-in recorded-response replay of the real live runner (quote → reserve → run → persist → trail → settle) on the
 * disposable test database. Search results, relevance decisions and profiles come from files recorded by
 * live-eval.live.int.test.ts in LIVE_EVAL_OUT; nothing is fetched live unless LIVE_REPLAY_ALLOW_LIVE=1 (Serper and the
 * hosted LLM only — paid profile extraction is never replayed live); LIVE_REPLAY_LIVE_LLM=1 allows only the hosted LLM. A recording that does not exist is reported as a
 * replay miss: the search returns no results and the profile reads as not found. The creator assessment step uses a
 * neutral "insufficient data" stub (it does not affect Campaign Fit); results are therefore labelled REPLAY.
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
import { createLlm, createSearchLimitGuard, createSerperSearch, MemoryStorage, MockPayments, type Llm, type ProfileScraper, type WebResult, type WebSearch } from "@mushin/integrations";
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
const SIZE = Number(process.env["LIVE_REPLAY_SIZE"] ?? "5") as 5 | 10 | 20;
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
    const realLlm = LIVE_LLM && config.llm.length > 0 ? createLlm(config.llm, { sink, logger }) : null;
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
    const scraper: Pick<ProfileScraper, "fetchProfiles"> & ProfileScraper = {
      async fetchProfile() {
        throw new Error("single-profile fetch is not replayed");
      },
      async fetchProfiles(req) {
        const profiles: { handle: string; raw: unknown }[] = [];
        for (const handle of req.handles) {
          const h = handle.replace(/^@/, "").toLowerCase();
          const hit = await readJson<{ raw: unknown }>(join(OUT, "raw", req.platform, `${h}.json`));
          if (!hit) misses.profiles++;
          profiles.push({ handle: h, raw: hit?.raw ?? [] });
        }
        return { provider: req.platform === "youtube" ? "youtube" : "apify", profiles, costUsd: 0 };
      },
    };
    const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
    const runner = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm, logger, maxAttempts: 1 });

    const report: unknown[] = [];
    for (const brief of recorded.briefs.filter((b) => ONLY.size === 0 || ONLY.has(b.id))) {
      const before = { ...misses };
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
      const trail = await ownerQuery<{ platform: string; stage: string; decision: string; reason: string | null; candidate_key: string; occurrences: number }>(
        `select platform, stage, decision, reason, candidate_key, occurrences from wp.discovery_candidates where job_id = '${jobId}'`);
      const byOutcome: Record<string, number> = {};
      for (const r of trail) {
        const k = `${r.platform}:${r.stage}:${r.decision}:${r.reason ?? "-"}`;
        byOutcome[k] = (byOutcome[k] ?? 0) + 1;
      }
      const balance = (await billing.summary(c)).balance;
      const entry = {
        id: brief.id, mode: "REPLAY", size: SIZE, status: job.status, outcome: job.outcome, delivered: results.results.length,
        deliveredHandles: trail.filter((r) => r.decision === "delivered").map((r) => r.candidate_key),
        credits: { quoted: quote.maxCredits, charged: job.live?.creditsCharged ?? 0, reservedAfter: balance.reserved },
        trailRows: trail.length, pendingAfter: trail.filter((r) => r.decision === "pending").length, duplicates: trail.reduce((n, r) => n + r.occurrences - 1, 0),
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
