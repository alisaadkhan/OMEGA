import { randomUUID } from "node:crypto";
import { parsePaddleEvent } from "./paddle-events";
import { signPaddleWebhook, verifyPaddleSignature } from "./signature";
import type { CheckoutInput, PaymentEvent, PaymentInterval, Payments, PriceRef, SubscriptionRef } from "./types";

export type Deliver = (rawBody: string, signature: string) => Promise<void>;
export type MockCheckout = { checkoutId: string; workspaceId: string; kind: "subscription" | "topup"; price: PriceRef };
type PaddlePayload = { event_id: string; event_type: string; occurred_at: string; notification_id: string; data: Record<string, unknown> };

function addInterval(date: Date, interval: PaymentInterval): Date {
  const months = interval === "year" ? 12 : 1;
  const day = date.getUTCDate();
  const out = new Date(date.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

const customerIdFor = (workspaceId: string) => `ctm_mock_${workspaceId.slice(0, 8)}`;

async function postWebhook(url: string, rawBody: string, signature: string): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "paddle-signature": signature }, body: rawBody });
  if (!res.ok) throw new Error(`mock webhook delivery to ${url} failed with ${res.status}`);
}

/**
 * Development stand-in for Paddle. It hosts a test-mode checkout page (served by the API's mock routes)
 * and sends the same signed, Paddle-format webhooks Paddle would, so the rest of MUSHIN cannot tell the difference.
 */
export class MockPayments implements Payments {
  readonly mode = "mock" as const;
  private readonly now: () => Date;
  private readonly deliver: Deliver;

  constructor(private readonly o: { webhookSecret: string; publicApiUrl: string; deliver?: Deliver; now?: () => Date }) {
    this.now = o.now ?? (() => new Date());
    this.deliver = o.deliver ?? ((raw, sig) => postWebhook(`${o.publicApiUrl}/webhooks/paddle`, raw, sig));
  }

  async createCheckout(input: CheckoutInput): Promise<{ providerCheckoutId: string; url: string }> {
    // The workspace id in the URL keeps the page's lookup workspace-scoped (SRS §2.5).
    return {
      providerCheckoutId: `chk_mock_${input.checkoutId}`,
      url: `${this.o.publicApiUrl}/mock-paddle/checkout/${input.workspaceId}/${input.checkoutId}`,
    };
  }

  async changePlan(input: { subscription: SubscriptionRef; target: PriceRef }): Promise<void> {
    const start = this.now();
    const next = { ...input.subscription, price: input.target, periodStart: start, periodEnd: addInterval(start, input.target.interval ?? "month") };
    await this.send(this.subscriptionEvent("subscription.updated", next, "active", false, null));
  }

  async cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void> {
    await this.send(this.subscriptionEvent("subscription.updated", input.subscription, "active", true, null));
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent {
    verifyPaddleSignature(signatureHeader, rawBody, this.o.webhookSecret, this.now());
    return parsePaddleEvent(JSON.parse(rawBody) as unknown);
  }

  /** The hosted test page's "Pay" and "Simulate failed payment" buttons. */
  async completeCheckout(c: MockCheckout, outcome: "paid" | "failed"): Promise<void> {
    const transactionId = `txn_mock_${randomUUID()}`;
    if (outcome === "failed") {
      await this.send(this.payload("transaction.payment_failed", { id: transactionId, status: "past_due", custom_data: { workspaceId: c.workspaceId, checkoutId: c.checkoutId } }));
      return;
    }
    const subscriptionId = c.kind === "subscription" ? `sub_mock_${c.checkoutId}` : null;
    await this.send(this.transactionEvent(transactionId, c.workspaceId, c.checkoutId, subscriptionId, c.price));
    if (subscriptionId) {
      const start = this.now();
      const ref: SubscriptionRef = {
        subscriptionId,
        customerId: customerIdFor(c.workspaceId),
        workspaceId: c.workspaceId,
        price: c.price,
        periodStart: start,
        periodEnd: addInterval(start, c.price.interval ?? "month"),
      };
      await this.send(this.subscriptionEvent("subscription.created", ref, "active", false, c.checkoutId));
    }
  }

  /** Period-end renewal (Paddle renews by itself in real mode). A scheduled cancellation ends the subscription instead. */
  async renew(subscription: SubscriptionRef, cancel: boolean): Promise<void> {
    if (cancel) {
      await this.send(this.subscriptionEvent("subscription.canceled", subscription, "canceled", false, null));
      return;
    }
    const start = subscription.periodEnd;
    const next = { ...subscription, periodStart: start, periodEnd: addInterval(start, subscription.price.interval ?? "month") };
    await this.send(this.transactionEvent(`txn_mock_${randomUUID()}`, subscription.workspaceId, null, subscription.subscriptionId, subscription.price));
    await this.send(this.subscriptionEvent("subscription.updated", next, "active", false, null));
  }

  private payload(type: string, data: Record<string, unknown>): PaddlePayload {
    return { event_id: `evt_mock_${randomUUID()}`, event_type: type, occurred_at: this.now().toISOString(), notification_id: `ntf_mock_${randomUUID()}`, data };
  }

  private transactionEvent(id: string, workspaceId: string, checkoutId: string | null, subscriptionId: string | null, price: PriceRef): PaddlePayload {
    return this.payload("transaction.completed", {
      id,
      status: "completed",
      subscription_id: subscriptionId,
      customer_id: customerIdFor(workspaceId),
      currency_code: price.currency,
      custom_data: { workspaceId, checkoutId },
      items: [{ price: { id: price.priceId }, quantity: 1 }],
      details: { totals: { grand_total: String(price.amountMinor) } },
      invoice_url: null,
    });
  }

  private subscriptionEvent(
    type: "subscription.created" | "subscription.updated" | "subscription.canceled",
    s: SubscriptionRef,
    status: "active" | "canceled",
    cancelScheduled: boolean,
    checkoutId: string | null,
  ): PaddlePayload {
    return this.payload(type, {
      id: s.subscriptionId,
      status,
      customer_id: s.customerId ?? customerIdFor(s.workspaceId),
      custom_data: { workspaceId: s.workspaceId, checkoutId },
      items: [{ price: { id: s.price.priceId }, quantity: 1 }],
      current_billing_period: { starts_at: s.periodStart.toISOString(), ends_at: s.periodEnd.toISOString() },
      scheduled_change: cancelScheduled ? { action: "cancel", effective_at: s.periodEnd.toISOString() } : null,
    });
  }

  private async send(p: PaddlePayload): Promise<void> {
    const raw = JSON.stringify(p);
    await this.deliver(raw, signPaddleWebhook(this.o.webhookSecret, raw, this.now()));
  }
}

export function isMockPayments(p: Payments): p is MockPayments {
  return p instanceof MockPayments;
}
