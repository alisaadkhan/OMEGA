import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TRIAL_CONSENT_TEXT } from "@mushin/contracts";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingModule, createBillingService, MemoryAccessCache } from "../billing/index";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens, type StaffRole } from "../staff/index";
import { softwareKey, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createTrialService, createTrialsModule } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
// The owner's trial allowance (migration 0050); global test setup pins the older 200 for the credit-arithmetic tests.
beforeAll(() => ownerQuery(`update platform.billing_settings set trial_credits = 2500`));
beforeEach(() => resetTables());
afterAll(async () => {
  await ownerQuery(`update platform.billing_settings set trial_credits = 200`);
  await db.close();
});

type H = Record<string, string>;
const DAY = 86_400_000;
const valid = { contactName: "Ayesha Khan", businessName: "Lahore Bakes", email: "ayesha@lahorebakes.pk", phone: "+92 300 1234567", callbackWindow: "morning", useCase: "Find food creators in Lahore", consent: true };

async function setup(o: { callbackLimit?: number } = {}) {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  // Production default (TRIAL_ACTIVATION=approval): sign-up starts no trial.
  const identity = createIdentityModule({ db, autoTrial: null });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, lookup: big, jobs: big, workspaceJobs: big, callback: { limit: o.callbackLimit ?? 1000, windowSeconds: 3600 } });
  const staff = createStaffModule({ db, tokens: createStaffTokens("s".repeat(48)), encryptionKey: Buffer.alloc(32, 9), webauthn: TEST_WEBAUTHN });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [
      platform.module,
      identity.module,
      staff.module,
      createBillingModule({ service: billing, payments, appUrl: "http://localhost:5173" }),
      createTrialsModule({ service: createTrialService({ db, startTrial: billing.startTrial }), limiter, requireStaff: staff.requireStaff }),
    ],
  });
  const call = (method: "GET" | "POST", url: string, headers: H, payload?: object) => app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });
  const customer = async (email: string) => {
    const h = { authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email, fullName: "Ayesha Khan" })}` };
    const me = (await call("GET", "/v1/me", h)).json() as { workspace: { id: string } };
    return { h, workspaceId: me.workspace.id };
  };
  const signIn = async (role: StaffRole) => {
    const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
    const acct = await staff.createStaffAccount({ email, name: `${role} person`, role });
    const { challengeToken } = (await call("POST", "/admin/v1/auth/login", {}, { email, password: acct.password })).json();
    const totp = { authorization: `Bearer ${(await call("POST", "/admin/v1/auth/totp", {}, { challengeToken, code: await generate({ secret: acct.totpSecret }) })).json().accessToken}` };
    if (role === "support") return { h: totp, totp };
    const key = softwareKey();
    const reg = (await call("POST", "/admin/v1/security/keys/options", totp)).json().options;
    expect((await call("POST", "/admin/v1/security/keys", totp, { response: key.register(reg), nickname: "Key", enrolmentCode: acct.enrolmentCode })).statusCode).toBe(201);
    const auth = (await call("POST", "/admin/v1/security/step-up/options", totp)).json().options;
    return { h: { authorization: `Bearer ${(await call("POST", "/admin/v1/security/step-up", totp, { response: key.assert(auth) })).json().accessToken}` }, totp };
  };
  const submit = async (body: object = valid) => call("POST", "/v1/public/trial-requests", {}, body);
  const requestId = async () => (await ownerQuery<{ id: string }>(`select id from platform.trial_requests order by created_at desc limit 1`))[0]?.id ?? "";
  const credits = async (ws: string) => Number((await ownerQuery<{ n: string }>(`select coalesce(sum(remaining), 0) n from wp.credit_lots where workspace_id = '${ws}'`))[0]?.n ?? 0);
  return { call, customer, signIn, submit, requestId, credits };
}

describe("public callback request", () => {
  it("is stored with the server's consent wording and gives the visitor no access", async () => {
    const { call, submit } = await setup();
    const res = await submit();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ received: true });
    const rows = await ownerQuery<{ email: string; consent_text: string; status: string; workspace_id: string | null }>(`select email, consent_text, status, workspace_id from platform.trial_requests`);
    expect(rows).toEqual([{ email: "ayesha@lahorebakes.pk", consent_text: TRIAL_CONSENT_TEXT, status: "new", workspace_id: null }]);
    expect((await call("GET", "/v1/me", {})).statusCode).toBe(401);
    expect((await ownerQuery(`select 1 from wp.workspaces`)).length).toBe(0);
  });

  it("rejects invalid, oversized and unexpected input; drops honeypot and repeated submissions silently", async () => {
    const { submit } = await setup();
    for (const bad of [
      { ...valid, consent: false },
      { ...valid, email: undefined, phone: undefined },
      { ...valid, email: "not-an-email" },
      { ...valid, phone: "call me maybe" },
      { ...valid, callbackWindow: "midnight" },
      { ...valid, contactName: "x".repeat(121) },
      { ...valid, useCase: "x".repeat(1001) },
      { ...valid, status: "approved" },
      { ...valid, workspaceId: randomUUID() },
    ]) expect((await submit(bad)).statusCode).toBe(400);
    expect((await submit({ ...valid, useCase: "x".repeat(9000) })).statusCode).toBe(413);
    expect((await submit({ ...valid, website: "http://spam.example" })).statusCode).toBe(202);
    expect((await submit()).statusCode).toBe(202);
    expect((await submit({ ...valid, email: "AYESHA@lahorebakes.pk" })).statusCode).toBe(202);
    expect((await ownerQuery(`select 1 from platform.trial_requests`)).length).toBe(1);
  });

  it("is rate-limited per address", async () => {
    const { submit } = await setup({ callbackLimit: 2 });
    expect((await submit()).statusCode).toBe(202);
    expect((await submit({ ...valid, email: "b@x.pk", phone: undefined })).statusCode).toBe(202);
    expect((await submit({ ...valid, email: "c@x.pk", phone: undefined })).statusCode).toBe(429);
  });
});

describe("owner-approved activation", () => {
  it("sign-up waits for approval; only a stepped-up Super Admin can approve; dates and 2,500 credits apply once", async () => {
    const { call, customer, signIn, submit, requestId, credits } = await setup();
    const c = await customer("ayesha@lahorebakes.pk");
    const before = (await call("GET", "/v1/billing/summary", c.h)).json();
    expect(before).toMatchObject({ awaitingTrial: true, trialStartedAt: null, trialEndsAt: null, balance: { available: 0 } });
    expect(await credits(c.workspaceId)).toBe(0);

    await submit();
    const id = await requestId();
    const [support, admin, owner] = [await signIn("support"), await signIn("admin"), await signIn("super_admin")];
    expect((await call("GET", "/admin/v1/trial-requests", support.h)).json().requests).toHaveLength(1);
    expect((await call("POST", `/admin/v1/trial-requests/${id}/contacted`, support.h)).json().status).toBe("contacted");
    const approve = { accountEmail: "ayesha@lahorebakes.pk" };
    expect((await call("POST", `/admin/v1/trial-requests/${id}/approve`, support.h, approve)).statusCode).toBe(403);
    expect((await call("POST", `/admin/v1/trial-requests/${id}/approve`, admin.h, approve)).statusCode).toBe(403);
    expect((await call("POST", `/admin/v1/trial-requests/${id}/approve`, owner.totp, approve)).json().error.details).toMatchObject({ reason: "hardware_key_required" });
    expect((await call("POST", `/v1/public/trial-requests`, c.h, { ...valid, status: "approved" })).statusCode).toBe(400);

    const res = await call("POST", `/admin/v1/trial-requests/${id}/approve`, owner.h, approve);
    expect(res.statusCode).toBe(200);
    const out = res.json() as { trialStartedAt: string; trialEndsAt: string; credits: number; request: { status: string; workspaceId: string; decidedBy: string } };
    expect(out.credits).toBe(2500);
    expect(out.request).toMatchObject({ status: "approved", workspaceId: c.workspaceId, decidedBy: "super_admin person" });
    expect(Date.parse(out.trialEndsAt) - Date.parse(out.trialStartedAt)).toBeGreaterThan(14 * DAY - 60_000);
    expect(Date.parse(out.trialEndsAt) - Date.parse(out.trialStartedAt)).toBeLessThan(14 * DAY + 60_000);
    expect(await credits(c.workspaceId)).toBe(2500);
    const after = (await call("GET", "/v1/billing/summary", c.h)).json();
    expect(after).toMatchObject({ awaitingTrial: false, status: "trialing", trialDaysLeft: 14, trialStartedAt: out.trialStartedAt, trialEndsAt: out.trialEndsAt, balance: { available: 2500 } });
    const audit = await ownerQuery<{ target_id: string }>(`select target_id from staff.audit_log where action = 'trials.approved'`);
    expect(audit).toEqual([{ target_id: c.workspaceId }]);

    // Repeating the approval returns the same trial; nothing more is granted.
    expect((await call("POST", `/admin/v1/trial-requests/${id}/approve`, owner.h, approve)).json()).toEqual(out);
    // A second request from the same person cannot start another trial.
    await submit({ ...valid, email: "other@lahorebakes.pk", phone: undefined });
    const second = await requestId();
    expect((await call("POST", `/admin/v1/trial-requests/${second}/approve`, owner.h, approve)).json().error.details).toMatchObject({ reason: "workspace_has_subscription" });
    expect(await credits(c.workspaceId)).toBe(2500);
    expect((await ownerQuery(`select 1 from wp.credit_lots where workspace_id = '${c.workspaceId}'`)).length).toBe(1);
  });

  it("concurrent approvals grant one trial; a rejected request cannot be approved; unknown accounts are refused", async () => {
    const { call, customer, signIn, submit, requestId, credits } = await setup();
    const c = await customer("bilal@shop.pk");
    await submit({ ...valid, email: "bilal@shop.pk", phone: undefined });
    const a = await requestId();
    await submit({ ...valid, email: "bilal2@shop.pk", phone: undefined });
    const b = await requestId();
    await submit({ ...valid, email: "nobody@shop.pk", phone: undefined });
    const nobody = await requestId();
    const owner = await signIn("super_admin");
    const results = await Promise.all([a, b].map((id) => call("POST", `/admin/v1/trial-requests/${id}/approve`, owner.h, { accountEmail: "bilal@shop.pk" })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await credits(c.workspaceId)).toBe(2500);
    expect((await ownerQuery(`select 1 from platform.trial_requests where status = 'approved'`)).length).toBe(1);

    expect((await call("POST", `/admin/v1/trial-requests/${nobody}/approve`, owner.h, { accountEmail: "nobody@shop.pk" })).json().error.details).toMatchObject({ reason: "no_account" });
    expect((await call("POST", `/admin/v1/trial-requests/${nobody}/reject`, owner.h, { note: "Not a business" })).json().status).toBe("rejected");
    expect((await call("POST", `/admin/v1/trial-requests/${nobody}/approve`, owner.h, { accountEmail: "bilal@shop.pk" })).json().error.details).toMatchObject({ reason: "request_rejected" });
  });
});

describe("trial lifecycle and feedback", () => {
  it("expiry is decided by the server clock, never bills, and keeps the workspace's data", async () => {
    const { call, customer, signIn, submit, requestId } = await setup();
    const c = await customer("sana@studio.pk");
    await submit({ ...valid, email: "sana@studio.pk", phone: undefined });
    const id = await requestId();
    const owner = await signIn("super_admin");
    expect((await call("POST", `/admin/v1/trial-requests/${id}/approve`, owner.h, { accountEmail: "sana@studio.pk" })).statusCode).toBe(200);
    // The trial ends: whatever the browser's clock says, the server reads trial_ends_at against its own time.
    await ownerQuery(`update wp.subscriptions set trial_ends_at = now() - interval '1 minute' where workspace_id = '${c.workspaceId}'`);
    const s = (await call("GET", "/v1/billing/summary", { ...c.h, date: new Date(Date.now() - 30 * DAY).toUTCString() })).json();
    expect(s).toMatchObject({ status: "expired", awaitingTrial: false, plan: null, trialDaysLeft: null });
    expect(s.lostAccess).toContain("search_existing");
    expect(await ownerQuery(`select 1 from wp.payments union all select 1 from wp.checkouts`)).toEqual([]);
    expect(await ownerQuery(`select status from wp.workspaces where id = '${c.workspaceId}'`)).toEqual([{ status: "active" }]);
  });

  it("feedback is stored for the sender's workspace only and readable by Super Admins only", async () => {
    const { call, customer, signIn } = await setup();
    const a = await customer("a@brand.pk");
    const b = await customer("b@brand.pk");
    expect((await call("POST", "/v1/trial-feedback", a.h, {})).statusCode).toBe(400);
    expect((await call("POST", "/v1/trial-feedback", a.h, { searchQuality: 6 })).statusCode).toBe(400);
    expect((await call("POST", "/v1/trial-feedback", a.h, { searchQuality: 2, wouldPay: "maybe", preferredPlan: "growth", comments: "Results were thin for Multan", workspaceId: b.workspaceId })).statusCode).toBe(400);
    expect((await call("POST", "/v1/trial-feedback", a.h, { searchQuality: 2, wouldPay: "maybe", preferredPlan: "growth", comments: "Results were thin for Multan" })).statusCode).toBe(201);
    expect(await ownerQuery(`select workspace_id from wp.trial_feedback`)).toEqual([{ workspace_id: a.workspaceId }]);
    const [admin, owner] = [await signIn("admin"), await signIn("super_admin")];
    expect((await call("GET", "/admin/v1/trial-feedback", admin.h)).statusCode).toBe(403);
    const list = (await call("GET", "/admin/v1/trial-feedback", owner.h)).json().feedback;
    expect(list).toMatchObject([{ workspaceId: a.workspaceId, searchQuality: 2, wouldPay: "maybe", preferredPlan: "growth" }]);
  });
});
