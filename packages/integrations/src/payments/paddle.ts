import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented } from "../instrumented";
import { parsePaddleEvent } from "./paddle-events";
import { verifyPaddleSignature } from "./signature";
import type { PaymentEvent, Payments, PriceRef, SubscriptionRef } from "./types";

type PaddleOptions = {
  apiKey: string;
  webhookSecret: string;
  environment: "sandbox" | "production";
  sink: ProviderCallSink;
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => Date;
};

/** Paddle Billing API. Writes are never retried automatically (a retry could create a second transaction). */
export class PaddlePayments implements Payments {
  readonly mode = "paddle" as const;
  private readonly base: string;

  constructor(private readonly o: PaddleOptions) {
    this.base = o.environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  }

  private call<T>(operation: string, method: "GET" | "POST" | "PATCH", path: string, body: unknown, workspaceId: string): Promise<T> {
    const doFetch = this.o.fetch ?? fetch;
    return instrumented(
      { provider: "paddle", operation, timeoutMs: 10_000, retries: method === "GET" ? 2 : 0, sink: this.o.sink, logger: this.o.logger, ctx: { workspaceId } },
      async (signal) => {
        const res = await doFetch(`${this.base}${path}`, {
          method,
          signal,
          headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Paddle ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`);
        return (text ? JSON.parse(text) : {}) as T;
      },
    );
  }

  async createCheckout(input: { checkoutId: string; workspaceId: string; price: PriceRef }): Promise<{ providerCheckoutId: string; url: string }> {
    const res = await this.call<{ data?: { id?: string; checkout?: { url?: string | null } | null } }>(
      "create_checkout",
      "POST",
      "/transactions",
      { items: [{ price_id: input.price.priceId, quantity: 1 }], custom_data: { workspaceId: input.workspaceId, checkoutId: input.checkoutId } },
      input.workspaceId,
    );
    const id = res.data?.id;
    const url = res.data?.checkout?.url;
    if (!id || !url) throw new Error("Paddle returned no checkout URL; set a default payment link in the Paddle dashboard");
    return { providerCheckoutId: id, url };
  }

  async changePlan(input: { subscription: SubscriptionRef; target: PriceRef }): Promise<void> {
    await this.call(
      "change_plan",
      "PATCH",
      `/subscriptions/${encodeURIComponent(input.subscription.subscriptionId)}`,
      { items: [{ price_id: input.target.priceId, quantity: 1 }], proration_billing_mode: "prorated_immediately" },
      input.subscription.workspaceId,
    );
  }

  async cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void> {
    await this.call(
      "cancel",
      "POST",
      `/subscriptions/${encodeURIComponent(input.subscription.subscriptionId)}/cancel`,
      { effective_from: "next_billing_period" },
      input.subscription.workspaceId,
    );
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent {
    verifyPaddleSignature(signatureHeader, rawBody, this.o.webhookSecret, (this.o.now ?? (() => new Date()))());
    return parsePaddleEvent(JSON.parse(rawBody) as unknown);
  }
}
