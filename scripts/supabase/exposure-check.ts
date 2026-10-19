/**
 * Supabase Data API exposure check (audit SEC-11). The anon (publishable) key is public and `authenticated` is any
 * signed-in user, so neither may reach MUSHIN's data except through the API. Checks, in the database given:
 *   - anon and authenticated have no USAGE on wp, gcp, staff, platform (PostgREST cannot even resolve those tables);
 *   - no table, view, sequence or function in any schema is granted to them, and none sits in `public`;
 *   - optionally (--api <url> --key <publishable key>), the live Data API refuses each schema and lists nothing.
 * Run against the hosted project before go-live and after any dashboard change to "Exposed schemas".
 *   node --import tsx scripts/supabase/exposure-check.ts <postgres url> [--api https://<ref>.supabase.co --key <anon key>]
 */
import { parseArgs } from "node:util";
import postgres from "postgres";

const SCHEMAS = ["wp", "gcp", "staff", "platform"];
const ROLES = ["anon", "authenticated"];

export type Exposure = { problems: string[]; checks: number };

export async function databaseExposure(sql: postgres.Sql): Promise<Exposure> {
  const problems: string[] = [];
  let checks = 0;
  const roles = await sql<{ r: string }[]>`select rolname r from pg_roles where rolname in ${sql(ROLES)}`;
  if (roles.length === 0) return { problems: ["no anon/authenticated roles here: not a Supabase database, nothing to check"], checks: 0 };
  for (const { r } of roles) {
    for (const s of SCHEMAS) {
      checks += 1;
      // A schema that does not exist yet (migrations not applied) cannot be exposed.
      const [u] = await sql<{ ok: boolean }[]>`
        select case when to_regnamespace(${s}) is null then false else has_schema_privilege(${r}, ${s}, 'USAGE') end ok`;
      if (u?.ok) problems.push(`${r} has USAGE on schema ${s}`);
    }
    const grants = await sql<{ o: string; p: string }[]>`
      select table_schema || '.' || table_name o, string_agg(privilege_type, ',') p from information_schema.role_table_grants
      where grantee = ${r} and table_schema not in ('pg_catalog', 'information_schema', 'graphql', 'graphql_public', 'storage', 'realtime', 'auth', 'extensions', 'vault', 'net', 'supabase_functions', 'pgbouncer', 'cron', 'pgmq')
      group by 1 order by 1`;
    checks += 1;
    for (const g of grants) problems.push(`${r} can ${g.p} ${g.o}`);
    const fns = await sql<{ f: string }[]>`
      select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any(${sql.array([...SCHEMAS, "public"])}) and has_function_privilege(${r}, p.oid, 'EXECUTE')
        -- trigger functions (e.g. Supabase's own public.rls_auto_enable event trigger) cannot be called, so not served
        and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
        and has_schema_privilege(${r}, n.oid, 'USAGE')`;
    checks += 1;
    for (const f of fns) problems.push(`${r} can execute ${f.f}`);
  }
  const own = await sql<{ o: string }[]>`
    select c.relname o from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')`;
  checks += 1;
  for (const o of own) problems.push(`public.${o.o} exists (the public schema is exposed by default)`);
  return { problems, checks };
}

/** The live Data API with the public key: every MUSHIN schema must be refused. */
export async function apiExposure(api: string, key: string, fetcher: typeof fetch = fetch): Promise<Exposure> {
  const problems: string[] = [];
  for (const s of SCHEMAS) {
    const res = await fetcher(`${api.replace(/\/+$/, "")}/rest/v1/`, { headers: { apikey: key, authorization: `Bearer ${key}`, "accept-profile": s } });
    if (res.ok) problems.push(`Data API serves schema ${s} to the public key (${res.status})`);
  }
  const root = await fetcher(`${api.replace(/\/+$/, "")}/rest/v1/`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (root.ok) {
    const body = (await root.json().catch(() => ({}))) as { paths?: Record<string, unknown> };
    const paths = Object.keys(body.paths ?? {}).filter((p) => p !== "/");
    if (paths.length > 0) problems.push(`Data API lists ${paths.length} path(s) to the public key: ${paths.slice(0, 5).join(", ")}`);
  }
  return { problems, checks: SCHEMAS.length + 1 };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/supabase/exposure-check.ts");
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { api: { type: "string" }, key: { type: "string" } } });
  const url = positionals[0] ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error("Usage: exposure-check.ts <postgres url> [--api <supabase url> --key <publishable key>]");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const db = await databaseExposure(sql);
    const live = values.api && values.key ? await apiExposure(values.api, values.key) : { problems: [], checks: 0 };
    const problems = [...db.problems, ...live.problems];
    for (const p of problems) console.log(`FAIL | ${p}`);
    console.log(JSON.stringify({ check: "supabase-exposure", checks: db.checks + live.checks, problems: problems.length }));
    process.exitCode = problems.length ? 1 : 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
