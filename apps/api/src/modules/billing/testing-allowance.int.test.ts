/**
 * Monthly testing allowance (0061, owner instruction 2026-10-27): 500 credits for a new account's first workspace each
 * Asia/Karachi calendar month, granted exactly once per month, lapsing at the month's end, never touching paid credits.
 * Every assertion reads the ledger and lots in the database, not only the summary.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createIdentityService } from "../identity/index";
import { MemoryAccessCache } from "./access-cache";
import { createBillingService } from "./service";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(async () => {
  await ownerQuery(`update platform.billing_settings set testing_monthly_credits = 500`);
  await db.close();
});

let clock = new Date("2026-10-27T10:00:00Z");
const cache = new MemoryAccessCache();
const payments = new MockPayments({ webhookSecret: "t".repeat(40), publicApiUrl: "http://api.test", now: () => clock, deliver: async () => {} });
const billing = createBillingService({ db, payments, cache, logger: createLogger({ level: "silent" }), now: () => clock });
// The Auth server's record of confirmed emails (owner decision 2026-10-28: the allowance needs a verified email).
const unverified = new Set<string>();
let authDown = false;
const verifyEmail = async (userId: string) => {
  if (authDown) throw new Error("auth admin unavailable");
  return { email: "x@test.mushin.pk", confirmed: !unverified.has(userId) };
};
const identity = createIdentityService(db, null, billing.startTestingAllowance, verifyEmail);
beforeEach(async () => {
  clock = new Date("2026-10-27T10:00:00Z");
  cache.entries.clear();
  unverified.clear();
  authDown = false;
  await ownerQuery(`update platform.billing_settings set testing_monthly_credits = 500`);
});

const person = () => ({ userId: randomUUID(), email: `t-${randomUUID().slice(0, 6)}@test.mushin.pk`, fullName: "Test Person" });
const ctxOf = (userId: string, workspaceId: string): TenantContext => ({ userId, workspaceId, requestId: "req", role: "owner" });
const grants = (ws: string) => ownerQuery<{ source_ref: string; amount: number }>(`select source_ref, amount from wp.credit_ledger where workspace_id = '${ws}' and kind = 'grant' order by created_at`);
const lots = (ws: string) => ownerQuery<{ source: string; amount: number; remaining: number; expires_at: string | null }>(`select source, amount, remaining, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '+00' expires_at from wp.credit_lots where workspace_id = '${ws}' order by created_at`);
const reconcile = (ws: string) => db.withWorkspace(ws, (tx) => billing.engine.reconcile(tx, ws));
const spend = (c: TenantContext, action: "search_existing" | "reveal_contact" | "find_new" | "refresh_data", cost: number) =>
  db.withTenant(c, (tx) => billing.engine.spendInstant(tx, c.workspaceId, { action, confirmedCost: cost, refType: "test", refId: randomUUID() }, { userId: c.userId, requestId: "req" }));
const costs = async () => (await ownerQuery<{ action: string; credits: number }>(`select action, credits from platform.credit_action_costs`)).reduce<Record<string, number>>((m, r) => ((m[r.action] = r.credits), m), {});

async function signUp() {
  const id = person();
  const t = await identity.resolveTenant(id, "req");
  return { ...t, id };
}

describe("monthly testing allowance (TA)", () => {
  it("TA-01 a new account's first workspace receives 500 credits for this Karachi month, expiring at 00:00 PKT on the 1st", async () => {
    const t = await signUp();
    expect(await grants(t.workspaceId)).toEqual([{ source_ref: `testing:${t.workspaceId}:2026-10`, amount: 500 }]);
    expect(await lots(t.workspaceId)).toEqual([{ source: "testing", amount: 500, remaining: 500, expires_at: "2026-10-31 19:00:00+00" }]);
    const s = await billing.summary(ctxOf(t.userId, t.workspaceId));
    expect(s.balance.available).toBe(500);
    expect(s.testingAllowance).toEqual({ monthlyCredits: 500, remaining: 500, renewsAt: "2026-10-31T19:00:00.000Z", actions: ["search_existing", "reveal_contact"] });
    expect(await ownerQuery(`select job, to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '+00' due_at from platform.billing_schedule where workspace_id = '${t.workspaceId}' and job = 'testing_allowance'`)).toEqual([{ job: "testing_allowance", due_at: "2026-10-31 19:00:00+00" }]);
  });

  it("TA-02 a retried and a concurrent first sign-in create one workspace and one grant", async () => {
    const id = person();
    const all = await Promise.all(Array.from({ length: 6 }, () => identity.resolveTenant(id, "req")));
    const again = await identity.resolveTenant(id, "req");
    expect(new Set([...all, again].map((x) => x.workspaceId)).size).toBe(1);
    expect(await grants(again.workspaceId)).toHaveLength(1);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.workspaces where owner_user_id = '${id.userId}'`))[0]?.n).toBe(1);
  });

  it("TA-03 one allowance per person: an invited member's or a later workspace gets none", async () => {
    const t = await signUp();
    // The same person, later in a workspace provisioned again (e.g. after leaving the first): the claim is spent.
    await ownerQuery(`delete from wp.workspace_members where user_id = '${t.userId}'`);
    const second = await identity.resolveTenant(t.id, "req");
    expect(second.workspaceId).not.toBe(t.workspaceId);
    expect(await grants(second.workspaceId)).toEqual([]);
    // An invited member joins an existing workspace: no provisioning, no grant.
    const ws = await createTestWorkspace();
    await ownerQuery(`insert into wp.workspace_members (workspace_id, user_id, role) values ('${ws.workspaceId}', '${t.userId}', 'member')`);
    expect(await grants(ws.workspaceId)).toEqual([]);
  });

  it("TA-04 duplicate and concurrent monthly jobs grant each month once", async () => {
    const t = await signUp();
    clock = new Date("2026-10-31T19:00:00Z"); // 00:00 PKT, 1 November
    await Promise.all([billing.runJob("testing_allowance"), billing.runJob("testing_allowance"), db.withWorkspace(t.workspaceId, (tx) => billing.startTestingAllowance(tx, t.workspaceId))]);
    await billing.runJob("testing_allowance");
    expect((await grants(t.workspaceId)).map((g) => g.source_ref)).toEqual([`testing:${t.workspaceId}:2026-10`, `testing:${t.workspaceId}:2026-11`]);
    expect(await reconcile(t.workspaceId)).toEqual([]);
  });

  it("TA-05 at 00:00 PKT on the 1st unused credits lapse and the balance resets to 500, not 1,000", async () => {
    const t = await signUp();
    const c = ctxOf(t.userId, t.workspaceId);
    await spend(c, "search_existing", (await costs())["search_existing"] as number);
    clock = new Date("2026-10-31T18:59:59Z");
    await billing.runJob("testing_allowance");
    expect(await grants(t.workspaceId)).toHaveLength(1);
    clock = new Date("2026-10-31T19:00:00Z");
    await billing.runJob("expire_lots");
    await billing.runJob("testing_allowance");
    const ledger = await ownerQuery<{ kind: string; amount: number }>(`select kind, amount from wp.credit_ledger where workspace_id = '${t.workspaceId}' and kind in ('grant', 'expire') order by created_at`);
    expect(ledger).toEqual([{ kind: "grant", amount: 500 }, { kind: "expire", amount: -450 }, { kind: "grant", amount: 500 }]);
    expect((await billing.summary(c)).balance.available).toBe(500);
    expect(await reconcile(t.workspaceId)).toEqual([]);
  });

  it("TA-06 an account created 30 minutes before the month ends gets this month, then next month's at 00:00 PKT", async () => {
    clock = new Date("2026-10-31T18:30:00Z");
    const t = await signUp();
    expect((await grants(t.workspaceId)).map((g) => g.source_ref)).toEqual([`testing:${t.workspaceId}:2026-10`]);
    clock = new Date("2026-10-31T19:00:01Z");
    await billing.runJob("expire_lots");
    await billing.runJob("testing_allowance");
    expect((await grants(t.workspaceId)).map((g) => g.source_ref)).toEqual([`testing:${t.workspaceId}:2026-10`, `testing:${t.workspaceId}:2026-11`]);
    expect((await billing.summary(ctxOf(t.userId, t.workspaceId))).balance.available).toBe(500);
  });

  it("TA-07 purchased and plan credits are never erased by the monthly reset", async () => {
    const t = await signUp();
    await db.withWorkspace(t.workspaceId, (tx) => billing.engine.grant(tx, t.workspaceId, { source: "topup", amount: 300, expiresAt: null, sourceRef: "test-topup", note: "test" }));
    await db.withWorkspace(t.workspaceId, (tx) => billing.engine.grant(tx, t.workspaceId, { source: "adjustment", amount: 40, expiresAt: new Date("2027-03-01T00:00:00Z"), sourceRef: "test-adj", note: "test" }));
    clock = new Date("2026-10-31T19:00:00Z");
    await billing.runJob("expire_lots");
    await billing.runJob("testing_allowance");
    const after = await lots(t.workspaceId);
    expect(after.find((l) => l.source === "topup")).toMatchObject({ amount: 300, remaining: 300 });
    expect(after.find((l) => l.source === "adjustment")).toMatchObject({ amount: 40, remaining: 40 });
    expect(after.filter((l) => l.source === "testing").map((l) => l.remaining)).toEqual([0, 500]);
    expect(await reconcile(t.workspaceId)).toEqual([]);
  });

  it("TA-08 without a plan, testing credits pay for searches and reveals only; paid provider actions still need a plan", async () => {
    const t = await signUp();
    const c = ctxOf(t.userId, t.workspaceId);
    const price = await costs();
    await spend(c, "search_existing", price["search_existing"] as number);
    await spend(c, "reveal_contact", price["reveal_contact"] as number);
    await expect(spend(c, "find_new", price["find_new"] as number)).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
    await expect(spend(c, "refresh_data", price["refresh_data"] as number)).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
    const scopes = await ownerQuery<{ spend_scope: string; n: number }>(`select spend_scope, count(*)::int n from wp.credit_reservations where workspace_id = '${t.workspaceId}' group by 1`);
    expect(scopes).toEqual([{ spend_scope: "testing_only", n: 2 }]);
    expect(await reconcile(t.workspaceId)).toEqual([]);
  });

  it("TA-09 two members racing for the last credits never overspend or go negative", async () => {
    const t = await signUp();
    const member = randomUUID();
    await ownerQuery(`insert into wp.users (id, email) values ('${member}', '${member}@test.mushin.pk');
      insert into wp.workspace_members (workspace_id, user_id, role) values ('${t.workspaceId}', '${member}', 'member');
      update wp.credit_lots set remaining = 100 where workspace_id = '${t.workspaceId}';
      insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, note)
        select workspace_id, -400, 'adjust', id, 'test: leave 100' from wp.credit_lots where workspace_id = '${t.workspaceId}';`);
    const price = (await costs())["search_existing"] as number;
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => spend(ctxOf(i % 2 ? member : t.userId, t.workspaceId), "search_existing", price)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(Math.floor(100 / price));
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason?.code === "INSUFFICIENT_CREDITS")).toBe(true);
    expect((await lots(t.workspaceId))[0]?.remaining).toBe(100 - ok * price);
    expect(await reconcile(t.workspaceId)).toEqual([]);
  });

  it("TA-10 a worker that dies during the grant leaves nothing behind; the retry grants once", async () => {
    const t = await signUp();
    clock = new Date("2026-10-31T19:00:00Z");
    await expect(
      db.withWorkspace(t.workspaceId, async (tx) => {
        await billing.startTestingAllowance(tx, t.workspaceId);
        throw new Error("worker killed mid-transaction");
      }),
    ).rejects.toThrow("worker killed");
    expect(await grants(t.workspaceId)).toHaveLength(1);
    await billing.runJob("testing_allowance");
    await billing.runJob("testing_allowance");
    expect(await grants(t.workspaceId)).toHaveLength(2);
  });

  it("TA-11 the allowance can be switched off (0) without touching credits already granted", async () => {
    const t = await signUp();
    await ownerQuery(`update platform.billing_settings set testing_monthly_credits = 0`);
    const late = await signUp();
    expect(await grants(late.workspaceId)).toEqual([]);
    clock = new Date("2026-10-31T19:00:00Z");
    await billing.runJob("testing_allowance");
    expect(await grants(t.workspaceId)).toHaveLength(1);
    expect((await lots(t.workspaceId))[0]?.remaining).toBe(500);
  });

  it("TA-12 a fresh service instance (restart) reads the same balance and history", async () => {
    const t = await signUp();
    const c = ctxOf(t.userId, t.workspaceId);
    await spend(c, "search_existing", (await costs())["search_existing"] as number);
    const before = { s: await billing.summary(c), l: await billing.ledger(c, { limit: 50 }) };
    const restarted = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger: createLogger({ level: "silent" }), now: () => clock });
    expect(await restarted.summary(c)).toEqual(before.s);
    expect(await restarted.ledger(c, { limit: 50 })).toEqual(before.l);
  });

  it("TA-13 an unverified email gets no allowance; after verifying, the next visit grants it once, even with concurrent visits", async () => {
    const id = person();
    unverified.add(id.userId);
    const t = await identity.resolveTenant(id, "req");
    const ctx = ctxOf(t.userId, t.workspaceId);
    await identity.getMe(ctx);
    expect(await grants(t.workspaceId)).toEqual([]);
    unverified.delete(id.userId);
    await Promise.all(Array.from({ length: 5 }, () => identity.getMe(ctx)));
    await identity.getMe(ctx);
    expect(await grants(t.workspaceId)).toEqual([{ source_ref: `testing:${t.workspaceId}:2026-10`, amount: 500 }]);
  });

  it("TA-14 a verified person visiting a workspace they were invited to never receives an allowance there", async () => {
    const host = await signUp();
    const guest = person();
    await ownerQuery(`insert into wp.users (id, email) values ('${guest.userId}', '${guest.email}');
      insert into wp.workspace_members (workspace_id, user_id, role) values ('${host.workspaceId}', '${guest.userId}', 'member');`);
    await identity.getMe({ ...ctxOf(guest.userId, host.workspaceId), role: "member" });
    expect((await grants(host.workspaceId)).map((g) => g.source_ref)).toEqual([`testing:${host.workspaceId}:2026-10`]);
    expect((await ownerQuery<{ at: string | null }>(`select testing_allowance_at::text at from wp.users where id = '${guest.userId}'`))[0]?.at).toBeNull();
  });

  it("TA-15 when the email check cannot be made, nothing is granted and a later visit grants it", async () => {
    authDown = true;
    const t = await signUp();
    expect(await grants(t.workspaceId)).toEqual([]);
    authDown = false;
    await identity.getMe(ctxOf(t.userId, t.workspaceId));
    expect(await grants(t.workspaceId)).toHaveLength(1);
  });

  it("TA-16 distinct email accounts each receive their own allowance in their own workspace", async () => {
    const a = await signUp();
    const b = await signUp();
    expect(a.workspaceId).not.toBe(b.workspaceId);
    expect(await grants(a.workspaceId)).toHaveLength(1);
    expect(await grants(b.workspaceId)).toHaveLength(1);
  });

  it("TA-17 without a plan, the summary lists Find New Creators and Update info as unavailable but not the search and reveal the testing credits pay for (BUG-31)", async () => {
    const t = await signUp();
    const s = await billing.summary(ctxOf(t.userId, t.workspaceId));
    expect(s.lostAccess).toEqual(expect.arrayContaining(["find_new", "refresh_data"]));
    expect(s.lostAccess).not.toContain("search_existing");
    expect(s.lostAccess).not.toContain("reveal_contact");
  });

  it("TA-18 the database itself holds one testing lot per workspace and month (0062), whatever writes it", async () => {
    const t = await signUp();
    const [lot] = await ownerQuery<{ period: string }>(`select period from wp.credit_lots where workspace_id = '${t.workspaceId}' and source = 'testing'`);
    expect(lot?.period).toMatch(/^\d{4}-\d{2}$/);
    const insert = (period: string | null) =>
      ownerQuery(`insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at, period) values ('${t.workspaceId}', 'testing', 500, 500, now() + interval '1 day', ${period === null ? "null" : `'${period}'`})`);
    await expect(insert(lot?.period ?? "")).rejects.toThrow(/credit_lots_one_testing_per_month_key/);
    await expect(insert(null)).rejects.toThrow(/credit_lots_period_rule/);
    await expect(ownerQuery(`insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at, period) values ('${t.workspaceId}', 'trial', 10, 10, now() + interval '1 day', '2026-10')`)).rejects.toThrow(/credit_lots_period_rule/);
    // The next month's lot is a different period and is allowed (TA-04, TA-05 grant it through the engine).
    expect(await lots(t.workspaceId)).toHaveLength(1);
    expect(await reconcile(t.workspaceId)).toEqual([]);
  });
});
