import { randomUUID } from "node:crypto";
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
import { TEST_KEY } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens } from "../staff/index";
import { steppedUpToken, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createOpsModule } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup() {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, autoTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, lookup: big, jobs: big, workspaceJobs: big, callback: big });
  const tokens = createStaffTokens("r".repeat(48));
  const staff = createStaffModule({ db, tokens, encryptionKey: TEST_KEY, webauthn: TEST_WEBAUTHN });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module, staff.module, createOpsModule({ db, requireStaff: staff.requireStaff, billing })],
  });
  const customer = async (email: string) => ({ authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email, fullName: "Ayesha Owner" })}` });
  const keyed = async (role: "admin" | "super_admin") => {
    const acct = await staff.createStaffAccount({ email: `${role}-${randomUUID().slice(0, 6)}@mushin.pk`, name: `${role} person`, role });
    return { authorization: `Bearer ${await steppedUpToken(db, tokens, acct.id, role)}` };
  };
  return { app, customer, keyed };
}

describe("staff Users and Subscriptions pages (owner, 22 Nov)", () => {
  it("shows an account's plan, credits, credit history and members to an admin, audited; a Super Admin assigns a complimentary plan", async () => {
    const { app, customer, keyed } = await setup();
    const owner = await customer("ayesha@brand.pk");
    const ws = (await app.inject({ method: "GET", url: "/v1/me", headers: owner })).json().workspace.id as string;
    const admin = await keyed("admin");

    const res = await app.inject({ method: "GET", url: `/admin/v1/ops/workspaces/${ws}/account`, headers: admin });
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.plan).toMatchObject({ status: "trialing", complimentary: false });
    expect(a.credits.available).toBeGreaterThan(0);
    expect(a.members).toEqual([expect.objectContaining({ email: "ayesha@brand.pk", role: "owner" })]);
    expect(a.ledger[0]).toMatchObject({ kind: "grant", byStaff: false });
    expect((await app.inject({ method: "GET", url: `/admin/v1/ops/workspaces/${randomUUID()}/account`, headers: admin })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/admin/v1/ops/workspaces/${ws}/account`, headers: owner })).statusCode).toBe(401);

    // Assigning a plan is Super Admin only and needs a written reason.
    const body = { planId: "growth", months: 2, reason: "Pilot partner agreed with the owner" };
    expect((await app.inject({ method: "POST", url: `/admin/v1/ops/workspaces/${ws}/plan`, headers: admin, payload: body })).statusCode).toBe(403);
    const sup = await keyed("super_admin");
    expect((await app.inject({ method: "POST", url: `/admin/v1/ops/workspaces/${ws}/plan`, headers: sup, payload: { ...body, reason: "short" } })).statusCode).toBe(400);
    const granted = await app.inject({ method: "POST", url: `/admin/v1/ops/workspaces/${ws}/plan`, headers: sup, payload: body });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({ planId: "growth", monthlyCredits: expect.any(Number) });
    const after = (await app.inject({ method: "GET", url: `/admin/v1/ops/workspaces/${ws}/account`, headers: admin })).json();
    expect(after.plan).toMatchObject({ id: "growth", status: "active", complimentary: true });

    const totals = await app.inject({ method: "GET", url: "/admin/v1/ops/subscriptions", headers: admin });
    expect(totals.statusCode).toBe(200);
    expect(totals.json()).toMatchObject({ accounts: 1, withoutPlan: 0, payments: [] });
    expect(totals.json().plans.find((p: { id: string }) => p.id === "growth")).toMatchObject({ accounts: 1, complimentary: 1, paying: 0 });

    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(["ops.account.viewed", "billing.plan.granted"]));
  });
});
