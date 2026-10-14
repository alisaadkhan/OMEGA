/**
 * Brain 2 (Live Discovery) human evaluation from a recorded-response replay (no provider calls):
 *   node --import tsx scripts/search-eval/brain2-sheets.ts <recordings-dir> <replay-label> <out-dir>
 * Reads <recordings-dir>/baseline.json (briefs) and replays/<label>.json (written by live-replay.live.int.test.ts) and
 * writes brain2-rater-A.csv / brain2-rater-B.csv (delivered creators per brief, in delivery order), brain2-results.json
 * (for `score.ts <out-dir> brain2`) and brain2-funnel.md (outcomes, credits and the per-stage decision counts).
 * These are REPLAY results: they measure the pipeline on recorded provider responses, not live provider quality.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "./metrics";
import { readRecordedProfiles } from "./recordings";

const [dir, label, out] = process.argv.slice(2);
if (!dir || !label || !out) throw new Error("usage: brain2-sheets.ts <recordings-dir> <replay-label> <out-dir>");
const BOM = String.fromCharCode(0xfeff);

const briefs = (JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")) as { briefs: { id: string; text: string; filters: Record<string, unknown> }[] }).briefs;
type Entry = { id: string; outcome: string | null; delivered: number; deliveredHandles: string[]; credits: { quoted: number; charged: number }; byOutcome: Record<string, number>; ms: number; misses: Record<string, number> };
const replay = JSON.parse(readFileSync(join(dir, "replays", `${label}.json`), "utf8")) as { size: number; briefs: Entry[] };
const byUrl = new Map(readRecordedProfiles(dir).profiles.map((p) => [p.url, p]));

const sheet: (string | number | null)[][] = [["case_id", "scenario", "query", "filters", "rank", "creator_id", "display_name", "handle", "platform", "city", "niches", "followers", "bio_excerpt", "rating_0_1_2", "note"]];
const cases: unknown[] = [];
const stageTotals: Record<string, number> = {};
const lines: string[] = [`# Brain 2 replay funnel (${label}, size ${replay.size})`, "", "REPLAY on recorded provider responses; not a live-provider measurement.", "", "| Brief | Outcome | Delivered | Quoted | Charged | Missing recordings |", "|---|---|---|---|---|---|"];
for (const e of replay.briefs) {
  const brief = briefs.find((b) => b.id === e.id);
  lines.push(`| ${e.id} | ${e.outcome ?? ""} | ${e.delivered} | ${e.credits.quoted} | ${e.credits.charged} | ${Object.entries(e.misses).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ")} |`);
  for (const [k, n] of Object.entries(e.byOutcome)) {
    const key = k.split(":").slice(1).join(":"); // stage:decision:reason, all platforms together
    stageTotals[key] = (stageTotals[key] ?? 0) + n;
  }
  cases.push({ caseId: e.id, scenario: "live_replay", latencyMs: e.ms, total: e.delivered, results: e.deliveredHandles.map((url, i) => ({ rank: i + 1, id: url })) });
  if (e.deliveredHandles.length === 0) sheet.push([e.id, "live_replay", brief?.text ?? "", JSON.stringify(brief?.filters ?? {}), 0, "", `(${e.outcome ?? "no result"})`, "", "", "", "", "", "", "n/a", ""]);
  for (const [i, url] of e.deliveredHandles.entries()) {
    const p = byUrl.get(url);
    sheet.push([e.id, "live_replay", brief?.text ?? "", JSON.stringify(brief?.filters ?? {}), i + 1, url, p?.profile.displayName ?? "(not in recordings)", p?.profile.handle ?? "", p?.platform ?? "", "", "", p?.profile.followers ?? "unknown", (p?.profile.bio ?? "").replace(/\s+/g, " ").slice(0, 160), "", ""]);
  }
}
lines.push("", "## Decisions across all briefs (stage:decision:reason → candidates)", "", ...Object.entries(stageTotals).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`));

mkdirSync(out, { recursive: true });
for (const r of ["A", "B"]) writeFileSync(join(out, `brain2-rater-${r}.csv`), BOM + toCsv(sheet));
writeFileSync(join(out, "brain2-results.json"), JSON.stringify({ label, cases }, null, 1));
writeFileSync(join(out, "brain2-funnel.md"), lines.join("\n") + "\n");
console.log(`${replay.briefs.length} briefs, ${sheet.length - 1} rows to rate → ${out}`);
