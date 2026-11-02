/**
 * Search freeze check (owner decision 2026-10-15): proves that catalogue Search (Brain 1) and Live Discovery (Brain 2)
 * still produce exactly what the human rating packets were made from, so the ratings stay valid. Run it after any
 * change that could touch Search. It re-runs both on the frozen inputs with the clock pinned to the packet runs:
 *   Brain 1: the 35-query panel on the disposable corpus database (no provider is called);
 *   Brain 2: the 25 recorded briefs through the real runner, every provider key blank (replay only, no spend);
 * then compares the regenerated blind sheets, keys and behaviour sheets byte for byte with the packets.
 *
 *   Brain 1 reads the corpus database mushin_eval_disposable. The Brain 2 replay runs the integration test runner,
 *   which TRUNCATES its database: it uses FREEZE_REPLAY_TEST_DATABASE_URL (default mushin_test_claude), never
 *   TEST_DATABASE_URL, and refuses the corpus (on 2026-10-16 an inherited TEST_DATABASE_URL emptied the corpus).
 *   node --import tsx scripts/search-eval/freeze-check.ts <queries.csv>
 * Exit code 0 only when both match.
 */
import { execFileSync } from "node:child_process";
import { assertTruncatableTestDatabaseUrl } from "@mushin/db/testing";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evalDir = join(repo, "eval-data");
const queries = process.argv[2];
if (!queries) {
  console.error("usage: freeze-check.ts <queries.csv>");
  process.exit(2);
}
// Current packets: creator eligibility policy elig-1, both brains run with the clock pinned to the same instant.
// (The superseded pre-eligibility packets blind-b1/blind-b2 used 2026-10-15T13:59:07.039Z and 13:53:35.002Z.)
const B1_AT = "2026-10-16T12:00:00.000Z";
const B2_AT = "2026-10-16T12:00:00.000Z";
const B1_PACKET = "blind-b1-elig1";
const B2_PACKET = "blind-b2-elig1";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const node = (args: string[], env: Record<string, string>) =>
  execFileSync(process.execPath, args, { cwd: repo, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] }).toString();
const same = (a: string, b: string) => readFileSync(a).equals(readFileSync(b));

const failures: string[] = [];

// Brain 1
const b1Out = join(evalDir, "runs", `freeze-b1-${stamp}`);
node(["--import", "tsx", "scripts/search-eval/run-brain1.ts", queries, b1Out], {
  EVAL_NOW: B1_AT,
  TEST_DATABASE_URL: "postgres://postgres@localhost:54330/mushin_eval_disposable",
  TEST_DATABASE_SSL_CA_FILE: "",
});
for (const f of ["brain1-rater-A.csv", "brain1-rater-B.csv", "brain1-key.csv", "brain1-cases-A.csv"]) {
  if (!same(join(b1Out, f), join(evalDir, "packets", B1_PACKET, f))) failures.push(`Brain 1 ${f} differs`);
}

// Brain 2 (on its own truncatable test database, never the corpus)
const replayDb = assertTruncatableTestDatabaseUrl(process.env["FREEZE_REPLAY_TEST_DATABASE_URL"] ?? "postgres://postgres@localhost:54330/mushin_test_claude");
const label = `freeze-b2-${stamp}`;
const blank = { SERPER_API_KEY: "", APIFY_TOKEN: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OLLAMA_API_KEY: "", YOUTUBE_API_KEY: "", LIVE_REPLAY_ALLOW_LIVE: "", LIVE_REPLAY_LIVE_LLM: "", LIVE_REPLAY_EXTRACT_BUDGET_USD: "0" };
node([join(repo, "node_modules", "vitest", "vitest.mjs"), "run", "apps/api/src/modules/discovery/live-replay.live.int.test.ts"], {
  ...blank,
  LIVE_DISCOVERY_REPLAY: "1",
  LIVE_EVAL_OUT: join(evalDir, "recordings"),
  LIVE_REPLAY_LABEL: label,
  LIVE_REPLAY_NOW: B2_AT,
  TEST_DATABASE_URL: replayDb,
  TEST_DATABASE_SSL_CA_FILE: "",
});
const b2Out = join(evalDir, "runs", label);
node(["--import", "tsx", "scripts/search-eval/brain2-sheets.ts", join(evalDir, "recordings"), label, b2Out], {});
for (const f of ["brain2-rater-A.csv", "brain2-rater-B.csv", "brain2-key.csv", "brain2-cases-A.csv"]) {
  if (!same(join(b2Out, f), join(evalDir, "packets", B2_PACKET, f))) failures.push(`Brain 2 ${f} differs`);
}

if (failures.length) {
  console.error(`SEARCH FREEZE BROKEN:\n  ${failures.join("\n  ")}\nThe rating packets no longer describe the current Search.`);
  process.exit(1);
}
console.log("Search freeze intact: Brain 1 (35 queries) and Brain 2 (25 briefs) reproduce the rating packets byte for byte.");
