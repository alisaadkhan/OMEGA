import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createTestWorkspace, dbError, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function lot(workspaceId: string, remaining: number) {
  const rows = await ownerQuery<{ id: string }>(`
    insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at)
    values ('${workspaceId}', 'topup', ${remaining}, ${remaining}, null) returning id`);
  return rows[0]?.id ?? "";
}

describe("billing schema", () => {
  it("seeds plans, packs, action costs and settings, and keeps them across resets", async () => {
    await resetTables();
    const rows = await ownerQuery<{ plans: number; packs: number; costs: number; trial: number }>(`
      select (select count(*)::int from platform.plans) plans, (select count(*)::int from platform.topup_packs) packs,
             (select count(*)::int from platform.credit_action_costs) costs,
             (select trial_credits from platform.billing_settings) trial`);
    expect(rows[0]).toEqual({ plans: 3, packs: 3, costs: 7, trial: 200 });
  });

  it("keeps the ledger append-only for the API role", async () => {
    const ws = await createTestWorkspace();
    await db.withTenant(ws, (tx) => tx.execute(sql`insert into wp.credit_ledger (workspace_id, amount, kind) values (${ws.workspaceId}, 10, 'reserve')`));
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`update wp.credit_ledger set amount = 99`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`delete from wp.credit_ledger`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(
      db.withTenant(ws, (tx) =>
        tx.execute(sql`insert into wp.payments (workspace_id, paddle_transaction_id, kind, amount_minor, currency, status)
                       values (${ws.workspaceId}, 'txn_x', 'topup', 100, 'USD', 'completed')`),
      ),
    ).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("lets the API role start one trial but never grant credits or activate a plan", async () => {
    const ws = await createTestWorkspace();
    const inApi = (q: SQL) => db.withTenant(ws, (tx) => tx.execute(q));
    await inApi(sql`insert into wp.subscriptions (workspace_id, trial_ends_at) values (${ws.workspaceId}, now() + interval '14 days')`);
    expect((await ownerQuery<{ status: string }>(`select status from wp.subscriptions`))[0]?.status).toBe("trialing");
    await expect(inApi(sql`update wp.subscriptions set status = 'active', plan_id = 'scale'`)).rejects.toSatisfy(dbError(/permission denied/));
    await expect(inApi(sql`insert into wp.subscriptions (workspace_id, status) values (${ws.workspaceId}, 'active')`)).rejects.toSatisfy(dbError(/permission denied/));

    await inApi(sql`insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at) values (${ws.workspaceId}, 'trial', 200, 200, now() + interval '14 days')`);
    await expect(
      inApi(sql`insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at) values (${ws.workspaceId}, 'trial', 200, 200, now() + interval '14 days')`),
    ).rejects.toSatisfy(dbError(/duplicate key/));
    await expect(
      inApi(sql`insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at) values (${ws.workspaceId}, 'topup', 5000, 5000, null)`),
    ).rejects.toSatisfy(dbError(/row-level security/));
    await expect(inApi(sql`update wp.credit_lots set amount = 99999`)).rejects.toSatisfy(dbError(/permission denied/));
    await expect(
      inApi(sql`insert into wp.credit_ledger (workspace_id, amount, kind, source_ref, lot_id) select ${ws.workspaceId}, 500, 'grant', 'txn:fake', id from wp.credit_lots`),
    ).rejects.toSatisfy(dbError(/row-level security/));
  });

  it("lets the API role reserve only a live run's quoted maximum (base 50 + 10 per creator for 5, 10 or 15)", async () => {
    const ws = await createTestWorkspace();
    const hold = (amount: number) =>
      db.withTenant(ws, (tx) =>
        tx.execute(sql`insert into wp.credit_reservations (workspace_id, amount, action, confirmed_cost, status, expires_at, ref_type, ref_id)
                        values (${ws.workspaceId}, ${amount}, 'find_new', ${amount}, 'held', now() + interval '15 minutes', 't', ${String(amount)})`),
      );
    for (const allowed of [100, 150, 200]) await hold(allowed);
    for (const refused of [62, 112, 250]) await expect(hold(refused)).rejects.toSatisfy(dbError(/row-level security/)); // old 12-credit base, old 20-creator size
  });

  it("lets the API role only lower credits, raise usage, change held holds and move due work earlier", async () => {
    const ws = await createTestWorkspace();
    const inApi = (q: SQL) => db.withTenant(ws, (tx) => tx.execute(q));
    await lot(ws.workspaceId, 10);
    await inApi(sql`update wp.credit_lots set remaining = 4`);
    await expect(inApi(sql`update wp.credit_lots set remaining = 10`)).rejects.toSatisfy(dbError(/only lower/));

    await expect(
      inApi(sql`insert into wp.credit_reservations (workspace_id, amount, action, confirmed_cost, status, expires_at, ref_type, ref_id)
                values (${ws.workspaceId}, 1, 'find_new', 1, 'held', now() + interval '15 minutes', 't', '1')`),
    ).rejects.toSatisfy(dbError(/row-level security/));
    await inApi(sql`insert into wp.credit_reservations (workspace_id, amount, action, confirmed_cost, status, expires_at, ref_type, ref_id)
                    values (${ws.workspaceId}, 50, 'find_new', 50, 'held', now() + interval '15 minutes', 't', '1')`);
    await expect(inApi(sql`update wp.credit_reservations set expires_at = now() + interval '1 day'`)).rejects.toSatisfy(dbError(/at most one/));
    await inApi(sql`update wp.credit_reservations set status = 'committed'`);
    await expect(inApi(sql`update wp.credit_reservations set status = 'held'`)).rejects.toSatisfy(dbError(/only a held reservation/));

    await inApi(sql`insert into wp.entitlement_usage (workspace_id, key, period_start, count) values (${ws.workspaceId}, 'audience_views', '2026-10-01', 1)`);
    await expect(inApi(sql`update wp.entitlement_usage set count = 0`)).rejects.toSatisfy(dbError(/only increase/));

    await inApi(sql`insert into platform.billing_schedule (workspace_id, job, due_at) values (${ws.workspaceId}, 'end_trials', now() + interval '1 day')`);
    await expect(inApi(sql`update platform.billing_schedule set due_at = now() + interval '1 year'`)).rejects.toSatisfy(dbError(/only move due work earlier/));
  });

  it("enforces the sign of every ledger row", async () => {
    const ws = await createTestWorkspace();
    const lotId = await lot(ws.workspaceId, 10);
    await expect(ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values ('${ws.workspaceId}', 5, 'spend', '${lotId}')`)).rejects.toSatisfy(dbError(/check constraint/));
    await expect(ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values ('${ws.workspaceId}', -5, 'grant', '${lotId}')`)).rejects.toSatisfy(dbError(/check constraint/));
    await expect(ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind) values ('${ws.workspaceId}', 0, 'adjust')`)).rejects.toSatisfy(dbError(/check constraint/));
  });

  it("rejects reserve rows that point at a lot and spend rows that do not", async () => {
    const ws = await createTestWorkspace();
    const lotId = await lot(ws.workspaceId, 10);
    await expect(
      ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values ('${ws.workspaceId}', 5, 'reserve', '${lotId}')`),
    ).rejects.toSatisfy(dbError(/check constraint/));
    await expect(ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind) values ('${ws.workspaceId}', -5, 'spend')`)).rejects.toThrow(
      /check constraint/,
    );
  });

  it("shows the worker no workspace data unless it works inside one workspace (SRS §2.5)", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await lot(a.workspaceId, 5);
    await lot(b.workspaceId, 7);
    const blind = await db.withSystem((tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from wp.credit_lots`));
    expect(blind[0]?.n).toBe(0);
    const scoped = await db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`update wp.credit_lots set remaining = 0 returning id`));
    expect(scoped.length).toBe(1);
    await expect(db.withWorkspace("not-a-uuid", async () => 1)).rejects.toThrow(/uuid/);
  });

  it("keeps the due-work index workspace-scoped, except for the worker's read-only scan", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await ownerQuery(`insert into platform.billing_schedule (workspace_id, job, due_at) values ('${b.workspaceId}', 'expire_lots', now())`);
    const seenByA = await db.withTenant(a, (tx) => tx.execute(sql`select workspace_id from platform.billing_schedule`));
    expect(seenByA.length).toBe(0);
    await expect(
      db.withTenant(a, (tx) =>
        tx.execute(sql`insert into platform.billing_schedule (workspace_id, job, due_at) values (${b.workspaceId}, 'reconcile', now())`),
      ),
    ).rejects.toSatisfy(dbError(/row-level security/));
    await expect(db.withTenant(a, (tx) => tx.execute(sql`delete from platform.billing_schedule`))).rejects.toSatisfy(dbError(/permission denied/));
    const scanned = await db.withSystem((tx) => tx.execute(sql`select workspace_id from platform.billing_schedule`));
    expect(scanned.length).toBe(1);
    const blindDelete = await db.withSystem((tx) => tx.execute(sql`delete from platform.billing_schedule returning workspace_id`));
    expect(blindDelete.length).toBe(0);
  });

  it("hides one workspace's billing rows from another", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await lot(a.workspaceId, 5);
    const fromB = await db.withTenant(b, (tx) => tx.execute(sql`select id from wp.credit_lots`));
    expect(fromB.length).toBe(0);
    expect(randomUUID()).not.toBe(a.workspaceId);
  });

  it("gives workspaces created before billing a trial, once (migration 0008)", async () => {
    const ws = await createTestWorkspace();
    const backfill = readFileSync(new URL("../migrations/0008_trial_backfill.sql", import.meta.url), "utf8");
    await ownerQuery(backfill);
    await ownerQuery(backfill);
    const rows = await ownerQuery<{ status: string; lots: number; grants: number; jobs: string }>(`
      select (select status from wp.subscriptions where workspace_id = '${ws.workspaceId}') status,
        (select count(*)::int from wp.credit_lots where workspace_id = '${ws.workspaceId}' and source = 'trial' and remaining = 200) lots,
        (select count(*)::int from wp.credit_ledger where workspace_id = '${ws.workspaceId}' and kind = 'grant' and source_ref = 'trial:${ws.workspaceId}') grants,
        (select string_agg(job, ',' order by job) from platform.billing_schedule where workspace_id = '${ws.workspaceId}') jobs`);
    expect(rows[0]).toEqual({ status: "trialing", lots: 1, grants: 1, jobs: "end_trials,expire_lots,reconcile,trial_notices" });
  });
});
