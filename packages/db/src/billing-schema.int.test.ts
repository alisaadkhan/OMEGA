import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function lot(workspaceId: string, remaining: number) {
  const rows = await ownerQuery<{ id: string }>(`
    insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at)
    values ('${workspaceId}', 'topup', ${remaining}, ${remaining}, now() + interval '30 days') returning id`);
  return rows[0]?.id ?? "";
}

describe("billing schema", () => {
  it("seeds plans, packs, action costs and settings, and keeps them across resets", async () => {
    await resetTables();
    const rows = await ownerQuery<{ plans: number; packs: number; costs: number; trial: number }>(`
      select (select count(*)::int from platform.plans) plans, (select count(*)::int from platform.topup_packs) packs,
             (select count(*)::int from platform.credit_action_costs) costs,
             (select trial_credits from platform.billing_settings) trial`);
    expect(rows[0]).toEqual({ plans: 3, packs: 3, costs: 4, trial: 200 });
  });

  it("keeps the ledger append-only for the API role", async () => {
    const ws = await createTestWorkspace();
    const lotId = await lot(ws.workspaceId, 10);
    await db.withTenant(ws, (tx) =>
      tx.execute(sql`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values (${ws.workspaceId}, 10, 'grant', ${lotId})`),
    );
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`update wp.credit_ledger set amount = 99`))).rejects.toThrow(/permission denied/);
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`delete from wp.credit_ledger`))).rejects.toThrow(/permission denied/);
    await expect(
      db.withTenant(ws, (tx) =>
        tx.execute(sql`insert into wp.payments (workspace_id, paddle_transaction_id, kind, amount_minor, currency, status)
                       values (${ws.workspaceId}, 'txn_x', 'topup', 100, 'USD', 'completed')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects reserve rows that point at a lot and spend rows that do not", async () => {
    const ws = await createTestWorkspace();
    const lotId = await lot(ws.workspaceId, 10);
    await expect(
      ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values ('${ws.workspaceId}', 5, 'reserve', '${lotId}')`),
    ).rejects.toThrow(/check constraint/);
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
    ).rejects.toThrow(/row-level security/);
    await expect(db.withTenant(a, (tx) => tx.execute(sql`delete from platform.billing_schedule`))).rejects.toThrow(/permission denied/);
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
});
