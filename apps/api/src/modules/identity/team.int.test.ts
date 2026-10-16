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
import { EmailCheckUnavailable, type VerifyEmail } from "../../auth/auth-admin";
import { createIdentityModule } from "./index";

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

async function setup(o: { verify?: VerifyEmail | null } = {}) {
  authDown = false;
  const logger = createLogger({ level: "silent" });
  const billing = createBillingService({ db, payments: new MockPayments({ webhookSecret: "t".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} }), cache: new MemoryAccessCache(), logger });
  const erased: string[] = [];
  const identity = createIdentityModule({ db, startTrial: billing.startTrial, appUrl: "https://app.mushin.test", verifyEmail: o.verify === undefined ? verifyEmail : o.verify, onWorkspaceErased: async (id) => void erased.push(id) });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter: new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big }) }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module],
  });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: H, payload?: object) => app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });
  /** `confirmed`: what the Auth server records; the token itself always claims user_metadata.email_verified = true. */
  const person = async (email: string, o: { confirmed?: boolean; sub?: string } = {}) => {
    const sub = o.sub ?? randomUUID();
    authRecords.set(sub, { email: email.toLowerCase(), confirmed: o.confirmed ?? true });
    const h = { authorization: `Bearer ${await iss.sign({ sub, email, fullName: email.split("@")[0] ?? "x", emailVerified: true })}` };
    const me = (await call("GET", "/v1/me", h)).json() as { workspace: { id: string }; user: { id: string } };
    return { h, sub, userId: me.user.id, workspaceId: me.workspace.id };
  };
  const invite = async (h: H, email: string, role = "member") => (await call("POST", "/v1/workspace/invitations", h, { email, role })).json() as { id: string; acceptUrl: string };
  const tokenOf = (url: string) => url.split("/invite/")[1] ?? "";
  return { call, person, invite, tokenOf, erased };
}

describe("workspace invitations and workspace selection", () => {
  it("only the invited, verified email can accept; the person then works in either workspace by choosing it", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    const inv = await invite(owner.h, "Sara@Agency.pk");
    expect(inv.acceptUrl).toMatch(/^https:\/\/app\.mushin\.test\/#\/invite\/.{40,}$/);
    expect((await call("POST", "/v1/workspace/invitations", owner.h, { email: "sara@agency.pk" })).statusCode).toBe(409); // already invited
    const token = tokenOf(inv.acceptUrl);

    const stranger = await person("mallory@evil.pk");
    expect((await call("POST", "/v1/invitations/accept", stranger.h, { token })).json().error.details).toMatchObject({ reason: "invitation_invalid" });
    // Audit SEC-03: the token claims user_metadata.email_verified = true (users can set that themselves) but the Auth
    // server has not confirmed the address: refused.
    const unverified = await person("sara@agency.pk", { confirmed: false });
    expect((await call("POST", "/v1/invitations/accept", unverified.h, { token })).json().error.details).toMatchObject({ reason: "email_unverified" });
    // If the Auth check cannot be made, nobody is let in.
    authDown = true;
    const down = await call("POST", "/v1/invitations/accept", unverified.h, { token });
    expect([down.statusCode, down.json().error.details.reason]).toEqual([503, "email_check_unavailable"]);
    authDown = false;

    const sara = await person("sara@agency.pk", { sub: unverified.sub }); // same account, email now confirmed by the Auth server
    expect((await call("POST", "/v1/invitations/preview", sara.h, { token })).json()).toMatchObject({ role: "member", status: "pending" });
    expect((await call("POST", "/v1/invitations/accept", sara.h, { token })).json()).toEqual({ workspaceId: owner.workspaceId, role: "member" });
    expect((await call("POST", "/v1/invitations/accept", sara.h, { token })).statusCode).toBe(403); // used once

    const mine = (await call("GET", "/v1/me/workspaces", sara.h)).json().workspaces as { id: string; role: string }[];
    expect(mine.map((w) => [w.id, w.role])).toEqual([[sara.workspaceId, "owner"], [owner.workspaceId, "member"]]);
    expect((await call("GET", "/v1/me", { ...sara.h, "x-workspace-id": owner.workspaceId })).json().workspace).toMatchObject({ id: owner.workspaceId, role: "member" });
    // A workspace the person does not belong to is refused, never entered and never swapped for another (audit SEC-04).
    const denied = await call("GET", "/v1/me", { ...stranger.h, "x-workspace-id": owner.workspaceId });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details).toMatchObject({ reason: "workspace_access_denied", workspaceId: owner.workspaceId });
    expect(denied.headers["x-workspace-id"]).toBeUndefined();
    // Without a header the person works in their own workspace, and every response names the workspace it acted in.
    const own = await call("GET", "/v1/me", stranger.h);
    expect(own.headers["x-workspace-id"]).toBe(stranger.workspaceId);
    expect((await call("GET", "/v1/me", { ...sara.h, "x-workspace-id": owner.workspaceId })).headers["x-workspace-id"]).toBe(owner.workspaceId);
    expect((await call("GET", "/v1/me", { ...stranger.h, "x-workspace-id": "not-a-uuid" })).statusCode).toBe(400);
  });

  it("owners invite admins, admins invite members only, members cannot invite; revoked links stop working", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    const adminInv = await invite(owner.h, "adam@brand.pk", "admin");
    const adam = await person("adam@brand.pk");
    await call("POST", "/v1/invitations/accept", adam.h, { token: tokenOf(adminInv.acceptUrl) });
    const asAdam = { ...adam.h, "x-workspace-id": owner.workspaceId };
    expect((await call("POST", "/v1/workspace/invitations", asAdam, { email: "x@brand.pk", role: "admin" })).statusCode).toBe(403);
    const memberInv = await invite(asAdam, "mona@brand.pk");
    expect((await call("DELETE", `/v1/workspace/invitations/${memberInv.id}`, owner.h)).statusCode).toBe(204);
    const mona = await person("mona@brand.pk");
    expect((await call("POST", "/v1/invitations/accept", mona.h, { token: tokenOf(memberInv.acceptUrl) })).statusCode).toBe(403);
    const again = await invite(owner.h, "mona@brand.pk");
    await call("POST", "/v1/invitations/accept", mona.h, { token: tokenOf(again.acceptUrl) });
    expect((await call("POST", "/v1/workspace/invitations", { ...mona.h, "x-workspace-id": owner.workspaceId }, { email: "y@brand.pk" })).statusCode).toBe(403);
    expect(((await call("GET", "/v1/workspace/invitations", owner.h)).json().invitations as { status: string }[]).map((i) => i.status).sort()).toEqual(["accepted", "accepted", "revoked"]);
  });
});

describe("trusted email verification (audit SEC-03)", () => {
  it("cannot accept when the Auth server's email differs from the token's, or when no Auth admin access is configured", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    const token = tokenOf((await invite(owner.h, "sara@agency.pk")).acceptUrl);
    const sara = await person("sara@agency.pk");
    authRecords.set(sara.sub, { email: "someone.else@agency.pk", confirmed: true }); // the account's confirmed address is another one
    expect((await call("POST", "/v1/invitations/accept", sara.h, { token })).json().error.details).toMatchObject({ reason: "email_unverified" });

    const noAdmin = await setup({ verify: null });
    const o2 = await noAdmin.person("owner2@brand.pk");
    const t2 = noAdmin.tokenOf((await noAdmin.invite(o2.h, "mona@brand.pk")).acceptUrl);
    const mona = await noAdmin.person("mona@brand.pk");
    expect((await noAdmin.call("POST", "/v1/invitations/accept", mona.h, { token: t2 })).json().error.details).toMatchObject({ reason: "email_check_unavailable" });
  });
});

describe("member roles, removal and ownership", () => {
  it("enforces who may change roles, remove people, leave and transfer ownership", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    const join = async (email: string, role = "member") => {
      const p = await person(email);
      await call("POST", "/v1/invitations/accept", p.h, { token: tokenOf((await invite(owner.h, email, role)).acceptUrl) });
      return { ...p, inWs: { ...p.h, "x-workspace-id": owner.workspaceId } };
    };
    const [adam, mona, max] = [await join("adam@brand.pk", "admin"), await join("mona@brand.pk"), await join("max@brand.pk")];
    expect((await call("PATCH", `/v1/workspace/members/${mona.userId}`, adam.inWs, { role: "admin" })).statusCode).toBe(403); // only the owner changes roles
    expect((await call("PATCH", `/v1/workspace/members/${owner.userId}`, owner.h, { role: "member" })).statusCode).toBe(409);
    expect((await call("PATCH", `/v1/workspace/members/${mona.userId}`, owner.h, { role: "admin" })).statusCode).toBe(204);
    expect((await call("DELETE", `/v1/workspace/members/${mona.userId}`, adam.inWs)).statusCode).toBe(403); // admins remove members only
    expect((await call("DELETE", `/v1/workspace/members/${max.userId}`, mona.inWs)).statusCode).toBe(204);
    expect((await call("GET", "/v1/me", max.inWs)).json().error.details).toMatchObject({ reason: "workspace_access_denied" }); // removed: refused, not redirected
    expect((await call("POST", "/v1/workspace/invitations", max.inWs, { email: "z@brand.pk" })).statusCode).toBe(403); // no write lands anywhere
    expect((await call("DELETE", `/v1/workspace/members/${owner.userId}`, owner.h)).statusCode).toBe(409); // the owner cannot leave
    expect((await call("DELETE", `/v1/workspace/members/${adam.userId}`, adam.inWs)).statusCode).toBe(204); // anyone else may leave
    expect((await call("POST", "/v1/workspace/transfer-ownership", mona.inWs, { userId: mona.userId })).statusCode).toBe(403);
    expect((await call("POST", "/v1/workspace/transfer-ownership", owner.h, { userId: mona.userId })).statusCode).toBe(204);
    expect((await call("GET", "/v1/me", mona.inWs)).json().workspace.role).toBe("owner");
    expect((await call("GET", "/v1/me", owner.h)).json().workspace).toMatchObject({ id: owner.workspaceId, role: "admin" });
    const [w] = await ownerQuery<{ owner_user_id: string }>(`select owner_user_id from wp.workspaces where id = '${owner.workspaceId}'`);
    expect(w?.owner_user_id).toBe(mona.userId);
  });
});

describe("privacy self-service", () => {
  it("exports the workspace's own data to owners and admins, without staff notes or contact values", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    await ownerQuery(`insert into wp.lists (workspace_id, name, created_by) values ('${owner.workspaceId}', 'Eid shortlist', '${owner.userId}')`);
    const t = randomUUID();
    await ownerQuery(`insert into wp.support_tickets (id, workspace_id, created_by, subject, category) values ('${t}', '${owner.workspaceId}', '${owner.userId}', 'Help', 'other')`);
    await ownerQuery(`insert into staff.staff_users (id, email, name, role, password_hash, totp_secret_encrypted) values ('${randomUUID()}', 's@mushin.pk', 'S', 'support', 'x', 'x')`);
    const [s] = await ownerQuery<{ id: string }>(`select id from staff.staff_users limit 1`);
    await ownerQuery(`insert into wp.support_messages (ticket_id, workspace_id, author_kind, author_user_id, body) values ('${t}', '${owner.workspaceId}', 'customer', '${owner.userId}', 'Please help')`);
    await ownerQuery(`insert into wp.support_messages (ticket_id, workspace_id, author_kind, author_staff_id, body) values ('${t}', '${owner.workspaceId}', 'internal', '${s?.id}', 'Staff-only remark')`);
    const res = await call("GET", "/v1/workspace/export", owner.h);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="mushin-workspace-export-/);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const data = res.json();
    expect(data).toMatchObject({ format: "mushin.workspace-export.v1", workspace: { id: owner.workspaceId } });
    expect(data.tables.lists.map((l: { name: string }) => l.name)).toEqual(["Eid shortlist"]);
    expect(data.tables.members).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("Staff-only remark");
    const mona = await person("mona@brand.pk");
    await call("POST", "/v1/invitations/accept", mona.h, { token: tokenOf((await invite(owner.h, "mona@brand.pk")).acceptUrl) });
    expect((await call("GET", "/v1/workspace/export", { ...mona.h, "x-workspace-id": owner.workspaceId })).statusCode).toBe(403);
  });

  it("deletes a workspace only for its owner, with the name typed, nothing paid or running; content goes, billing records stay", async () => {
    const { call, person, invite, tokenOf, erased } = await setup();
    const owner = await person("owner@brand.pk");
    const mona = await person("mona@brand.pk");
    await call("POST", "/v1/invitations/accept", mona.h, { token: tokenOf((await invite(owner.h, "mona@brand.pk")).acceptUrl) });
    await ownerQuery(`insert into wp.lists (workspace_id, name, created_by) values ('${owner.workspaceId}', 'Eid shortlist', '${owner.userId}')`);
    const inWs = { ...mona.h, "x-workspace-id": owner.workspaceId };
    expect((await call("POST", "/v1/workspace/delete", inWs, { confirmName: "x" })).statusCode).toBe(403);
    expect((await call("POST", "/v1/workspace/delete", owner.h, { confirmName: "wrong" })).statusCode).toBe(400);
    const name = (await call("GET", "/v1/me", owner.h)).json().workspace.name as string;
    await ownerQuery(`update wp.subscriptions set status = 'active' where workspace_id = '${owner.workspaceId}'`);
    expect((await call("POST", "/v1/workspace/delete", owner.h, { confirmName: name })).json().error.details).toMatchObject({ reason: "subscription_active" });
    await ownerQuery(`update wp.subscriptions set status = 'canceled' where workspace_id = '${owner.workspaceId}'`);
    const done = (await call("POST", "/v1/workspace/delete", owner.h, { confirmName: name })).json();
    expect(done).toMatchObject({ deleted: true, retained: expect.arrayContaining([expect.stringMatching(/Billing records/)]) });
    expect(erased).toEqual([owner.workspaceId]);
    expect(await ownerQuery(`select 1 from wp.lists where workspace_id = '${owner.workspaceId}'`)).toEqual([]);
    expect((await ownerQuery(`select count(*)::int n from wp.credit_ledger where workspace_id = '${owner.workspaceId}'`))[0]).toMatchObject({ n: expect.any(Number) });
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_ledger where workspace_id = '${owner.workspaceId}'`))[0]?.n).toBeGreaterThan(0); // trial grant kept
    expect((await ownerQuery<{ status: string }>(`select status from wp.workspaces where id = '${owner.workspaceId}'`))[0]?.status).toBe("deleted");
    // Former members cannot enter it any more, and are not redirected to another workspace either.
    expect((await call("GET", "/v1/me", inWs)).json().error.details).toMatchObject({ reason: "workspace_access_denied" });
    // The owner's next sign-in provisions a fresh workspace, but not a second free trial (regression: 0036).
    const fresh = (await call("GET", "/v1/me", owner.h)).json().workspace.id as string;
    expect(fresh).not.toBe(owner.workspaceId);
    expect(await ownerQuery(`select 1 from wp.subscriptions where workspace_id = '${fresh}'`)).toEqual([]);
    expect(await ownerQuery(`select 1 from wp.credit_lots where workspace_id = '${fresh}'`)).toEqual([]);
  });

  it("gives a person who only ever joined by invitation their own trial once, and only once", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    const mona = await person("mona@brand.pk");
    await call("POST", "/v1/invitations/accept", mona.h, { token: tokenOf((await invite(owner.h, "mona@brand.pk")).acceptUrl) });
    const trials = async () => (await ownerQuery<{ n: number }>(`select count(*)::int n from wp.subscriptions s join wp.workspaces w on w.id = s.workspace_id where w.owner_user_id = '${mona.userId}'`))[0]?.n;
    expect(await trials()).toBe(1); // their first own workspace
    const name = (await call("GET", "/v1/me", mona.h)).json().workspace.name as string;
    expect((await call("POST", "/v1/workspace/delete", mona.h, { confirmName: name })).statusCode).toBe(200);
    // Leaving the last workspace too means the next request provisions a new one of their own: it gets no trial.
    expect((await call("DELETE", `/v1/workspace/members/${mona.userId}`, { ...mona.h, "x-workspace-id": owner.workspaceId })).statusCode).toBe(204);
    const fresh = (await call("GET", "/v1/me", mona.h)).json().workspace as { id: string; role: string };
    expect(fresh.role).toBe("owner");
    expect(fresh.id).not.toBe(mona.workspaceId);
    expect(await trials()).toBe(1);
  });

  it("erases every workspace table except the billing records that are kept on purpose", async () => {
    // A table added later with a workspace_id must be erased or deliberately kept; this fails until it is one or the other.
    const kept = ["checkouts", "credit_ledger", "credit_lots", "credit_reservations", "entitlement_usage", "payment_adjustments", "payments", "subscriptions"];
    const tables = (await ownerQuery<{ t: string }>(`select table_name t from information_schema.columns where table_schema = 'wp' and column_name = 'workspace_id' and table_name in (select table_name from information_schema.tables where table_schema = 'wp' and table_type = 'BASE TABLE')`)).map((r) => r.t);
    const [fn] = await ownerQuery<{ src: string }>(`select prosrc src from pg_proc where proname = 'erase_workspace'`);
    expect(tables.filter((t) => !kept.includes(t) && !fn?.src.includes(`'${t}'`)).sort()).toEqual([]);
  });

  it("deletes an account only once shared workspaces have a new owner; the account then stays deleted", async () => {
    const { call, person, invite, tokenOf } = await setup();
    const owner = await person("owner@brand.pk");
    const mona = await person("mona@brand.pk");
    await call("POST", "/v1/invitations/accept", mona.h, { token: tokenOf((await invite(owner.h, "mona@brand.pk")).acceptUrl) });
    expect((await call("POST", "/v1/me/delete", owner.h, { confirmEmail: "nope@brand.pk" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/me/delete", owner.h, { confirmEmail: "owner@brand.pk" })).json().error.details).toMatchObject({ reason: "owner_of_shared_workspace" });
    await call("POST", "/v1/workspace/transfer-ownership", owner.h, { userId: mona.userId });
    const res = (await call("POST", "/v1/me/delete", owner.h, { confirmEmail: "owner@brand.pk" })).json();
    expect(res).toMatchObject({ deleted: true, identityProviderAccount: "not_deleted_requires_provider" });
    const [u] = await ownerQuery<{ email: string; status: string; display_name: string | null }>(`select email, status, display_name from wp.users where id = '${owner.userId}'`);
    expect(u).toEqual({ email: `deleted+${owner.userId}@invalid`, status: "deleted", display_name: null });
    expect((await call("GET", "/v1/me", owner.h)).json().error.details).toMatchObject({ reason: "account_deleted" });
    expect((await call("GET", "/v1/me", { ...mona.h, "x-workspace-id": owner.workspaceId })).json().workspace).toMatchObject({ id: owner.workspaceId, role: "owner" });
  });
});
