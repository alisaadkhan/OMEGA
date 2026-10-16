import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { providerPaused } from "@mushin/db";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createIdentityModule } from "../identity/index";
import { createOpsModule } from "../ops/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens, type StaffRole } from "../staff/index";
import { softwareKey, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createSupportModule, createSupportService } from "../support/index";
import { createStaffOpsModule } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
let clock = Date.now();
const now = () => new Date(clock);
beforeEach(async () => {
  await resetTables();
  clock = Date.now();
});
afterAll(() => db.close());

type H = Record<string, string>;
let testAlerts = 0;
async function setup() {
  testAlerts = 0;
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big });
  const tokens = createStaffTokens("s".repeat(48));
  const staff = createStaffModule({ db, tokens, encryptionKey: Buffer.alloc(32, 9), webauthn: TEST_WEBAUTHN });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [
      platform.module,
      identity.module,
      staff.module,
      createSupportModule({ service: createSupportService({ db }) }),
      createOpsModule({ db, requireStaff: staff.requireStaff }),
      createStaffOpsModule({ db, billing, requireStaff: staff.requireStaff, createStaffAccount: staff.createStaffAccount, now, alerts: { notifier: { sendTest: async () => void testAlerts++ }, channel: "webhook" } }),
    ],
  });
  const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, headers: H, payload?: object) => app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });
  const customer = async (email: string) => {
    const h = { authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email, fullName: "Ayesha Owner" })}` };
    const me = (await call("GET", "/v1/me", h)).json() as { workspace: { id: string } };
    return { h, workspaceId: me.workspace.id };
  };
  /** Password + TOTP sign-in; Admin and Super Admin then enrol a key and step up, exactly as in the console. */
  const signIn = async (role: StaffRole) => {
    const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
    const acct = await staff.createStaffAccount({ email, name: `${role} ${email.slice(-10, -9)}`, role });
    const { challengeToken } = (await call("POST", "/admin/v1/auth/login", {}, { email, password: acct.password })).json();
    const totp = { authorization: `Bearer ${(await call("POST", "/admin/v1/auth/totp", {}, { challengeToken, code: await generate({ secret: acct.totpSecret }) })).json().accessToken}` };
    if (role === "support") return { id: acct.id, h: totp, totp };
    const key = softwareKey();
    const reg = (await call("POST", "/admin/v1/security/keys/options", totp)).json().options;
    expect((await call("POST", "/admin/v1/security/keys", totp, { response: key.register(reg), nickname: "Key" })).statusCode).toBe(201);
    const auth = (await call("POST", "/admin/v1/security/step-up/options", totp)).json().options;
    const strong = { authorization: `Bearer ${(await call("POST", "/admin/v1/security/step-up", totp, { response: key.assert(auth) })).json().accessToken}` };
    return { id: acct.id, h: strong, totp };
  };
  return { app, call, customer, signIn, billing };
}
const reason = "Customer reported a failed run; verified in the job inspector.";
const audit = async (action: string) => ownerQuery<{ staff_id: string; workspace_id: string | null; metadata: Record<string, unknown> }>(`select staff_id, workspace_id, metadata from staff.audit_log where action = '${action}' order by created_at`);

describe("two-person approvals", () => {
  it("credit corrections: never self-approved, executed once as a new adjustment grant, audited", async () => {
    const { call, customer, signIn } = await setup();
    const { workspaceId } = await customer("ayesha@brand.pk");
    const available = async () => Number((await ownerQuery<{ n: string }>(`select coalesce(sum(remaining), 0) n from wp.credit_lots where workspace_id = '${workspaceId}'`))[0]?.n ?? 0);
    const [a1, a2, support] = [await signIn("admin"), await signIn("admin"), await signIn("support")];
    const body = { action: "credits.grant", payload: { workspaceId, amount: 150, expiresInDays: 90 }, reason };
    expect((await call("POST", "/admin/v1/approvals", a1.h, { ...body, reason: "too short" })).statusCode).toBe(400);
    expect((await call("POST", "/admin/v1/approvals", a1.totp, body)).json().error.details).toMatchObject({ reason: "hardware_key_required" });
    expect((await call("POST", "/admin/v1/approvals", support.h, body)).statusCode).toBe(403);
    const req = (await call("POST", "/admin/v1/approvals", a1.h, body)).json() as { id: string; status: string };
    expect(req.status).toBe("pending");
    expect((await call("POST", "/admin/v1/approvals", a1.h, body)).json().id).toBe(req.id); // same request, not a second one
    expect((await call("POST", `/admin/v1/approvals/${req.id}/decision`, a1.h, { decision: "approve" })).json().error.details).toMatchObject({ reason: "self_approval" });
    expect((await call("POST", `/admin/v1/approvals/${req.id}/decision`, support.h, { decision: "approve" })).statusCode).toBe(403);
    const before = await available();
    const done = (await call("POST", `/admin/v1/approvals/${req.id}/decision`, a2.h, { decision: "approve", note: "Matches the incident." })).json();
    expect(done).toMatchObject({ status: "executed", decidedBy: { id: a2.id }, result: { amount: 150 } });
    expect(await available()).toBe(before + 150);
    expect((await call("POST", `/admin/v1/approvals/${req.id}/decision`, a2.h, { decision: "approve" })).statusCode).toBe(409);
    const ledger = await ownerQuery<{ kind: string; amount: number; source_ref: string }>(`select kind, amount, source_ref from wp.credit_ledger where source_ref like 'approval:%'`);
    expect(ledger).toEqual([{ kind: "grant", amount: 150, source_ref: `approval:${req.id}` }]);
    expect((await audit("approvals.executed"))[0]).toMatchObject({ staff_id: a2.id });
  });

  it("staff role changes need a Super Admin request and a different Super Admin's approval; Super Admins are untouchable", async () => {
    const { call, signIn } = await setup();
    const [s1, s2, admin, support] = [await signIn("super_admin"), await signIn("super_admin"), await signIn("admin"), await signIn("support")];
    const promote = { action: "staff.role.change", payload: { staffId: support.id, role: "admin" }, reason };
    expect((await call("POST", "/admin/v1/approvals", admin.h, promote)).statusCode).toBe(403); // Admins cannot request escalation
    expect((await call("POST", "/admin/v1/approvals", s1.h, { ...promote, payload: { staffId: support.id, role: "super_admin" } })).statusCode).toBe(400);
    expect((await call("POST", "/admin/v1/approvals", s1.h, { ...promote, payload: { staffId: s2.id, role: "admin" } })).json().error.details).toMatchObject({ reason: "super_admin_protected" });
    expect((await call("POST", "/admin/v1/approvals", s1.h, { ...promote, payload: { staffId: s1.id, role: "admin" } })).json().error.details).toMatchObject({ reason: "self_target" });
    const req = (await call("POST", "/admin/v1/approvals", s1.h, promote)).json() as { id: string; requiresSuperAdmin: boolean };
    expect(req.requiresSuperAdmin).toBe(true);
    expect((await call("POST", `/admin/v1/approvals/${req.id}/decision`, admin.h, { decision: "approve" })).json().error.details).toMatchObject({ reason: "super_admin_cosign" });
    expect((await call("POST", `/admin/v1/approvals/${req.id}/decision`, s2.h, { decision: "approve" })).json()).toMatchObject({ status: "executed" });
    expect((await ownerQuery<{ role: string }>(`select role from staff.staff_users where id = '${support.id}'`))[0]?.role).toBe("admin");
    // The promoted person's old token stops working (role checked per request) and their sessions are revoked.
    expect((await call("GET", "/admin/v1/me", support.h)).statusCode).toBe(401);
  });

  it("suspending staff is co-signed and takes effect at once; rejected and expired requests do nothing", async () => {
    const { call, signIn } = await setup();
    const [s1, s2, admin] = [await signIn("super_admin"), await signIn("super_admin"), await signIn("admin")];
    const rejected = (await call("POST", "/admin/v1/approvals", s1.h, { action: "staff.suspend", payload: { staffId: admin.id, suspended: true }, reason })).json() as { id: string };
    expect((await call("POST", `/admin/v1/approvals/${rejected.id}/decision`, s2.h, { decision: "reject", note: "Not needed" })).json()).toMatchObject({ status: "rejected" });
    expect((await call("GET", "/admin/v1/me", admin.h)).statusCode).toBe(200);
    clock += 25 * 3_600_000; // next day: a new request, which then expires unanswered
    const late = (await call("POST", "/admin/v1/approvals", s1.h, { action: "staff.suspend", payload: { staffId: admin.id, suspended: true }, reason })).json() as { id: string };
    clock += 25 * 3_600_000;
    expect((await call("POST", `/admin/v1/approvals/${late.id}/decision`, s2.h, { decision: "approve" })).json().error.details).toMatchObject({ reason: "expired" });
    clock += 25 * 3_600_000;
    const req = (await call("POST", "/admin/v1/approvals", s1.h, { action: "staff.suspend", payload: { staffId: admin.id, suspended: true }, reason })).json() as { id: string };
    expect((await call("POST", `/admin/v1/approvals/${req.id}/decision`, s2.h, { decision: "approve" })).json()).toMatchObject({ status: "executed" });
    expect((await call("GET", "/admin/v1/me", admin.h)).statusCode).toBe(401);
  });
});

describe("operations controls", () => {
  it("pausing a provider needs an Admin with a key and a reason, is idempotent and audited; the worker reads it", async () => {
    const { call, signIn } = await setup();
    const [admin, support] = [await signIn("admin"), await signIn("support")];
    expect((await call("PUT", "/admin/v1/ops/provider-controls/apify", support.h, { paused: true, reason })).statusCode).toBe(403);
    expect((await call("PUT", "/admin/v1/ops/provider-controls/apify", admin.h, { paused: true, reason: "short" })).statusCode).toBe(400);
    expect((await call("PUT", "/admin/v1/ops/provider-controls/youtube", admin.h, { paused: true, reason })).statusCode).toBe(400); // not pausable from here
    const res = (await call("PUT", "/admin/v1/ops/provider-controls/apify", admin.h, { paused: true, reason })).json() as { providers: { provider: string; paused: boolean; changedBy: string | null }[] };
    expect(res.providers.find((p) => p.provider === "apify")).toMatchObject({ paused: true, changedBy: expect.any(String) });
    await call("PUT", "/admin/v1/ops/provider-controls/apify", admin.h, { paused: true, reason });
    expect(await audit("ops.provider.paused")).toHaveLength(1);
    expect(await providerPaused(db, "apify")).toBe(true);
    await call("PUT", "/admin/v1/ops/provider-controls/apify", admin.h, { paused: false, reason: "Provider confirmed the incident is over." });
    expect(await providerPaused(db, "apify")).toBe(false);
  });

  it("cancels a live run once, refuses add-by-link cancels, and re-dispatches only a stuck job", async () => {
    const { call, customer, signIn } = await setup();
    const admin = await signIn("admin");
    let workspaceId = "";
    const job = async (kind: "live" | "add_by_url", ageMinutes: number) => {
      workspaceId = (await customer(`jobs-${randomUUID().slice(0, 6)}@brand.pk`)).workspaceId;
      const [m] = await ownerQuery<{ user_id: string }>(`select user_id from wp.workspace_members where workspace_id = '${workspaceId}'`);
      const id = randomUUID();
      const live = kind === "live";
      await ownerQuery(`insert into wp.discovery_jobs (id, workspace_id, kind, requested_by, platform, handle, canonical_url, status, attempts, cost, credits_charged, created_at${live ? ", search, max_new, search_hash, prices" : ""})
        values ('${id}', '${workspaceId}', '${kind}', '${m?.user_id}', ${live ? "null, null, null" : "'instagram', 'a', 'https://instagram.com/a'"}, 'running', 1, 100, 0, now() - interval '${ageMinutes} minutes'${live ? `, '{"text":"food","filters":{}}', 5, '${"a".repeat(64)}', '{}'` : ""})`);
      return id;
    };
    const live = await job("live", 2);
    expect((await call("POST", `/admin/v1/ops/jobs/${live}/cancel`, admin.h, { reason })).json()).toEqual({ status: "cancel_requested" });
    expect((await call("POST", `/admin/v1/ops/jobs/${live}/cancel`, admin.h, { reason })).json()).toEqual({ status: "already_requested" });
    expect((await call("POST", `/admin/v1/ops/jobs/${await job("add_by_url", 2)}/cancel`, admin.h, { reason })).statusCode).toBe(409);
    expect((await call("POST", `/admin/v1/ops/jobs/${await job("add_by_url", 2)}/retry`, admin.h, { reason })).json().error.details).toMatchObject({ reason: "not_stuck" });
    const stuck = await job("add_by_url", 45);
    expect((await call("POST", `/admin/v1/ops/jobs/${stuck}/retry`, admin.h, { reason })).json()).toEqual({ status: "requeued" });
    expect(await ownerQuery(`select 1 from platform.outbox where event_type = 'discovery.requested' and payload->>'jobId' = '${stuck}'`)).toHaveLength(1);
    expect((await audit("ops.job.retried"))[0]).toMatchObject({ workspace_id: workspaceId });
  });

  it("internal notes never reach the customer; Support takes tickets for themselves, Admins assign anyone", async () => {
    const { call, customer, signIn } = await setup();
    const { h: owner } = await customer("tickets@brand.pk");
    const [support, other, admin] = [await signIn("support"), await signIn("support"), await signIn("admin")];
    const t = (await call("POST", "/v1/support/tickets", owner, { subject: "Charged twice?", category: "billing", body: "I see two charges." })).json() as { id: string };
    expect((await call("POST", `/admin/v1/support/tickets/${t.id}/notes`, support.h, { body: "Ledger shows one charge and one release; explain." })).json().messages.at(-1)).toMatchObject({ authorKind: "internal" });
    const seen = (await call("GET", `/v1/support/tickets/${t.id}`, owner)).json() as { thread: { body: string }[]; messages: number };
    expect(seen.thread.map((m) => m.body)).toEqual(["I see two charges."]);
    expect(seen.messages).toBe(1);
    expect(JSON.stringify((await call("GET", "/v1/support/tickets", owner)).json())).not.toContain("Ledger shows");
    expect((await call("PUT", `/admin/v1/support/tickets/${t.id}/assignee`, support.h, { assigneeId: other.id })).statusCode).toBe(403);
    expect((await call("PUT", `/admin/v1/support/tickets/${t.id}/assignee`, support.h, { assigneeId: support.id })).json()).toMatchObject({ assignedStaffId: support.id });
    expect((await call("PUT", `/admin/v1/support/tickets/${t.id}/assignee`, admin.h, { assigneeId: other.id })).json()).toMatchObject({ assignedStaffId: other.id });
    expect((await call("PUT", `/admin/v1/support/tickets/${t.id}/assignee`, admin.h, { assigneeId: randomUUID() })).statusCode).toBe(400);
    expect((await audit("support.ticket.noted"))[0]?.metadata).toEqual({ ticketId: t.id }); // the note text is not copied into the audit
  });

  it("staff directory for Admins; only a Super Admin creates staff, always as Support; audit search filters", async () => {
    const { call, signIn } = await setup();
    const [sa, admin, support] = [await signIn("super_admin"), await signIn("admin"), await signIn("support")];
    expect((await call("GET", "/admin/v1/staff", support.h)).statusCode).toBe(403);
    expect(((await call("GET", "/admin/v1/staff", admin.h)).json().staff as { keys: number }[]).length).toBe(3);
    const body = { email: "new.person@mushin.pk", name: "New Person", reason: "New support hire starting Monday." };
    expect((await call("POST", "/admin/v1/staff", admin.h, body)).statusCode).toBe(403);
    const created = (await call("POST", "/admin/v1/staff", sa.h, body)).json() as { id: string; temporaryPassword: string };
    expect(created.temporaryPassword.length).toBeGreaterThan(10);
    expect((await ownerQuery<{ role: string }>(`select role from staff.staff_users where id = '${created.id}'`))[0]?.role).toBe("support");
    expect((await call("POST", "/admin/v1/staff", sa.h, body)).statusCode).toBe(409);
    const events = (await call("GET", "/admin/v1/audit/search?action=staff.created", admin.h)).json().events as { action: string; metadata: Record<string, unknown> }[];
    expect(events).toEqual([expect.objectContaining({ action: "staff.created" })]);
    expect(JSON.stringify(events)).not.toContain(created.temporaryPassword);
    expect(((await call("GET", `/admin/v1/audit/search?staffId=${support.id}`, admin.h)).json().events as unknown[]).length).toBeGreaterThan(0);
  });

  it("alerts report measured values and crossed thresholds, never a default 'healthy'", async () => {
    const { call, customer, signIn } = await setup();
    const { workspaceId } = await customer("alerts@brand.pk");
    const support = await signIn("support");
    const quiet = (await call("GET", "/admin/v1/ops/alerts", support.h)).json();
    expect(quiet).toMatchObject({ stuckJobs: 0, alerts: expect.any(Array) });
    expect(quiet.alerts.some((a: { key: string }) => a.key === "stuck_jobs")).toBe(false);
    const [m] = await ownerQuery<{ user_id: string }>(`select user_id from wp.workspace_members where workspace_id = '${workspaceId}'`);
    await ownerQuery(`insert into wp.discovery_jobs (id, workspace_id, kind, requested_by, platform, handle, canonical_url, status, attempts, cost, credits_charged, created_at)
      values ('${randomUUID()}', '${workspaceId}', 'add_by_url', '${m?.user_id}', 'instagram', 'a', 'https://instagram.com/a', 'queued', 0, 50, 0, now() - interval '2 hours')`);
    expect((await call("GET", "/admin/v1/ops/alerts", support.h)).json().alerts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "stuck_jobs", severity: "warning" })]));
  });

  it("lets an Admin send a test alert, audited; Support cannot (audit OPS-03)", async () => {
    const { call, signIn } = await setup();
    const [support, admin] = [await signIn("support"), await signIn("admin")];
    expect((await call("POST", "/admin/v1/ops/alerts/test", support.h, {})).statusCode).toBe(403);
    expect((await call("POST", "/admin/v1/ops/alerts/test", admin.totp, {})).statusCode).toBe(403); // hardware-key step-up needed
    const res = await call("POST", "/admin/v1/ops/alerts/test", admin.h, {});
    expect(res.json()).toEqual({ sent: true, channel: "webhook" });
    expect(testAlerts).toBe(1);
    expect(await audit("ops.alerts.test_sent")).toEqual([expect.objectContaining({ staff_id: admin.id, metadata: { channel: "webhook" } })]);
  });
});

describe("consented, read-only support access", () => {
  it("is asked with a purpose, granted only by the workspace owner or admin, read-only, audited and time-boxed", async () => {
    const { call, customer, signIn } = await setup();
    const { h: owner, workspaceId } = await customer("access@brand.pk");
    const { h: stranger } = await customer("other@else.pk");
    const [support, colleague] = [await signIn("support"), await signIn("support")];
    expect((await call("POST", "/admin/v1/access-requests", support.h, { workspaceId, purpose: "debug" })).statusCode).toBe(400);
    const req = (await call("POST", "/admin/v1/access-requests", support.h, { workspaceId, purpose: "Customer asked us to check why their list is empty." })).json() as { id: string };
    expect((await call("GET", `/admin/v1/access-requests/${req.id}/view`, support.h)).json().error.details).toMatchObject({ reason: "access_requested" });
    expect((await call("POST", `/v1/support/access-requests/${req.id}/grant`, stranger, {})).statusCode).toBe(404); // another workspace cannot see it
    const listed = (await call("GET", "/v1/support/access-requests", owner)).json() as { requests: { id: string; staffName: string; purpose: string }[] };
    expect(listed.requests).toEqual([expect.objectContaining({ id: req.id, purpose: "Customer asked us to check why their list is empty." })]);
    expect((await call("POST", `/v1/support/access-requests/${req.id}/grant`, owner, { minutes: 30 })).json()).toMatchObject({ status: "granted" });

    const view = (await call("GET", `/admin/v1/access-requests/${req.id}/view`, support.h)).json();
    expect(view).toMatchObject({ workspace: { id: workspaceId }, lists: [], campaigns: [], access: { status: "granted" } });
    expect(JSON.stringify(view)).not.toMatch(/balance|ledger|budget|fee|email/i);
    expect((await call("GET", `/admin/v1/access-requests/${req.id}/view`, colleague.h)).statusCode).toBe(404); // granted to one person only
    expect((await audit("support.access.viewed"))[0]).toMatchObject({ staff_id: support.id, workspace_id: workspaceId });

    clock += 31 * 60_000;
    expect((await call("GET", `/admin/v1/access-requests/${req.id}/view`, support.h)).json().error.details).toMatchObject({ reason: "access_expired" });
  });

  it("the customer can decline or end access at any time; a granted window never exceeds 60 minutes", async () => {
    const { call, customer, signIn } = await setup();
    const { h: owner, workspaceId } = await customer("end@brand.pk");
    const support = await signIn("support");
    const purpose = "Checking a failed Find New Creators run with the customer.";
    const a = (await call("POST", "/admin/v1/access-requests", support.h, { workspaceId, purpose })).json() as { id: string };
    expect((await call("POST", `/v1/support/access-requests/${a.id}/grant`, owner, { minutes: 240 })).statusCode).toBe(400);
    const granted = (await call("POST", `/v1/support/access-requests/${a.id}/grant`, owner, {})).json() as { decidedAt: string; expiresAt: string };
    expect(Date.parse(granted.expiresAt) - Date.parse(granted.decidedAt)).toBe(60 * 60_000);
    expect((await call("POST", `/v1/support/access-requests/${a.id}/end`, owner, {})).json()).toMatchObject({ status: "ended" });
    expect((await call("GET", `/admin/v1/access-requests/${a.id}/view`, support.h)).json().error.details).toMatchObject({ reason: "access_ended" });
    const b = (await call("POST", "/admin/v1/access-requests", support.h, { workspaceId, purpose })).json() as { id: string };
    expect((await call("POST", `/v1/support/access-requests/${b.id}/decline`, owner, {})).json()).toMatchObject({ status: "declined" });
    expect((await call("POST", `/v1/support/access-requests/${b.id}/grant`, owner, {})).statusCode).toBe(409);
  });
});
