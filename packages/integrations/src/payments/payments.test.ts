import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { MockPayments, PaddlePayments, parsePaddleEvent, signPaddleWebhook, verifyPaddleSignature, WebhookSignatureError } from "./index";

const SECRET = "s".repeat(40);
const WS = "0b7d7c3e-5d1a-4f7e-8c2b-9a1e3f4d5c6b";
const CHECKOUT = "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10";
const at = new Date("2026-10-07T10:00:00Z");
const growthMonth = { priceId: "pri_mock_growth_month", interval: "month" as const, amountMinor: 4600, currency: "USD" };

function capture(now = () => at) {
  const sent: { raw: string; sig: string }[] = [];
  const mock = new MockPayments({ webhookSecret: SECRET, publicApiUrl: "http://api.test", now, deliver: async (raw, sig) => void sent.push({ raw, sig }) });
  const events = () => sent.map((s) => mock.verifyWebhook(s.raw, s.sig));
  return { mock, sent, events };
}

describe("Paddle-Signature", () => {
  it("accepts a valid signature and rejects tampering, stale timestamps, wrong secrets and garbage", () => {
    const body = '{"a":1}';
    const header = signPaddleWebhook(SECRET, body, at);
    expect(() => verifyPaddleSignature(header, body, SECRET, at)).not.toThrow();
    expect(() => verifyPaddleSignature(header, '{"a":2}', SECRET, at)).toThrow(WebhookSignatureError);
    expect(() => verifyPaddleSignature(header, body, SECRET, new Date(at.getTime() + 301_000))).toThrow(/stale/);
    expect(() => verifyPaddleSignature(header, body, "x".repeat(40), at)).toThrow(/mismatch/);
    expect(() => verifyPaddleSignature(undefined, body, SECRET, at)).toThrow(/missing/);
    expect(() => verifyPaddleSignature("ts=abc;h1=zz", body, SECRET, at)).toThrow(/malformed/);
  });
});

describe("parsePaddleEvent", () => {
  it("reads completed transactions and subscriptions, and ignores what it does not handle", () => {
    expect(
      parsePaddleEvent({
        event_id: "evt_1",
        event_type: "transaction.completed",
        occurred_at: "2026-10-07T10:00:00.123456Z",
        data: {
          id: "txn_1",
          subscription_id: null,
          custom_data: { workspaceId: WS, checkoutId: CHECKOUT },
          items: [{ price: { id: "pri_mock_credits_1000" }, quantity: 1 }],
          currency_code: "USD",
          details: { totals: { grand_total: "900" } },
        },
      }),
    ).toMatchObject({ kind: "transaction.completed", workspaceId: WS, checkoutId: CHECKOUT, priceId: "pri_mock_credits_1000", amountMinor: 900, subscriptionId: null });

    expect(
      parsePaddleEvent({
        event_id: "evt_2",
        event_type: "subscription.updated",
        occurred_at: "2026-10-07T10:00:00Z",
        data: {
          id: "sub_1",
          status: "active",
          customer_id: "ctm_1",
          custom_data: { workspaceId: WS },
          items: [{ price: { id: "pri_mock_growth_month" } }],
          current_billing_period: { starts_at: "2026-10-07T10:00:00Z", ends_at: "2026-11-07T10:00:00Z" },
          scheduled_change: { action: "cancel", effective_at: "2026-11-07T10:00:00Z" },
        },
      }),
    ).toMatchObject({ kind: "subscription.updated", subscription: { subscriptionId: "sub_1", priceId: "pri_mock_growth_month", cancelScheduled: true } });

    expect(parsePaddleEvent({ event_id: "evt_3", event_type: "customer.created", occurred_at: "2026-10-07T10:00:00Z", data: {} })).toMatchObject({
      kind: "ignored",
      eventType: "customer.created",
    });
    // A transaction MUSHIN did not start (no workspace in custom_data) is ignored, not retried forever.
    expect(
      parsePaddleEvent({ event_id: "evt_4", event_type: "transaction.completed", occurred_at: "2026-10-07T10:00:00Z", data: { id: "txn_x", custom_data: null } }),
    ).toMatchObject({ kind: "ignored" });
  });

  it("reads approved refunds and chargebacks; pending, rejected and credit adjustments change nothing", () => {
    const adj = (data: Record<string, unknown>, type = "adjustment.updated") =>
      parsePaddleEvent({ event_id: "evt_a", event_type: type, occurred_at: "2026-10-07T10:00:00Z", data: { id: "adj_1", transaction_id: "txn_1", type: "full", totals: { total: "4600" }, ...data } });
    expect(adj({ action: "refund", status: "approved" })).toEqual({
      kind: "adjustment.approved",
      eventId: "evt_a",
      occurredAt: new Date("2026-10-07T10:00:00Z"),
      adjustmentId: "adj_1",
      action: "refund",
      transactionId: "txn_1",
      amountMinor: 4600,
      full: true,
    });
    expect(adj({ action: "chargeback", status: "approved", type: "partial" }, "adjustment.created")).toMatchObject({ action: "chargeback", full: false });
    for (const other of [{ action: "refund", status: "pending_approval" }, { action: "refund", status: "rejected" }, { action: "credit", status: "approved" }, { action: "chargeback_warning", status: "approved" }]) {
      expect(adj(other)).toMatchObject({ kind: "ignored" });
    }
  });
});

describe("MockPayments", () => {
  it("hosts the checkout on its own route", async () => {
    const { mock } = capture();
    expect(await mock.createCheckout({ checkoutId: CHECKOUT, workspaceId: WS, customerEmail: "a@b.pk", price: growthMonth })).toEqual({
      providerCheckoutId: `chk_mock_${CHECKOUT}`,
      url: `http://api.test/mock-paddle/checkout/${WS}/${CHECKOUT}`,
    });
  });

  it("pays a subscription with signed transaction and subscription events, one billing month long", async () => {
    const { mock, events } = capture();
    await mock.completeCheckout({ checkoutId: CHECKOUT, workspaceId: WS, kind: "subscription", price: growthMonth }, "paid");
    const [txn, sub] = events();
    expect(txn).toMatchObject({ kind: "transaction.completed", subscriptionId: `sub_mock_${CHECKOUT}`, checkoutId: CHECKOUT, amountMinor: 4600 });
    expect(sub).toMatchObject({
      kind: "subscription.created",
      workspaceId: WS,
      subscription: { subscriptionId: `sub_mock_${CHECKOUT}`, status: "active", priceId: "pri_mock_growth_month", cancelScheduled: false },
    });
    if (sub?.kind !== "subscription.created") throw new Error("expected a subscription event");
    expect(sub.subscription.periodEnd?.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("reports failed payments, scheduled cancellation and renewals", async () => {
    const { mock, events } = capture();
    await mock.completeCheckout({ checkoutId: CHECKOUT, workspaceId: WS, kind: "topup", price: { ...growthMonth, interval: null } }, "failed");
    const ref = { subscriptionId: "sub_mock_1", customerId: "ctm_1", workspaceId: WS, price: growthMonth, periodStart: at, periodEnd: new Date("2026-11-07T10:00:00Z") };
    await mock.cancelAtPeriodEnd({ subscription: ref });
    await mock.renew(ref, false);
    await mock.renew(ref, true);
    expect(events().map((e) => e.kind)).toEqual([
      "transaction.payment_failed",
      "subscription.updated",
      "transaction.completed",
      "subscription.updated",
      "subscription.canceled",
    ]);
    const [, cancel, , renewal] = events();
    expect(cancel).toMatchObject({ subscription: { cancelScheduled: true } });
    if (renewal?.kind !== "subscription.updated") throw new Error("expected a renewal");
    expect(renewal.subscription.periodStart?.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("changes plans the way Paddle does", async () => {
    const mid = new Date("2026-10-22T10:00:00Z"); // 16 of the period's 31 days remain
    const periodEnd = new Date("2026-11-07T10:00:00Z");
    const ref = { subscriptionId: "sub_mock_1", customerId: "ctm_1", workspaceId: WS, price: growthMonth, periodStart: at, periodEnd };

    // Same interval, now: the billing period is kept and the prorated difference is charged.
    const now = capture(() => mid);
    await now.mock.changePlan({ subscription: ref, target: { ...growthMonth, priceId: "pri_mock_scale_month", amountMinor: 8900 }, when: "now" });
    const [charge, upgraded] = now.events();
    expect(charge).toMatchObject({ kind: "transaction.completed", subscriptionId: "sub_mock_1", priceId: "pri_mock_scale_month", amountMinor: 2219 });
    expect(upgraded).toMatchObject({ kind: "subscription.updated", subscription: { priceId: "pri_mock_scale_month", periodStart: at, periodEnd } });

    // Next period: the plan changes now, nothing is charged now, the renewal bills the new price.
    const next = capture(() => mid);
    await next.mock.changePlan({ subscription: ref, target: { ...growthMonth, priceId: "pri_mock_explorer_month", amountMinor: 1800 }, when: "next_period" });
    expect(next.events()).toEqual([
      expect.objectContaining({ kind: "subscription.updated", subscription: expect.objectContaining({ priceId: "pri_mock_explorer_month", periodStart: at, periodEnd }) }),
    ]);

    // A different interval restarts the period: the new price, less the unused part of the old one.
    const yearly = capture(() => mid);
    await yearly.mock.changePlan({ subscription: ref, target: { priceId: "pri_mock_scale_year", interval: "year", amountMinor: 85_200, currency: "USD" }, when: "now" });
    const [yearCharge, restarted] = yearly.events();
    expect(yearCharge).toMatchObject({ kind: "transaction.completed", amountMinor: 85_200 - 2374 });
    expect(restarted).toMatchObject({ subscription: { periodStart: mid, periodEnd: new Date("2027-10-22T10:00:00Z") } });
  });
});

describe("PaddlePayments", () => {
  function paddle(respond: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return respond(url, init ?? {});
    };
    const p = new PaddlePayments({
      apiKey: "pdl_key",
      webhookSecret: SECRET,
      environment: "sandbox",
      sink: new MemoryProviderCallSink(),
      logger: createLogger({ level: "silent" }),
      fetch: fetchFake as typeof fetch,
    });
    return { p, calls };
  }

  it("creates a transaction with our ids in custom_data and returns Paddle's hosted checkout URL", async () => {
    const { p, calls } = paddle(() => Response.json({ data: { id: "txn_9", checkout: { url: "https://pay.paddle.io/txn_9" } } }));
    expect(await p.createCheckout({ checkoutId: CHECKOUT, workspaceId: WS, customerEmail: "a@b.pk", price: growthMonth })).toEqual({
      providerCheckoutId: "txn_9",
      url: "https://pay.paddle.io/txn_9",
    });
    expect(calls[0]?.url).toBe("https://sandbox-api.paddle.com/transactions");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ custom_data: { workspaceId: WS, checkoutId: CHECKOUT }, items: [{ price_id: "pri_mock_growth_month" }] });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer pdl_key");
  });

  it("does not retry a failed checkout creation and reports the provider as unavailable", async () => {
    const { p, calls } = paddle(() => new Response("boom", { status: 500 }));
    await expect(p.createCheckout({ checkoutId: CHECKOUT, workspaceId: WS, customerEmail: "a@b.pk", price: growthMonth })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(calls).toHaveLength(1);
  });

  it("changes the plan now with proration, or from the next billing period without charging now", async () => {
    const { p, calls } = paddle(() => Response.json({ data: {} }));
    const ref = { subscriptionId: "sub_1", customerId: null, workspaceId: WS, price: growthMonth, periodStart: at, periodEnd: at };
    await p.changePlan({ subscription: ref, target: growthMonth, when: "now" });
    await p.changePlan({ subscription: ref, target: growthMonth, when: "next_period" });
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      ["https://sandbox-api.paddle.com/subscriptions/sub_1", "PATCH"],
      ["https://sandbox-api.paddle.com/subscriptions/sub_1", "PATCH"],
    ]);
    expect(calls.map((c) => (JSON.parse(String(c.init.body)) as { proration_billing_mode: string }).proration_billing_mode)).toEqual([
      "prorated_immediately",
      "full_next_billing_period",
    ]);
  });

  it("schedules cancellation at the next billing period", async () => {
    const { p, calls } = paddle(() => Response.json({ data: {} }));
    const ref = { subscriptionId: "sub_1", customerId: null, workspaceId: WS, price: growthMonth, periodStart: at, periodEnd: at };
    await p.cancelAtPeriodEnd({ subscription: ref });
    expect(calls[0]?.url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_1/cancel");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ effective_from: "next_billing_period" });
  });
});
