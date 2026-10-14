import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { MemoryAccessCache } from "./access-cache";
import { createBillingService } from "./service";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const SECRET = "w".repeat(40);
let clock = new Date("2026-10-07T10:00:00Z");
const sent: { raw: string; sig: string }[] = [];
const payments = new MockPayments({ webhookSecret: SECRET, publicApiUrl: "http://api.test", now: () => clock, deliver: async (raw, sig) => void sent.push({ raw, sig }) });
const cache = new MemoryAccessCache();
const billing = createBillingService({ db, payments, cache, logger: createLogger({ level: "silent" }), now: () => clock });

beforeEach(() => {
  clock = new Date("2026-10-07T10:00:00Z");
  sent.length = 0;
  cache.entries.clear();
});

const days = (n: number) => new Date(clock.getTime() + n * 86_400_000);

/** Applies every webhook the mock has "sent", in order, the way the worker would. */
async function flush() {
  for (const s of sent.splice(0)) await billing.applyEvent(payments.verifyWebhook(s.raw, s.sig));
}

async function trialCustomer(role: TenantContext["role"] = "owner") {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req", role, email: "owner@test.mushin.pk" };
}

async function subscribe(c: Awaited<ReturnType<typeof trialCustomer>>, planId: "explorer" | "growth" | "scale", interval: "month" | "year" = "month") {
  const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId, interval });
  await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
  await flush();
  return checkoutId;
}

describe("summary and plans", () => {
  it("shows a fresh trial", async () => {
    const c = await trialCustomer();
    expect(await billing.summary(c)).toMatchObject({
      plan: null,
      status: "trialing",
      trialDaysLeft: 14,
      balance: { available: 200, reserved: 0, base: 200, meter: "normal" },
      canPurchase: true,
      lostAccess: [],
    });
    expect((await billing.summary({ ...c, role: "member" })).canPurchase).toBe(false);
  });

  it("shows a trial past its end as expired before the trial-end job runs", async () => {
    const c = await trialCustomer();
    clock = days(15);
    const s = await billing.summary(c);
    expect(s).toMatchObject({ status: "expired", trialDaysLeft: null, balance: { available: 0 } });
    expect(s.lostAccess).toContain("find_new");
    expect((await billing.getAccess(c)).spend).toBe("topup_only");
  });

  it("lists plans with PKR display and USD charge prices, packs and action costs", async () => {
    const c = await trialCustomer();
    const p = await billing.plans(c);
    expect(p.plans.map((x) => x.id)).toEqual(["explorer", "growth", "scale"]);
    expect(p.plans[1]).toMatchObject({
      monthlyCredits: 12_000,
      display: { monthly: { amountMinor: 1_290_000, currency: "PKR" } },
      charge: { monthly: { amountMinor: 4_600, currency: "USD" }, yearly: { amountMinor: 46_800 } },
    });
    expect(p.topupPacks.map((x) => x.credits)).toEqual([1000, 5000, 15000]);
    // Owner pricing 2026-10-14 (migration 0027); audience estimates have no approved price and stay disabled.
    expect(p.actionCosts).toEqual({ search_existing: 50, find_new: 50, live_creator: 10, reveal_contact: 5, refresh_data: 50, refresh_tiktok: 50, audience_estimate: 5 });
  });
});

describe("checkout (Review Focus 3)", () => {
  it("lets only owners and admins buy, and blocks top-ups during the trial", async () => {
    const member = await trialCustomer("member");
    await expect(billing.startCheckout(member, { kind: "subscription", planId: "growth", interval: "month" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const owner = await trialCustomer();
    await expect(billing.startCheckout(owner, { kind: "topup", packId: "credits_1000" })).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      details: { reason: "trial_topup_blocked" },
    });
  });

  it("subscribes through the hosted mock checkout and grants the plan's monthly credits", async () => {
    const c = await trialCustomer();
    const { checkoutId, url } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    expect(url).toBe(`http://api.test/mock-paddle/checkout/${c.workspaceId}/${checkoutId}`);
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
    await flush();
    const s = await billing.summary(c);
    expect(s).toMatchObject({ plan: { id: "growth" }, interval: "month", status: "active", balance: { available: 12_200, base: 12_000 } });
    expect(s.currentPeriodEnd).toBe("2026-11-07T10:00:00.000Z");
    const checkout = await ownerQuery<{ status: string }>(`select status from wp.checkouts where id = '${checkoutId}'`);
    expect(checkout[0]?.status).toBe("paid");
    expect((await billing.invoices(c)).invoices).toEqual([expect.objectContaining({ kind: "subscription", amount: { amountMinor: 4600, currency: "USD" } })]);
    await expect(billing.startCheckout(c, { kind: "subscription", planId: "scale", interval: "month" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("charges the configured price on the test-mode page, not what the checkout row says", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await ownerQuery(`update wp.checkouts set amount_minor = 1, price_id = 'pri_mock_scale_month' where id = '${checkoutId}'`);
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
    await flush();
    expect((await billing.summary(c)).plan?.id).toBe("growth");
    expect((await billing.invoices(c)).invoices[0]?.amount).toEqual({ amountMinor: 4600, currency: "USD" });
  });

  it("marks a failed payment and notifies, granting nothing", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "failed");
    await flush();
    expect((await billing.summary(c)).status).toBe("trialing");
    const rows = await ownerQuery<{ status: string; n: number }>(`
      select (select status from wp.checkouts) status, (select count(*)::int from platform.outbox where event_type = 'notify.payment_failed') n`);
    expect(rows[0]).toEqual({ status: "failed", n: 1 });
  });
});

describe("webhook safety (Review Focus 2)", () => {
  it("duplicate events grant once", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
    const copies = [...sent];
    await flush();
    for (const s of copies) await billing.applyEvent(payments.verifyWebhook(s.raw, s.sig));
    const lots = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_lots where source = 'monthly'`);
    const pays = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.payments`);
    expect([lots[0]?.n, pays[0]?.n]).toEqual([1, 1]);
  });

  it("ignores an older event that arrives after a newer one", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
    // Verify while the clock is still at day 0 (signatures are only valid for 5 minutes).
    const [payment, created] = sent.splice(0).map((s) => payments.verifyWebhook(s.raw, s.sig));
    if (!payment || !created) throw new Error("expected a payment and a subscription event");
    await billing.applyEvent(payment);
    await billing.applyEvent(created); // subscription.created, stamped day 0
    clock = days(1);
    await billing.requestPlanChange(c, { planId: "scale", interval: "month" }); // mock sends subscription.updated, stamped day 1
    await flush();
    await billing.applyEvent(created); // the day-0 event delivered late
    expect((await billing.summary(c)).plan?.id).toBe("scale");
  });

  it("records each delivery once and processes it from storage", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
    for (const s of sent) {
      const event = payments.verifyWebhook(s.raw, s.sig);
      await billing.recordWebhook(event, s.raw, "req-1");
      await billing.recordWebhook(event, s.raw, "req-2");
    }
    const stored = await ownerQuery<{ id: string }>(`select id from platform.webhook_events order by received_at`);
    const outbox = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'billing.webhook_received'`);
    expect([stored.length, outbox[0]?.n]).toEqual([2, 2]);
    for (const row of stored) await billing.processStoredWebhook(row.id);
    expect((await billing.summary(c)).status).toBe("active");
    const processed = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.webhook_events where processed_at is not null`);
    expect(processed[0]?.n).toBe(2);
  });
});

describe("plan changes", () => {
  it("upgrades to a new interval now: the period restarts and the new plan's full allowance replaces the old", async () => {
    const c = await trialCustomer();
    await subscribe(c, "growth");
    clock = days(15);
    expect(await billing.requestPlanChange(c, { planId: "scale", interval: "year" })).toEqual({ change: "upgrade", effective: "now" });
    await flush();
    const lots = await ownerQuery<{ amount: number; remaining: number }>(`select amount, remaining from wp.credit_lots where source = 'monthly' order by amount`);
    expect(lots).toEqual([
      { amount: 12_000, remaining: 0 },
      { amount: 35_000, remaining: 35_000 },
    ]);
    expect((await billing.summary(c)).interval).toBe("year");
  });

  it("prorates both the charge and the extra credits for an upgrade that keeps the billing period", async () => {
    const c = await trialCustomer();
    await subscribe(c, "growth");
    clock = days(15); // 16 of the period's 31 days remain; the provider keeps the period, as Paddle does
    await billing.requestPlanChange(c, { planId: "scale", interval: "month" });
    await flush();
    const lots = await ownerQuery<{ amount: number; remaining: number }>(`select amount, remaining from wp.credit_lots where source = 'monthly' order by amount`);
    expect(lots).toEqual([
      { amount: 11_870, remaining: 11_870 }, // 23,000 more per month × 16/31 of the month left
      { amount: 12_000, remaining: 12_000 },
    ]);
    expect((await billing.summary(c)).balance.available).toBe(23_870); // the trial lot ended on day 14
    expect((await billing.invoices(c)).invoices.map((i) => i.amount.amountMinor)).toEqual([2219, 4600]);
  });

  it("gives almost nothing for an upgrade made just before the period ends (SRS §4.8: impossible to game)", async () => {
    const c = await trialCustomer();
    await subscribe(c, "growth");
    clock = new Date("2026-11-07T09:00:00Z"); // one hour of the 744-hour period left
    await billing.requestPlanChange(c, { planId: "scale", interval: "month" });
    await flush();
    const extra = await ownerQuery<{ amount: number }>(`select amount from wp.credit_lots where source = 'monthly' and amount <> 12000`);
    expect(extra).toEqual([{ amount: 30 }]); // 23,000 × 1/744, rounded down
  });

  it("gives a mid-year upgrade's extra credits until the end of the current credit month", async () => {
    const c = await trialCustomer();
    await subscribe(c, "explorer", "year");
    clock = new Date("2026-11-07T10:00:01Z");
    await billing.runJob("monthly_grants"); // the second month's 2,500 credits, valid until Dec 7
    clock = new Date("2026-11-20T10:00:00Z");
    await billing.requestPlanChange(c, { planId: "growth", interval: "year" });
    await flush();
    const extra = await ownerQuery<{ amount: number; expires: string }>(`
      select amount, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD') expires from wp.credit_lots
      where source = 'monthly' and amount not in (2500)`);
    expect(extra).toEqual([{ amount: 5383, expires: "2026-12-07" }]); // 9,500 × 17/30 of the credit month left
    expect((await billing.summary(c)).balance.available).toBe(7_883);
  });

  it("ignores a second subscription for a workspace that already has one", async () => {
    const c = await trialCustomer();
    const first = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    const second = await billing.startCheckout(c, { kind: "subscription", planId: "scale", interval: "month" });
    await billing.completeMockCheckout(c.workspaceId, first.checkoutId, "paid");
    await flush();
    await billing.completeMockCheckout(c.workspaceId, second.checkoutId, "paid");
    await flush();
    expect((await billing.summary(c)).plan?.id).toBe("growth");
    const lots = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_lots where source = 'monthly'`);
    expect(lots[0]?.n).toBe(1);
  });

  it("applies a downgrade just before the period ends, so the renewal bills the lower plan", async () => {
    const c = await trialCustomer();
    await subscribe(c, "scale");
    expect(await billing.requestPlanChange(c, { planId: "explorer", interval: "month" })).toEqual({ change: "downgrade", effective: "period_end" });
    expect((await billing.summary(c)).scheduledChange).toEqual({ planId: "explorer", interval: "month" });
    clock = days(29);
    await billing.runJob("scheduled_changes");
    expect(sent).toHaveLength(0); // too early
    clock = new Date("2026-11-07T09:00:00Z"); // an hour before the period ends
    await billing.runJob("scheduled_changes");
    expect(sent.map((x) => (JSON.parse(x.raw) as { event_type: string }).event_type)).toEqual(["subscription.updated"]); // nothing billed now
    await flush();
    const before = await billing.summary(c);
    expect(before).toMatchObject({ plan: { id: "explorer" }, scheduledChange: null, balance: { available: 35_000 } }); // this period's allowance stays
    clock = new Date("2026-11-07T10:00:01Z");
    await billing.runJob("mock_renewals");
    await flush();
    expect((await billing.invoices(c)).invoices[0]?.amount).toEqual({ amountMinor: 1800, currency: "USD" });
    expect((await billing.summary(c)).balance.available).toBe(2_500);
  });

  it("keeps a cancellation made while a downgrade is scheduled", async () => {
    const c = await trialCustomer();
    await subscribe(c, "scale");
    await billing.requestPlanChange(c, { planId: "explorer", interval: "month" });
    await billing.requestCancel(c);
    await flush();
    expect(await billing.summary(c)).toMatchObject({ scheduledChange: null, cancelAtPeriodEnd: true });
    clock = new Date("2026-11-07T09:00:00Z");
    await billing.runJob("scheduled_changes");
    expect(sent).toHaveLength(0);
    clock = new Date("2026-11-07T10:00:01Z");
    await billing.runJob("mock_renewals");
    await flush();
    expect((await billing.summary(c)).status).toBe("canceled");
  });

  it("cancels at period end; afterwards only paid top-ups remain spendable", async () => {
    const c = await trialCustomer();
    await subscribe(c, "growth");
    const { checkoutId } = await billing.startCheckout(c, { kind: "topup", packId: "credits_1000" });
    await billing.completeMockCheckout(c.workspaceId, checkoutId, "paid");
    await flush();
    expect(await billing.requestCancel(c)).toEqual({ change: "cancel", effective: "period_end" });
    await flush();
    expect((await billing.summary(c)).cancelAtPeriodEnd).toBe(true);
    clock = days(31);
    await billing.runJob("mock_renewals");
    await flush();
    const s = await billing.summary(c);
    expect(s).toMatchObject({ status: "canceled", plan: null, balance: { available: 1000 } });
    expect(s.lostAccess).toEqual(["monthly_credits", "outreach", "audience_details", "export"]);
    await expect(billing.reserve(c, { action: "find_new", confirmedCost: 50, refType: "test", refId: "1" })).resolves.toMatchObject({ amount: 50 });
  });
});

describe("jobs", () => {
  it("warns before the trial ends, then expires it", async () => {
    const c = await trialCustomer();
    clock = days(12);
    await billing.runJob("trial_notices");
    await billing.runJob("trial_notices");
    clock = days(3);
    await billing.runJob("end_trials");
    const s = await billing.summary(c);
    expect(s).toMatchObject({ status: "expired", balance: { available: 0 } });
    expect(s.lostAccess).toContain("find_new");
    const events = await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox where event_type like 'notify.trial%' order by created_at`);
    expect(events.map((e) => e.event_type)).toEqual(["notify.trial_ending", "notify.trial_expired"]);
  });

  it("grants a yearly plan's credits month by month", async () => {
    const c = await trialCustomer();
    await subscribe(c, "explorer", "year");
    const first = await ownerQuery<{ expires: string }>(`select to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD') expires from wp.credit_lots where source = 'monthly'`);
    expect(first[0]?.expires).toBe("2026-11-07");
    clock = new Date("2026-11-07T10:00:01Z");
    await billing.runJob("monthly_grants");
    const lots = await ownerQuery<{ remaining: number; expires: string }>(`
      select remaining, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD') expires from wp.credit_lots where source = 'monthly' order by expires_at`);
    expect(lots).toEqual([
      { remaining: 0, expires: "2026-11-07" },
      { remaining: 2500, expires: "2026-12-07" },
    ]);
  });

  it("releases abandoned reservations and expires lots", async () => {
    const c = await trialCustomer();
    await billing.reserve(c, { action: "find_new", confirmedCost: 50, refType: "test", refId: "1" });
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect(await billing.runJob("release_abandoned")).toEqual({ processed: 1 });
    expect((await billing.summary(c)).balance.reserved).toBe(0);
    expect(await billing.runJob("reconcile")).toEqual({ processed: 0 }); // first reconcile is due a day after the grant
    clock = days(2);
    expect(await billing.runJob("reconcile")).toEqual({ processed: 1 });
  });
});

describe("history", () => {
  it("pages through the ledger without skipping rows written in one transaction", async () => {
    const c = await trialCustomer();
    await billing.spendInstant(c, { action: "find_new", confirmedCost: 50, refType: "test", refId: "1" }); // reserve + spend share a timestamp
    const kinds: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await billing.ledger(c, { cursor, limit: 1 });
      kinds.push(...page.entries.map((e) => e.kind));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(kinds.sort()).toEqual(["grant", "reserve", "spend"]);
  });
});

describe("access cache", () => {
  it("caches access and invalidates it when billing changes", async () => {
    const c = await trialCustomer();
    expect(await billing.getAccess(c)).toMatchObject({ status: "trialing", spend: "all", entitlements: { campaignLimit: 3 } });
    expect(cache.entries.has(c.workspaceId)).toBe(true);
    await subscribe(c, "scale");
    expect(cache.entries.has(c.workspaceId)).toBe(false);
    expect(await billing.getAccess(c)).toMatchObject({ status: "active", planId: "scale", entitlements: { export: true } });
  });
});
