import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens, type StaffRole } from "../staff/index";
import { softwareKey, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createInsightsModule } from "./index";

const db = createTestDatabase();
beforeEach(() => resetTables());
afterAll(() => db.close());
type H = Record<string, string>;

async function setup() {
  const identity = createIdentityModule({ db, autoTrial: null });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big, callback: big });
  const staff = createStaffModule({ db, tokens: createStaffTokens("s".repeat(48)), encryptionKey: Buffer.alloc(32, 9), webauthn: TEST_WEBAUTHN });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module, staff.module, createInsightsModule({ db, requireStaff: staff.requireStaff })],
  });
  const call = (method: "GET" | "POST" | "PATCH", url: string, headers: H, payload?: object) => app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });
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
    if (role === "support") return totp;
    const key = softwareKey();
    const reg = (await call("POST", "/admin/v1/security/keys/options", totp)).json().options;
    expect((await call("POST", "/admin/v1/security/keys", totp, { response: key.register(reg), nickname: "Key", enrolmentCode: acct.enrolmentCode })).statusCode).toBe(201);
    const auth = (await call("POST", "/admin/v1/security/step-up/options", totp)).json().options;
    return { authorization: `Bearer ${(await call("POST", "/admin/v1/security/step-up", totp, { response: key.assert(auth) })).json().accessToken}` };
  };
  return { call, customer, signIn };
}

describe("product reviews (plan Phase 12)", () => {
  it("INS-01 a customer leaves a review; no email is queued; a second one within 10 minutes is refused", async () => {
    const { call, customer } = await setup();
    const c = await customer("owner@brand.pk");
    const outboxBefore = (await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox`))[0]?.n;
    const first = await call("POST", "/v1/feedback", c.h, { rating: 4, comment: "Search is quick", page: "search" });
    expect(first.statusCode).toBe(201);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox`))[0]?.n).toBe(outboxBefore);
    expect((await call("POST", "/v1/feedback", c.h, { rating: 5 })).statusCode).toBe(429);
    expect((await call("POST", "/v1/feedback", c.h, { rating: 9 })).statusCode).toBe(400);
    expect((await call("POST", "/v1/feedback", {}, { rating: 3 })).statusCode).toBe(401);
  });

  it("INS-02 Staff Admin and Super Admin see reviews with the workspace name only; Support cannot; a status change is audited", async () => {
    const { call, customer, signIn } = await setup();
    const c = await customer("owner@brand.pk");
    await call("POST", "/v1/feedback", c.h, { rating: 2, comment: "Needs more TikTok creators" });
    expect((await call("GET", "/admin/v1/feedback", await signIn("support"))).statusCode).toBe(403);
    for (const role of ["admin", "super_admin"] as const) {
      const h = await signIn(role);
      const list = await call("GET", "/admin/v1/feedback", h);
      expect(list.statusCode).toBe(200);
      const [r] = list.json().reviews as Record<string, unknown>[];
      expect(r).toMatchObject({ rating: 2, comment: "Needs more TikTok creators", status: "new" });
      expect(JSON.stringify(list.json())).not.toMatch(/owner@brand\.pk|userId|email/);
    }
    const admin = await signIn("admin");
    const id = ((await call("GET", "/admin/v1/feedback", admin)).json().reviews as { id: string }[])[0]?.id;
    expect((await call("PATCH", `/admin/v1/feedback/${id}`, admin, { status: "reviewed" })).statusCode).toBe(204);
    expect((await call("GET", "/admin/v1/feedback?status=reviewed", admin)).json().reviews).toHaveLength(1);
    expect(await ownerQuery(`select metadata->>'status' s from staff.audit_log where action = 'feedback.status_changed'`)).toEqual([{ s: "reviewed" }]);
  });
});

describe("usage analytics and support performance (plan Phases 11-12)", () => {
  it("INS-03 analytics are for Staff Admin and Super Admin; staff performance for Super Admin only; empty windows say so", async () => {
    const { call, signIn } = await setup();
    const [support, admin, sup] = [await signIn("support"), await signIn("admin"), await signIn("super_admin")];
    for (const url of ["/admin/v1/analytics/creator-views", "/admin/v1/analytics/searches"]) {
      expect((await call("GET", url, support)).statusCode).toBe(403);
      const ok = await call("GET", `${url}?days=7`, admin);
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ days: 7, trackedSince: null });
    }
    expect((await call("GET", "/admin/v1/support/performance", admin)).statusCode).toBe(403);
    const perf = await call("GET", "/admin/v1/support/performance", sup);
    expect(perf.statusCode).toBe(200);
    expect(perf.json()).toMatchObject({ days: 30, backlog: 0 });
    expect((await call("GET", "/admin/v1/analytics/searches?days=0", admin)).statusCode).toBe(400);
  });
});
