import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables, pinActionCosts } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "./index";

// Ledger mechanics are tested with fixed prices, independent of the business price table (owner pricing lives in
// discovery and search tests).
let restorePrices: () => Promise<void> = async () => {};
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0, find_new: 12, live_creator: 10, reveal_contact: 5, refresh_data: 10, refresh_tiktok: 30 });
});
afterAll(() => restorePrices());


const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const actor = (c: TenantContext) => ({ userId: c.userId, requestId: c.requestId });
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;

async function hold(c: TenantContext, amount: number, confirmedCost = amount) {
  return db.withTenant(c, (tx) =>
    billing.engine.reserveAmount(tx, c.workspaceId, { action: "find_new", amount, confirmedCost, refType: "discovery_job", refId: randomUUID() }, actor(c)),
  );
}

describe("quoted reservations and partial commits", () => {
  it("reads current prices in the transaction", async () => {
    const c = await customer();
    expect(await db.withTenant(c, (tx) => billing.engine.costs(tx, ["find_new", "refresh_data", "refresh_tiktok"]))).toEqual({ find_new: 12, refresh_data: 10, refresh_tiktok: 30 });
  });

  it("holds a quoted amount and refuses a stale quote", async () => {
    const c = await customer();
    await expect(hold(c, 112, 100)).rejects.toMatchObject({ code: "CONFLICT", details: { confirmedCost: 100, currentCost: 112 } });
    await hold(c, 112);
    expect(await balance(c)).toMatchObject({ available: 88, reserved: 112 });
  });

  it("charges part of a reservation and returns the rest, keeping lots and ledger in step", async () => {
    const c = await customer();
    const h = await hold(c, 112);
    await db.withTenant(c, (tx) => billing.engine.commitPartial(tx, c.workspaceId, h.reservationId, 42, actor(c), "Found 4 creators (3 new)"));
    expect(await balance(c)).toMatchObject({ available: 158, reserved: 0 });
    const ledger = await ownerQuery<{ kind: string; amount: number }>(`select kind, amount from wp.credit_ledger where reservation_id = '${h.reservationId}' order by created_at, kind`);
    expect(ledger.map((l) => [l.kind, l.amount])).toEqual(expect.arrayContaining([["reserve", 112], ["spend", -42], ["release", 70]]));
    expect(await db.withTenant(c, (tx) => billing.engine.reconcile(tx, c.workspaceId))).toEqual([]);
    // A second commit of the same reservation changes nothing.
    await db.withTenant(c, (tx) => billing.engine.commitPartial(tx, c.workspaceId, h.reservationId, 42, actor(c), "again"));
    expect(await balance(c)).toMatchObject({ available: 158, reserved: 0 });
  });

  it("releases everything when nothing is used, and never charges more than was held", async () => {
    const c = await customer();
    const h = await hold(c, 62);
    await expect(db.withTenant(c, (tx) => billing.engine.commitPartial(tx, c.workspaceId, h.reservationId, 63, actor(c), "x"))).rejects.toThrow(/between 0 and/);
    await db.withTenant(c, (tx) => billing.engine.commitPartial(tx, c.workspaceId, h.reservationId, 0, actor(c), "Nothing found"));
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
    const [r] = await ownerQuery<{ status: string }>(`select status from wp.credit_reservations where id = '${h.reservationId}'`);
    expect(r?.status).toBe("released");
  });

  it("refuses more than the workspace has", async () => {
    const c = await customer();
    await expect(hold(c, 312)).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });
});
