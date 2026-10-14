/**
 * Brain 1 (catalogue Search) human evaluation, step 1: run every panel query through the real search service and write
 * two identical, independent rating sheets (rater A and rater B) plus the raw results.
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
import { createCreatorsService, createPostgresCatalogSearch } from "../../apps/api/src/modules/creators/index";
import { parseCsv, toCsv } from "./metrics";

/** Byte-order mark so spreadsheet apps open the UTF-8 sheets (Urdu text) correctly. */
const BOM = String.fromCharCode(0xfeff);
const BOM_PREFIX = new RegExp(`^${BOM}`);

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
const sheet: (string | number | null)[][] = [["case_id", "scenario", "query", "filters", "rank", "creator_id", "display_name", "handle", "platform", "city", "niches", "followers", "bio_excerpt", "rating_0_1_2", "note"]];

for (const r of rows) {
  const caseId = r[col("case_id")] ?? "";
  const scenario = r[col("scenario")] ?? "";
  const text = r[col("query_text")] ?? "";
  const filtersRaw = (r[col("filters_json")] ?? "").trim();
  const started = performance.now();
  try {
    // The panel's filters_json is the EXPECTED reading of the query (for raters), not something a user set: the search
    // gets exactly what a user types. Only a filters-only case (no text) is run with its filters.
    const filters = searchFiltersSchema.parse(!text.trim() && filtersRaw ? JSON.parse(filtersRaw) : {});
    const out = await service.search(ctx, searchRequestSchema.parse({ text, filters, confirmedCost: price }));
    const ms = Math.round(performance.now() - started);
    const top = out.results.slice(0, 10);
    results.push({ caseId, scenario, text, filters, latencyMs: ms, total: out.total, results: top.map((c, i) => ({ rank: i + 1, id: c.id, displayName: c.displayName, handle: c.handle, platform: c.platform })) });
    if (top.length === 0) sheet.push([caseId, scenario, text, filtersRaw, 0, "", "(no results)", "", "", "", "", "", "", "n/a", ""]);
    for (const [i, c] of top.entries()) {
      const bio = (await ownerQuery<{ bio: string | null }>(`select bio from gcp.creator_profiles where creator_id = '${c.id}' order by followers desc nulls last limit 1`))[0]?.bio ?? "";
      sheet.push([caseId, scenario, text, filtersRaw, i + 1, c.id, c.displayName, c.handle, c.platform, c.city ?? "unknown", c.niches.join("; "), c.followers ?? "unknown", bio.replace(/\s+/g, " ").slice(0, 160), "", ""]);
    }
  } catch (err) {
    const reason = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message.split("\n")[0] : String(err);
    results.push({ caseId, scenario, text, filtersRaw, rejected: reason, latencyMs: Math.round(performance.now() - started) });
    sheet.push([caseId, scenario, text, filtersRaw, 0, "", `(request rejected: ${reason})`, "", "", "", "", "", "", "n/a", ""]);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "brain1-results.json"), JSON.stringify({ at: new Date().toISOString(), price, cases: results }, null, 2));
for (const rater of ["A", "B"]) writeFileSync(join(outDir, `brain1-rater-${rater}.csv`), BOM + toCsv(sheet));
console.log(`${rows.length} queries, ${sheet.length - 1} rows to rate → ${outDir}`);
await db.close();
