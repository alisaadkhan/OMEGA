import type { FastifyInstance } from "fastify";
import {
  billingPlansSchema,
  billingSummarySchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  invoicesResponseSchema,
  ledgerPageSchema,
  ledgerQuerySchema,
  planChangeRequestSchema,
  planChangeResponseSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { WebhookPayloadError, type PaymentEvent, type Payments } from "@mushin/integrations";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { BillingService } from "./service";

export function registerBillingRoutes(app: FastifyInstance, guards: Guards, service: BillingService, payments: Payments): void {
  const read = { preHandler: guards.customer };
  const write = { preHandler: [guards.customer, guards.idempotent] };

  app.get("/v1/billing/summary", read, async (req, reply) => sendOk(reply, billingSummarySchema, await service.summary(tenantOf(req))));
  app.get("/v1/billing/plans", read, async (req, reply) => sendOk(reply, billingPlansSchema, await service.plans(tenantOf(req))));
  // The pricing page for signed-out visitors: the same catalogue, nothing per workspace or person, so a short shared
  // cache is safe (a plan change reaches every visitor within five minutes).
  app.get("/v1/public/plans", async (_req, reply) => {
    void reply.header("cache-control", "public, max-age=300");
    return sendOk(reply, billingPlansSchema, await service.publicPlans());
  });
  app.get("/v1/billing/ledger", read, async (req, reply) => {
    const q = parseInput(ledgerQuerySchema, req.query);
    return sendOk(reply, ledgerPageSchema, await service.ledger(tenantOf(req), q));
  });
  app.get("/v1/billing/invoices", read, async (req, reply) => sendOk(reply, invoicesResponseSchema, await service.invoices(tenantOf(req))));

  app.post("/v1/billing/checkout", write, async (req, reply) => {
    const body = parseInput(checkoutRequestSchema, req.body);
    if (!req.customer) throw new AppError("UNAUTHENTICATED", "Authentication required");
    const result = await service.startCheckout({ ...tenantOf(req), email: req.customer.email }, body);
    return sendOk(reply, checkoutResponseSchema, result, 201);
  });
  app.post("/v1/billing/subscription/change", write, async (req, reply) => {
    const body = parseInput(planChangeRequestSchema, req.body);
    return sendOk(reply, planChangeResponseSchema, await service.requestPlanChange(tenantOf(req), body), 202);
  });
  app.post("/v1/billing/subscription/cancel", write, async (req, reply) =>
    sendOk(reply, planChangeResponseSchema, await service.requestCancel(tenantOf(req)), 202),
  );

  // Payment provider → MUSHIN. The signature covers the raw body, so this scope keeps JSON unparsed.
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post("/webhooks/paddle", async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const header = req.headers["paddle-signature"];
      let event: PaymentEvent;
      try {
        event = payments.verifyWebhook(raw, typeof header === "string" ? header : undefined);
      } catch (err) {
        if (err instanceof WebhookPayloadError) {
          req.log.error({ err }, "signed payment webhook has an unexpected shape");
          throw new AppError("VALIDATION_FAILED", "Unexpected webhook payload");
        }
        req.log.warn({ err }, "rejected a payment webhook");
        throw new AppError("UNAUTHENTICATED", "Invalid webhook signature");
      }
      await service.recordWebhook(event, raw, req.id);
      return reply.status(200).send({ received: true });
    });
  });
}
