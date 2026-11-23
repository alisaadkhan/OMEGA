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

    await ownerQuery(`insert into wp.lists (workspace_id, name, created_by) select '${ws}', 'Eid shortlist', owner_user_id from wp.workspaces where id = '${ws}'`);
    const res = await app.inject({ method: "GET", url: `/admin/v1/ops/workspaces/${ws}/account`, headers: admin });
    expect(res.statusCode, res.body).toBe(200);
    const a = res.json();
    expect(a.plan).toMatchObject({ status: "trialing", complimentary: false });
    expect(a.credits.available).toBeGreaterThan(0);
    expect(a.members).toEqual([expect.objectContaining({ email: "ayesha@brand.pk", role: "owner" })]);
    expect(a.ledger[0]).toMatchObject({ kind: "grant", byStaff: false });
    expect(a.history).toMatchObject({ lists: [expect.objectContaining({ name: "Eid shortlist", creators: 0 })], campaigns: [], searches: { total: 0 }, payments: [], revealedContacts: 0, emailsSent: 0 });
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

    // Suspension (owner, 22 Nov): the customer is refused until staff restore the account.
    const why = { reason: "Payment dispute under review" };
    expect((await app.inject({ method: "POST", url: `/admin/v1/ops/workspaces/${ws}/suspend`, headers: admin, payload: why })).json()).toEqual({ suspended: true, people: 1 });
    const refused = await app.inject({ method: "GET", url: "/v1/me", headers: owner });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: "account_suspended" });
    expect((await app.inject({ method: "GET", url: `/admin/v1/ops/workspaces/${ws}/account`, headers: admin })).json().history.suspended).toBe(true);
    expect((await app.inject({ method: "POST", url: `/admin/v1/ops/workspaces/${ws}/restore`, headers: admin, payload: why })).json()).toEqual({ suspended: false, people: 1 });
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: owner })).statusCode).toBe(200);

    // Plan terms and credit costs: everyone with Subscriptions reads them; only a Super Admin changes them.
    const pricing = (await app.inject({ method: "GET", url: "/admin/v1/ops/pricing", headers: admin })).json() as { plans: { id: string; monthlyCredits: number }[]; actions: { action: string; credits: number }[] };
    expect(pricing.plans.map((p) => p.id)).toEqual(["explorer", "growth", "scale"]);
    const terms = { monthlyCredits: 13_000, displayMonthlyMinor: 1_390_000, reason: "Owner raised Growth for the launch" };
    expect((await app.inject({ method: "PUT", url: "/admin/v1/ops/pricing/plans/growth", headers: admin, payload: terms })).statusCode).toBe(403);
    const changed = (await app.inject({ method: "PUT", url: "/admin/v1/ops/pricing/plans/growth", headers: sup, payload: terms })).json() as typeof pricing;
    expect(changed.plans.find((p) => p.id === "growth")).toMatchObject({ monthlyCredits: 13_000, displayMonthlyMinor: 1_390_000 });
    const cost = (await app.inject({ method: "PUT", url: "/admin/v1/ops/pricing/actions/reveal_contact", headers: sup, payload: { credits: 7, reason: "Owner set contact unlocks to 7" } })).json() as typeof pricing;
    expect(cost.actions.find((a) => a.action === "reveal_contact")?.credits).toBe(7);
    expect((await app.inject({ method: "PUT", url: "/admin/v1/ops/pricing/actions/no_such", headers: sup, payload: { credits: 7, reason: "This action does not exist" } })).statusCode).toBe(404);

    // System Health (owner, 22 Nov): measured now; nothing defaults to healthy.
    const hres = await app.inject({ method: "GET", url: "/admin/v1/ops/health", headers: admin });
    expect(hres.statusCode, hres.body).toBe(200);
    const health = hres.json() as { checks: { key: string; state: string; detail: string }[] };
    expect(health.checks.find((c) => c.key === "database")?.state).toBe("ok");
    expect(health.checks.find((c) => c.key === "migrations")?.detail).toMatch(/migrations applied, latest 00\d\d_/);
    expect(health.checks.map((c) => c.key)).toEqual(expect.arrayContaining(["search", "worker", "outbox", "jobs", "meilisearch", "email", "payments"]));

    const totals = await app.inject({ method: "GET", url: "/admin/v1/ops/subscriptions", headers: admin });
    expect(totals.statusCode).toBe(200);
    expect(totals.json()).toMatchObject({ accounts: 1, withoutPlan: 0, payments: [] });
    expect(totals.json().plans.find((p: { id: string }) => p.id === "growth")).toMatchObject({ accounts: 1, complimentary: 1, paying: 0 });

    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(["ops.account.viewed", "billing.plan.granted", "ops.account.suspended", "ops.account.restored"]));
  });

  it("keeps a person suspended while any account they belong to is still suspended (security review of 0095, 23 Nov)", async () => {
    const { app, customer, keyed } = await setup();
    const a = await customer("both@brand.pk");
    const b = await customer("other@brand.pk");
    const wsA = (await app.inject({ method: "GET", url: "/v1/me", headers: a })).json().workspace.id as string;
    const wsB = (await app.inject({ method: "GET", url: "/v1/me", headers: b })).json().workspace.id as string;
    await ownerQuery(`insert into wp.workspace_members (workspace_id, user_id, role) select '${wsB}', owner_user_id, 'member' from wp.workspaces where id = '${wsA}'`);
    const admin = await keyed("admin");
    const why = { reason: "Payment dispute under review" };
    const post = async (ws: string, path: string) => (await app.inject({ method: "POST", url: `/admin/v1/ops/workspaces/${ws}/${path}`, headers: admin, payload: why })).json();

    expect(await post(wsA, "suspend")).toEqual({ suspended: true, people: 1 });
    expect(await post(wsB, "suspend")).toEqual({ suspended: true, people: 1 }); // the shared person is already suspended
    expect(await post(wsA, "restore")).toEqual({ suspended: false, people: 0 }); // still in suspended account B
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: a })).statusCode).toBe(403);
    expect(await post(wsB, "restore")).toEqual({ suspended: false, people: 2 });
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: a })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: b })).statusCode).toBe(200);
  });
});
