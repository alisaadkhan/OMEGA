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
import { createPlatformModule } from "../platform/index";
import { EmailCheckUnavailable, type DeleteIdentity, type VerifyEmail } from "../../auth/auth-admin";
import { createIdentityModule } from "./index";
import { createPrivacyService } from "./privacy";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

type H = Record<string, string>;
/** The Auth server's records (audit SEC-03): the only trusted evidence of a confirmed email. */
const authRecords = new Map<string, { email: string; confirmed: boolean }>();
let authDown = false;
const verifyEmail: VerifyEmail = async (userId) => {
  if (authDown) throw new EmailCheckUnavailable("down");
  return authRecords.get(userId) ?? null;
};
/** Supabase Auth users that still exist (audit SEC-13): deleting an account must remove its user here. */
const authUsers = new Set<string>();
const identityFailures: string[] = [];
const deleteIdentity: DeleteIdentity = async (userId) => {
  if (authDown) return false;
  authUsers.delete(userId);
  return true;
};

async function setup(o: { verify?: VerifyEmail | null } = {}) {
  authDown = false;
  const logger = createLogger({ level: "silent" });
  const billing = createBillingService({ db, payments: new MockPayments({ webhookSecret: "t".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} }), cache: new MemoryAccessCache(), logger });
  const erased: string[] = [];
  const identity = createIdentityModule({ db, autoTrial: billing.startTrial, appUrl: "https://app.mushin.test", verifyEmail: o.verify === undefined ? verifyEmail : o.verify, deleteIdentity, onIdentityDeleteFailed: (id) => void identityFailures.push(id), onWorkspaceErased: async (id) => void erased.push(id) });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter: new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, lookup: big, jobs: big, workspaceJobs: big, callback: big }) }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module],
  });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: H, payload?: object) => app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });
  /** `confirmed`: what the Auth server records; the token itself always claims user_metadata.email_verified = true. */
  const person = async (email: string, o: { confirmed?: boolean; sub?: string } = {}) => {
    const sub = o.sub ?? randomUUID();
    authRecords.set(sub, { email: email.toLowerCase(), confirmed: o.confirmed ?? true });
    const h = { authorization: `Bearer ${await iss.sign({ sub, email, fullName: email.split("@")[0] ?? "x", emailVerified: true })}` };
    const res = await call("GET", "/v1/me", h);
    const me = res.json() as { workspace?: { id: string }; user?: { id: string } };
    // An unconfirmed account gets nothing (0089): no user row, no workspace.
    return { h, sub, status: res.statusCode, userId: me.user?.id ?? sub, workspaceId: me.workspace?.id ?? "" };
  };
  /** Puts a second person into a workspace directly: the app no longer offers teams (owner, 17 Nov). */
  const join = (workspaceId: string, userId: string) => ownerQuery(`insert into wp.workspace_members (workspace_id, user_id, role) values ('${workspaceId}', '${userId}', 'member')`);
  return { call, person, join, erased };
}

describe("privacy self-service", () => {
  it("exports the workspace's own data to owners and admins, without staff notes or contact values", async () => {
    const { call, person } = await setup();
    const owner = await person("owner@brand.pk");
    await ownerQuery(`insert into wp.lists (workspace_id, name, created_by) values ('${owner.workspaceId}', 'Eid shortlist', '${owner.userId}')`);
    const t = randomUUID();
    await ownerQuery(`insert into wp.support_tickets (id, workspace_id, created_by, subject, category) values ('${t}', '${owner.workspaceId}', '${owner.userId}', 'Help', 'other')`);
    await ownerQuery(`insert into staff.staff_users (id, email, name, role, password_hash, totp_secret_encrypted) values ('${randomUUID()}', 's@mushin.pk', 'S', 'support', 'x', 'x')`);
    const [s] = await ownerQuery<{ id: string }>(`select id from staff.staff_users limit 1`);
    await ownerQuery(`insert into wp.support_messages (ticket_id, workspace_id, author_kind, author_user_id, body) values ('${t}', '${owner.workspaceId}', 'customer', '${owner.userId}', 'Please help')`);
    await ownerQuery(`insert into wp.support_messages (ticket_id, workspace_id, author_kind, author_staff_id, body) values ('${t}', '${owner.workspaceId}', 'internal', '${s?.id}', 'Staff-only remark')`);
    const res = await call("GET", "/v1/workspace/export", owner.h);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="mushin-export-/);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const data = res.json();
    expect(data).toMatchObject({ format: "mushin.workspace-export.v1", workspace: { id: owner.workspaceId } });
    expect(data.tables.lists.map((l: { name: string }) => l.name)).toEqual(["Eid shortlist"]);
    expect(data.tables.members).toHaveLength(1);
    expect(data.truncated).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("Staff-only remark");
    // Another account cannot export it, even by naming the workspace.
    const mona = await person("mona@brand.pk");
    expect((await call("GET", "/v1/workspace/export", { ...mona.h, "x-workspace-id": owner.workspaceId })).statusCode).toBe(403);
  });

  it("erases every workspace table except the billing records that are kept on purpose", async () => {
    // A table added later with a workspace_id must be erased or deliberately kept; this fails until it is one or the other.
    const kept = ["checkouts", "credit_ledger", "credit_lots", "credit_reservations", "entitlement_usage", "payment_adjustments", "payments", "subscriptions"];
    const tables = (await ownerQuery<{ t: string }>(`select table_name t from information_schema.columns where table_schema = 'wp' and column_name = 'workspace_id' and table_name in (select table_name from information_schema.tables where table_schema = 'wp' and table_type = 'BASE TABLE')`)).map((r) => r.t);
    const [fn] = await ownerQuery<{ src: string }>(`select prosrc src from pg_proc where proname = 'erase_workspace'`);
    expect(tables.filter((t) => !kept.includes(t) && !fn?.src.includes(`'${t}'`)).sort()).toEqual([]);
  });

  it("deletes an account only once shared workspaces have a new owner; the account then stays deleted", async () => {
    const { call, person, join } = await setup();
    const owner = await person("owner@brand.pk");
    const mona = await person("mona@brand.pk");
    await join(owner.workspaceId, mona.userId);
    expect((await call("POST", "/v1/me/delete", owner.h, { confirmEmail: "nope@brand.pk" })).statusCode).toBe(400);
    // A shared account (none exist since teams were removed, but the rule stays) is not deleted from under its other users.
    expect((await call("POST", "/v1/me/delete", owner.h, { confirmEmail: "owner@brand.pk" })).json().error.details).toMatchObject({ reason: "owner_of_shared_workspace" });
    await ownerQuery(`update wp.workspace_members set role = case when user_id = '${mona.userId}' then 'owner' else 'admin' end where workspace_id = '${owner.workspaceId}'`);
    await ownerQuery(`update wp.workspaces set owner_user_id = '${mona.userId}' where id = '${owner.workspaceId}'`);
    authUsers.add(owner.userId);
    const res = (await call("POST", "/v1/me/delete", owner.h, { confirmEmail: "owner@brand.pk" })).json();
    expect(res).toMatchObject({ deleted: true, identityProviderAccount: "deleted" });
    expect(authUsers.has(owner.userId)).toBe(false); // the sign-in identity is gone too (audit SEC-13)
    const [u] = await ownerQuery<{ email: string; status: string; display_name: string | null }>(`select email, status, display_name from wp.users where id = '${owner.userId}'`);
    expect(u).toEqual({ email: `deleted+${owner.userId}@invalid`, status: "deleted", display_name: null });
    expect((await call("GET", "/v1/me", owner.h)).json().error.details).toMatchObject({ reason: "account_deleted" });
    expect((await call("GET", "/v1/me", { ...mona.h, "x-workspace-id": owner.workspaceId })).json().workspace).toMatchObject({ id: owner.workspaceId, role: "owner" });
  });

  it("reports, and flags for operators, a sign-in identity the provider did not delete (audit SEC-13)", async () => {
    const { call, person } = await setup();
    const solo = await person("solo@brand.pk");
    identityFailures.length = 0;
    authDown = true;
    const res = (await call("POST", "/v1/me/delete", solo.h, { confirmEmail: "solo@brand.pk" })).json();
    authDown = false;
    expect(res).toMatchObject({ deleted: true, identityProviderAccount: "not_deleted_requires_provider" });
    expect(identityFailures).toEqual([solo.userId]);
  });

  it("names every table cut at the export row limit instead of exporting it silently incomplete (audit DATA-03)", async () => {
    const { person } = await setup();
    const owner = await person("big@brand.pk");
    for (const name of ["One", "Two"]) await ownerQuery(`insert into wp.lists (workspace_id, name, created_by) values ('${owner.workspaceId}', '${name}', '${owner.userId}')`);
    const privacy = createPrivacyService({ db, exportRowLimit: 1 });
    const data = await privacy.exportWorkspace({ userId: owner.userId, workspaceId: owner.workspaceId, role: "owner", requestId: "r" });
    expect(data.tables["lists"]).toHaveLength(1);
    expect(data.truncated).toEqual(["lists"]);
    expect(data.notes[0]).toMatch(/cut at that number: lists/);
  });
});
