import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./database";
import { createTestDatabase, ownerQuery, testCaPem, testDatabaseUrl } from "./testing";

const db = createTestDatabase();

beforeAll(async () => {
  await ownerQuery(`
    create table if not exists wp.scope_probe (workspace_id uuid not null, v int not null);
    alter table wp.scope_probe enable row level security;
    alter table wp.scope_probe force row level security;
    drop policy if exists scope_probe_tenant on wp.scope_probe;
    create policy scope_probe_tenant on wp.scope_probe
      using (workspace_id = platform.current_workspace_id())
      with check (workspace_id = platform.current_workspace_id());
    grant select, insert on wp.scope_probe to mushin_app, mushin_worker;
    truncate wp.scope_probe;`);
});

afterAll(async () => {
  await ownerQuery(`drop table if exists wp.scope_probe`);
  await db.close();
});

describe("database scopes", () => {
  it("runs tenant work as mushin_app and isolates workspaces", async () => {
    const a = { userId: randomUUID(), workspaceId: randomUUID() };
    const b = { userId: randomUUID(), workspaceId: randomUUID() };
    await db.withTenant(a, (tx) => tx.execute(sql`insert into wp.scope_probe values (${a.workspaceId}, 1)`));
    await db.withTenant(b, (tx) => tx.execute(sql`insert into wp.scope_probe values (${b.workspaceId}, 2)`));
    const seen = await db.withTenant(a, async (tx) => {
      const role = await tx.execute<{ r: string }>(sql`select current_user as r`);
      const rows = await tx.execute<{ v: number }>(sql`select v from wp.scope_probe`);
      return { role: role[0]?.r, values: rows.map((r) => r.v) };
    });
    expect(seen).toEqual({ role: "mushin_app", values: [1] });
    await expect(
      db.withTenant(a, (tx) => tx.execute(sql`insert into wp.scope_probe values (${b.workspaceId}, 9)`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("returns zero rows without tenant context, even on a reused connection (Review Focus 1)", async () => {
    const single = createDatabase(testDatabaseUrl(), { max: 1, applicationName: "mushin-test-single", caPem: testCaPem() });
    try {
      const ctx = { userId: randomUUID(), workspaceId: randomUUID() };
      await single.withTenant(ctx, (tx) => tx.execute(sql`insert into wp.scope_probe values (${ctx.workspaceId}, 3)`));
      const userScope = await single.withUser(randomUUID(), (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from wp.scope_probe`));
      expect(userScope[0]?.n).toBe(0);
      const system = await single.withSystem(async (tx) => {
        const role = await tx.execute<{ r: string }>(sql`select current_user as r`);
        const rows = await tx.execute<{ n: number }>(sql`select count(*)::int as n from wp.scope_probe`);
        return { role: role[0]?.r, n: rows[0]?.n };
      });
      expect(system).toEqual({ role: "mushin_worker", n: 0 });
    } finally {
      await single.close();
    }
  });

  it("rejects non-uuid context values before touching the database", async () => {
    await expect(db.withTenant({ userId: "x", workspaceId: randomUUID() }, async () => 1)).rejects.toThrow(/uuid/);
  });

  it("keeps Supabase API roles out of our schemas", async () => {
    const rows = await ownerQuery<{ s: string; anon: boolean; authed: boolean; app_staff: boolean }>(`
      select s,
        has_schema_privilege('anon', s, 'usage') as anon,
        has_schema_privilege('authenticated', s, 'usage') as authed,
        has_schema_privilege('mushin_app', 'staff', 'usage') as app_staff
      from unnest(array['wp','staff','platform']) as s`);
    for (const r of rows) {
      expect(r.anon).toBe(false);
      expect(r.authed).toBe(false);
      expect(r.app_staff).toBe(false);
    }
  });

  it("pings", async () => {
    expect(await db.ping()).toBe("ok");
  });
});
