/**
 * Read-only preflight before applying migrations to a hosted database (staging first). Run it yourself so the
 * connection string never leaves your machine:
 *   node --env-file=.env --import tsx scripts/ops/migration-preflight.ts
 * Prints the project it reached (host and project reference, never the password), the migrations already applied and
 * the ones the runner would apply, whether every applied file still matches the repository, and the 0060-0065 safety
 * checks (scripts/ops/preflight-0060-0062.sql). Everything runs in a read-only transaction. Nothing is changed.
 * Then, only if it ends with "SAFE TO MIGRATE":  npm run db:migrate
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env["DIRECT_URL"];
if (!url) throw new Error("DIRECT_URL is not set (run with --env-file=.env)");
const u = new URL(url);
const ref = u.username.includes(".") ? u.username.split(".")[1] : u.hostname.split(".")[1];
console.log(`target: host ${u.hostname}, project ${ref ?? "?"}, database ${u.pathname.slice(1)}`);

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dir = join(root, "packages", "db", "migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const sha = (f: string) => createHash("sha256").update(readFileSync(join(dir, f), "utf8")).digest("hex");

// TLS for every hosted database (verified when a CA file is set); only a local database may go without.
const local = ["localhost", "127.0.0.1"].includes(u.hostname);
const ca = process.env["DATABASE_SSL_CA_FILE"];
const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : ca ? { ca: readFileSync(ca, "utf8") } : "require" });
let safe = true;
try {
  await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    const applied = await tx<{ name: string; checksum: string }[]>`select name, checksum from platform.schema_migrations order by name`;
    const byName = new Map(applied.map((r) => [r.name, r.checksum]));
    const changed = applied.filter((r) => files.includes(r.name) && sha(r.name) !== r.checksum).map((r) => r.name);
    const unknown = applied.filter((r) => !files.includes(r.name)).map((r) => r.name);
    const pending = files.filter((f) => !byName.has(f));
    console.log(`applied: ${applied.length} (latest ${applied.at(-1)?.name ?? "none"})`);
    console.log(`pending: ${pending.length ? pending.join(", ") : "none"}`);
    if (changed.length) { safe = false; console.log(`STOP: applied migrations differ from the repository: ${changed.join(", ")}`); }
    if (unknown.length) { safe = false; console.log(`STOP: the database has migrations this repository does not: ${unknown.join(", ")}`); }
    const gap = pending.find((p) => applied.some((a) => a.name > p));
    if (gap) { safe = false; console.log(`STOP: ${gap} is pending but later migrations are applied`); }

    // 0060-0065 safety checks apply when the database is at 0059; earlier pending files create what they check.
    if (byName.has("0059_workspace_erasure_new_tables.sql") && pending.some((p) => p >= "0060")) {
      const checks = await tx<{ ok: boolean; what: string }[]>`
        select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'platform' and p.proname = 'expire_youtube_api_data') >= 1 as ok, 'retention function present (0060 replaces it)' as what
        union all select count(*) = 3, '0061 constraints present' from pg_constraint where conname in ('credit_lots_source_check', 'credit_reservations_spend_scope_check', 'billing_schedule_job_check')
        union all select count(*) = 2, '0061 policies present' from pg_policies where policyname in ('credit_lots_app_insert', 'credit_ledger_app_insert')
        union all select count(*) = 2, 'roles mushin_app and mushin_worker exist' from pg_roles where rolname in ('mushin_app', 'mushin_worker')
        union all select not exists (select 1 from wp.credit_lots where source not in ('trial', 'monthly', 'topup', 'adjustment', 'testing')), 'credit lots satisfy the widened rule (testing lots exist from 0061 on)'
        union all select count(*) = 0, 'no transaction open longer than 5 minutes' from pg_stat_activity where datname = current_database() and xact_start < now() - interval '5 minutes' and pid <> pg_backend_pid()`;
      for (const c of checks) { console.log(`${c.ok ? "ok  " : "STOP"} ${c.what}`); if (!c.ok) safe = false; }
    }
    const [size] = await tx<{ creators: number; profiles: number }[]>`select (select count(*) from gcp.creators)::int creators, (select count(*) from gcp.creator_profiles)::int profiles`;
    console.log(`catalogue: ${size?.creators} creators, ${size?.profiles} profiles (ALTERs take brief locks: run in a quiet period, after a backup)`);
    throw new Error("rollback");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "rollback")) throw err;
} finally {
  await sql.end();
}
console.log(safe ? "SAFE TO MIGRATE (take a backup first, then: npm run db:migrate)" : "NOT SAFE: resolve the STOP lines first");
