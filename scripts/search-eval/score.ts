/**
 * Search human evaluation, step 2 (Brain 1 catalogue or Brain 2 live replay).
 *   node --import tsx scripts/search-eval/score.ts <out-dir> [brain1|brain2]
 * Reads the blind packet written by run-brain1.ts / brain2-sheets.ts: <prefix>-rater-A/B.csv (2 relevant, 1 partly,
 * 0 not), <prefix>-cases-A/B.csv (behaviour yes/no) and <prefix>-key.csv. Rows are matched by row_id, so raters may sort
 * or filter their sheets; a sheet whose rows do not match the key is refused.
 * Without <prefix>-adjudicated.csv it reports agreement and writes every disagreement to <prefix>-to-adjudicate.csv (a
 * third person writes the final value in final_rating / final_behaviour, then saves it as <prefix>-adjudicated.csv).
 * With it, it writes <prefix>-report.md: strict and lenient precision@5/@10 of MUSHIN's results, nDCG@10 against every
 * judged row (results and pooled candidates), relevant-query coverage, behaviour cases, and the acceptance gates.
 * Recall is not reported: the pool is not a complete relevance set.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACCEPTANCE_GATES, cohensKappa, gate, mean, ndcgAt, parseCsv, percentile, precisionAt, relevantCoverage, toCsv, type Rating } from "./metrics";
import { BOM } from "./sheets";

const dir = process.argv[2];
const prefix = process.argv[3] ?? "brain1";
if (!dir || !/^brain[12]$/.test(prefix)) throw new Error("usage: score.ts <out-dir> [brain1|brain2]");
const BOM_PREFIX = new RegExp(`^${BOM}`);
const table = (name: string): Record<string, string>[] => {
  const [header = [], ...data] = parseCsv(readFileSync(join(dir, name), "utf8").replace(BOM_PREFIX, ""));
  return data.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])));
};
const asRating = (v: string | undefined): Rating | null => (v === "0" || v === "1" || v === "2" ? (Number(v) as Rating) : null);
const asYesNo = (v: string | undefined): "yes" | "no" | null => (/^(yes|y)$/i.test(v ?? "") ? "yes" : /^(no|n)$/i.test(v ?? "") ? "no" : null);

const key = new Map(table(`${prefix}-key.csv`).map((k) => [k["row_id"] ?? "", { caseId: k["case_id"] ?? "", source: k["source"] ?? "", rank: Number(k["rank"] || 0) }]));
/** Ratings by row_id, refusing a sheet with missing, extra or duplicated rows. */
function ratings(name: string, column: string): Map<string, Rating | null> {
  const rows = table(name);
  const out = new Map(rows.map((r) => [r["row_id"] ?? "", asRating(r[column])]));
  if (out.size !== rows.length || out.size !== key.size || [...key.keys()].some((id) => !out.has(id))) throw new Error(`${name}: its rows do not match ${prefix}-key.csv (rows added, removed or row_id changed)`);
  return out;
}
function behaviour(name: string, column: string): Map<string, "yes" | "no" | null> {
  return new Map(table(name).map((r) => [r["case_id"] ?? "", asYesNo(r[column])]));
}

const a = ratings(`${prefix}-rater-A.csv`, "rating_0_1_2");
const b = ratings(`${prefix}-rater-B.csv`, "rating_0_1_2");
const ca = behaviour(`${prefix}-cases-A.csv`, "behaviour_ok_yes_no");
const cb = behaviour(`${prefix}-cases-B.csv`, "behaviour_ok_yes_no");
const unrated = [...key.keys()].filter((id) => a.get(id) == null || b.get(id) == null).length + [...ca.keys()].filter((id) => ca.get(id) == null || cb.get(id) == null).length;
if (unrated > 0) {
  console.log(`${unrated} rows or cases are not rated by both raters yet. Nothing is reported until everything is rated.`);
  process.exit(1);
}
const ids = [...key.keys()];
const kappa = cohensKappa(ids.map((id) => a.get(id) as Rating), ids.map((id) => b.get(id) as Rating));
const rowDisagreements = ids.filter((id) => a.get(id) !== b.get(id));
const caseDisagreements = [...ca.keys()].filter((id) => ca.get(id) !== cb.get(id));
console.log(`Agreement: ${ids.length - rowDisagreements.length}/${ids.length} rows identical, Cohen's kappa ${kappa?.toFixed(3)}; behaviour ${ca.size - caseDisagreements.length}/${ca.size} identical`);

const adjudicatedPath = join(dir, `${prefix}-adjudicated.csv`);
if (!existsSync(adjudicatedPath)) {
  writeFileSync(
    join(dir, `${prefix}-to-adjudicate.csv`),
    BOM + toCsv([["kind", "id", "rater_A", "rater_B", "final"], ...rowDisagreements.map((id) => ["row", id, a.get(id) ?? "", b.get(id) ?? "", ""]), ...caseDisagreements.map((id) => ["case", id, ca.get(id) ?? "", cb.get(id) ?? "", ""])]),
  );
  console.log(`${rowDisagreements.length + caseDisagreements.length} disagreements written to ${prefix}-to-adjudicate.csv. Fill "final", save as ${prefix}-adjudicated.csv.`);
  process.exit(0);
}

// Final values: agreed ones, plus the adjudicator's decision for every disagreement.
const decided = new Map(table(`${prefix}-adjudicated.csv`).map((r) => [`${r["kind"]}:${r["id"]}`, r["final"] ?? ""]));
const finalRating = (id: string): Rating => {
  if (a.get(id) === b.get(id)) return a.get(id) as Rating;
  const v = asRating(decided.get(`row:${id}`));
  if (v === null) throw new Error(`${prefix}-adjudicated.csv: row ${id} has no final rating`);
  return v;
};
const finalBehaviour = (id: string): "yes" | "no" => {
  if (ca.get(id) === cb.get(id)) return ca.get(id) as "yes" | "no";
  const v = asYesNo(decided.get(`case:${id}`));
  if (v === null) throw new Error(`${prefix}-adjudicated.csv: case ${id} has no final behaviour`);
  return v;
};

const results = JSON.parse(readFileSync(join(dir, `${prefix}-results.json`), "utf8")) as { cases: { caseId: string; scenario: string; latencyMs: number; rejected?: string; behaviourOnly?: boolean }[] };
const perCase = results.cases.map((c) => {
  const rows = ids.filter((id) => key.get(id)?.caseId === c.caseId);
  const returned = rows.filter((id) => key.get(id)?.source === "result").sort((x, y) => (key.get(x)?.rank ?? 0) - (key.get(y)?.rank ?? 0)).map(finalRating);
  const judged = rows.map(finalRating);
  return { ...c, returned, judged, pooled: judged.length - returned.length, behaviour: ca.has(c.caseId) ? finalBehaviour(c.caseId) : null, p5s: precisionAt(returned, 5, true), p5l: precisionAt(returned, 5, false), p10l: precisionAt(returned, 10, false), ndcg: ndcgAt(returned, judged, 10) };
});
// Relevance metrics cover the topical queries MUSHIN answered; behaviour-only cases are judged on the behaviour sheet.
const answered = perCase.filter((c) => !c.rejected && !c.behaviourOnly);
const coverage = relevantCoverage(answered);
const withBehaviour = perCase.filter((c) => c.behaviour !== null);
const behaviourShare = withBehaviour.length ? withBehaviour.filter((c) => c.behaviour === "yes").length / withBehaviour.length : null;
const gates = [
  gate("Rater agreement (Cohen's kappa)", kappa, ACCEPTANCE_GATES.kappa),
  gate("Mean precision@5, strict (rating 2 only)", mean(answered.map((c) => c.p5s)), ACCEPTANCE_GATES.precisionAt5),
  gate("Mean nDCG@10 (pooled judgements)", mean(answered.map((c) => c.ndcg)), ACCEPTANCE_GATES.ndcgAt10),
  gate("Relevant-query coverage", coverage.share, ACCEPTANCE_GATES.coverage),
  gate("Behaviour cases correct", behaviourShare, ACCEPTANCE_GATES.behaviour),
];
const f = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
const failed = gates.filter((g) => !g.pass);
const lines = [
  `# ${prefix === "brain1" ? "Brain 1 catalogue" : "Brain 2 live (REPLAY)"} relevance report`,
  "",
  failed.length ? `**Acceptance gates NOT met:** ${failed.map((g) => g.name).join("; ")}.` : "**All acceptance gates met on this panel.** Acceptance still needs the owner's sign-off on this evidence.",
  "",
  "| Gate | Value | Threshold | Result |",
  "|---|---|---|---|",
  ...gates.map((g) => `| ${g.name} | ${f(g.value)} | ${g.threshold} | ${g.pass ? "pass" : "FAIL"} |`),
  "",
  `Queries ${perCase.length}; behaviour-only ${perCase.filter((c) => c.behaviourOnly).length}; refused ${perCase.filter((c) => c.rejected).length}; topical answered ${answered.length}; zero results ${answered.filter((c) => c.returned.length === 0).length}.`,
  `Judged rows ${ids.length} (${ids.length - rowDisagreements.length} agreed, ${rowDisagreements.length} adjudicated); pooled candidates ${perCase.reduce((n, c) => n + c.pooled, 0)}.`,
  `Coverage: ${coverage.covered} of ${coverage.answerable} queries with a relevant creator in the judged pool returned one. Queries with no relevant creator judged anywhere: ${answered.length - coverage.answerable}.`,
  `Precision@5 lenient ${f(mean(answered.map((c) => c.p5l)))}; precision@10 lenient ${f(mean(answered.map((c) => c.p10l)))}. Latency p50 ${percentile(results.cases.map((c) => c.latencyMs), 50)} ms, p95 ${percentile(results.cases.map((c) => c.latencyMs), 95)} ms.`,
  "",
  "| Case | Scenario | Returned | Pooled | Relevant exists | P@5 strict | P@5 lenient | nDCG@10 | Behaviour ok | Refused |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...perCase.map((c) => `| ${c.caseId} | ${c.scenario} | ${c.returned.length} | ${c.pooled} | ${c.judged.includes(2) ? "yes" : "no"} | ${f(c.p5s)} | ${f(c.p5l)} | ${f(c.ndcg)} | ${c.behaviour ?? ""} | ${c.rejected ?? ""} |`),
];
writeFileSync(join(dir, `${prefix}-report.md`), lines.join("\n") + "\n");
console.log(lines.slice(0, 10).join("\n"));
