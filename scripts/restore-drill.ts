/**
 * Backup and restore drill (OPS-002): dumps a database with pg_dump (custom format), restores it into a new disposable
 * database, and compares the exact row count of every application table plus the migration history. The disposable
 * copy is dropped afterwards unless --keep. This proves the dump/restore procedure on a PostgreSQL server; it is not a
 * Supabase point-in-time recovery test (that needs the hosted project).
 *
 *   PG_BIN=<postgres bin dir> node --import tsx scripts/restore-drill.ts <source-db> [--keep]
 * Source and target are on localhost:54330 as postgres. The source is only read.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = process.env["PG_BIN"];
const source = process.argv[2];
if (!bin || !source || !/^[a-z0-9_]+$/.test(source)) {
  console.error("usage: PG_BIN=<dir> restore-drill.ts <source-db> [--keep]");
  process.exit(2);
}
const exe = (name: string) => join(bin, process.platform === "win32" ? `${name}.exe` : name);
const conn = ["-h", "localhost", "-p", "54330", "-U", "postgres"];
const target = `${source}_restore_drill_disposable`;
const psql = (db: string, q: string) => execFileSync(exe("psql"), [...conn, "-d", db, "-Atc", q], { encoding: "utf8" }).trim();

const COUNT_ALL = `select string_agg(format('%s.%s=%s', schemaname, relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text), ',' order by schemaname, relname)
  from pg_stat_user_tables where schemaname in ('wp','gcp','platform','staff')`;

const dir = mkdtempSync(join(tmpdir(), "mushin-drill-"));
const dump = join(dir, `${source}.dump`);
const t0 = Date.now();
execFileSync(exe("pg_dump"), [...conn, "-d", source, "-Fc", "-f", dump]);
const dumpMs = Date.now() - t0;
const before = psql(source, COUNT_ALL);
const migrationsBefore = psql(source, "select string_agg(name || ':' || checksum, ',' order by name) from platform.schema_migrations");

execFileSync(exe("dropdb"), [...conn, "--if-exists", target]);
execFileSync(exe("createdb"), [...conn, target]);
const t1 = Date.now();
execFileSync(exe("pg_restore"), [...conn, "-d", target, "--no-owner", "--exit-on-error", dump]);
const restoreMs = Date.now() - t1;
const after = psql(target, COUNT_ALL);
const migrationsAfter = psql(target, "select string_agg(name || ':' || checksum, ',' order by name) from platform.schema_migrations");

const tables = before.split(",").length;
const rows = before.split(",").reduce((s, kv) => s + Number(kv.split("=")[1] ?? 0), 0);
const ok = before === after && migrationsBefore === migrationsAfter;
console.log(JSON.stringify({ source, target, dumpBytes: statSync(dump).size, dumpMs, restoreMs, tables, rows, rowCountsMatch: before === after, migrationsMatch: migrationsBefore === migrationsAfter }, null, 1));
if (!process.argv.includes("--keep")) execFileSync(exe("dropdb"), [...conn, "--if-exists", target]);
rmSync(dir, { recursive: true, force: true });
if (!ok) {
  console.error("RESTORE DRILL FAILED: counts or migration history differ");
  process.exit(1);
}
console.log("Restore drill passed: every table's row count and the migration history match.");
