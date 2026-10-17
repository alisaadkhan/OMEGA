import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const write = (action: string, metadata: Record<string, unknown> = {}) =>
  db.withSystem((tx) => tx.execute(sql`insert into staff.audit_log (action, metadata) values (${action}, ${JSON.stringify(metadata)}::jsonb)`));
const verify = async () => (await ownerQuery<{ rows: string; first_broken_seq: string | null; head_hash: string | null }>(`select * from platform.verify_staff_audit_chain()`))[0];

describe("tamper-evident staff audit log (audit SEC-10)", () => {
  it("chains every entry to the one before it, in order, under concurrent writers", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => write(`staff.test.${i}`)));
    const rows = await ownerQuery<{ seq: string; prev_hash: string | null; row_hash: string }>(`select seq, prev_hash, row_hash from staff.audit_log order by seq`);
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(rows[0]?.prev_hash).toBeNull();
    for (let i = 1; i < rows.length; i++) expect(rows[i]?.prev_hash).toBe(rows[i - 1]?.row_hash);
    expect(await verify()).toEqual({ rows: "12", first_broken_seq: null, head_hash: rows[11]?.row_hash });
  });

  it("finds an edited entry, even by the database owner", async () => {
    for (const a of ["one", "two", "three"]) await write(`staff.${a}`, { reason: "ok" });
    await ownerQuery(`update staff.audit_log set metadata = '{"reason":"covered up"}' where seq = 2`);
    expect((await verify())?.first_broken_seq).toBe("2");
  });

  it("finds a deleted entry and a rewritten head", async () => {
    for (const a of ["one", "two", "three"]) await write(`staff.${a}`);
    const head = (await verify())?.head_hash;
    await ownerQuery(`delete from staff.audit_log where seq = 2`);
    expect((await verify())?.first_broken_seq).toBe("3");
    // Even a fully recomputed chain no longer ends in the head exported before (the daily digest).
    await ownerQuery(`delete from staff.audit_log`);
    await write("staff.one");
    expect((await verify())?.head_hash).not.toBe(head);
  });

  it("app roles still cannot change or delete entries", async () => {
    await write("staff.one");
    await expect(db.withSystem((tx) => tx.execute(sql`update staff.audit_log set action = 'x'`))).rejects.toThrow();
    await expect(db.withSystem((tx) => tx.execute(sql`delete from staff.audit_log`))).rejects.toThrow();
  });
});
