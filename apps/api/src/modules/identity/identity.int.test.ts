import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier, type CustomerIdentity } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp, noGuards } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createCreditEngine } from "../billing/index";
import { createIdentityModule } from "./index";

const db = createTestDatabase();
const identity = createIdentityModule({ db, startTrial: createCreditEngine().startTrial });
const person = (over: Partial<CustomerIdentity> = {}): CustomerIdentity => ({
  userId: randomUUID(),
  email: "ayesha@mushin.pk",
  fullName: "Ayesha Malik",
  ...over,
});

beforeEach(resetTables);
afterAll(() => db.close());

describe("identity provisioning", () => {
  it("starts the 14-day, 200-credit trial in the same transaction, once", async () => {
    const who = person();
    await Promise.all([identity.resolveTenant(who, "a"), identity.resolveTenant(who, "b"), identity.resolveTenant(who, "c")]);
    const rows = await ownerQuery<{ status: string; days: number; lots: number; credits: number }>(`
      select s.status, round(extract(epoch from (s.trial_ends_at - s.created_at)) / 86400)::int as days,
             (select count(*)::int from wp.credit_lots) as lots, (select sum(remaining)::int from wp.credit_lots) as credits
      from wp.subscriptions s`);
    expect(rows).toEqual([{ status: "trialing", days: 14, lots: 1, credits: 200 }]);
  });

  it("creates user, workspace and owner membership on first request, then reuses them", async () => {
    const who = person();
    const first = await identity.resolveTenant(who, "req-1");
    expect(first).toMatchObject({ requestId: "req-1", userId: who.userId, role: "owner" });
    const second = await identity.resolveTenant(who, "req-2");
    expect(second.workspaceId).toBe(first.workspaceId);
    const counts = await ownerQuery<{ u: number; w: number; m: number; name: string }>(`
      select (select count(*)::int from wp.users) u, (select count(*)::int from wp.workspaces) w,
             (select count(*)::int from wp.workspace_members) m, (select name from wp.workspaces limit 1) name`);
    expect(counts[0]).toEqual({ u: 1, w: 1, m: 1, name: "Ayesha Malik's workspace" });
  });

  it("creates exactly one workspace under concurrent first requests (Review Focus 2)", async () => {
    const who = person();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => identity.resolveTenant(who, `r${i}`)));
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
    const rows = await ownerQuery<{ w: number; m: number }>(
      `select (select count(*)::int from wp.workspaces) w, (select count(*)::int from wp.workspace_members) m`,
    );
    expect(rows[0]).toEqual({ w: 1, m: 1 });
  });

  it("names the workspace from the email when there is no full name", async () => {
    await identity.resolveTenant(person({ fullName: null, email: "bilal@brand.pk" }), "r");
    const rows = await ownerQuery<{ name: string }>(`select name from wp.workspaces`);
    expect(rows[0]?.name).toBe("bilal's workspace");
  });

  it("keeps one user from reading another user's workspace", async () => {
    const a = await identity.resolveTenant(person(), "a");
    const b = await identity.resolveTenant(person({ email: "b@b.pk" }), "b");
    const seen = await db.withTenant(a, (tx) => tx.execute<{ id: string }>(sql`select id from wp.workspaces`));
    expect(seen.map((r) => r.id)).toEqual([a.workspaceId]);
    expect(b.workspaceId).not.toBe(a.workspaceId);
  });
});

describe("GET /v1/me", () => {
  it("returns the signed-in user's profile and workspace, ignoring client-supplied workspace ids", async () => {
    const iss = await createTestIssuer();
    const guard = createCustomerGuard({
      verify: createCustomerTokenVerifier({ issuer: iss.issuer, audience: iss.audience, keys: iss.keys }),
      resolveTenant: identity.resolveTenant,
      limiter: new MemoryRateLimiter({
        ip: { limit: 100, windowSeconds: 60 },
        user: { limit: 100, windowSeconds: 60 },
        auth: { limit: 100, windowSeconds: 60 },
        ai: { limit: 100, windowSeconds: 60 },
        jobs: { limit: 100, windowSeconds: 3600 }, workspaceJobs: { limit: 100_000, windowSeconds: 3600 },
      }),
    });
    const app = await buildTestApp({ guards: { ...noGuards(), customer: guard }, modules: [identity.module] });
    const sub = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${await iss.sign({ sub, email: "sana@mushin.pk", fullName: "Sana Riaz" })}`, "x-workspace-id": randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({ id: sub, email: "sana@mushin.pk", displayName: "Sana Riaz", avatarUrl: null });
    expect(body.workspace).toMatchObject({ name: "Sana Riaz's workspace", role: "owner" });

    expect((await app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
  });
});
