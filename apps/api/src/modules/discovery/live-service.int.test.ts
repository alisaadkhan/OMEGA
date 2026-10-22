import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema, type LiveSearch, type LiveRunSize } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { workerHeartbeatAgeSeconds } from "@mushin/db";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { addCreator } from "../creators/test-fixtures";
import * as repo from "./repository";
import { createDiscoveryService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const discovery = createDiscoveryService({ db, billing });
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;
const search = (filters: Record<string, unknown> = {}, text = "bridal makeup in Lahore"): LiveSearch => ({ text, filters: searchFiltersSchema.parse(filters) });
const estimate = (c: TenantContext, s: LiveSearch, maxNew: LiveRunSize) => discovery.createEstimate(c, { search: s, maxNew });
const startLive = async (c: TenantContext, s: LiveSearch, maxNew: LiveRunSize) => {
  const quote = await estimate(c, s, maxNew);
  return discovery.start(c, { kind: "live", estimateId: quote.estimateId });
};

async function started(c: TenantContext, s = search({ platform: "instagram" }), maxNew: 5 | 10 | 15 = 10): Promise<string> {
  const out = await startLive(c, s, maxNew);
  if (out.body.status !== "started") throw new Error("expected started");
  return out.body.job.id;
}

describe("starting live runs", () => {
  it("quotes without spending, then reserves the server-priced maximum and announces the run", async () => {
    const c = await customer();
    const s = search({ platform: "instagram", niches: ["Bridal"] });
    const quote = await estimate(c, s, 10);
    expect(quote).toMatchObject({ maxCredits: 150 }); // 50 base + 10 × 10 new creators
    expect(quote.priceVersion).toHaveLength(24);
    expect(Date.parse(quote.expiresAt)).toBeGreaterThan(Date.now());
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const out = await discovery.start(c, { kind: "live", estimateId: quote.estimateId });
    expect(out.httpStatus).toBe(202);
    if (out.body.status !== "started") throw new Error("expected started");
    expect(out.body.job).toMatchObject({ kind: "live", status: "queued", platform: null, handle: null, live: { maxNew: 10, maxCost: 150, found: 0, creditsCharged: 0 } });
    expect(await balance(c)).toMatchObject({ available: 50, reserved: 150 });
    const ev = await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox where event_type like 'discovery.%'`);
    expect(ev.map((e) => e.event_type)).toEqual(["discovery.live_requested"]);
  });

  // Regression (search audit 2026-10-22): with no worker running, a run stayed "queued" indefinitely with its credits held.
  it("refuses a run, holding nothing and queueing nothing, while the worker's heartbeat is missing or stale", async () => {
    const age = async () => db.withSystem((tx) => workerHeartbeatAgeSeconds(tx));
    const gated = createDiscoveryService({ db, billing, workerAvailable: async () => { const a = await age(); return a !== null && a < 300; } });
    const c = await customer();
    for (const beat of [null, "now() - interval '10 minutes'"]) {
      await ownerQuery(beat ? `insert into platform.process_heartbeats (process, beat_at) values ('worker', ${beat}) on conflict (process) do update set beat_at = excluded.beat_at` : `delete from platform.process_heartbeats`);
      const quote = await estimate(c, search({ platform: "instagram" }), 10);
      await expect(gated.start(c, { kind: "live", estimateId: quote.estimateId })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", details: { reason: "worker_unavailable" } });
      expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    }
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.discovery_jobs`))[0]?.n).toBe(0);
    await ownerQuery(`update platform.process_heartbeats set beat_at = now() where process = 'worker'`);
    expect(await age()).toBeLessThan(5);
    const quote = await estimate(c, search({ platform: "instagram" }), 10);
    expect((await gated.start(c, { kind: "live", estimateId: quote.estimateId })).httpStatus).toBe(202);
    expect(await balance(c)).toMatchObject({ available: 50, reserved: 150 });
  });

  it("prices every platform the same (100 / 150 / 200 for 5 / 10 / 15) and rejects an unaffordable quote at confirmation", async () => {
    const c = await customer();
    for (const [size, max] of [[5, 100], [10, 150], [15, 200]] as const) {
      expect((await estimate(c, search(), size)).maxCredits).toBe(max);
      expect((await estimate(c, search({ platform: "tiktok" }), size)).maxCredits).toBe(max);
    }
    const first = await startLive(c, search(), 5);
    expect(await balance(c)).toMatchObject({ available: 100, reserved: 100 });
    if (first.body.status !== "started") throw new Error("expected started");
    await ownerQuery(`update wp.discovery_jobs set status = 'completed' where id = '${first.body.job.id}'`); // its hold stays until settled
    const expensive = await estimate(c, search({ platform: "instagram" }), 15);
    expect(expensive.maxCredits).toBe(200);
    await expect(discovery.start(c, { kind: "live", estimateId: expensive.estimateId })).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });

  it("uses one quote exactly once, even when confirmation is concurrent", async () => {
    const c = await customer();
    const quote = await estimate(c, search({ platform: "instagram" }), 5);
    const outs = await Promise.all(Array.from({ length: 4 }, () => discovery.start(c, { kind: "live", estimateId: quote.estimateId })));
    expect(new Set(outs.map((o) => (o.body.status === "started" ? o.body.job.id : "")))).toHaveProperty("size", 1);
    expect(await balance(c)).toMatchObject({ available: 100, reserved: 100 });
  });

  it("runs one live discovery per workspace at a time, without holding credits for the second (audit BIL-06)", async () => {
    const c = await customer();
    const firstId = await started(c, search({ platform: "instagram" }), 5);
    const second = await estimate(c, search({ platform: "youtube" }), 5); // a different brief, not a duplicate of the first
    await expect(discovery.start(c, { kind: "live", estimateId: second.estimateId })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "live_run_in_progress", jobId: firstId },
    });
    expect(await balance(c)).toMatchObject({ available: 100, reserved: 100 });
    // Concurrent confirmations of different briefs: exactly one starts.
    const d = await customer();
    const quotes = await Promise.all([search({ platform: "youtube" }), search({ platform: "instagram" })].map((s) => estimate(d, s, 5)));
    const outs = await Promise.allSettled(quotes.map((q) => discovery.start(d, { kind: "live", estimateId: q.estimateId })));
    expect(outs.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outs.filter((o) => o.status === "rejected").map((o) => (o as PromiseRejectedResult).reason)).toEqual([expect.objectContaining({ code: "CONFLICT" })]);
    // Once the run finishes, the next brief starts.
    await ownerQuery(`update wp.discovery_jobs set status = 'completed' where id = '${firstId}'`);
    expect((await discovery.start(c, { kind: "live", estimateId: second.estimateId })).httpStatus).toBe(202);
  });

  it("returns the existing job for a duplicate brief confirmation without a second hold or outbox event", async () => {
    const c = await customer();
    const s = search({ platform: "instagram", niches: ["Bridal"] });
    const firstQuote = await estimate(c, s, 10);
    const first = await discovery.start(c, { kind: "live", estimateId: firstQuote.estimateId });
    if (first.body.status !== "started") throw new Error("expected started");

    const duplicateQuote = await estimate(c, s, 10);
    const duplicate = await discovery.start(c, { kind: "live", estimateId: duplicateQuote.estimateId });
    if (duplicate.body.status !== "started") throw new Error("expected existing started job");
    expect(duplicate.httpStatus).toBe(200);
    expect(duplicate.body.job.id).toBe(first.body.job.id);
    expect(await balance(c)).toMatchObject({ available: 50, reserved: 150 });
    const reservations = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_reservations where workspace_id = '${c.workspaceId}' and action = 'find_new'`);
    const events = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where workspace_id = '${c.workspaceId}' and event_type = 'discovery.live_requested'`);
    expect(reservations[0]?.n).toBe(1);
    expect(events[0]?.n).toBe(1);
  });

  it("rejects broad briefs before storing an estimate or touching credits", async () => {
    const c = await customer();
    await expect(estimate(c, search({}, "best creators and influencers"), 10)).rejects.toMatchObject({ code: "QUERY_TOO_BROAD" });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const rows = await ownerQuery<{ n: number }>(`select count(*)::int as n from wp.discovery_estimates where workspace_id = '${c.workspaceId}'`);
    expect(rows[0]?.n).toBe(0);
  });

  it("rejects expired estimates without reserving credits", async () => {
    const c = await customer();
    const quote = await estimate(c, search(), 5);
    await ownerQuery(`update wp.discovery_estimates set expires_at = now() - interval '1 second' where id = '${quote.estimateId}'`);
    await expect(discovery.start(c, { kind: "live", estimateId: quote.estimateId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });
});

describe("reading results", () => {
  it("returns cards after the cursor, leaves hidden creators out, and keeps runs private", async () => {
    const a = await customer();
    const b = await customer();
    const jobId = await started(a);
    const known = await addCreator(db, { displayName: "Known One" });
    const fresh = await addCreator(db, { displayName: "New One" });
    const minor = await addCreator(db, { isMinor: true });
    await db.withWorkspace(a.workspaceId, async (tx) => {
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: known, isNew: false, credits: 0, reason: null })).toBe(true);
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: fresh, isNew: true, credits: 10, reason: "Bridal makeup in Lahore" })).toBe(true);
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: minor, isNew: true, credits: 0, reason: null })).toBe(true);
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: fresh, isNew: true, credits: 10, reason: null })).toBe(false);
    });
    const all = await discovery.results(a, jobId, 0);
    expect(all.results.map((r) => [r.displayName, r.isNew, r.seq])).toEqual([["Known One", false, 1], ["New One", true, 2]]);
    expect(all.done).toBe(false);
    expect((await discovery.results(a, jobId, 1)).results.map((r) => r.displayName)).toEqual(["New One"]);
    expect(await discovery.get(a, jobId)).toMatchObject({ live: { found: 3, new: 2, known: 1 } });
    await expect(discovery.results(b, jobId, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
