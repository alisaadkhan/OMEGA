import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments, signPaddleWebhook } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createBillingModule, createBillingService, MemoryAccessCache, type BillingService } from "./index";

const SECRET = "h".repeat(40);
const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const roomy = () =>
  new MemoryRateLimiter({ ip: { limit: 1000, windowSeconds: 60 }, user: { limit: 1000, windowSeconds: 60 }, auth: { limit: 1000, windowSeconds: 60 } });

async function setup() {
  const target: { app?: FastifyInstance } = {};
  const payments = new MockPayments({
    webhookSecret: SECRET,
    publicApiUrl: "http://api.test",
    // Deliver the mock's webhooks to this very app, as Paddle would over HTTPS.
    deliver: async (raw, sig) => {
      if (!target.app) throw new Error("app not ready");
      const res = await target.app.inject({ method: "POST", url: "/webhooks/paddle", headers: { "content-type": "application/json", "paddle-signature": sig }, payload: raw });
      if (res.statusCode !== 200) throw new Error(`webhook rejected: ${res.statusCode} ${res.body}`);
    },
  });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger: createLogger({ level: "silent" }) });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: {
      customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter: roomy() }),
      idempotent: platform.requireIdempotencyKey,
    },
    modules: [platform.module, identity.module, createBillingModule({ service: billing, payments, appUrl: "http://localhost:5173" })],
  });
  target.app = app;
  const token = await iss.sign({ sub: randomUUID(), email: "owner@mushin.pk", fullName: "Owner" });
  return { app, billing, auth: { authorization: `Bearer ${token}` } };
}

/** What the worker does for each `billing.webhook_received` outbox event. */
async function processWebhooks(billing: BillingService) {
  const rows = await ownerQuery<{ id: string }>(`select id from platform.webhook_events where processed_at is null order by received_at`);
  for (const row of rows) await billing.processStoredWebhook(row.id);
}

describe("billing API", () => {
  it("shows the trial, then buys a plan through the hosted mock checkout", async () => {
    const { app, billing, auth } = await setup();
    const summary = await app.inject({ method: "GET", url: "/v1/billing/summary", headers: auth });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ status: "trialing", balance: { available: 200 } });

    const body = { kind: "subscription", planId: "growth", interval: "month" };
    expect((await app.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: body })).statusCode).toBe(400);
    const checkout = await app.inject({ method: "POST", url: "/v1/billing/checkout", headers: { ...auth, "idempotency-key": "checkout-0001" }, payload: body });
    expect(checkout.statusCode).toBe(201);
    const { checkoutId, url } = checkout.json() as { checkoutId: string; url: string };
    const path = new URL(url).pathname;
    expect(path).toMatch(new RegExp(`^/mock-paddle/checkout/[0-9a-f-]{36}/${checkoutId}$`));

    const page = await app.inject({ method: "GET", url: path });
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body).toContain("$46.00");

    const pay = await app.inject({
      method: "POST",
      url: `${path}/pay`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(pay.statusCode).toBe(303);
    expect(pay.headers.location).toBe("http://localhost:5173/?checkout=success#/dashboard");
    await processWebhooks(billing);

    const after = await app.inject({ method: "GET", url: "/v1/billing/summary", headers: auth });
    expect(after.json()).toMatchObject({ status: "active", plan: { id: "growth" }, balance: { available: 12_200 } });
    const invoices = await app.inject({ method: "GET", url: "/v1/billing/invoices", headers: auth });
    expect(invoices.json().invoices).toHaveLength(1);
    const again = await app.inject({
      method: "POST",
      url: `${path}/pay`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(again.statusCode).toBe(409);
  });

  it("returns ledger history and rejects a bad cursor", async () => {
    const { app, auth } = await setup();
    await app.inject({ method: "GET", url: "/v1/billing/summary", headers: auth });
    const ledger = await app.inject({ method: "GET", url: "/v1/billing/ledger?limit=1", headers: auth });
    expect(ledger.json()).toMatchObject({ entries: [{ kind: "grant", amount: 200, lotSource: "trial" }], nextCursor: null });
    expect((await app.inject({ method: "GET", url: "/v1/billing/ledger?cursor=garbage", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/billing/plans" })).statusCode).toBe(401);
  });

  it("rejects forged and stale webhooks (Review Focus 5) and stores each delivery once", async () => {
    const { app } = await setup();
    const body = JSON.stringify({ event_id: "evt_x", event_type: "customer.created", occurred_at: new Date().toISOString(), data: {} });
    const post = (sig?: string) =>
      app.inject({
        method: "POST",
        url: "/webhooks/paddle",
        headers: sig ? { "content-type": "application/json", "paddle-signature": sig } : { "content-type": "application/json" },
        payload: body,
      });
    expect((await post(signPaddleWebhook("x".repeat(40), body, new Date()))).statusCode).toBe(401);
    expect((await post(signPaddleWebhook(SECRET, body, new Date(Date.now() - 600_000)))).statusCode).toBe(401);
    expect((await post()).statusCode).toBe(401);
    const none = await ownerQuery<{ n: number }>(`select (select count(*)::int from platform.webhook_events) + (select count(*)::int from platform.outbox) as n`);
    expect(none[0]?.n).toBe(0);
    expect((await post(signPaddleWebhook(SECRET, body, new Date()))).statusCode).toBe(200);
    expect((await post(signPaddleWebhook(SECRET, body, new Date()))).statusCode).toBe(200);
    const stored = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.webhook_events`);
    expect(stored[0]?.n).toBe(1);
  });
});
