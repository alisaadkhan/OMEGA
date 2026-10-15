/**
 * Brain 2 (Live Discovery) human evaluation from a recorded-response replay (no provider calls):
 *   node --import tsx scripts/search-eval/brain2-sheets.ts <recordings-dir> <replay-label> <out-dir>
 * Reads <recordings-dir>/baseline.json (briefs) and replays/<label>.json (written by live-replay.live.int.test.ts) and
 * writes the blind rating packet (sheets.ts): the delivered creators per brief mixed with up to EVAL_POOL_SIZE (default
 * 10) recorded profiles the run found but did not deliver (rejected or not extracted). A pooled profile rated relevant
 * is a creator the pipeline missed or wrongly rejected. Candidates rejected as possible minors and hidden creators are
 * never shown. Also writes brain2-results.json (for `score.ts <out-dir> brain2`) and brain2-funnel.md.
 * These are REPLAY results: they measure the pipeline on recorded provider responses, not live provider quality.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readRecordedProfiles, type RecordedProfile } from "./recordings";
import { writeRatingPacket, type CandidateRow, type CaseRow } from "./sheets";

const [dir, label, out] = process.argv.slice(2);
if (!dir || !label || !out) throw new Error("usage: brain2-sheets.ts <recordings-dir> <replay-label> <out-dir>");
const POOL_SIZE = Number(process.env["EVAL_POOL_SIZE"] ?? 10);
const NEVER_SHOWN = new Set(["minor_or_unclear", "hidden_creator"]);
const STAGE_ORDER = ["fit", "relevance", "verification", "selection", "extraction", "cheap_gate", "normalization"];

const briefs = (JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")) as { briefs: { id: string; text: string; filters: Record<string, unknown> }[] }).briefs;
type Candidate = { key: string; stage: string; decision: string; reason: string | null };
type Entry = { id: string; outcome: string | null; delivered: number; deliveredHandles: string[]; candidates?: Candidate[]; credits: { quoted: number; charged: number }; fetched?: Record<string, number>; estimatedExtractionUsd?: number; byOutcome: Record<string, number>; ms: number; misses: Record<string, number> };
const replay = JSON.parse(readFileSync(join(dir, "replays", `${label}.json`), "utf8")) as { size: number; briefs: Entry[] };
if (replay.briefs.some((e) => !e.candidates)) throw new Error(`replays/${label}.json has no candidate trail: re-run the replay with the current harness`);
const byUrl = new Map(readRecordedProfiles(dir).profiles.map((p) => [p.url, p]));
const describe = (p: RecordedProfile | undefined) => ({
  displayName: p?.profile.displayName ?? "(not in recordings)",
  handle: p?.profile.handle ?? "",
  platform: p?.platform ?? "",
  city: "unknown",
  niches: "",
  followers: p?.profile.followers == null ? "unknown" : String(p.profile.followers),
  bio: p?.profile.bio ?? "",
});

const rows: CandidateRow[] = [];
const cases: CaseRow[] = [];
const queries = new Map<string, { query: string; expected: string }>();
const results: unknown[] = [];
const stageTotals: Record<string, number> = {};
const lines: string[] = [`# Brain 2 replay funnel (${label}, size ${replay.size})`, "", "REPLAY on recorded provider responses; not a live-provider measurement.", "", "Est. USD is the estimated profile-extraction cost (LIVE_PROFILE_USD_* per fetched profile; YouTube is API quota at USD 0). It excludes web search and LLM calls, so it is a lower bound on direct cost, never an invoice.", "", "| Brief | Outcome | Delivered | Pooled | Quoted | Charged | Profiles fetched | Est. USD | Est. USD per delivered | Missing recordings |", "|---|---|---|---|---|---|---|---|---|---|"];
const usd = (n: number) => n.toFixed(4);
const totals = { delivered: 0, fetched: 0, usd: 0, charged: 0, quoted: 0, empty: 0 };
for (const e of replay.briefs) {
  const brief = briefs.find((b) => b.id === e.id);
  const expected = `Creators matching the brief; filters ${JSON.stringify(brief?.filters ?? {})}. Too few suitable creators is reported, not padded.`;
  queries.set(e.id, { query: brief?.text ?? "", expected });
  for (const [k, n] of Object.entries(e.byOutcome)) {
    const stage = k.split(":").slice(1).join(":"); // stage:decision:reason, all platforms together
    stageTotals[stage] = (stageTotals[stage] ?? 0) + n;
  }
  for (const [i, url] of e.deliveredHandles.entries()) rows.push({ caseId: e.id, creatorId: url, source: "result", rank: i + 1, profileUrl: url, ...describe(byUrl.get(url)) });
  const delivered = new Set(e.deliveredHandles);
  const pool = (e.candidates ?? [])
    .filter((c) => !delivered.has(c.key) && byUrl.has(c.key) && !NEVER_SHOWN.has(c.reason ?? ""))
    .sort((x, y) => STAGE_ORDER.indexOf(x.stage) - STAGE_ORDER.indexOf(y.stage) || x.key.localeCompare(y.key))
    .slice(0, POOL_SIZE);
  for (const c of pool) rows.push({ caseId: e.id, creatorId: c.key, source: "pool", rank: null, profileUrl: c.key, ...describe(byUrl.get(c.key)) });
  cases.push({ caseId: e.id, query: brief?.text ?? "", expected, outcome: `${e.outcome ?? "no outcome"}: ${e.delivered} delivered of ${replay.size}; charged ${e.credits.charged} of ${e.credits.quoted} quoted credits` });
  results.push({ caseId: e.id, scenario: "live_replay", latencyMs: e.ms, total: e.delivered });
  const fetched = Object.values(e.fetched ?? {}).reduce((a, n) => a + n, 0);
  const est = e.estimatedExtractionUsd ?? 0;
  Object.assign(totals, { delivered: totals.delivered + e.delivered, fetched: totals.fetched + fetched, usd: totals.usd + est, charged: totals.charged + e.credits.charged, quoted: totals.quoted + e.credits.quoted, empty: totals.empty + (e.delivered === 0 ? 1 : 0) });
  lines.push(`| ${e.id} | ${e.outcome ?? ""} | ${e.delivered} | ${pool.length} | ${e.credits.quoted} | ${e.credits.charged} | ${fetched} | ${usd(est)} | ${e.delivered ? usd(est / e.delivered) : "n/a"} | ${Object.entries(e.misses).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ")} |`);
}
lines.push(
  `| **All ${replay.briefs.length} briefs** | ${totals.empty} empty | ${totals.delivered} |  | ${totals.quoted} | ${totals.charged} | ${totals.fetched} | ${usd(totals.usd)} | ${totals.delivered ? usd(totals.usd / totals.delivered) : "n/a"} |  |`,
);
lines.push("", "## Decisions across all briefs (stage:decision:reason → candidates)", "", ...Object.entries(stageTotals).sort((x, y) => y[1] - x[1]).map(([k, n]) => `- ${k}: ${n}`));

mkdirSync(out, { recursive: true });
const packet = writeRatingPacket(out, "brain2", queries, rows, cases);
writeFileSync(join(out, "brain2-results.json"), JSON.stringify({ label, poolSize: POOL_SIZE, cases: results }, null, 1));
writeFileSync(join(out, "brain2-funnel.md"), lines.join("\n") + "\n");
console.log(`${replay.briefs.length} briefs, ${packet.rows} rows to rate (${packet.pooled} pooled) → ${out}`);
