import { describe, expect, it } from "vitest";
import { MockPayments } from "@mushin/integrations";
import { buildTestApp } from "../../test-support/app";
import { createBillingModule } from "./index";
import type { BillingService } from "./service";

/** Security audit 2026-11-17: the live deployment without Paddle must not sell through the mock provider. */
describe("payments closed on a public deployment without a payment provider", () => {
  async function app(paymentsOpen: boolean) {
    const calls: string[] = [];
    const service = new Proxy({}, { get: (_t, name) => async () => { calls.push(String(name)); return {}; } }) as unknown as BillingService;
    const payments = new MockPayments({ webhookSecret: "w".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
    const tenant = { requestId: "r", userId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222", role: "owner" as const };
    const a = await buildTestApp({
      guards: { customer: async (req) => { req.tenant = tenant; req.customer = { userId: tenant.userId, email: "o@b.pk", fullName: null }; }, idempotent: async () => undefined },
      modules: [createBillingModule({ service, payments, appUrl: "http://app.test", paymentsOpen })],
    });
    return { a, calls };
  }

  it("refuses checkout and plan changes, and has no mock checkout pages", async () => {
    const { a, calls } = await app(false);
    const checkout = await a.inject({ method: "POST", url: "/v1/billing/checkout", payload: { kind: "plan", planId: "growth", interval: "month" } });
    expect(checkout.statusCode).toBe(503);
    expect(checkout.json().error.details).toEqual({ reason: "payments_not_open" });
    expect((await a.inject({ method: "POST", url: "/v1/billing/subscription/change", payload: { planId: "growth" } })).statusCode).toBe(503);
    const id = "33333333-3333-4333-8333-333333333333";
    expect((await a.inject({ method: "POST", url: `/mock-paddle/checkout/22222222-2222-4222-8222-222222222222/${id}/pay` })).statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it("keeps the mock checkout pages where payments are open (development and tests)", async () => {
    const { a } = await app(true);
    expect((await a.inject({ method: "GET", url: "/mock-paddle/checkout/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333" })).statusCode).not.toBe(404);
  });
});
