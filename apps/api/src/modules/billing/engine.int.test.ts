import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantTx } from "@mushin/db";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables, pinActionCosts } from "@mushin/db/testing";
import { createCreditEngine } from "./engine";

// Ledger mechanics are tested with fixed prices, independent of the business price table (owner pricing lives in
// discovery and search tests).
let restorePrices: () => Promise<void> = async () => {};
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0, find_new: 12, live_creator: 10, reveal_contact: 5, refresh_data: 10, refresh_tiktok: 30 });
});
afterAll(() => restorePrices());


const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

let clock = new Date("2026-10-07T10:00:00Z");
const engine = createCreditEngine({ now: () => clock });
const actor = { userId: null, requestId: "req-test" };
const findNew = (refId = randomUUID()) => ({ action: "find_new" as const, confirmedCost: 12, refType: "test", refId });
const minutes = (n: number) => new Date(clock.getTime() + n * 60_000);

async function trialWorkspace() {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => engine.startTrial(tx, ws.workspaceId));
  return ws;
}
const inWs = <T>(ws: { userId: string; workspaceId: string }, fn: (tx: TenantTx) => Promise<T>) => db.withTenant(ws, fn);
/** Grants, expiry and cleanup run in the worker (webhooks and jobs), never as the API role. */
const inWorker = <T>(ws: { workspaceId: string }, fn: (tx: TenantTx) => Promise<T>) => db.withWorkspace(ws.workspaceId, fn);

beforeEach(() => {
  clock = new Date("2026-10-07T10:00:00Z");
});

describe("trial", () => {
  it("grants 200 trial credits once", async () => {
    const ws = await trialWorkspace();
    await inWs(ws, (tx) => engine.startTrial(tx, ws.workspaceId));
    const b = await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId));
    expect(b).toMatchObject({ status: "trialing", available: 200, reserved: 0, base: 200, meter: "normal" });
    const lots = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_lots where workspace_id = '${ws.workspaceId}'`);
    expect(lots[0]?.n).toBe(1);
  });
});

describe("reserve, commit, release", () => {
  it("holds credits, then spends the soonest-expiring lot first", async () => {
    const ws = await trialWorkspace();
    const topup = await inWorker(ws, (tx) =>
      engine.grant(tx, ws.workspaceId, { source: "topup", amount: 100, expiresAt: null, sourceRef: "txn:1" }),
    );
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 288, reserved: 12 });
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor)); // repeat is a no-op
    const lots = await ownerQuery<{ source: string; remaining: number }>(
      `select source, remaining from wp.credit_lots where workspace_id = '${ws.workspaceId}' order by source`,
    );
    expect(lots).toEqual([
      { source: "topup", remaining: 100 },
      { source: "trial", remaining: 188 },
    ]);
    const kinds = await ownerQuery<{ kind: string; amount: number }>(
      `select kind, amount from wp.credit_ledger where reservation_id = '${reservationId}' order by created_at, kind`,
    );
    expect(kinds).toEqual([
      { kind: "reserve", amount: 12 },
      { kind: "spend", amount: -12 },
    ]);
    expect(topup).toEqual(expect.any(String));
    await expect(inWs(ws, (tx) => engine.release(tx, ws.workspaceId, reservationId, "test", actor))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("releases a hold without touching lots, and a repeated release is a no-op", async () => {
    const ws = await trialWorkspace();
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    await inWs(ws, (tx) => engine.release(tx, ws.workspaceId, reservationId, "job failed", actor));
    await inWs(ws, (tx) => engine.release(tx, ws.workspaceId, reservationId, "job failed", actor));
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 200, reserved: 0 });
    const rows = await ownerQuery<{ kind: string }>(`select kind from wp.credit_ledger where reservation_id = '${reservationId}' order by created_at`);
    expect(rows.map((r) => r.kind)).toEqual(["reserve", "release"]);
  });

  it("refuses a changed cost (Review Focus 4) and too few credits", async () => {
    const ws = await trialWorkspace();
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, { ...findNew(), confirmedCost: 10 }, actor))).rejects.toMatchObject({
      code: "CONFLICT",
      details: { confirmedCost: 10, currentCost: 12 },
    });
    await ownerQuery(`update wp.credit_lots set remaining = 5 where workspace_id = '${ws.workspaceId}'`);
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      details: { required: 12, available: 5 },
    });
    const held = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_reservations`);
    expect(held[0]?.n).toBe(0);
  });

  it("never overspends under 20 concurrent reserves", async () => {
    const ws = await trialWorkspace();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(16); // 16 × 12 = 192 ≤ 200
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 8, reserved: 192 });
  });
});

describe("plans and access", () => {
  it("spends only top-up credits from a hold placed without a plan, though other lots are unexpired", async () => {
    const ws = await trialWorkspace(); // the trial lot stays valid until day 14
    await inWorker(ws, (tx) => engine.grant(tx, ws.workspaceId, { source: "topup", amount: 100, expiresAt: null, sourceRef: "txn:scope" }));
    await ownerQuery(`update wp.subscriptions set status = 'canceled' where workspace_id = '${ws.workspaceId}'`);
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    const lots = await ownerQuery<{ source: string; remaining: number }>(`select source, remaining from wp.credit_lots order by source`);
    expect(lots).toEqual([
      { source: "topup", remaining: 88 },
      { source: "trial", remaining: 200 },
    ]);
  });

  it("requires a plan, but lets an expired workspace spend paid top-ups only", async () => {
    const bare = await createTestWorkspace();
    await expect(inWs(bare, (tx) => engine.reserve(tx, bare.workspaceId, findNew(), actor))).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
    });

    const ws = await trialWorkspace();
    await ownerQuery(`update wp.subscriptions set status = 'expired' where workspace_id = '${ws.workspaceId}'`);
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      details: { reason: "no_active_plan" },
    });
    await inWorker(ws, (tx) => engine.grant(tx, ws.workspaceId, { source: "topup", amount: 20, expiresAt: null, sourceRef: "txn:2" }));
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 20, topupRemaining: 20 });
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).resolves.toMatchObject({ amount: 12 });
  });

  it("treats a trial past its end as expired before the trial-end job runs", async () => {
    const ws = await trialWorkspace();
    clock = new Date(clock.getTime() + 15 * 86_400_000);
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ status: "expired", available: 0 });
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
  });

  it("grants each source reference once", async () => {
    const ws = await trialWorkspace();
    const g = { source: "topup" as const, amount: 50, expiresAt: null, sourceRef: "txn:dup" };
    expect(await inWorker(ws, (tx) => engine.grant(tx, ws.workspaceId, g))).toEqual(expect.any(String));
    expect(await inWorker(ws, (tx) => engine.grant(tx, ws.workspaceId, g))).toBeNull();
  });
});

describe("expiry and cleanup", () => {
  it("commits from lots that were valid when reserved (Review Focus 1)", async () => {
    const ws = await createTestWorkspace();
    await ownerQuery(`insert into wp.subscriptions (workspace_id, status) values ('${ws.workspaceId}', 'active')`);
    await inWorker(ws, (tx) => engine.grant(tx, ws.workspaceId, { source: "monthly", amount: 20, expiresAt: minutes(5), sourceRef: "m:1" }));
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    clock = minutes(10);
    expect(await inWorker(ws, (tx) => engine.expireLots(tx, ws.workspaceId))).toBe(0); // skipped: a hold exists
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    expect(await inWorker(ws, (tx) => engine.expireLots(tx, ws.workspaceId))).toBe(1);
    expect(await inWs(ws, (tx) => engine.reconcile(tx, ws.workspaceId))).toEqual([]);
  });

  it("releases abandoned holds but keeps renewed ones", async () => {
    const ws = await trialWorkspace();
    const kept = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    const dropped = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    clock = minutes(10);
    await inWs(ws, (tx) => engine.extend(tx, ws.workspaceId, kept.reservationId));
    clock = minutes(10); // 20 minutes after the holds were made
    expect(await inWorker(ws, (tx) => engine.releaseAbandoned(tx, ws.workspaceId))).toBe(1);
    const rows = await ownerQuery<{ id: string; status: string }>(`select id, status from wp.credit_reservations order by status`);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: dropped.reservationId, status: "expired" },
        { id: kept.reservationId, status: "held" },
      ]),
    );
  });

  it("detects a lot that no longer matches its ledger", async () => {
    const ws = await trialWorkspace();
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    expect(await inWs(ws, (tx) => engine.reconcile(tx, ws.workspaceId))).toEqual([]);
    await ownerQuery(`update wp.credit_lots set remaining = remaining + 1 where workspace_id = '${ws.workspaceId}'`);
    expect(await inWs(ws, (tx) => engine.reconcile(tx, ws.workspaceId))).toEqual([expect.objectContaining({ remaining: 189, ledgerSum: 188 })]);
  });
});

describe("meter alerts", () => {
  it("writes low and very-low notifications once each as the balance falls", async () => {
    const ws = await trialWorkspace();
    for (let i = 0; i < 16; i++) await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor)); // 200 → 8
    const rows = await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox order by created_at`);
    expect(rows.map((r) => r.event_type)).toEqual(["notify.credits_low", "notify.credits_very_low"]);
  });
});

describe("plan limits", () => {
  it("counts monthly usage up to the limit", async () => {
    const ws = await trialWorkspace();
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "audience_views", 2))).toBe(true);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "audience_views", 2))).toBe(true);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "audience_views", 2))).toBe(false);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "outreach_emails", 0))).toBe(false);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "outreach_emails", null))).toBe(true);
  });
});
