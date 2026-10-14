import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { addCreator } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createListsModule, createListsService } from "./index";

const db = createTestDatabase();
const lists = createListsService({ db });
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}

describe("lists", () => {
  it("creates, renames, favourites and deletes a list; names are unique per workspace", async () => {
    const c = await customer();
    const made = await lists.create(c, { name: "Bridal Lahore", description: "Q3 shortlist" });
    expect(made).toMatchObject({ name: "Bridal Lahore", description: "Q3 shortlist", count: 0, favorite: false, preview: [] });
    await expect(lists.create(c, { name: "  bridal lahore ", description: "" })).rejects.toMatchObject({ code: "CONFLICT" });
    // Another workspace may use the same name.
    await lists.create(await customer(), { name: "Bridal Lahore", description: "" });
    const renamed = await lists.update(c, made.id, { name: "Bridal Lahore Q3", favorite: true });
    expect(renamed).toMatchObject({ name: "Bridal Lahore Q3", favorite: true });
    expect((await lists.index(c)).lists.map((l) => l.name)).toEqual(["Bridal Lahore Q3"]);
    await lists.remove(c, made.id);
    expect((await lists.index(c)).lists).toEqual([]);
    await expect(lists.remove(c, made.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves creators once, keeps notes, removes them, and shows them as search cards without contacts", async () => {
    const c = await customer();
    const a = await addCreator(db, { displayName: "Sana Bridal" });
    const b = await addCreator(db, { displayName: "Hina Bridal" });
    const list = await lists.create(c, { name: "Shortlist", description: "" });
    expect(await lists.addMembers(c, list.id, [a, b, a])).toEqual({ added: 2, alreadyOnList: 0 });
    expect(await lists.addMembers(c, list.id, [a])).toEqual({ added: 0, alreadyOnList: 1 });
    await lists.setNote(c, list.id, a, "Great bridal portfolio");
    const detail = await lists.detail(c, list.id);
    expect(detail.count).toBe(2);
    expect(detail.preview).toHaveLength(2);
    expect(detail.members.map((m) => m.creator.displayName).sort()).toEqual(["Hina Bridal", "Sana Bridal"]);
    expect(detail.members.find((m) => m.creator.id === a)?.note).toBe("Great bridal portfolio");
    expect(JSON.stringify(detail)).not.toMatch(/"(email|phone|value)"/);
    expect((await lists.index(c, a)).lists[0]?.containsCreator).toBe(true);
    expect(await lists.removeMembers(c, list.id, [a])).toEqual({ removed: 1 });
    expect((await lists.index(c, a)).lists[0]?.containsCreator).toBe(false);
    await expect(lists.setNote(c, list.id, a, "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps lists private to the workspace (AUTH-001)", async () => {
    const owner = await customer();
    const other = await customer();
    const creator = await addCreator(db);
    const list = await lists.create(owner, { name: "Private", description: "" });
    await lists.addMembers(owner, list.id, [creator]);
    expect((await lists.index(other)).lists).toEqual([]);
    await expect(lists.detail(other, list.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lists.update(other, list.id, { name: "Hijacked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lists.addMembers(other, list.id, [creator])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lists.removeMembers(other, list.id, [creator])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lists.remove(other, list.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Even a raw query under the other workspace's RLS context sees no rows.
    expect(await db.withTenant(other, (tx) => tx.execute(`select * from wp.list_members`))).toHaveLength(0);
    expect((await lists.detail(owner, list.id)).count).toBe(1);
  });

  it("refuses hidden or unknown creators, hides a creator hidden later, and erasure removes the membership (PRIV-001)", async () => {
    const c = await customer();
    const shown = await addCreator(db);
    const minor = await addCreator(db, { isMinor: true });
    const list = await lists.create(c, { name: "Mixed", description: "" });
    await expect(lists.addMembers(c, list.id, [shown, minor])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(lists.addMembers(c, list.id, [randomUUID()])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await lists.addMembers(c, list.id, [shown]);
    await ownerQuery(`update gcp.creators set status = 'removal_requested' where id = '${shown}'`);
    expect(await lists.detail(c, list.id)).toMatchObject({ count: 0, members: [], preview: [] });
    await ownerQuery(`select platform.erase_creator_workspace_rows('${shown}', array[]::text[])`);
    expect(await ownerQuery(`select 1 from wp.list_members where creator_id = '${shown}'`)).toHaveLength(0);
  });
});

describe("lists API", () => {
  it("requires sign-in and validates input", async () => {
    const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
    const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger: createLogger({ level: "silent" }) });
    const identity = createIdentityModule({ db, startTrial: billing.startTrial });
    const platform = createPlatformModule({ db, ttlHours: 24 });
    const big = { limit: 1000, windowSeconds: 60 };
    const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big });
    const iss = await createTestIssuer();
    const app = await buildTestApp({
      guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
      modules: [platform.module, identity.module, createListsModule({ service: lists })],
    });
    const auth = { authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email: "owner@mushin.pk", fullName: "Owner" })}` };
    expect((await app.inject({ method: "GET", url: "/v1/lists" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/lists", headers: auth, payload: { name: "" } })).statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/v1/lists", headers: auth, payload: { name: "Food Karachi" } });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect((await app.inject({ method: "PATCH", url: `/v1/lists/${id}`, headers: auth, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/lists/${id}/members`, headers: auth, payload: { creatorIds: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/v1/lists/${id}`, headers: auth })).json()).toMatchObject({ name: "Food Karachi", members: [] });
    expect((await app.inject({ method: "GET", url: "/v1/lists/not-a-uuid", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/v1/lists/${id}`, headers: auth })).statusCode).toBe(204);
  });
});
