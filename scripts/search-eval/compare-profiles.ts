/**
 * Search profile comparison, read-only (search-v2 branch): runs every frozen Brain 1 panel query through query
 * understanding v1 (frozen) and v2 and the PostgreSQL catalogue retrieval of a given database, and reports per query and
 * in total: results returned, zero-result queries, how many of the frozen rating packet's pooled candidates (creators
 * the raters will judge) each profile now returns, and platform-constraint violations. No relevance is judged here:
 * these are retrieval measurements, not quality metrics.
 *
 *   node --import tsx scripts/search-eval/compare-profiles.ts <queries.csv> <database name> <packet dir> [out.json]
 * Only SELECTs are run (no charge rows, no index writes); the frozen corpus can be measured directly.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { searchFiltersSchema } from "@mushin/contracts";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { createPostgresCatalogSearch, understandQuery, understandQueryV2 } from "../../apps/api/src/modules/creators/index";
import { parseCsv } from "./metrics";

const [queriesPath, dbName, packetDir, out] = process.argv.slice(2);
if (!queriesPath || !dbName || !packetDir) throw new Error("usage: compare-profiles.ts <queries.csv> <database> <packet dir> [out.json]");
const BOM_AT_START = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const BEHAVIOUR_ONLY = new Set(["conflicting_filters", "ambiguous", "unsupported_attribute", "url_security", "duplicate_identity", "cross_platform_identity", "stale_metric", "missing_metric"]);
const base = new URL(process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:54330/x");
base.pathname = `/${dbName}`;
const db = createDatabase(base.toString(), { max: 2, applicationName: "compare-profiles-readonly", caPem: null });
const search = createPostgresCatalogSearch(db);
const ctx = { userId: randomUUID(), workspaceId: randomUUID() };
// EVAL_NOW pins eligibility time like the frozen run (2026-10-15T13:59:07.039Z); default: now.
const at = process.env["EVAL_NOW"] ? new Date(process.env["EVAL_NOW"]) : new Date();

// The frozen packet's key: which creators raters will see per case, and whether MUSHIN returned or pooled them.
const keyRows = parseCsv(readFileSync(join(packetDir, "brain1-key.csv"), "utf8").replace(BOM_AT_START, "")).slice(1);
const judged = new Map<string, Set<string>>();
for (const r of keyRows) {
  const set = judged.get(r[1] ?? "") ?? new Set<string>();
  set.add(r[2] ?? "");
  judged.set(r[1] ?? "", set);
}

async function run(profile: "v1" | "v2", text: string) {
  const u1 = understandQuery(text);
  const u2 = profile === "v2" ? understandQueryV2(text) : null;
  const f = searchFiltersSchema.safeParse(u2 ? u2.filters : u1.filters);
  if (!f.success) return { refused: true as const };
  const hits = await search.search({ text: u2 ? u2.text : u1.text, boost: u2 ? u2.boost : u1.optional, filters: f.data, freshCurrentDays: 7, now: at, limit: 200, ...(u2?.groups.length ? { plan: u2.groups } : {}) }, ctx);
  return { refused: false as const, ids: hits.hits.map((h) => h.id), platform: f.data.platform ?? null };
}
const platformsOf = async (ids: string[]) =>
  ids.length ? new Map((await db.withTenant(ctx, (tx) => tx.execute<{ id: string; platforms: string[] }>(sql`select creator_id as id, platforms from gcp.creator_search_documents where creator_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`))).map((r) => [r.id, r.platforms])) : new Map<string, string[]>();

const [header, ...rows] = parseCsv(readFileSync(queriesPath, "utf8").replace(BOM_AT_START, ""));
const col = (name: string) => header?.indexOf(name) ?? -1;
const cases = [];
for (const r of rows) {
  const caseId = r[col("case_id")] ?? "";
  const text = r[col("query_text")] ?? "";
  const scenario = r[col("scenario")] ?? "";
  if (!text.trim()) continue;
  const entry: Record<string, unknown> = { caseId, scenario, behaviourOnly: BEHAVIOUR_ONLY.has(scenario), text };
  for (const profile of ["v1", "v2"] as const) {
    const res = await run(profile, text);
    if (res.refused) {
      entry[profile] = { refused: true };
      continue;
    }
    const top10 = res.ids.slice(0, 10);
    const pool = judged.get(caseId) ?? new Set<string>();
    const plats = res.platform ? await platformsOf(res.ids) : new Map<string, string[]>();
    entry[profile] = { returned: res.ids.length, top10JudgedCandidates: top10.filter((id) => pool.has(id)).length, judgedCandidatesReturnedAnywhere: res.ids.filter((id) => pool.has(id)).length, platformViolations: res.platform ? res.ids.filter((id) => !(plats.get(id) ?? []).includes(res.platform as string)).length : 0 };
  }
  cases.push(entry);
}
const rel = cases.filter((c) => !c.behaviourOnly);
const summary = (p: "v1" | "v2") => {
  const ok = rel.map((c) => c[p] as { refused?: boolean; returned?: number; platformViolations?: number; judgedCandidatesReturnedAnywhere?: number }).filter((x) => !x.refused);
  return { relevanceQueries: rel.length, zeroResult: ok.filter((x) => x.returned === 0).length, withResults: ok.filter((x) => (x.returned ?? 0) > 0).length, medianReturned: [...ok.map((x) => x.returned ?? 0)].sort((a, b) => a - b)[Math.floor(ok.length / 2)], platformViolations: ok.reduce((s, x) => s + (x.platformViolations ?? 0), 0), judgedCandidatesReturned: ok.reduce((s, x) => s + (x.judgedCandidatesReturnedAnywhere ?? 0), 0) };
};
const report = { database: dbName, at: at.toISOString(), v1: summary("v1"), v2: summary("v2"), cases };
if (out) writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ database: dbName, v1: report.v1, v2: report.v2 }));
await db.close();
