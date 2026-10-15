/**
 * Builds one folder per person for the Search rating round, so nobody receives files they must not see:
 *   rater-A/ and rater-B/: that rater's blind sheets (Brain 1 and Brain 2) and the instructions; never the key or the
 *                          other rater's sheets.
 *   adjudicator/:          instructions only; the to-adjudicate files are produced by score.ts after both raters return.
 * A SHA-256 manifest of every handed-out sheet is written next to the kits (not inside them), so a returned sheet can be
 * matched to what was sent. score.ts separately refuses sheets with missing, extra or renamed rows.
 *
 *   node --import tsx scripts/search-eval/make-rater-kits.ts <brain1-packet-dir> <brain2-packet-dir> <out-dir> <delete-by YYYY-MM-DD>
 * No database or provider is used.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [b1, b2, out, deleteBy] = process.argv.slice(2);
if (!b1 || !b2 || !out || !deleteBy || !/^\d{4}-\d{2}-\d{2}$/.test(deleteBy)) {
  console.error("usage: make-rater-kits.ts <brain1-packet-dir> <brain2-packet-dir> <out-dir> <delete-by YYYY-MM-DD>");
  process.exit(1);
}

const RETENTION = `DATA RETENTION: these sheets contain YouTube API data and public creator profiles. Keep them on your own
computer only, do not upload them to other tools or services, and delete every copy (including e-mail attachments) once
you have returned your sheets, and in any case before ${deleteBy}.`;

const RATER = (who: "A" | "B") => `MUSHIN Search rating: rater ${who}

You rate two blind sheets for each search system, on your own, without discussing them with the other rater:
  brain1-rater-${who}.csv and brain1-cases-${who}.csv: catalogue Search (Brain 1)
  brain2-rater-${who}.csv and brain2-cases-${who}.csv: Find New Creators / Live Discovery (Brain 2)
Read brain1-RATER-INSTRUCTIONS.txt and brain2-RATER-INSTRUCTIONS.txt first; the rules are the same for both.

Rules:
- Fill only rating_0_1_2 (2, 1 or 0) and note on the rater sheets, and behaviour_ok_yes_no (yes or no) and note on the
  cases sheets. Do not add, delete or reorder rows or change any other column; a changed sheet is refused when scored.
- Rate every row. If you cannot decide, choose the lower rating and explain in note.
- Judge from the row and, if needed, the public profile link. Do not search for the creator elsewhere and do not guess
  a city or country from language or name.
- Save as CSV (UTF-8) with the same file names and return all four files to the coordinator.

${RETENTION}
`;

const ADJUDICATOR = `MUSHIN Search rating: adjudicator

You decide only the rows where the two raters disagree. After both raters return their sheets, the coordinator runs
score.ts, which writes brain1-to-adjudicate.csv and brain2-to-adjudicate.csv. For each row, write the final value in
"final" (0, 1 or 2 for a creator; yes or no for a behaviour case), using the same instructions as the raters
(brain1-RATER-INSTRUCTIONS.txt), and save the file as brain1-adjudicated.csv / brain2-adjudicated.csv. Do not change the
raters' sheets. The coordinator then runs score.ts again to produce the gate report.

${RETENTION}
`;

const manifest: string[] = ["file,sha256"];
const copy = (from: string, to: string, file: string) => {
  const src = join(from, file);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  copyFileSync(src, join(to, file));
  manifest.push(`${to.split(/[\\/]/).slice(-1)[0]}/${file},${createHash("sha256").update(readFileSync(src)).digest("hex")}`);
};

for (const who of ["A", "B"] as const) {
  const dir = join(out, `rater-${who}`);
  mkdirSync(dir, { recursive: true });
  for (const f of [`brain1-rater-${who}.csv`, `brain1-cases-${who}.csv`, "brain1-RATER-INSTRUCTIONS.txt"]) copy(b1, dir, f);
  for (const f of [`brain2-rater-${who}.csv`, `brain2-cases-${who}.csv`, "brain2-RATER-INSTRUCTIONS.txt"]) copy(b2, dir, f);
  writeFileSync(join(dir, "README.txt"), RATER(who));
}
const adj = join(out, "adjudicator");
mkdirSync(adj, { recursive: true });
copy(b1, adj, "brain1-RATER-INSTRUCTIONS.txt");
writeFileSync(join(adj, "README.txt"), ADJUDICATOR);
writeFileSync(join(out, "kits-manifest.csv"), manifest.join("\n") + "\n");
console.log(`kits written to ${out}: rater-A, rater-B, adjudicator (keys withheld); delete by ${deleteBy}`);
