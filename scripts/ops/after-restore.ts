/**
 * Run after restoring the database from a backup, before the API and worker take traffic (audit OPS-04):
 *   1. re-applies the erasure journal (export-erasure-journal.ts, kept outside the database): suppressions come back and
 *      any creator erased after the backup is erased again, files included;
 *   2. clears YouTube API data older than 30 days at once (the restored copy may hold data that has expired since);
 *   3. checks consistency: every migration in the repository is applied, and every workspace's credit lots match its
 *      ledger. Exits non-zero if a check fails.
 * The worker's start-up reconciliation then rebuilds the search documents and index from the restored rows.
 *   npm run ops:after-restore -- <erasure-journal.json>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import postgres from "postgres";
import { createDatabase, tlsOptions, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createObjectStorage } from "@mushin/integrations";
import { createCreditEngine } from "../../apps/api/src/modules/billing/index";
import { createEraser, expireYoutubeApiData } from "../../apps/api/src/modules/creators/index";

const journalPath = process.argv[2];
if (!journalPath) {
  console.error("Usage: npm run ops:after-restore -- <erasure-journal.json>");
  process.exit(1);
}
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { format?: string; exportedAt?: string; entries?: { urlHash: string; platform: "instagram" | "tiktok" | "youtube" }[] };
if (journal.format !== "mushin.erasure-journal.v1" || !Array.isArray(journal.entries)) throw new Error("not a MUSHIN erasure journal");

const config = loadWorkerConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const logger = createLogger({ level: "warn", name: "after-restore" });
const db = createDatabase(config.databaseUrl, { max: 2, applicationName: "mushin-after-restore", caPem: config.databaseCaPem });
const started = Date.now();
let failed = false;
try {
  const storage = createObjectStorage(config.storage, logger);
  const erased = await createEraser({ db, storage, logger }).reapplyJournal(journal.entries);
  console.log(`erasure journal (${journal.exportedAt}): ${erased.suppressionsRestored} suppression(s) restored, ${erased.creatorsErased} creator(s) erased again`);

  const expired = await expireYoutubeApiData(db, storage ? { storage } : {});
  console.log(`YouTube API data past 30 days cleared for ${expired.length} creator(s)`);

  const files = readdirSync(join(import.meta.dirname, "../../packages/db/migrations")).filter((f) => f.endsWith(".sql")).length;
  // The migrations table belongs to the database owner (DIRECT_URL), as for the migration runner.
  const owner = postgres(config.directUrl, { max: 1, prepare: false, ssl: tlsOptions(config.databaseCaPem, config.directUrl), onnotice: () => {} });
  const [m] = await owner<{ n: number }[]>`select count(*)::int n from platform.schema_migrations`;
  // Row-level security hides workspaces from the worker role: the owner lists them, each is checked inside its own scope.
  const workspaces = await owner<{ id: string }[]>`select id::text id from wp.workspaces`.finally(() => owner.end({ timeout: 5 }));
  const migrationsOk = (m?.n ?? 0) === files;
  console.log(`${migrationsOk ? "PASS" : "FAIL"} | migrations applied ${m?.n ?? 0} of ${files} in the repository${migrationsOk ? "" : " (run the migrations, then this script again)"}`);
  failed ||= !migrationsOk;

  const engine = createCreditEngine();
  let mismatched = 0;
  for (const w of workspaces) if ((await db.withWorkspace(w.id, (tx) => engine.reconcile(tx, w.id))).length > 0) mismatched += 1;
  console.log(`${mismatched === 0 ? "PASS" : "FAIL"} | credit lots match the ledger in ${workspaces.length - mismatched} of ${workspaces.length} workspace(s)`);
  failed ||= mismatched > 0;
} finally {
  await db.close();
}
console.log(`after-restore finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = failed ? 1 : 0;
