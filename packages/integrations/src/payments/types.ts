export type PaymentInterval = "month" | "year";
export type PriceRef = { priceId: string; interval: PaymentInterval | null; amountMinor: number; currency: string };
export type SubscriptionRef = {
  subscriptionId: string;
  customerId: string | null;
  workspaceId: string;
  price: PriceRef;
  periodStart: Date;
  periodEnd: Date;
};
export type SubscriptionSnapshot = {
  subscriptionId: string;
  customerId: string | null;
  status: "active" | "past_due" | "canceled" | "trialing" | "paused";
  priceId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelScheduled: boolean;
};

type EventBase = { eventId: string; occurredAt: Date; workspaceId: string };
export const SUBSCRIPTION_EVENT_TYPES = [
  "subscription.created",
  "subscription.activated",
  "subscription.updated",
  "subscription.past_due",
  "subscription.canceled",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

export type PaymentEvent =
  | (EventBase & {
      kind: "transaction.completed";
      transactionId: string;
      subscriptionId: string | null;
      checkoutId: string | null;
      priceId: string;
      amountMinor: number;
      currency: string;
      invoiceUrl: string | null;
    })
  | (EventBase & { kind: "transaction.payment_failed"; transactionId: string; checkoutId: string | null })
  | (EventBase & { kind: SubscriptionEventType; subscription: SubscriptionSnapshot })
  /**
   * An approved refund or chargeback of a transaction (Paddle adjustment.created / adjustment.updated). It carries no
   * workspace: the receiver finds it through the stored transaction. Shape from Paddle's documentation, not yet
   * verified against a sandbox delivery.
   */
  | {
      kind: "adjustment.approved";
      eventId: string;
      occurredAt: Date;
      adjustmentId: string;
      action: "refund" | "chargeback";
      transactionId: string;
      amountMinor: number;
      full: boolean;
    }
  | { kind: "ignored"; eventId: string; occurredAt: Date; eventType: string };

export type CheckoutInput = { checkoutId: string; workspaceId: string; customerEmail: string; price: PriceRef };
/** "now": change and bill the prorated difference immediately. "next_period": change now, bill the new price from the next renewal. */
export type PlanChangeTiming = "now" | "next_period";
export type PlanChangeInput = { subscription: SubscriptionRef; target: PriceRef; when: PlanChangeTiming };

export interface Payments {
  readonly mode: "mock" | "paddle";
  createCheckout(input: CheckoutInput): Promise<{ providerCheckoutId: string; url: string }>;
  changePlan(input: PlanChangeInput): Promise<void>;
  cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void>;
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent;
}
