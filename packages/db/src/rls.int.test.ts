import { describe, expect, it } from "vitest";
import { ownerQuery } from "./testing";

describe("RLS catalog guard", () => {
  it("every wp table has RLS enabled, forced and a tenant/user-scoped policy", async () => {
    const rows = await ownerQuery<{ table: string; enabled: boolean; forced: boolean; scoped: number }>(`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policy p
          where p.polrelid = c.oid
            and pg_get_expr(p.polqual, p.polrelid) ~ 'current_(workspace|user)_id') as scoped
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'wp' and c.relkind = 'r'
      order by 1`);
    expect(rows.length).toBeGreaterThan(0);
    const offenders = rows.filter((r) => !r.enabled || !r.forced || r.scoped === 0).map((r) => r.table);
    expect(offenders).toEqual([]);
  });

  it("no app role can bypass RLS", async () => {
    const rows = await ownerQuery<{ rolname: string; rolbypassrls: boolean }>(
      `select rolname, rolbypassrls from pg_roles where rolname in ('mushin_app','mushin_worker')`,
    );
    expect(rows.every((r) => !r.rolbypassrls)).toBe(true);
  });
});
