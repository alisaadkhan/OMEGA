import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createTestWorkspace, dbError, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function creator(opts: { minor?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await ownerQuery(`
    insert into gcp.creators (id, display_name, primary_handle, primary_platform, is_minor)
      values ('${id}', 'Test Creator', 'test_${id.slice(0, 8)}', 'instagram', ${opts.minor ? "true" : "false"});
    insert into gcp.creator_contacts (creator_id, kind, value_encrypted, value_hash, masked, source)
      values ('${id}', 'email', 'v1.cipher', 'hash-${id}', 'a***@e***.com', 'bio');`);
  return id;
}

describe("creator plane", () => {
  it("keeps shared creator data free of workspace columns (SRS §6.1)", async () => {
    const rows = await ownerQuery<{ n: number }>(`select count(*)::int n from information_schema.columns where table_schema = 'gcp' and column_name = 'workspace_id'`);
    expect(rows[0]?.n).toBe(0);
  });

  it("never lets the API role read contact values; the reveal function returns them only to the paying workspace", async () => {
    const id = await creator();
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await expect(db.withTenant(a, (tx) => tx.execute(sql`select value_encrypted from gcp.creator_contacts`))).rejects.toSatisfy(dbError(/permission denied/));
    const masked = await db.withTenant(a, (tx) => tx.execute<{ masked: string }>(sql`select masked from gcp.creator_contacts where creator_id = ${id}`));
    expect(masked[0]?.masked).toBe("a***@e***.com");
    const before = await db.withTenant(a, (tx) => tx.execute(sql`select * from gcp.revealed_contacts(${id})`));
    expect(before.length).toBe(0);
    await db.withTenant(a, (tx) => tx.execute(sql`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values (${a.workspaceId}, ${id}, ${a.userId})`));
    const forA = await db.withTenant(a, (tx) => tx.execute<{ value_encrypted: string }>(sql`select * from gcp.revealed_contacts(${id})`));
    expect(forA.map((r) => r.value_encrypted)).toEqual(["v1.cipher"]);
    const forB = await db.withTenant(b, (tx) => tx.execute(sql`select * from gcp.revealed_contacts(${id})`));
    expect(forB.length).toBe(0);
  });

  it("blocks reveal rows for possible minors until MUSHIN staff override the flag (SRS §5.5)", async () => {
    const id = await creator({ minor: true });
    const a = await createTestWorkspace();
    const insert = () =>
      db.withTenant(a, (tx) => tx.execute(sql`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values (${a.workspaceId}, ${id}, ${a.userId})`));
    await expect(insert()).rejects.toSatisfy(dbError(/possible minor/));
    const staffId = randomUUID();
    await ownerQuery(`
      insert into staff.staff_users (id, email, name, password_hash, totp_secret_encrypted, role) values ('${staffId}', 's@mushin.pk', 'S', 'x', 'x', 'admin');
      update gcp.creators set minor_override_by_staff_id = '${staffId}', minor_override_reason = 'verified adult' where id = '${id}';`);
    await expect(insert()).resolves.toBeDefined();
  });

  it("stops returning contact values to a workspace that revealed them once the creator is flagged as a possible minor", async () => {
    const id = await creator();
    const a = await createTestWorkspace();
    await db.withTenant(a, (tx) => tx.execute(sql`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values (${a.workspaceId}, ${id}, ${a.userId})`));
    const values = () => db.withTenant(a, (tx) => tx.execute(sql`select * from gcp.revealed_contacts(${id})`));
    expect((await values()).length).toBe(1);
    await ownerQuery(`update gcp.creators set is_minor = true where id = '${id}'`);
    expect((await values()).length).toBe(0);
    await ownerQuery(`update gcp.creators set is_minor = false, status = 'removal_requested' where id = '${id}'`);
    expect((await values()).length).toBe(0);
  });

  it("keeps enrichment snapshots append-only and never stores a score without evidence", async () => {
    const id = await creator();
    await expect(
      ownerQuery(`insert into gcp.enrichment_snapshots (creator_id, verdict, authenticity_score, model_version) values ('${id}', 'genuine', 80, 'm1')`),
    ).rejects.toThrow(/check constraint/);
    await ownerQuery(`insert into gcp.enrichment_snapshots (creator_id, verdict, authenticity_score, evidence_breakdown, model_version)
      values ('${id}', 'genuine', 80, '[{"signal":"growth","detail":"steady","weight":0.4}]', 'm1')`);
    await expect(db.withSystem((tx) => tx.execute(sql`update gcp.enrichment_snapshots set verdict = 'x'`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(db.withSystem((tx) => tx.execute(sql`delete from gcp.enrichment_snapshots`))).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("does not let the API role write creator data", async () => {
    const a = await createTestWorkspace();
    await expect(
      db.withTenant(a, (tx) => tx.execute(sql`insert into gcp.creators (display_name, primary_handle, primary_platform) values ('x', 'x', 'tiktok')`)),
    ).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("scopes saved searches, reveals and audience views to the workspace", async () => {
    const id = await creator();
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await db.withTenant(a, async (tx) => {
      await tx.execute(sql`insert into wp.saved_searches (workspace_id, name, filters, created_by) values (${a.workspaceId}, 'mine', '{}'::jsonb, ${a.userId})`);
      await tx.execute(sql`insert into wp.audience_views (workspace_id, creator_id, month, viewed_by) values (${a.workspaceId}, ${id}, '2026-10-01', ${a.userId})`);
    });
    const seenByB = await db.withTenant(b, (tx) =>
      tx.execute<{ n: number }>(sql`select (select count(*) from wp.saved_searches)::int + (select count(*) from wp.audience_views)::int as n`),
    );
    expect(seenByB[0]?.n).toBe(0);
    await expect(
      db.withTenant(b, (tx) =>
        tx.execute(sql`insert into wp.saved_searches (workspace_id, name, filters, created_by) values (${a.workspaceId}, 'x', '{}'::jsonb, ${b.userId})`),
      ),
    ).rejects.toSatisfy(dbError(/row-level security/));
  });

  it("seeds the niche list and search settings", async () => {
    const list = await ownerQuery<{ label: string }>(`select label from platform.niches order by sort_order`);
    expect(list.map((n) => n.label)).toEqual(["Bridal", "Fashion", "Beauty", "Tech", "Food", "Travel", "Comedy", "Finance", "Wellness", "Lifestyle",
      // The canonical taxonomy (0054).
      "Education & How-to", "Gaming", "History", "Literature", "Agriculture", "Business & Ecommerce", "Automotive", "Religion", "Music", "News & Commentary", "Sports", "Entertainment", "Real Estate"]);
    const s = await ownerQuery<{ weight_text: number; label_best: number; candidate_pool: number }>(
      `select weight_text, label_best, candidate_pool from platform.search_settings`,
    );
    expect(s).toEqual([{ weight_text: 35, label_best: 80, candidate_pool: 200 }]);
  });
});
