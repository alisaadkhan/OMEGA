import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@mushin/core";
import { parseInput } from "../../http/validate";
import type { CheckoutRow } from "./repository";
import type { BillingService } from "./service";

const params = z.object({ workspaceId: z.uuid(), id: z.uuid() });
const ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITY[c] ?? c);

function describeItem(c: CheckoutRow): string {
  if (c.kind === "topup") return `Credit top-up (${c.topupPackId ?? "pack"})`;
  return `${c.planId ?? "plan"} plan, billed ${c.billingInterval === "year" ? "yearly" : "monthly"}`;
}

function checkoutPage(c: CheckoutRow): string {
  const amount = `$${(c.amountMinor / 100).toFixed(2)} ${c.currency}`;
  const open = c.status === "open";
  const action = (outcome: "pay" | "fail") => `/mock-paddle/checkout/${encodeURIComponent(c.workspaceId)}/${encodeURIComponent(c.id)}/${outcome}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test checkout · MUSHIN</title>
<link rel="icon" href="data:,">
<style>
  body { font-family: Inter, system-ui, sans-serif; background: #f8fafc; color: #0f172a; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 10px 30px rgba(15, 23, 42, .08); }
  .badge { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  h1 { font-size: 20px; margin: 16px 0 4px; } p { color: #475569; font-size: 14px; line-height: 1.5; }
  .amount { font-size: 32px; font-weight: 600; margin: 20px 0; }
  button { width: 100%; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 10px; }
  .pay { background: #0f172a; color: #fff; border: 0; } .fail { background: #fff; color: #b91c1c; border: 1px solid #fecaca; }
</style></head>
<body><main>
  <span class="badge">Test mode: no real payment</span>
  <h1>${escapeHtml(describeItem(c))}</h1>
  <p>This page stands in for Paddle's hosted checkout until sandbox keys are configured.</p>
  <div class="amount">${escapeHtml(amount)}</div>
  ${
    open
      ? `<form method="post" action="${escapeHtml(action("pay"))}"><button class="pay" type="submit">Pay ${escapeHtml(amount)}</button></form>
  <form method="post" action="${escapeHtml(action("fail"))}"><button class="fail" type="submit">Simulate failed payment</button></form>`
      : `<p>This checkout is already ${escapeHtml(c.status)}.</p>`
  }
</main></body></html>`;
}

/** Only registered when the mock payment provider is active (never in production; config refuses it). */
export function registerMockPaddleRoutes(app: FastifyInstance, service: BillingService, appUrl: string): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.get("/mock-paddle/checkout/:workspaceId/:id", async (req, reply) => {
      const { workspaceId, id } = parseInput(params, req.params);
      const checkout = await service.mockCheckout(workspaceId, id);
      if (!checkout) throw new AppError("NOT_FOUND", "Checkout not found");
      // The one HTML page the API serves (development only). The API-wide CSP allows nothing; this page needs its inline
      // styles, its two forms posting back here, and the redirect to the app after paying (browsers check that too).
      const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self' ${new URL(appUrl).origin}; frame-ancestors 'none'; base-uri 'none'`;
      return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").header("content-security-policy", csp).send(checkoutPage(checkout));
    });
    for (const outcome of ["pay", "fail"] as const) {
      scope.post(`/mock-paddle/checkout/:workspaceId/:id/${outcome}`, async (req, reply) => {
        const { workspaceId, id } = parseInput(params, req.params);
        await service.completeMockCheckout(workspaceId, id, outcome === "pay" ? "paid" : "failed");
        return reply.redirect(`${appUrl}/?checkout=${outcome === "pay" ? "success" : "failed"}#/dashboard`, 303);
      });
    }
  });
}
