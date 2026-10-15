/**
 * Brain 1 (catalogue Search) human evaluation, step 1: run every panel query through the real search service and write
 * the blind rating packet (sheets.ts): MUSHIN's top 10 per query mixed with up to EVAL_POOL_SIZE (default 10) pooled
 * candidates it did not return (catalogue documents matching any of the query's words or concept forms), so raters can
 * say whether a relevant creator existed at all. That makes relevant-query coverage measurable, and tests every "nothing
 * suitable in the catalogue" claim. Pooling only finds creators whose text mentions a query term; that limit is stated.
 *
 * Runs only against a disposable local copy of a catalogue (never the database you work in):
 *   createdb -h localhost -p 54330 -U postgres -T mushin_local mushin_eval_disposable
 *   TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_eval_disposable TEST_DATABASE_SSL_CA_FILE= \
 *     node --import tsx scripts/search-eval/run-brain1.ts <queries.csv> <out-dir>
 * The queries file is the panel CSV (case_id, language_script, scenario, query_text, filters_json, …). No provider is
 * called: catalogue Search reads PostgreSQL only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { searchFiltersSchema, searchRequestSchema } from "@mushin/contracts";
import { AppError, createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../../apps/api/src/modules/billing/index";
import { createCreatorsService, createPostgresCatalogSearch, expandQuery, understandQuery } from "../../apps/api/src/modules/creators/index";
import { parseCsv } from "./metrics";
import { BOM, writeRatingPacket, type CandidateRow, type CaseRow } from "./sheets";

const BOM_PREFIX = new RegExp(`^${BOM}`);
const POOL_SIZE = Number(process.env["EVAL_POOL_SIZE"] ?? 10);
/** Panel scenarios that test behaviour (refusal, ambiguity, identity, metric freshness), not topical relevance: judged on
 * the behaviour sheet only, with no relevance rows and no part in precision, nDCG or coverage. */
const BEHAVIOUR_ONLY = new Set(["conflicting_filters", "ambiguous", "unsupported_attribute", "url_security", "duplicate_identity", "cross_platform_identity", "stale_metric", "missing_metric"]);
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const PROFILE_URL: Record<string, (h: string) => string> = { instagram: (h) => `https://instagram.com/${h}`, tiktok: (h) => `https://tiktok.com/@${h}`, youtube: (h) => `https://youtube.com/@${h}` };

/** What a rater sees about a creator: name, primary profile and its bio, read from the catalogue copy. */
async function describe(ids: string[]): Promise<Map<string, Omit<CandidateRow, "caseId" | "creatorId" | "source" | "rank">>> {
  if (!ids.length) return new Map();
  const rows = await ownerQuery<{ id: string; display_name: string; handle: string; platform: string; url: string | null; city: string | null; niches: string[]; followers: number | null; bio: string | null }>(
    `select distinct on (c.id) c.id, c.display_name, p.handle, p.platform, p.canonical_url url, c.city, c.niches, p.followers, p.bio
     from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id where c.id in (${ids.map(lit).join(", ")})
     order by c.id, (p.platform = c.primary_platform) desc, p.followers desc nulls last`);
  return new Map(rows.map((x) => [x.id, { displayName: x.display_name, handle: x.handle, platform: x.platform, profileUrl: x.url ?? PROFILE_URL[x.platform]?.(x.handle) ?? "", city: x.city ?? "unknown", niches: x.niches.join("; "), followers: x.followers === null ? "unknown" : String(x.followers), bio: x.bio ?? "" }]));
}

/** Searchable catalogue creators (same exclusions as Search: active, no unreviewed minor) matching ANY of the query's words or concept forms, best text rank first, not yet returned. */
async function pool(text: string, exclude: string[]): Promise<string[]> {
  const u = understandQuery(text);
  const forms = [...new Set((expandQuery(u.text) ?? u.text.split(" ").filter(Boolean).map((w) => ({ forms: [w] }))).flatMap((g) => g.forms))];
  if (!forms.length || POOL_SIZE <= 0) return [];
  const ts = forms.map((x) => `plainto_tsquery('simple', ${lit(x)})`).join(" || ");
  const rows = await ownerQuery<{ id: string }>(
    `select d.creator_id id from gcp.creator_search_documents d join gcp.creators c on c.id = d.creator_id
     where c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null) and d.search_vector @@ (${ts})${exclude.length ? ` and d.creator_id not in (${exclude.map(lit).join(", ")})` : ""}
     order by ts_rank_cd(d.search_vector, ${ts}) desc, d.creator_id limit ${POOL_SIZE}`);
  return rows.map((x) => x.id);
}

const [queriesPath, outDir] = process.argv.slice(2);
if (!queriesPath || !outDir) throw new Error("usage: run-brain1.ts <queries.csv> <out-dir>");

const db = createTestDatabase(); // refuses anything but a local database named with test/disposable
const logger = createLogger({ level: "silent" });
const billing = createBillingService({ db, payments: new MockPayments({ webhookSecret: "e".repeat(40), publicApiUrl: "http://eval.local", deliver: async () => {} }), cache: new MemoryAccessCache(), logger });
const service = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: Buffer.alloc(32), logger });

// An evaluation workspace with labelled credits in the disposable copy (searches are charged as in production).
const ws = await createTestWorkspace();
await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId)); // a plan, as every real workspace has
await ownerQuery(`with lot as (insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at) values ('${ws.workspaceId}', 'adjustment', 100000, 100000, now() + interval '1 day') returning id)
  insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, source_ref, note) select '${ws.workspaceId}', 100000, 'grant', id, 'search-eval', 'Search evaluation credits (disposable copy)' from lot`);
const ctx: TenantContext = { ...ws, requestId: "search-eval", role: "owner" };
const price = (await ownerQuery<{ credits: number }>(`select credits from platform.credit_action_costs where action = 'search_existing'`))[0]?.credits ?? 0;

const [header, ...rows] = parseCsv(readFileSync(queriesPath, "utf8").replace(BOM_PREFIX, ""));
const col = (name: string) => header?.indexOf(name) ?? -1;
const results: unknown[] = [];
const candidates: CandidateRow[] = [];
const cases: CaseRow[] = [];
const queries = new Map<string, { query: string; expected: string }>();

for (const r of rows) {
  const caseId = r[col("case_id")] ?? "";
  const scenario = r[col("scenario")] ?? "";
  const text = r[col("query_text")] ?? "";
  const filtersRaw = (r[col("filters_json")] ?? "").trim();
  const expected = (r[col("hard_constraints")] ?? "").trim();
  queries.set(caseId, { query: text || `(no text; filters ${filtersRaw})`, expected });
  const started = performance.now();
  try {
    // The panel's filters_json is the EXPECTED reading of the query (for raters), not something a user set: the search
    // gets exactly what a user types. Only a filters-only case (no text) is run with its filters.
    const filters = searchFiltersSchema.parse(!text.trim() && filtersRaw ? JSON.parse(filtersRaw) : {});
    const out = await service.search(ctx, searchRequestSchema.parse({ text, filters, confirmedCost: price }));
    const ms = Math.round(performance.now() - started);
    const top = out.results.slice(0, 10);
    const behaviourOnly = BEHAVIOUR_ONLY.has(scenario);
    results.push({ caseId, scenario, behaviourOnly, text, filters, latencyMs: ms, total: out.total, results: top.map((c, i) => ({ rank: i + 1, id: c.id, displayName: c.displayName, handle: c.handle, platform: c.platform })) });
    const shown = behaviourOnly ? [] : top;
    const pooled = text.trim() && !behaviourOnly ? await pool(text, top.map((c) => c.id)) : [];
    const info = await describe([...top.map((c) => c.id), ...pooled]);
    for (const [i, c] of shown.entries()) {
      const d = info.get(c.id);
      if (d) candidates.push({ caseId, creatorId: c.id, source: "result", rank: i + 1, ...d });
    }
    for (const id of pooled) {
      const d = info.get(id);
      if (d) candidates.push({ caseId, creatorId: id, source: "pool", rank: null, ...d });
    }
    cases.push({ caseId, query: queries.get(caseId)?.query ?? text, expected, outcome: top.length ? `${out.total} result(s), first: ${top.slice(0, 5).map((c) => `${c.displayName} (${c.platform})`).join("; ")}` : "no results" });
  } catch (err) {
    const reason = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message.split("\n")[0] : String(err);
    results.push({ caseId, scenario, text, filtersRaw, rejected: reason, latencyMs: Math.round(performance.now() - started) });
    cases.push({ caseId, query: queries.get(caseId)?.query ?? text, expected, outcome: `refused: ${reason}` });
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "brain1-results.json"), JSON.stringify({ at: new Date().toISOString(), price, poolSize: POOL_SIZE, cases: results }, null, 2));
const packet = writeRatingPacket(outDir, "brain1", queries, candidates, cases);
console.log(`${rows.length} queries, ${packet.rows} rows to rate (${packet.pooled} pooled) → ${outDir}`);
await db.close();
