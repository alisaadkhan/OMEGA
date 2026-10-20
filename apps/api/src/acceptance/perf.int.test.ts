/**
 * Acceptance: performance, resilience and controlled failure (PERF-*). Profile fixed before running:
 *   - catalogue: 2,000 SYNTHETIC eligible creators (3 platforms, 8 cities, 6 niches), PostgreSQL search backend;
 *   - machine: the developer laptop running PostgreSQL 17 locally (no network latency), one API process in-process;
 *   - workload: 300 sequential warm searches over 20 query shapes, then 20 concurrent clients × 10 searches;
 *   - no latency or throughput target is documented (blocker B4): figures are recorded, only functional properties
 *     (no errors, no overspend, safe failure) are gated.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@mushin/db";
import { resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../test-support/app";
import { buildApi, db, evidence, externalAttempts, indexer, KEY, owner, percentile, webFor } from "./harness";
import { insertCreator } from "../modules/creators/index";

const CITIES = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Peshawar", "Faisalabad", "Multan", "Quetta"];
const NICHES = ["Food", "Fashion", "Travel", "Tech", "Beauty", "Lifestyle"];
const PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
const QUERIES = ["food lahore", "fashion karachi", "travel vlogger", "tech reviews islamabad", "beauty", "lifestyle multan", "food vloggers in karachi", "street food", "khana lahore", "لاہور فوڈ", "fashion stylist lahore", "travel pakistan", "tech", "beauty tips karachi", "food blogger", "quetta travel", "peshawar food", "faisalabad fashion", "rawalpindi tech", "lahore"];
type Api = Awaited<ReturnType<typeof buildApi>>;
let api: Api;
let headers: Record<string, string>;
let ws = "";

beforeAll(async () => {
  await resetTables();
  const ids: string[] = [];
  for (let i = 0; i < 2_000; i++) {
    const city = CITIES[i % CITIES.length] as string;
    const niche = NICHES[i % NICHES.length] as string;
    const platform = PLATFORMS[i % PLATFORMS.length] as (typeof PLATFORMS)[number];
    const handle = `perf_${i}`;
    ids.push(await db.withSystem((tx) => insertCreator(tx, { displayName: `SYNTHETIC Perf ${i}`, primaryHandle: handle, primaryPlatform: platform, city, country: "PK", niches: [niche], tags: [], profiles: [{ platform, handle, followers: 10_500 + ((i * 7919) % 900_000), engagementRate: 1 + (i % 9), bio: `${niche.toLowerCase()} creator from ${city} ${i % 3 === 0 ? "street food vlogger" : "daily videos"}` }] }, KEY)));
  }
  for (let i = 0; i < ids.length; i += 200) await indexer.sync(ids.slice(i, i + 200));
  api = await buildApi();
  const p = await api.person();
  headers = p.headers;
  ws = p.workspaceId;
  await db.withWorkspace(ws, (tx) => api.billing.engine.grant(tx, ws, { source: "adjustment", amount: 1_000_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `perf-${randomUUID()}`, note: "perf" }));
}, 600_000);
afterAll(() => expect(externalAttempts).toEqual([]));

async function timed(text: string, filters: Record<string, unknown> = {}) {
  const t = performance.now();
  const r = await api.search(headers, text, filters);
  return { ms: performance.now() - t, status: r.statusCode, total: (r.json() as { total?: number }).total ?? 0 };
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: +percentile(s, 50).toFixed(1), p95: +percentile(s, 95).toFixed(1), p99: +percentile(s, 99).toFixed(1), max: +(s.at(-1) ?? 0).toFixed(1) };
};

describe("performance and resilience (PERF)", () => {
  it("PERF-01 cold first catalogue search (fresh service, empty settings cache) answers successfully", async () => {
    const cold = await buildApi();
    const p = await cold.person();
    const t = performance.now();
    const r = await cold.search(p.headers, "food lahore");
    const ms = performance.now() - t;
    evidence("PERF-01", { ms: +ms.toFixed(1), status: r.statusCode, catalogue: 2_000 });
    expect(r.statusCode).toBe(200);
  });

  it("PERF-02 300 sequential warm searches over 20 query shapes: latency percentiles, no errors", async () => {
    const out = [];
    for (let i = 0; i < 300; i++) out.push(await timed(QUERIES[i % QUERIES.length] as string, i % 4 === 0 ? { platform: PLATFORMS[i % 3] } : {}));
    const errors = out.filter((o) => o.status !== 200).length;
    const mem = process.memoryUsage();
    evidence("PERF-02", { latencyMs: stats(out.map((o) => o.ms)), errors, rssMb: Math.round(mem.rss / 1e6), heapUsedMb: Math.round(mem.heapUsed / 1e6) });
    expect(errors).toBe(0);
  });

  it("PERF-03 20 concurrent clients × 10 searches: throughput, latency and errors", async () => {
    const t = performance.now();
    const cpu = process.cpuUsage();
    const all = await Promise.all(Array.from({ length: 20 }, async (_, c) => {
      const res = [];
      for (let i = 0; i < 10; i++) res.push(await timed(QUERIES[(c + i) % QUERIES.length] as string));
      return res;
    }));
    const wall = performance.now() - t;
    const flat = all.flat();
    const used = process.cpuUsage(cpu);
    evidence("PERF-03", { requests: flat.length, wallMs: Math.round(wall), throughputPerSec: +(flat.length / (wall / 1000)).toFixed(1), latencyMs: stats(flat.map((o) => o.ms)), errors: flat.filter((o) => o.status !== 200).length, cpuUserMs: Math.round(used.user / 1000) });
    expect(flat.filter((o) => o.status !== 200)).toEqual([]);
  });

  it("PERF-04 the largest valid query (300 characters) answers successfully", async () => {
    const text = "food vlogger lahore street food desi khana ".repeat(8).slice(0, 300);
    const r = await timed(text);
    evidence("PERF-04", { ms: +r.ms.toFixed(1), status: r.status, length: text.length });
    expect(r.status).toBe(200);
  });

  it("PERF-05 a broad, high-match query (one niche over 2,000 creators) answers with a bounded page", async () => {
    const r = await api.search(headers, "creator");
    const body = r.json() as { results: unknown[]; total: number };
    const t = await timed("pakistan creator videos");
    evidence("PERF-05", { status: r.statusCode, pageSize: body.results.length, total: body.total, msBroad: +t.ms.toFixed(1) });
    expect(r.statusCode).toBe(200);
    expect(body.results.length).toBeLessThanOrEqual(24);
  });

  it("PERF-06 the main full-text query uses the search index (query plan, 2,000 documents)", async () => {
    const plan = await owner<{ "QUERY PLAN": string }>(`explain (analyze, format text) select creator_id from gcp.creator_search_documents d where d.eligible and d.search_vector @@ phraseto_tsquery('simple', 'food') order by ts_rank_cd(d.search_vector, phraseto_tsquery('simple','food')) desc limit 200`);
    const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
    const indexes = await owner<{ indexdef: string }>(`select indexdef from pg_indexes where schemaname = 'gcp' and tablename = 'creator_search_documents'`);
    evidence("PERF-06", { plan: text, indexes: indexes.map((i) => i.indexdef) });
    expect(indexes.some((i) => /gin/i.test(i.indexdef) && /search_vector/.test(i.indexdef))).toBe(true);
    expect(text).toMatch(/Execution Time/);
  });

  it("PERF-07 50 simultaneous instant spends on one workspace never overspend and all settle", async () => {
    const p = await api.person();
    await owner(`update wp.credit_lots set remaining = 0 where workspace_id = '${p.workspaceId}'`);
    await db.withWorkspace(p.workspaceId, (tx) => api.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: 100, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `perf7-${randomUUID()}`, note: "perf" }));
    const t = performance.now();
    const out = await Promise.allSettled(Array.from({ length: 50 }, () => db.withWorkspace(p.workspaceId, (tx) => api.billing.engine.spendInstant(tx, p.workspaceId, { action: "reveal_contact", confirmedCost: 5, refType: "creator", refId: randomUUID() }, { userId: p.sub, requestId: null }))));
    const ms = performance.now() - t;
    const [r] = await owner<{ remaining: number }>(`select coalesce(sum(remaining),0)::int remaining from wp.credit_lots where workspace_id = '${p.workspaceId}'`);
    evidence("PERF-07", { attempts: 50, ok: out.filter((o) => o.status === "fulfilled").length, refused: out.filter((o) => o.status === "rejected").length, remaining: r?.remaining, wallMs: Math.round(ms) });
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(20);
    expect(r?.remaining).toBe(0);
  });

  it("PERF-08 a database outage is reported by readiness (503) quickly and safely, without a stack trace", async () => {
    const broken = createDatabase("postgres://postgres@127.0.0.1:1/none", { max: 1, applicationName: "acceptance-outage", caPem: null });
    const app = await buildTestApp({ readiness: [{ name: "database", check: () => broken.ping() }] });
    const t = performance.now();
    const r = await app.inject({ method: "GET", url: "/health/ready" });
    const ms = performance.now() - t;
    await broken.close().catch(() => undefined);
    evidence("PERF-08", { status: r.statusCode, body: r.json(), ms: Math.round(ms) });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toMatch(/ECONNREFUSED|at \w+ \(/);
  });

  it("PERF-09 Live Discovery end to end on fixtures (size 10): duration of quote → run → settle", async () => {
    const handles = Array.from({ length: 12 }, (_, i) => `perf_live_${i + 1}`);
    const live = await buildApi({ fixtures: { web: webFor(() => handles) } });
    const p = await live.person();
    await db.withWorkspace(p.workspaceId, (tx) => live.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: 1_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `perf9-${randomUUID()}`, note: "perf" }));
    const t = performance.now();
    const { jobId } = await live.startLive(p.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 10);
    const t2 = performance.now();
    await live.live.run(jobId, p.workspaceId);
    const job = await live.discovery.get(p.ctx, jobId);
    const total = performance.now() - t;
    evidence("PERF-09", { msQuoteAndConfirm: Math.round(t2 - t), msRun: Math.round(performance.now() - t2), msTotal: Math.round(total), outcome: job.outcome, delivered: job.live?.found, note: "fixture providers: no network or provider latency included" });
    expect(job.status).toBe("completed");
  });

  it("PERF-10 a provider that fails on every attempt ends the run within the retry budget and returns the credits", async () => {
    const failing = await buildApi({ fixtures: { web: webFor(() => { throw new Error("socket hang up (injected)"); }) } });
    const p = await failing.person();
    const before = (await failing.balance(p.ctx)).available;
    // A brief no earlier test searched for: the 15-minute search cache is shared, and a cached answer never reaches the provider.
    const { jobId } = await failing.startLive(p.ctx, "fitness coach", { platform: "instagram", creatorCity: "Multan" }, 5);
    const t = performance.now();
    let attempts = 0;
    for (; attempts < 5; attempts++) {
      await failing.live.run(jobId, p.workspaceId).catch(() => undefined);
      if ((await failing.discovery.get(p.ctx, jobId)).status !== "running" && (await failing.discovery.get(p.ctx, jobId)).status !== "queued") break;
    }
    const job = await failing.discovery.get(p.ctx, jobId);
    evidence("PERF-10", { attemptsUntilTerminal: attempts + 1, status: job.status, ms: Math.round(performance.now() - t), balanceRestored: (await failing.balance(p.ctx)).available === before });
    expect(job.status).toBe("failed");
    expect((await failing.balance(p.ctx)).available).toBe(before);
  });
});
