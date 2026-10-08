import { z } from "zod";
import { SUBSCRIPTION_EVENT_TYPES, type PaymentEvent, type SubscriptionEventType } from "./types";

export class WebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookPayloadError";
  }
}

const timestamp = z.iso.datetime({ offset: true });
const envelope = z.object({ event_id: z.string().min(1), event_type: z.string().min(1), occurred_at: timestamp, data: z.unknown() });
const customData = z.object({ workspaceId: z.uuid(), checkoutId: z.uuid().nullish() });
const withCustomData = z.object({ custom_data: customData });
const items = z.array(z.object({ price: z.object({ id: z.string().min(1) }) })).min(1);

const transaction = z.object({
  id: z.string().min(1),
  subscription_id: z.string().nullish(),
  items,
  currency_code: z.string().length(3),
  details: z.object({ totals: z.object({ grand_total: z.string().regex(/^\d+$/) }) }),
  invoice_url: z.string().nullish(),
});
const failedTransaction = z.object({ id: z.string().min(1) });
const subscription = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "past_due", "canceled", "trialing", "paused"]),
  customer_id: z.string().nullish(),
  items,
  current_billing_period: z.object({ starts_at: timestamp, ends_at: timestamp }).nullish(),
  scheduled_change: z.object({ action: z.string() }).nullish(),
});

function parseData<S extends z.ZodType>(schema: S, data: unknown, type: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new WebhookPayloadError(`unexpected ${type} payload: ${result.error.issues[0]?.message ?? "invalid"}`);
  return result.data;
}

function firstPrice(list: { price: { id: string } }[]): string {
  const id = list[0]?.price.id;
  if (!id) throw new WebhookPayloadError("event has no price");
  return id;
}

const isSubscriptionEvent = (type: string): type is SubscriptionEventType => (SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(type);

/** Turns a verified Paddle webhook body into a PaymentEvent. Events MUSHIN did not start (no workspace in custom_data) are ignored. */
export function parsePaddleEvent(payload: unknown): PaymentEvent {
  const env = envelope.safeParse(payload);
  if (!env.success) throw new WebhookPayloadError("not a Paddle event");
  const { event_id: eventId, event_type: type, occurred_at: occurredAtRaw, data } = env.data;
  const occurredAt = new Date(occurredAtRaw);
  const handled = type === "transaction.completed" || type === "transaction.payment_failed" || isSubscriptionEvent(type);
  const owner = withCustomData.safeParse(data);
  if (!handled || !owner.success) return { kind: "ignored", eventId, occurredAt, eventType: type };
  const { workspaceId, checkoutId } = owner.data.custom_data;

  if (type === "transaction.completed") {
    const t = parseData(transaction, data, type);
    return {
      kind: type,
      eventId,
      occurredAt,
      workspaceId,
      transactionId: t.id,
      subscriptionId: t.subscription_id ?? null,
      checkoutId: checkoutId ?? null,
      priceId: firstPrice(t.items),
      amountMinor: Number(t.details.totals.grand_total),
      currency: t.currency_code,
      invoiceUrl: t.invoice_url ?? null,
    };
  }
  if (type === "transaction.payment_failed") {
    const t = parseData(failedTransaction, data, type);
    return { kind: type, eventId, occurredAt, workspaceId, transactionId: t.id, checkoutId: checkoutId ?? null };
  }
  const s = parseData(subscription, data, type);
  return {
    kind: type,
    eventId,
    occurredAt,
    workspaceId,
    subscription: {
      subscriptionId: s.id,
      customerId: s.customer_id ?? null,
      status: s.status,
      priceId: firstPrice(s.items),
      periodStart: s.current_billing_period ? new Date(s.current_billing_period.starts_at) : null,
      periodEnd: s.current_billing_period ? new Date(s.current_billing_period.ends_at) : null,
      cancelScheduled: s.scheduled_change?.action === "cancel",
    },
  };
}
