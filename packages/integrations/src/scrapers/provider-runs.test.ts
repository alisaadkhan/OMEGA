import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { createApifyClient, type ApifyRun } from "./apify";
import { reconcileApifyRuns } from "./reconcile";
import { createProfileScraper } from "./scraper";
import { scraperFixture } from "./testing";
import type { ProviderRunRecord, ProviderRunStore } from "./types";

/** Audit SRCH-04: a paid Apify run survives a worker crash without a second paid run or a second cost. */
const logger = createLogger({ level: "silent" });

/** The PostgreSQL store's behaviour, in memory. */
function memoryRuns() {
  const rows = new Map<string, ProviderRunRecord & { actor: string; jobId: string | null; workspaceId: string | null; startedAt: Date; costUsd: number | null }>();
  const store: ProviderRunStore = {
    async claim(r) {
      const existing = rows.get(r.runKey);
      if (existing) return { run: { runKey: existing.runKey, externalRunId: existing.externalRunId, status: existing.status, costRecorded: existing.costRecorded }, created: false };
      rows.set(r.runKey, { runKey: r.runKey, externalRunId: null, status: "starting", costRecorded: false, actor: r.actor, jobId: r.jobId, workspaceId: r.workspaceId, startedAt: new Date(), costUsd: null });
      return { run: { runKey: r.runKey, externalRunId: null, status: "starting", costRecorded: false }, created: true };
    },
    async attach(key, id) {
      const r = rows.get(key);
      if (r && (r.status === "starting" || r.status === "running")) Object.assign(r, { externalRunId: id, status: "running" });
    },
    async finish(key, status, costUsd) {
      const r = rows.get(key);
      if (r && (r.status === "starting" || r.status === "running")) Object.assign(r, { status, costUsd, costRecorded: costUsd !== null });
    },
    async open(before) {
      return [...rows.values()].filter((r) => (r.status === "starting" || r.status === "running") && r.startedAt < before);
    },
  };
  return { store, rows };
}

const runFixture = () => scraperFixture("apify-run-instagram.json") as ApifyRun;

function fakeApify(state: { phase: "crash" | "done" }) {
  const calls: { url: string; method: string }[] = [];
  const f = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (method === "POST" && url.includes("/runs?")) return Response.json({ data: { ...runFixture(), id: "run-9", status: "RUNNING" } }, { status: 201 });
    if (url.includes("/actor-runs/run-9")) {
      // The worker dies while waiting: the connection drops.
      if (state.phase === "crash") throw new Error("socket hang up");
      return Response.json({ data: { ...runFixture(), id: "run-9", status: "SUCCEEDED" } });
    }
    if (url.includes("/datasets/")) return Response.json(url.includes("/items") ? [{ username: "coke_studio", followersCount: 1 }] : { data: { itemCount: 1 } });
    return new Response("unexpected", { status: 500 });
  };
  return { fetch: f as typeof fetch, calls };
}

const scraperWith = (fetchImpl: typeof fetch, runs: ProviderRunStore, sink: MemoryProviderCallSink) =>
  createProfileScraper({
    apify: { token: "t", instagramActor: "apify/instagram-profile-scraper", tiktokActor: "clockworks/tiktok-profile-scraper" },
    youtubeApiKey: null,
    tiktokVideos: 3,
    spendGuard: { begin: async () => () => undefined },
    sink,
    logger,
    fetch: fetchImpl,
    sleep: async () => undefined,
    runs,
  });

describe("paid Apify runs across a worker crash (audit SRCH-04)", () => {
  it("the retry resumes the same run: one paid start, one cost; Apify's own caps are sent", async () => {
    const { store, rows } = memoryRuns();
    const sink = new MemoryProviderCallSink();
    const state: { phase: "crash" | "done" } = { phase: "crash" };
    const api = fakeApify(state);
    const req = { platform: "instagram" as const, handle: "coke_studio", ctx: { workspaceId: "w1", jobId: "11111111-1111-4111-8111-111111111111", requestId: null } };

    await expect(scraperWith(api.fetch, store, sink).fetchProfile(req)).rejects.toThrow();
    const [run] = [...rows.values()];
    expect(run).toMatchObject({ externalRunId: "run-9", status: "running", costRecorded: false }); // stored before waiting

    state.phase = "done";
    const out = await scraperWith(api.fetch, store, sink).fetchProfile(req); // the job's retry, in a fresh process
    expect(out.provider).toBe("apify");
    const starts = api.calls.filter((c) => c.method === "POST" && c.url.includes("/runs?"));
    expect(starts).toHaveLength(1);
    expect(starts[0]?.url).toMatch(/timeout=300/);
    expect(starts[0]?.url).toMatch(/maxTotalChargeUsd=1/);
    expect([...rows.values()][0]).toMatchObject({ status: "succeeded", costRecorded: true });
    const paid = sink.calls.filter((c) => c.provider === "apify" && c.costUsd > 0);
    expect(paid).toHaveLength(1);

    // A further retry after success reads the items again but never records the cost twice.
    await scraperWith(api.fetch, store, sink).fetchProfile(req);
    expect(api.calls.filter((c) => c.method === "POST" && c.url.includes("/runs?"))).toHaveLength(1);
    expect(sink.calls.filter((c) => c.provider === "apify" && c.costUsd > 0)).toHaveLength(1);
  });

  it("the reconciler settles an ended run once and aborts one still running past its deadline", async () => {
    const { store, rows } = memoryRuns();
    const sink = new MemoryProviderCallSink();
    const old = new Date(Date.now() - 60 * 60_000);
    await store.claim({ runKey: "apify:j:a:ended", actor: "a", jobId: null, workspaceId: null });
    await store.attach("apify:j:a:ended", "run-ended");
    await store.claim({ runKey: "apify:j:a:stuck", actor: "a", jobId: null, workspaceId: null });
    await store.attach("apify:j:a:stuck", "run-stuck");
    await store.claim({ runKey: "apify:j:a:lost", actor: "a", jobId: null, workspaceId: null });
    for (const r of rows.values()) r.startedAt = old;
    const aborted: string[] = [];
    const f = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/run-ended")) return Response.json({ data: { ...runFixture(), id: "run-ended", status: "SUCCEEDED" } });
      if (url.endsWith("/run-stuck")) return Response.json({ data: { ...runFixture(), id: "run-stuck", status: "RUNNING" } });
      if (url.endsWith("/run-stuck/abort") && init?.method === "POST") {
        aborted.push(url);
        return Response.json({ data: { ...runFixture(), id: "run-stuck", status: "ABORTED" } });
      }
      if (url.includes("/datasets/")) return Response.json({ data: { itemCount: 2 } });
      return new Response("unexpected", { status: 500 });
    };
    const tally = await reconcileApifyRuns({ runs: store, apify: createApifyClient({ token: "t", fetch: f as typeof fetch }), sink, logger });
    expect(tally).toEqual({ settled: 1, aborted: 1, unknown: 1, open: 0 });
    expect(aborted).toHaveLength(1);
    expect(sink.calls.filter((c) => c.operation === "reconciled_run")).toHaveLength(2);
    expect(await reconcileApifyRuns({ runs: store, apify: createApifyClient({ token: "t", fetch: f as typeof fetch }), sink, logger })).toEqual({ settled: 0, aborted: 0, unknown: 0, open: 0 });
  });
});
