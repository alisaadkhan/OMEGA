/**
 * Acceptance on REAL data, read-only (CORPUS-*): the frozen evaluation corpus (mushin_eval_disposable, 455 creators,
 * 204 eligible; never AI-assessed, so no structured city/niche/contact data). Only the production query parser
 * (understand.ts) and PostgreSQL retrieval are run, so nothing is written (no charge rows, no index writes). These are
 * software-behaviour probes on real text, NOT relevance judgements and NOT official quality metrics.
 * Corpus integrity is proven separately by content hashes taken before and after the campaign.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { createDatabase } from "@mushin/db";
import { evidence } from "../../acceptance/harness";
import { createPostgresCatalogSearch } from "./postgres-search";
import { understandQuery } from "./understand";

const CORPUS = (process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:54330/x").replace(/\/[^/]+$/, "/mushin_eval_disposable");
const corpus = createDatabase(CORPUS, { max: 2, applicationName: "acceptance-corpus-readonly", caPem: null });
const search = createPostgresCatalogSearch(corpus);
const ctx = { userId: randomUUID(), workspaceId: randomUUID() };
afterAll(() => corpus.close());

async function run(text: string, filters: Record<string, unknown> = {}) {
  const u = understandQuery(text);
  const f = searchFiltersSchema.parse({ ...filters, ...Object.fromEntries(Object.entries(u.filters).filter(([, v]) => v !== undefined)) });
  const out = await search.search({ text: u.text, boost: u.optional, filters: f, freshCurrentDays: 7, now: new Date(), limit: 200 }, ctx);
  return { parsed: u.text, filters: u.filters, ids: out.hits.map((h) => h.id) };
}
const docs = (ids: string[]) =>
  corpus.withTenant(ctx, async (tx) => {
    if (ids.length === 0) return [] as { id: string; platforms: string[]; eligible: boolean; has_contact: boolean }[];
    const { sql } = await import("drizzle-orm");
    return tx.execute<{ id: string; platforms: string[]; eligible: boolean; has_contact: boolean }>(sql`select creator_id as id, platforms, eligible, has_contact from gcp.creator_search_documents where creator_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  });

describe("frozen corpus, read-only (CORPUS)", () => {
  it("CORPUS-01 equivalent supported wordings of 'food creators in Lahore' return the identical set on real data", async () => {
    const wordings = ["food vloggers in Lahore", "food bloggers in Lahore", "food content creators based in Lahore", "Lahore mein khana walay vloggers", "LHR foodie", "food vlogers in lahor"];
    const runs = await Promise.all(wordings.map((w) => run(w)));
    const base = [...(runs[0]?.ids ?? [])].sort().join();
    evidence("CORPUS-01", { results: wordings.map((w, i) => ({ wording: w, parsed: runs[i]?.parsed, count: runs[i]?.ids.length, sameSetAsFirst: [...(runs[i]?.ids ?? [])].sort().join() === base })) });
    for (const r of runs) expect([...r.ids].sort().join()).toBe(base);
  });

  it("CORPUS-02 outside-vocabulary and control wordings on real data: counts and overlap recorded; controls differ from the baseline", async () => {
    const base = await run("food vloggers in Lahore");
    const cases = ["creators who review restaurants in Lahore", "YouTubers covering food in Lahore", "food review influencers in Lahore", "لاہور کے کھانے والے", "لاہور فوڈ بلاگر", "food vloggers in Karachi", "fashion vloggers in Lahore", "food vloggers in Lahore on TikTok", "food vloggers in Quetta"];
    const out = [];
    for (const c of cases) {
      const r = await run(c);
      out.push({ wording: c, parsed: r.parsed, filters: r.filters, count: r.ids.length, overlapWithBaseline: r.ids.filter((id) => base.ids.includes(id)).length });
    }
    evidence("CORPUS-02", { baseline: { count: base.ids.length }, cases: out });
    const karachi = out.find((o) => o.wording.includes("Karachi"));
    const fashion = out.find((o) => o.wording.startsWith("fashion"));
    expect(base.ids.length).toBeGreaterThan(0);
    expect(karachi?.overlapWithBaseline).toBeLessThan(base.ids.length);
    expect(fashion?.overlapWithBaseline).toBeLessThan(base.ids.length);
  });

  it("CORPUS-03 text-only coverage probe over the 35 frozen Brain 1 query texts (not the official protocol)", async () => {
    const csv = readFileSync(new URL("../../../../../../MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/testing/search_eval_queries_unlabeled.csv", import.meta.url), "utf8").replace(/^\uFEFF/, "");
    // RFC 4180 fields (quoted fields may hold commas and doubled quotes); query_text is the 4th column.
    const records: string[][] = [];
    let field = "", row: string[] = [], quoted = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i] as string;
      if (quoted) {
        if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && csv[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some(Boolean)) records.push(row); row = []; }
      else field += ch;
    }
    if (field || row.length) { row.push(field); records.push(row); }
    const texts = records.slice(1).map((r) => r[3] ?? "").filter(Boolean);
    const counts: number[] = [];
    const refused: string[] = [];
    for (const t of texts) {
      // A contradictory range (the Q022 behaviour case) is refused by the API as conflicting_range, before searching.
      const parsed = searchFiltersSchema.safeParse(understandQuery(t).filters);
      if (!parsed.success) refused.push(t);
      else counts.push((await run(t)).ids.length);
    }
    const zero = counts.filter((n) => n === 0).length;
    evidence("CORPUS-03", { queries: texts.length, refusedAsContradictory: refused, searched: counts.length, zeroResultQueries: zero, zeroResultRate: +(zero / counts.length).toFixed(3), medianCount: [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)], note: "text only; official runs apply each query's filters via the freeze tooling" });
    // 35 frozen Brain 1 cases; Q021 is filters-only (no text), so 34 carry a query text.
    expect(records.length - 1).toBe(35);
    expect(texts.length).toBe(34);
    expect(refused).toHaveLength(1);
  });

  it("CORPUS-04 no duplicate creators in any real result list (variation set and frozen texts)", async () => {
    const texts = ["food vloggers in Lahore", "skincare lahore", "travel vlogger", "tech reviews", "cooking recipes", "lahore", "karachi food"];
    let dups = 0;
    for (const t of texts) {
      const r = await run(t);
      dups += r.ids.length - new Set(r.ids).size;
    }
    evidence("CORPUS-04", { queries: texts.length, duplicateResults: dups });
    expect(dups).toBe(0);
  });

  it("CORPUS-05 every returned real creator is eligible and claims no contact the corpus does not hold", async () => {
    const r = await run("food");
    const d = await docs(r.ids);
    evidence("CORPUS-05", { returned: r.ids.length, ineligible: d.filter((x) => !x.eligible).length, claimingContact: d.filter((x) => x.has_contact).length });
    expect(d.filter((x) => !x.eligible)).toEqual([]);
    expect(d.filter((x) => x.has_contact)).toEqual([]);
  });

  it("CORPUS-06 the platform filter holds on real data (TikTok, YouTube, Instagram)", async () => {
    const out: Record<string, { returned: number; wrong: number }> = {};
    for (const p of ["tiktok", "youtube", "instagram"]) {
      const r = await run("food", { platform: p });
      const d = await docs(r.ids);
      out[p] = { returned: r.ids.length, wrong: d.filter((x) => !x.platforms.includes(p)).length };
    }
    evidence("CORPUS-06", out);
    expect(Object.values(out).every((o) => o.wrong === 0)).toBe(true);
  });

  it("CORPUS-07 deterministic ordering on real data: the same query five times gives one ordering", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 5; i++) orders.add((await run("lahore food")).ids.join());
    evidence("CORPUS-07", { distinctOrderings: orders.size });
    expect(orders.size).toBe(1);
  });
});
