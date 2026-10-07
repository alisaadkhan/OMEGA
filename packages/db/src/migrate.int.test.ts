import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "./migrate";
import { ownerQuery, testCaPem, testDatabaseUrl } from "./testing";

describe("migration runner", () => {
  const dir = mkdtempSync(join(tmpdir(), "mushin-mig-"));
  const name = `9001_runner_probe_${Date.now()}.sql`;

  afterAll(async () => {
    await ownerQuery(`drop table if exists platform.runner_probe; delete from platform.schema_migrations where name like '9001_runner_probe_%'`);
  });

  it("applies the real migrations and is idempotent", async () => {
    expect(await migrate(testDatabaseUrl(), { caPem: testCaPem() })).toEqual([]); // global setup already applied them
    const roles = await ownerQuery<{ rolname: string }>(`select rolname from pg_roles where rolname in ('mushin_app','mushin_worker') order by 1`);
    expect(roles.map((r) => r.rolname)).toEqual(["mushin_app", "mushin_worker"]);
  });

  it("applies a new file once and refuses an edited one (Review Focus 5)", async () => {
    const caPem = testCaPem();
    writeFileSync(join(dir, name), "create table platform.runner_probe (id int);");
    expect(await migrate(testDatabaseUrl(), { dir, caPem })).toEqual([name]);
    expect(await migrate(testDatabaseUrl(), { dir, caPem })).toEqual([]);
    writeFileSync(join(dir, name), "create table platform.runner_probe (id bigint);");
    await expect(migrate(testDatabaseUrl(), { dir, caPem })).rejects.toThrow(/was modified after being applied/);
  });
});
