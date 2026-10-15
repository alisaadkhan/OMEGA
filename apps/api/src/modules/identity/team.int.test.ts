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
import { createIdentityModule } from "./index";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

type H = Record<string, string>;
async function setup() {
  const logger = createLogger({ level: "silent" });
  const billing = createBillingService({ db, payments: new MockPayments({ webhookSecret: "t".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} }), cache: new MemoryAccessCache(), logger });
  const erased: string[] = [];
  const identity = createIdentityModule({ db, startTrial: billing.startTrial, appUrl: "https://app.mushin.test", onWorkspaceErased: async (id) => void erased.push(id) });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter: new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big }) }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module],
  });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: H, payload?: object) => app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });
  const person = async (email: string, o: { emailVerified?: boolean; sub?: string } = {}) => {
    const sub = o.sub ?? randomUUID();
    const h = { authorization: `Bearer ${await iss.sign({ sub, email, fullName: email.split("@")[0] ?? "x", ...(o.emailVerified === undefined ? {} : { emailVerified: o.emailVerified }) })}` };
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
    const unverified = await person("sara@agency.pk", { emailVerified: false });
    expect((await call("POST", "/v1/invitations/accept", unverified.h, { token })).json().error.details).toMatchObject({ reason: "email_unverified" });

    const sara = await person("sara@agency.pk", { sub: unverified.sub }); // same account, email now confirmed
    expect((await call("POST", "/v1/invitations/preview", sara.h, { token })).json()).toMatchObject({ role: "member", status: "pending" });
    expect((await call("POST", "/v1/invitations/accept", sara.h, { token })).json()).toEqual({ workspaceId: owner.workspaceId, role: "member" });
    expect((await call("POST", "/v1/invitations/accept", sara.h, { token })).statusCode).toBe(403); // used once

    const mine = (await call("GET", "/v1/me/workspaces", sara.h)).json().workspaces as { id: string; role: string }[];
    expect(mine.map((w) => [w.id, w.role])).toEqual([[sara.workspaceId, "owner"], [owner.workspaceId, "member"]]);
    expect((await call("GET", "/v1/me", { ...sara.h, "x-workspace-id": owner.workspaceId })).json().workspace).toMatchObject({ id: owner.workspaceId, role: "member" });
    // A workspace the person does not belong to is ignored, never entered.
    expect((await call("GET", "/v1/me", { ...stranger.h, "x-workspace-id": owner.workspaceId })).json().workspace.id).toBe(stranger.workspaceId);
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
    expect((await call("GET", "/v1/me", max.inWs)).json().workspace.id).toBe(max.workspaceId); // removed: back in own workspace
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
    // Former members cannot enter it any more; they land in their own workspace.
    expect((await call("GET", "/v1/me", inWs)).json().workspace.id).toBe(mona.workspaceId);
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
