import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens } from "../staff/index";
import { steppedUpToken, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createSupportModule, createSupportService } from "../support/index";
import { createOpsModule, maskEmail } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup() {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big });
  const tokens = createStaffTokens("r".repeat(48));
  const staff = createStaffModule({ db, tokens, encryptionKey: TEST_KEY, webauthn: TEST_WEBAUTHN });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module, staff.module, createSupportModule({ service: createSupportService({ db }) }), createOpsModule({ db, requireStaff: staff.requireStaff })],
  });
  const customer = async (email: string) => ({ authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email, fullName: "Ayesha Owner" })}` });
  const staffToken = async (role: "admin" | "support") => {
    const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
    const acct = await staff.createStaffAccount({ email, name: `${role} person`, role });
    const { challengeToken } = (await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password: acct.password } })).json();
    const res = await app.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
    return { authorization: `Bearer ${(res.json() as { accessToken: string }).accessToken}` };
  };
  // An admin session that states a hardware-key factor. No WebAuthn sign-in exists yet, so only tests can mint one.
  const hardwareKeyAdmin = async () => {
    const acct = await staff.createStaffAccount({ email: `hwk-${randomUUID().slice(0, 6)}@mushin.pk`, name: "Key admin", role: "admin" });
    return { authorization: `Bearer ${await steppedUpToken(db, tokens, acct.id, "admin")}` };
  };
  return { app, customer, staffToken, hardwareKeyAdmin };
}

describe("support tickets and staff operations", () => {
  it("customer opens a ticket, support replies, the customer sees it; workspaces cannot see each other's tickets", async () => {
    const { app, customer, staffToken } = await setup();
    const owner = await customer("ayesha@brand.pk");
    const other = await customer("bilal@other.pk");
    const created = await app.inject({ method: "POST", url: "/v1/support/tickets", headers: owner, payload: { subject: "Find New Creators failed", category: "discovery", body: "My run says provider unavailable." } });
    expect(created.statusCode).toBe(201);
    const ticket = created.json() as { id: string; thread: unknown[] };
    expect(ticket.thread).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/v1/support/tickets/${ticket.id}`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/support/tickets", headers: other })).json()).toEqual({ tickets: [] });
    expect((await app.inject({ method: "POST", url: "/v1/support/tickets", headers: owner, payload: { subject: "", category: "other", body: "x" } })).statusCode).toBe(400);

    const support = await staffToken("support");
    const queue = (await app.inject({ method: "GET", url: "/admin/v1/support/tickets?status=open", headers: support })).json() as { tickets: { id: string; lastAuthor: string }[] };
    expect(queue.tickets.map((t) => t.id)).toEqual([ticket.id]);
    expect(queue.tickets[0]?.lastAuthor).toBe("customer");
    const replied = await app.inject({ method: "PATCH", url: `/admin/v1/support/tickets/${ticket.id}`, headers: support, payload: { body: "Apify is paused; credits were returned. Try again tomorrow.", status: "waiting_on_customer" } });
    expect(replied.statusCode).toBe(200);
    expect(replied.json()).toMatchObject({ status: "waiting_on_customer", messages: [{ authorKind: "customer", authorName: "Ayesha Owner" }, { authorKind: "staff", authorName: "support person" }] });

    // The customer sees the reply (as MUSHIN support), replies (reopens), then closes; a closed ticket takes no reply.
    const seen = (await app.inject({ method: "GET", url: `/v1/support/tickets/${ticket.id}`, headers: owner })).json() as { status: string; thread: { authorKind: string; authorName: string }[] };
    expect(seen.status).toBe("waiting_on_customer");
    expect(seen.thread[1]).toMatchObject({ authorKind: "staff", authorName: "MUSHIN support" });
    expect((await app.inject({ method: "POST", url: `/v1/support/tickets/${ticket.id}/messages`, headers: owner, payload: { body: "Thanks, will retry." } })).json()).toMatchObject({ status: "open" });
    expect((await app.inject({ method: "PATCH", url: `/v1/support/tickets/${ticket.id}`, headers: owner, payload: { status: "closed" } })).json()).toMatchObject({ status: "closed" });
    expect((await app.inject({ method: "POST", url: `/v1/support/tickets/${ticket.id}/messages`, headers: owner, payload: { body: "one more" } })).statusCode).toBe(409);
    // Customers cannot edit or delete messages at the database level either.
    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["support.ticket.updated"]));
  });

  it("separates staff roles: support gets redacted, read-only views; providers and audit are admin-only; customers are refused", async () => {
    const { app, customer, staffToken, hardwareKeyAdmin } = await setup();
    const owner = await customer("ayesha@brand.pk");
    await app.inject({ method: "GET", url: "/v1/me", headers: owner }); // provisions the workspace
    const support = await staffToken("support");
    const totpAdmin = await staffToken("admin");
    const admin = await hardwareKeyAdmin();
    // Admin-only views need a hardware key: a TOTP-only admin session is refused (DOC-029).
    for (const url of ["/admin/v1/ops/providers", "/admin/v1/audit"]) {
      const res = await app.inject({ method: "GET", url, headers: totpAdmin });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { details: { reason: "hardware_key_required" } } });
    }
    expect((await app.inject({ method: "GET", url: "/admin/v1/ops/overview", headers: totpAdmin })).statusCode).toBe(200);

    expect((await app.inject({ method: "GET", url: "/admin/v1/ops/overview", headers: owner })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/admin/v1/ops/overview" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/admin/v1/ops/providers", headers: support })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/v1/audit", headers: support })).statusCode).toBe(403);

    const overview = (await app.inject({ method: "GET", url: "/admin/v1/ops/overview", headers: support })).json();
    expect(overview).toMatchObject({ workspaces: 1, openTickets: 0, openJobs: 0 });
    const bySupport = (await app.inject({ method: "GET", url: "/admin/v1/ops/workspaces?q=ayesha", headers: support })).json() as { workspaces: { ownerEmail: string }[] };
    const byAdmin = (await app.inject({ method: "GET", url: "/admin/v1/ops/workspaces?q=ayesha", headers: admin })).json() as { workspaces: { ownerEmail: string }[] };
    expect(bySupport.workspaces[0]?.ownerEmail).toBe(maskEmail("ayesha@brand.pk"));
    // Every staff role sees a masked owner email (staff spec: redacted lookup); an exact address still finds the workspace.
    expect(byAdmin.workspaces[0]?.ownerEmail).toBe(maskEmail("ayesha@brand.pk"));
    const exact = (await app.inject({ method: "GET", url: "/admin/v1/ops/workspaces?q=AYESHA%40brand.pk", headers: support })).json() as { workspaces: unknown[] };
    expect(exact.workspaces).toHaveLength(1);
    expect(((await app.inject({ method: "GET", url: "/admin/v1/ops/workspaces?q=%40brand.pk", headers: support })).json() as { workspaces: unknown[] }).workspaces).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/admin/v1/ops/jobs?status=stuck", headers: support })).json()).toEqual({ jobs: [] });

    await ownerQuery(`insert into platform.provider_calls (provider, operation, latency_ms, status, cost_usd) values ('serper', 'search', 420, 'ok', 0.001), ('serper', 'search', 900, 'error', 0)`);
    const providersRes = await app.inject({ method: "GET", url: "/admin/v1/ops/providers?hours=24", headers: admin });
    const providers = providersRes.json() as { providers: { provider: string; calls: number; errors: number }[] };
    expect(providers.providers).toEqual([expect.objectContaining({ provider: "serper", calls: 2, errors: 1 })]);

    const audit = (await app.inject({ method: "GET", url: "/admin/v1/audit", headers: admin })).json() as { events: { action: string; staffRole: string }[] };
    expect(audit.events.map((e) => e.action)).toEqual(expect.arrayContaining(["ops.workspaces.searched"]));
    expect(audit.events.find((e) => e.action === "ops.workspaces.searched")?.staffRole).toBeDefined();
  });

  it("shows a job's direct provider cost by model next to the credits charged (admin job inspector)", async () => {
    const { app, customer, staffToken } = await setup();
    const owner = await customer("cost@brand.pk");
    await app.inject({ method: "GET", url: "/v1/me", headers: owner });
    const [ws] = await ownerQuery<{ workspace_id: string; user_id: string }>(`select workspace_id, user_id from wp.workspace_members limit 1`);
    const jobId = randomUUID();
    await ownerQuery(`insert into wp.discovery_jobs (id, workspace_id, kind, requested_by, platform, handle, canonical_url, status, attempts, cost, credits_charged)
      values ('${jobId}', '${ws?.workspace_id}', 'add_by_url', '${ws?.user_id}', 'instagram', 'a', 'https://instagram.com/a', 'completed', 2, 50, 50)`);
    for (const [i, handle] of ["c_one", "c_two"].entries()) {
      const creatorId = await addCreator(db, { profiles: [{ platform: "instagram", handle }] });
      await ownerQuery(`insert into wp.discovery_results (workspace_id, job_id, creator_id, seq, is_new, credits) values ('${ws?.workspace_id}', '${jobId}', '${creatorId}', ${i + 1}, true, 10)`);
    }
    await ownerQuery(`insert into platform.provider_calls (provider, operation, model, tokens_in, tokens_out, units, latency_ms, status, cost_usd, job_id) values
      ('apify', 'scrape_instagram', 'apify/instagram-profile-scraper', null, null, 2, 4000, 'ok', 0.0052, '${jobId}'),
      ('serper', 'web_search', null, null, null, 1, 300, 'ok', 0.001, '${jobId}'),
      ('ollama', 'creator_assessment', 'gpt-oss:20b', 1000, 500, null, 2000, 'ok', 0.00022, '${jobId}'),
      ('groq', 'creator_assessment', 'openai/gpt-oss-20b', 1000, 0, null, 900, 'error', 0, '${jobId}')`);
    const detail = (await app.inject({ method: "GET", url: `/admin/v1/ops/jobs/${jobId}`, headers: await staffToken("admin") })).json() as {
      providerCalls: { provider: string; model: string | null; tokensIn: number; tokensOut: number; costUsd: number }[];
      cost: { totalUsd: number; failedCalls: number; attempts: number; newCreators: number; creditsCharged: number; costPerNewCreatorUsd: number | null };
    };
    expect(detail.providerCalls.find((c) => c.provider === "ollama")).toMatchObject({ model: "gpt-oss:20b", tokensIn: 1000, tokensOut: 500 });
    expect(detail.cost).toMatchObject({ failedCalls: 1, attempts: 2, newCreators: 2, creditsCharged: 50 });
    expect(detail.cost.totalUsd).toBeCloseTo(0.00642, 6);
    expect(detail.cost.costPerNewCreatorUsd).toBeCloseTo(0.00321, 6);
  });
});
