/**
 * Brain 1 human evaluation, step 2.
 *   node --import tsx scripts/search-eval/score.ts <out-dir>
 * Reads brain1-rater-A.csv and brain1-rater-B.csv (filled independently: rating 2 relevant, 1 partly, 0 not).
 * Without brain1-adjudicated.csv it reports agreement and writes the disagreements to brain1-to-adjudicate.csv (a third
 * person decides; copy the full sheet with the final ratings to brain1-adjudicated.csv). With it, it writes
 * brain1-report.md: precision@5/10 (strict = only 2, lenient = 1 or 2), nDCG@10 against the pooled judgements,
 * zero-result and rejected rates and latency. Recall is not reported: the judged pool is not a complete relevance set.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cohensKappa, mean, ndcgAt, parseCsv, percentile, precisionAt, toCsv, type Rating } from "./metrics";

/** Byte-order mark so spreadsheet apps open the UTF-8 sheets (Urdu text) correctly. */
const BOM = String.fromCharCode(0xfeff);
const BOM_PREFIX = new RegExp(`^${BOM}`);

const dir = process.argv[2];
if (!dir) throw new Error("usage: score.ts <out-dir>");
const read = (name: string) => parseCsv(readFileSync(join(dir, name), "utf8").replace(BOM_PREFIX, ""));
type Row = { caseId: string; rank: number; creatorId: string; rating: Rating | null; cells: string[] };
const load = (name: string): { header: string[]; rows: Row[] } => {
  const [header = [], ...data] = read(name);
  const i = (c: string) => header.indexOf(c);
  return {
    header,
    rows: data.map((cells) => {
      const raw = (cells[i("rating_0_1_2")] ?? "").trim();
      return { caseId: cells[i("case_id")] ?? "", rank: Number(cells[i("rank")]), creatorId: cells[i("creator_id")] ?? "", rating: raw === "0" || raw === "1" || raw === "2" ? (Number(raw) as Rating) : null, cells };
    }),
  };
};

const a = load("brain1-rater-A.csv");
const b = load("brain1-rater-B.csv");
const rated = (rows: Row[]) => rows.filter((r) => r.creatorId);
const pairs = rated(a.rows).map((r, idx) => [r, rated(b.rows)[idx]] as const);
const missing = pairs.filter(([x, y]) => x.rating === null || y?.rating === null || y === undefined).length;
if (missing > 0) {
  console.log(`${missing} of ${pairs.length} results are not rated by both raters yet. Nothing is reported until every row is rated.`);
  process.exit(1);
}
const kappa = cohensKappa(pairs.map(([x]) => x.rating as Rating), pairs.map(([, y]) => y?.rating as Rating));
const disagreements = pairs.filter(([x, y]) => x.rating !== y?.rating);
console.log(`Agreement: ${pairs.length - disagreements.length}/${pairs.length} identical, Cohen's kappa ${kappa?.toFixed(3)}`);

if (!existsSync(join(dir, "brain1-adjudicated.csv"))) {
  writeFileSync(
    join(dir, "brain1-to-adjudicate.csv"),
    BOM + toCsv([[...a.header, "rater_B"], ...disagreements.map(([x, y]) => [...x.cells, y?.rating ?? ""])]),
  );
  console.log(`${disagreements.length} disagreements written to brain1-to-adjudicate.csv. Adjudicate, then save brain1-adjudicated.csv.`);
  process.exit(0);
}

const final = load("brain1-adjudicated.csv");
if (rated(final.rows).some((r) => r.rating === null)) throw new Error("brain1-adjudicated.csv has unrated rows");
const results = JSON.parse(readFileSync(join(dir, "brain1-results.json"), "utf8")) as { cases: { caseId: string; scenario: string; latencyMs: number; total?: number; rejected?: string }[] };

const perCase = results.cases.map((c) => {
  const ranked = rated(final.rows).filter((r) => r.caseId === c.caseId).sort((x, y) => x.rank - y.rank).map((r) => r.rating as Rating);
  return {
    ...c,
    count: ranked.length,
    p5s: precisionAt(ranked, 5, true),
    p5l: precisionAt(ranked, 5, false),
    p10s: precisionAt(ranked, 10, true),
    p10l: precisionAt(ranked, 10, false),
    ndcg: ndcgAt(ranked, ranked, 10),
  };
});
const answered = perCase.filter((c) => !c.rejected);
const f = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
const lines = [
  "# Brain 1 relevance report",
  "",
  `Queries ${perCase.length}; answered ${answered.length}; rejected by validation ${perCase.length - answered.length}; zero results ${answered.filter((c) => c.count === 0).length} (${f(answered.filter((c) => c.count === 0).length / Math.max(1, answered.length))}).`,
  `Rater agreement: Cohen's kappa ${kappa?.toFixed(3)} over ${pairs.length} judged results; ${disagreements.length} adjudicated.`,
  `Mean precision@5 strict ${f(mean(answered.map((c) => c.p5s)))} / lenient ${f(mean(answered.map((c) => c.p5l)))}; precision@10 strict ${f(mean(answered.map((c) => c.p10s)))} / lenient ${f(mean(answered.map((c) => c.p10l)))}; nDCG@10 ${f(mean(answered.map((c) => c.ndcg)))} (pooled judgements; queries with nothing relevant judged are excluded).`,
  `Latency p50 ${percentile(results.cases.map((c) => c.latencyMs), 50)} ms, p95 ${percentile(results.cases.map((c) => c.latencyMs), 95)} ms (service call incl. charge).`,
  "",
  "| Case | Scenario | Results | P@5 strict | P@5 lenient | P@10 lenient | nDCG@10 | Note |",
  "|---|---|---|---|---|---|---|---|",
  ...perCase.map((c) => `| ${c.caseId} | ${c.scenario} | ${c.count} | ${f(c.p5s)} | ${f(c.p5l)} | ${f(c.p10l)} | ${f(c.ndcg)} | ${c.rejected ?? ""} |`),
];
writeFileSync(join(dir, "brain1-report.md"), lines.join("\n") + "\n");
console.log(lines.slice(0, 6).join("\n"));
