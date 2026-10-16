/**
 * Deletes the Search evaluation data that holds YouTube API data and public creator profiles (YouTube API Services
 * policy: delete or refresh within 30 days; owner deadline 2026-11-12):
 *   - everything under eval-data/ except eval-data/reports/ (aggregate gate reports, which hold no creator rows);
 *   - the disposable corpus database mushin_eval_disposable (local only).
 * Without --confirm it only lists what would be deleted. Copies handed to raters must be deleted by them (kit README).
 *
 *   node --import tsx scripts/search-eval/purge-eval-data.ts [--confirm]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const root = join(repo, "eval-data");
const confirm = process.argv.includes("--confirm");
const KEEP = new Set(["reports"]);
const DB = "mushin_eval_disposable";

const targets = existsSync(root) ? readdirSync(root).filter((n) => !KEEP.has(n)).map((n) => join(root, n)) : [];
const size = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, n) => s + size(join(p, n)), 0) : statSync(p).size);
for (const t of targets) console.log(`${confirm ? "deleting" : "would delete"} ${t} (${(size(t) / 1e6).toFixed(1)} MB)`);

const pgBin = process.env["PG_BIN"];
const dropdb = pgBin ? join(pgBin, process.platform === "win32" ? "dropdb.exe" : "dropdb") : null;
console.log(`${confirm ? "dropping" : "would drop"} database ${DB} on localhost:54330${dropdb ? "" : " (set PG_BIN to the PostgreSQL bin folder)"}`);

if (!confirm) {
  console.log("dry run: nothing deleted. Re-run with --confirm.");
  process.exit(0);
}
for (const t of targets) rmSync(t, { recursive: true, force: true });
if (dropdb) execFileSync(dropdb, ["-h", "localhost", "-p", "54330", "-U", "postgres", "--if-exists", DB], { stdio: "inherit" });
else console.warn(`database ${DB} not dropped: PG_BIN is not set`);
console.log("evaluation data purged; aggregate reports kept in eval-data/reports");
