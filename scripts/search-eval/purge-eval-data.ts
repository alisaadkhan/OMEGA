/**
 * Deletes the Search evaluation data that holds YouTube API data and public creator profiles (YouTube API Services
 * policy: delete or refresh within 30 days; owner deadline 2026-11-12):
 *   - everything under eval-data/ except eval-data/reports/ (aggregate gate reports, which hold no creator rows);
 *   - the disposable corpus database mushin_eval_disposable (local only);
 *   - any older copy named with --also <dir> (repeatable), such as the earlier sessions' temporary folders listed in
 *     docs/readiness/youtube-eval-data-inventory.md. Each must be an existing directory outside this repository.
 * Without --confirm it only lists what would be deleted. --verify deletes nothing and exits 1 while anything listed
 * still exists. Copies handed to raters must be deleted by them (kit README).
 *
 *   PG_BIN=<postgres bin> node --import tsx scripts/search-eval/purge-eval-data.ts [--also <dir> ...] [--confirm | --verify]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const root = join(repo, "eval-data");
const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const verify = args.includes("--verify");
if (confirm && verify) {
  console.error("use --confirm or --verify, not both");
  process.exit(2);
}
const KEEP = new Set(["reports"]);
const DB = "mushin_eval_disposable";

const also = args.flatMap((a, i) => (a === "--also" && args[i + 1] ? [resolve(args[i + 1] as string)] : []));
for (const dir of also) {
  if (dir === repo || dir.startsWith(repo + sep) || repo.startsWith(dir + sep)) {
    console.error(`--also ${dir}: must be outside the repository (and not contain it)`);
    process.exit(2);
  }
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    console.error(`--also ${dir}: not a directory`);
    process.exit(2);
  }
}

const inRepo = existsSync(root) ? readdirSync(root).filter((n) => !KEEP.has(n)).map((n) => join(root, n)) : [];
const targets = [...inRepo, ...also.filter((d) => existsSync(d))];
const size = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, n) => s + size(join(p, n)), 0) : statSync(p).size);

const pgBin = process.env["PG_BIN"];
const exe = (name: string) => (pgBin ? join(pgBin, process.platform === "win32" ? `${name}.exe` : name) : null);
const conn = ["-h", "localhost", "-p", "54330", "-U", "postgres"];
function databaseExists(): boolean | null {
  const psql = exe("psql");
  if (!psql) return null;
  return execFileSync(psql, [...conn, "-d", "postgres", "-Atc", `select count(*) from pg_database where datname = '${DB}'`], { encoding: "utf8" }).trim() === "1";
}

if (verify) {
  const db = databaseExists();
  for (const t of targets) console.log(`STILL PRESENT ${t} (${(size(t) / 1e6).toFixed(1)} MB)`);
  for (const d of also.filter((x) => !existsSync(x))) console.log(`gone ${d}`);
  console.log(db === null ? `database ${DB}: not checked (set PG_BIN)` : db ? `STILL PRESENT database ${DB}` : `gone database ${DB}`);
  const clean = targets.length === 0 && db === false;
  console.log(clean ? "verified: no evaluation data remains in the checked locations" : "NOT CLEAN: evaluation data remains (or the database was not checked)");
  process.exit(clean ? 0 : 1);
}

for (const t of targets) console.log(`${confirm ? "deleting" : "would delete"} ${t} (${(size(t) / 1e6).toFixed(1)} MB)`);
console.log(`${confirm ? "dropping" : "would drop"} database ${DB} on localhost:54330${pgBin ? "" : " (set PG_BIN to the PostgreSQL bin folder)"}`);
if (!confirm) {
  console.log("dry run: nothing deleted. Re-run with --confirm, then with --verify.");
  process.exit(0);
}
for (const t of targets) rmSync(t, { recursive: true, force: true });
const dropdb = exe("dropdb");
if (dropdb) execFileSync(dropdb, [...conn, "--if-exists", DB], { stdio: "inherit" });
else console.warn(`database ${DB} not dropped: PG_BIN is not set`);
console.log("evaluation data purged; aggregate reports kept in eval-data/reports. Run again with --verify.");
