import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../auth/customer-guard";
import { createCustomerTokenVerifier } from "../auth/customer-token";
import { createBillingService, MemoryAccessCache } from "./billing/index";
import { createCampaignsModule, createCampaignsService } from "./campaigns/index";
import { addIndexedCreator } from "./creators/test-fixtures";
import { createIdentityModule } from "./identity/index";
import { createListsModule, createListsService } from "./lists/index";
import { createPlatformModule } from "./platform/index";
import { MemoryRateLimiter } from "../rate-limit/memory";
import { buildTestApp } from "../test-support/app";
import { createTestIssuer } from "../test-support/keys";

// API security checks against the real app (OWASP API Security Top 10 risks this API can exhibit): object-level
// authorization across workspaces (API1), property-level / mass assignment (API3), function-level authorization by
// workspace role (API5), injection-shaped input, error detail leakage and response headers.
const db = createTestDatabase();
let app: FastifyInstance;
let sign: (sub: string, email: string) => Promise<string>;

beforeAll(async () => {
  const logger = createLogger({ level: "silent" });
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big });
  const iss = await createTestIssuer();
  sign = (sub, email) => iss.sign({ sub, email, fullName: email.split("@")[0] ?? "x" });
  app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [
      platform.module,
      identity.module,
      createListsModule({ service: createListsService({ db }) }),
      createCampaignsModule({ service: createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) }) }),
    ],
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});
beforeEach(resetTables);

async function user(email: string) {
  const headers = { authorization: `Bearer ${await sign(randomUUID(), email)}` };
  const me = (await app.inject({ method: "GET", url: "/v1/me", headers })).json() as { workspace: { id: string } };
  return { headers, workspaceId: me.workspace.id };
}

describe("API security", () => {
  it("API1: another workspace's lists and campaigns are invisible and untouchable (404, never 403 that confirms existence)", async () => {
    const a = await user("a@brand.pk");
    const b = await user("b@brand.pk");
    const creator = await addIndexedCreator(db);
    const list = (await app.inject({ method: "POST", url: "/v1/lists", headers: a.headers, payload: { name: "A only" } })).json() as { id: string };
    const camp = (await app.inject({ method: "POST", url: "/v1/campaigns", headers: a.headers, payload: { name: "A camp", status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } })).json() as { id: string };
    for (const [method, url, payload] of [
      ["GET", `/v1/lists/${list.id}`, undefined],
      ["PATCH", `/v1/lists/${list.id}`, { name: "taken over" }],
      ["DELETE", `/v1/lists/${list.id}`, undefined],
      ["POST", `/v1/lists/${list.id}/members`, { creatorIds: [creator] }],
      ["GET", `/v1/campaigns/${camp.id}`, undefined],
      ["PATCH", `/v1/campaigns/${camp.id}`, { name: "taken over" }],
      ["DELETE", `/v1/campaigns/${camp.id}`, undefined],
      ["POST", `/v1/campaigns/${camp.id}/creators`, { creatorIds: [creator] }],
    ] as const) {
      const r = await app.inject({ method, url, headers: b.headers, ...(payload ? { payload } : {}) });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await ownerQuery<{ name: string }>(`select name from wp.lists where id = '${list.id}'`))[0]?.name).toBe("A only");
  });

  it("API3: extra properties cannot set fields the endpoint does not own (mass assignment)", async () => {
    const a = await user("owner@brand.pk");
    const before = await ownerQuery<{ email: string; balance: string }>(`select u.email, (select coalesce(sum(remaining), 0) from wp.credit_lots l where l.workspace_id = '${a.workspaceId}')::text as balance from wp.users u where u.email = 'owner@brand.pk'`);
    const otherWs = randomUUID();
    const r1 = await app.inject({ method: "PATCH", url: "/v1/workspace", headers: a.headers, payload: { name: "Renamed", id: otherWs, plan: "scale", credits: 999_999, ownerId: randomUUID() } });
    const r2 = await app.inject({ method: "PATCH", url: "/v1/me", headers: a.headers, payload: { displayName: "New Name", email: "attacker@evil.test", role: "owner", id: randomUUID() } });
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const after = await ownerQuery<{ email: string; balance: string }>(`select u.email, (select coalesce(sum(remaining), 0) from wp.credit_lots l where l.workspace_id = '${a.workspaceId}')::text as balance from wp.users u where u.display_name = 'New Name'`);
    expect(after).toEqual(before);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int as n from wp.workspaces where id = '${otherWs}'`))[0]?.n).toBe(0);
    expect((await ownerQuery<{ name: string }>(`select name from wp.workspaces where id = '${a.workspaceId}'`))[0]?.name).toBe("Renamed");
  });

  it("API5: a member cannot use owner/admin functions", async () => {
    const owner = await user("boss@brand.pk");
    const memberSub = randomUUID();
    await ownerQuery(`insert into wp.users (id, email, display_name) values ('${memberSub}', 'member@brand.pk', 'Member')`);
    await ownerQuery(`insert into wp.workspace_members (workspace_id, user_id, role) values ('${owner.workspaceId}', '${memberSub}', 'member')`);
    const member = { authorization: `Bearer ${await sign(memberSub, "member@brand.pk")}` };
    expect((await app.inject({ method: "PATCH", url: "/v1/workspace", headers: member, payload: { name: "Member rename" } })).statusCode).toBe(403);
  });

  it("treats injection-shaped input as data and never leaks internals in errors", async () => {
    const a = await user("inj@brand.pk");
    const nasty = "x'); drop table wp.lists; --";
    const r = await app.inject({ method: "POST", url: "/v1/lists", headers: a.headers, payload: { name: nasty } });
    expect(r.statusCode).toBe(201);
    expect((await ownerQuery<{ name: string }>(`select name from wp.lists where workspace_id = '${a.workspaceId}'`))[0]?.name).toBe(nasty);
    const bad = await app.inject({ method: "GET", url: "/v1/lists/not-a-uuid", headers: a.headers });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);
    const body = bad.body;
    expect(body).not.toMatch(/stack|at \w+ \(|node_modules|select |postgres|drizzle/i);
    expect(Object.keys((bad.json() as { error: Record<string, unknown> }).error).sort()).toEqual(expect.arrayContaining(["code", "message", "requestId"]));
  });

  it("sends protective headers and keeps API responses out of shared caches", async () => {
    const a = await user("hdr@brand.pk");
    const r = await app.inject({ method: "GET", url: "/v1/lists", headers: a.headers });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBeDefined();
    expect(String(r.headers["cache-control"])).toMatch(/private/);
    expect(String(r.headers["cache-control"])).toMatch(/no-store/);
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
});
