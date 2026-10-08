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
  | { kind: "ignored"; eventId: string; occurredAt: Date; eventType: string };

export interface Payments {
  readonly mode: "mock" | "paddle";
  createCheckout(input: { checkoutId: string; workspaceId: string; customerEmail: string; price: PriceRef }): Promise<{ providerCheckoutId: string; url: string }>;
  changePlan(input: { subscription: SubscriptionRef; target: PriceRef }): Promise<void>;
  cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void>;
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent;
}
