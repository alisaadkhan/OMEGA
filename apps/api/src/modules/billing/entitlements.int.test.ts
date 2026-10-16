import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments, type PaymentEvent } from "@mushin/integrations";
import { MemoryAccessCache } from "./access-cache";
import { createBillingService } from "./service";

/** Owner plan model 2026-10-16 (pricing screenshot): catalogue, annual switch, refunds and chargebacks. */
const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

let clock = new Date("2026-10-07T10:00:00Z");
const sent: { raw: string; sig: string }[] = [];
const payments = new MockPayments({ webhookSecret: "w".repeat(40), publicApiUrl: "http://api.test", now: () => clock, deliver: async (raw, sig) => void sent.push({ raw, sig }) });
const cache = new MemoryAccessCache();
const capabilities = { audienceDetails: false, outreachEmail: "off", export: true } as const;
const billing = createBillingService({ db, payments, cache, logger: createLogger({ level: "silent" }), now: () => clock, capabilities });

beforeEach(() => {
  clock = new Date("2026-10-07T10:00:00Z");
  sent.length = 0;
  cache.entries.clear();
});

async function flush() {
  for (const s of sent.splice(0)) await billing.applyEvent(payments.verifyWebhook(s.raw, s.sig));
}
async function customer(role: TenantContext["role"] = "owner") {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req", role, email: "owner@test.mushin.pk" };
}
async function buy(c: Awaited<ReturnType<typeof customer>>, req: Parameters<typeof billing.startCheckout>[1]) {
  const { checkoutId } = await billing.startCheckout(c, req);
  await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
  await flush();
}
const lots = (ws: string) => ownerQuery<{ source: string; amount: number; remaining: number }>(`select source, amount, remaining from wp.credit_lots where workspace_id = '${ws}' order by created_at`);
const txnOf = async (ws: string, kind: string) => (await ownerQuery<{ t: string }>(`select paddle_transaction_id t from wp.payments where workspace_id = '${ws}' and kind = '${kind}' order by created_at desc limit 1`))[0]?.t ?? "";
const adjustment = (o: { id: string; transactionId: string; action?: "refund" | "chargeback"; amountMinor: number; full?: boolean }): PaymentEvent => ({
  kind: "adjustment.approved",
  eventId: `evt_${o.id}`,
  occurredAt: clock,
  adjustmentId: o.id,
  action: o.action ?? "refund",
  transactionId: o.transactionId,
  amountMinor: o.amountMinor,
  full: o.full ?? true,
});
const reconciled = async (c: TenantContext) => db.withTenant(c, (tx) => billing.engine.reconcile(tx, c.workspaceId));

describe("plan catalogue (owner pricing 2026-10-16)", () => {
  it("serves exactly the owner's table from the database, with the server's capability switches and no annual billing", async () => {
    const c = await customer();
    const p = await billing.plans(c);
    expect(p.plans.map((x) => ({ id: x.id, name: x.name, credits: x.monthlyCredits, pkr: x.display.monthly, e: x.entitlements }))).toEqual([
      { id: "explorer", name: "Starter", credits: 2500, pkr: { amountMinor: 490_000, currency: "PKR" }, e: { audienceViewsPerMonth: 0, outreachEmailsPerMonth: 0, campaignLimit: 3, export: false } },
      { id: "growth", name: "Growth", credits: 12000, pkr: { amountMinor: 1_290_000, currency: "PKR" }, e: { audienceViewsPerMonth: null, outreachEmailsPerMonth: 500, campaignLimit: null, export: false } },
      { id: "scale", name: "Scale", credits: 35000, pkr: { amountMinor: 2_490_000, currency: "PKR" }, e: { audienceViewsPerMonth: null, outreachEmailsPerMonth: 2000, campaignLimit: null, export: true } },
    ]);
    expect(p.annualBilling).toBe(false);
    expect(p.availability).toEqual(capabilities);
    // The signed-out pricing page reads the same catalogue.
    expect(await billing.publicPlans()).toEqual(p);
  });

  it("refuses yearly checkouts and changes until annual billing is approved, and allows monthly", async () => {
    const c = await customer();
    await expect(billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "year" })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "annual_billing_unavailable" } });
    await buy(c, { kind: "subscription", planId: "growth", interval: "month" });
    await expect(billing.requestPlanChange(c, { planId: "scale", interval: "year" })).rejects.toMatchObject({ details: { reason: "annual_billing_unavailable" } });
    // Global setting: always restored, since resetting the tables does not touch platform settings.
    await ownerQuery(`update platform.billing_settings set annual_billing_enabled = true`);
    try {
      expect((await billing.plans(c)).annualBilling).toBe(true);
      expect(await billing.requestPlanChange(c, { planId: "scale", interval: "year" })).toMatchObject({ change: "upgrade" });
    } finally {
      await ownerQuery(`update platform.billing_settings set annual_billing_enabled = false`);
    }
  });
});

describe("refunds and chargebacks (provisional policy, OD-009)", () => {
  it("a refunded top-up loses its unspent credits once; spent credits are a shortfall; the ledger still reconciles", async () => {
    const c = await customer();
    await buy(c, { kind: "subscription", planId: "explorer", interval: "month" });
    await buy(c, { kind: "topup", packId: "credits_1000" });
    // Spend all monthly credits and part of the top-up (monthly credits are spent first).
    await ownerQuery(`update wp.credit_lots set remaining = 0 where workspace_id = '${c.workspaceId}' and source <> 'topup'`);
    await ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, note) select workspace_id, -amount, 'expire', id, 'test: spent' from wp.credit_lots where workspace_id = '${c.workspaceId}' and source <> 'topup'`);
    await ownerQuery(`update wp.credit_lots set remaining = 700 where workspace_id = '${c.workspaceId}' and source = 'topup'`);
    await ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, note) select workspace_id, -300, 'expire', id, 'test: spent' from wp.credit_lots where workspace_id = '${c.workspaceId}' and source = 'topup'`);
    const t = await txnOf(c.workspaceId, "topup");
    await billing.applyEvent(adjustment({ id: "adj_1", transactionId: t, amountMinor: 900 }));
    await billing.applyEvent(adjustment({ id: "adj_1", transactionId: t, amountMinor: 900 })); // duplicate delivery
    expect((await lots(c.workspaceId)).find((l) => l.source === "topup")).toMatchObject({ amount: 1000, remaining: 0 });
    const [a] = await ownerQuery<{ credits_removed: number; credits_shortfall: number; action: string }>(`select credits_removed, credits_shortfall, action from wp.payment_adjustments where workspace_id = '${c.workspaceId}'`);
    expect(a).toEqual({ credits_removed: 700, credits_shortfall: 300, action: "refund" });
    expect((await ownerQuery<{ status: string; refunded_minor: string }>(`select status, refunded_minor from wp.payments where paddle_transaction_id = '${t}'`))[0]).toMatchObject({ status: "refunded", refunded_minor: "900" });
    expect(await reconciled(c)).toEqual([]);
    expect((await billing.summary(c)).balance.available).toBe(0);
  });

  it("a partial refund removes the same share of the credits it bought", async () => {
    const c = await customer();
    await buy(c, { kind: "subscription", planId: "explorer", interval: "month" });
    await buy(c, { kind: "topup", packId: "credits_1000" });
    await billing.applyEvent(adjustment({ id: "adj_half", transactionId: await txnOf(c.workspaceId, "topup"), amountMinor: 450, full: false }));
    expect((await lots(c.workspaceId)).find((l) => l.source === "topup")?.remaining).toBe(500);
    expect((await ownerQuery<{ status: string }>(`select status from wp.payments where kind = 'topup' and workspace_id = '${c.workspaceId}'`))[0]?.status).toBe("partially_refunded");
    expect(await reconciled(c)).toEqual([]);
  });

  it("a chargeback of a subscription payment removes this period's monthly credits but never credits held for running work", async () => {
    const c = await customer();
    await buy(c, { kind: "subscription", planId: "growth", interval: "month" });
    const held = await billing.reserve(c, { action: "find_new", confirmedCost: 50, refType: "test", refId: "held" });
    await billing.applyEvent(adjustment({ id: "adj_cb", transactionId: await txnOf(c.workspaceId, "subscription"), action: "chargeback", amountMinor: 4600 }));
    const after = await lots(c.workspaceId);
    const [adj] = await ownerQuery<{ credits_removed: number }>(`select credits_removed from wp.payment_adjustments where workspace_id = '${c.workspaceId}'`);
    // This period's monthly credits are gone; the trial lot (not bought by this payment) is untouched and covers the hold.
    expect(after.filter((l) => l.source === "monthly").reduce((n, l) => n + l.remaining, 0)).toBe(0);
    expect(after.find((l) => l.source === "trial")?.remaining).toBe(200);
    expect(adj?.credits_removed).toBe(after.filter((l) => l.source === "monthly").reduce((n, l) => n + l.amount - l.remaining, 0));
    await billing.commit(c, held.reservationId); // the held charge still settles
    expect((await ownerQuery<{ status: string }>(`select status from wp.payments where kind = 'subscription' and workspace_id = '${c.workspaceId}'`))[0]?.status).toBe("charged_back");
    expect(await reconciled(c)).toEqual([]);
  });

  it("ignores an adjustment for a transaction MUSHIN never recorded", async () => {
    await expect(billing.applyEvent(adjustment({ id: "adj_x", transactionId: "txn_unknown", amountMinor: 100 }))).resolves.toBeUndefined();
    expect(await ownerQuery(`select 1 from wp.payment_adjustments`)).toEqual([]);
  });
});

describe("financial records are protected from deletion (audit BIL-05)", () => {
  it("a workspace is never hard-deleted, even by the database owner; erasing it keeps every financial record", async () => {
    const c = await customer();
    await buy(c, { kind: "subscription", planId: "growth", interval: "month" });
    await expect(ownerQuery(`delete from wp.workspaces where id = '${c.workspaceId}'`)).rejects.toThrow(/never hard-deleted/);
    const before = await ownerQuery<{ n: number }>(`select (select count(*) from wp.credit_ledger where workspace_id = '${c.workspaceId}') + (select count(*) from wp.payments where workspace_id = '${c.workspaceId}') + (select count(*) from wp.subscriptions where workspace_id = '${c.workspaceId}') as n`);
    await ownerQuery(`select platform.erase_workspace('${c.workspaceId}')`);
    const after = await ownerQuery<{ n: number; status: string }>(`select (select count(*) from wp.credit_ledger where workspace_id = '${c.workspaceId}') + (select count(*) from wp.payments where workspace_id = '${c.workspaceId}') + (select count(*) from wp.subscriptions where workspace_id = '${c.workspaceId}') as n, (select status from wp.workspaces where id = '${c.workspaceId}') as status`);
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
    expect(Number(before[0]?.n)).toBeGreaterThan(2);
    expect(after[0]?.status).toBe("deleted");
    // Even with the trigger disabled (a careless maintenance script), the foreign keys still refuse.
    await expect(ownerQuery(`alter table wp.workspaces disable trigger workspaces_no_delete; delete from wp.workspaces where id = '${c.workspaceId}'`)).rejects.toThrow(/violates foreign key|restrict/);
    await ownerQuery(`alter table wp.workspaces enable trigger workspaces_no_delete`);
  });

  it("no financial table cascades on workspace deletion", async () => {
    const rows = await ownerQuery<{ t: string; rule: string }>(`select c.conrelid::regclass::text t, c.confdeltype::text rule from pg_constraint c where c.contype = 'f' and c.confrelid = 'wp.workspaces'::regclass and c.conrelid::regclass::text in ('wp.credit_ledger','wp.credit_lots','wp.credit_reservations','wp.payments','wp.payment_adjustments','wp.subscriptions','wp.checkouts','wp.entitlement_usage') order by 1`);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.rule !== "r")).toEqual([]);
  });
});
