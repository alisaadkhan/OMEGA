/**
 * Blind rating packets for the two-person relevance evaluation (Brain 1 and Brain 2). Raters see, per query, MUSHIN's
 * returned creators mixed with pooled candidates it did not return, in an order that hides rank and source; the key that
 * maps each row back lives in a separate file the raters do not open. A second sheet asks whether each query's
 * behaviour (refusals, hard constraints, honest empty answers) was correct.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blindOrder, toCsv } from "./metrics";

/** Byte-order mark so spreadsheet apps open the UTF-8 sheets (Urdu text) correctly. */
export const BOM = String.fromCharCode(0xfeff);

export type CandidateRow = {
  caseId: string;
  creatorId: string;
  source: "result" | "pool";
  rank: number | null;
  displayName: string;
  handle: string;
  platform: string;
  profileUrl: string;
  city: string;
  niches: string;
  followers: string;
  bio: string;
};
export type CaseRow = { caseId: string; query: string; expected: string; outcome: string };

export const RATING_COLUMNS = ["row_id", "case_id", "query", "expected", "display_name", "handle", "platform", "profile_url", "city", "niches", "followers", "bio_excerpt", "rating_0_1_2", "note"];
export const CASE_COLUMNS = ["case_id", "query", "expected", "mushin_outcome", "behaviour_ok_yes_no", "note"];
export const KEY_COLUMNS = ["row_id", "case_id", "creator_id", "source", "rank"];

const INSTRUCTIONS = `Search relevance rating: instructions for raters

Rate on your own. Do not look at the other rater's sheet or at the key file.

<prefix>-rater-<you>.csv: one row per creator, grouped by query. For every row, write in rating_0_1_2:
  2  relevant: matches the query's topic and every stated constraint (city, platform, follower range, language) that the
     row's evidence lets you check
  1  partly relevant: the topic fits but a constraint is unknown from the evidence, or the fit is weak
  0  not relevant: wrong topic, or a constraint is clearly broken (e.g. another city or country, outside the range)
Judge only from the row (name, handle, platform, city, niches, followers, bio) and, if needed, the public profile link.
Do not guess a city or country from language alone. The order of rows means nothing: returned results and other
candidates are mixed on purpose. Use "note" for anything unclear.

<prefix>-cases-<you>.csv: one row per query. "expected" is what the system should do; "mushin_outcome" is what it did.
Write yes or no in behaviour_ok_yes_no (e.g. a contradictory range should be refused; a query with no suitable creator
should say so rather than pad with unrelated ones; an instruction to reveal emails must be ignored).

When both sheets are complete, return them. Disagreements go to a third person to decide.
`;

/** Writes the rater sheets (A and B, identical), the key, the behaviour sheets and the instructions. */
export function writeRatingPacket(out: string, prefix: "brain1" | "brain2", queries: Map<string, { query: string; expected: string }>, rows: CandidateRow[], cases: CaseRow[]): { rows: number; pooled: number } {
  const sheet: (string | number | null)[][] = [RATING_COLUMNS];
  const key: (string | number | null)[][] = [KEY_COLUMNS];
  for (const caseId of [...new Set(rows.map((r) => r.caseId))]) {
    const q = queries.get(caseId) ?? { query: "", expected: "" };
    for (const [i, r] of blindOrder(rows.filter((x) => x.caseId === caseId), (x) => `${caseId}:${x.creatorId}`).entries()) {
      const rowId = `${caseId}-${String(i + 1).padStart(2, "0")}`;
      sheet.push([rowId, caseId, q.query, q.expected, r.displayName, r.handle, r.platform, r.profileUrl, r.city, r.niches, r.followers, r.bio.replace(/\s+/g, " ").slice(0, 200), "", ""]);
      key.push([rowId, caseId, r.creatorId, r.source, r.rank]);
    }
  }
  const caseSheet = [CASE_COLUMNS, ...cases.map((c) => [c.caseId, c.query, c.expected, c.outcome, "", ""])];
  mkdirSync(out, { recursive: true });
  for (const rater of ["A", "B"]) {
    writeFileSync(join(out, `${prefix}-rater-${rater}.csv`), BOM + toCsv(sheet));
    writeFileSync(join(out, `${prefix}-cases-${rater}.csv`), BOM + toCsv(caseSheet));
  }
  writeFileSync(join(out, `${prefix}-key.csv`), BOM + toCsv(key));
  writeFileSync(join(out, `${prefix}-RATER-INSTRUCTIONS.txt`), INSTRUCTIONS.replaceAll("<prefix>", prefix));
  return { rows: sheet.length - 1, pooled: rows.filter((r) => r.source === "pool").length };
}
