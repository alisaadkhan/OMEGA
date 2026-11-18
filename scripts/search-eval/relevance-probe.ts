/**
 * Relevance probe (18 Nov directive): runs catalogue searches through the real query understanding and Postgres search
 * against a local catalogue and prints the returned creators with their niches and the evidence they matched on, so
 * results are inspected rather than counted. Read-only.
 *
 *   node --import tsx scripts/search-eval/relevance-probe.ts --db mushin_catalog_v4 [--old | --any-contact] pubg health "pubg mobile"
 * --old: the previous matching (no relevance plan, no email rule); --any-contact: the new matching without the email rule.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createDatabase, type Db } from "@mushin/db";
import { searchFiltersShape } from "@mushin/contracts";
import { createPostgresCatalogSearch } from "../../apps/api/src/modules/creators/postgres-search";
import { understandQuery } from "../../apps/api/src/modules/creators/understand";
import { relevancePlan } from "../../apps/api/src/modules/creators/relevance";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { db: { type: "string", default: "mushin_catalog_v4" }, old: { type: "boolean", default: false }, top: { type: "string", default: "15" }, json: { type: "boolean", default: false }, "any-contact": { type: "boolean", default: false } } });
if (!/^mushin_catalog_[a-z0-9_]+$/.test(values.db ?? "")) throw new Error("--db must name a local catalogue");
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${values.db}`, { max: 2, applicationName: "relevance-probe" });
// Read-only probe: the tenant wrapper is the system one (no workspace needed for reading the projection).
const probeDb = { ...db, withTenant: (_ctx: unknown, fn: Parameters<Db["withSystem"]>[0]) => db.withSystem(fn) } as unknown as Db;
const search = createPostgresCatalogSearch(probeDb);
const out: Record<string, unknown> = {};
for (const raw of positionals) {
  const u = understandQuery(raw);
  const relevance = values.old ? null : relevancePlan(u.text);
  const { hits, total } = await search.search({ text: u.text, boost: u.optional, filters: searchFiltersShape.parse({}), freshCurrentDays: 30, now: new Date(), limit: 200, relevance, requireEmail: !values.old && !values["any-contact"] }, { userId: "probe", workspaceId: "probe" });
  const ids = hits.slice(0, Number(values.top)).map((h) => h.id);
  const rows = ids.length
    ? await db.withSystem((tx) => tx.execute<{ id: string; name: string; niches: string[]; tags: string[]; bio: string }>(sql`select creator_id id, display_name name, niches, tags, left(regexp_replace(bio, '[[:space:]]+', ' ', 'g'), 90) bio from gcp.creator_search_documents where creator_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const list = hits.slice(0, Number(values.top)).map((h) => ({ score: Math.round(h.rankingScore * 100) / 100, ...byId.get(h.id), tags: (byId.get(h.id)?.tags ?? []).slice(0, 4) }));
  out[raw] = { understood: u.text, plan: relevance?.groups.map((g) => `${g.kind}:${g.canonical}`), total, list };
  if (!values.json) {
    console.log(`\n=== "${raw}" → text "${u.text}" plan ${JSON.stringify(relevance?.groups.map((g) => `${g.kind}:${g.canonical}`) ?? null)} total ${total}`);
    for (const r of list) console.log(`  ${String(r.score).padEnd(5)} ${(r.name ?? "").slice(0, 28).padEnd(28)} [${(r.niches ?? []).join(", ")}] ${(r.tags ?? []).join(" ").slice(0, 50)} | ${(r.bio ?? "").slice(0, 60)}`);
  }
}
if (values.json) console.log(JSON.stringify(out, null, 1));
await db.close?.();
process.exit(0);
