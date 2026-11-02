/**
 * No-cost backfill of niche and country (and city evidence) for a local operational catalogue (owner instruction
 * 2026-10-26). Re-derives each creator from its newest archived response while that is inside its retention period,
 * otherwise from the stored name, bio and recorded platform country; no provider or AI is called.
 *
 *   node --import tsx scripts/catalog/backfill-evidence.ts --db mushin_catalog_v3            # dry run (default)
 *   node --import tsx scripts/catalog/backfill-evidence.ts --db mushin_catalog_v3 --apply    # write, then re-project
 *   ... --resume            continue after the last finished batch of an interrupted --apply run
 *   ... --rollback <file>   restore the before-images an --apply run saved
 * Options: --batch <n> (default 200), --limit <n>, --payloads-from <db> (a clone reads its source's archived files). YouTube video text stays out unless YOUTUBE_CONTENT_EVIDENCE=on.
 * Only local mushin_catalog_* databases are accepted; the frozen evaluation corpus is refused. Run files (which quote
 * creator bios) go to the git-excluded .catalog-storage/<db>/backfill/; the summary goes to docs/completion.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { RAW_PAYLOAD_BUCKET } from "@mushin/integrations";
import { backfillAttributes, createCreatorIndexer, getEnrichmentSettings, restoreBeforeImages, type BeforeImage } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    apply: { type: "boolean", default: false },
    resume: { type: "boolean", default: false },
    rollback: { type: "string" },
    batch: { type: "string" },
    limit: { type: "string" },
    "payloads-from": { type: "string" },
  },
});
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*), never an evaluation corpus");
const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
// Only the two policy switches are read (never .env secrets): no key, token or provider is needed for a backfill.
const sourcePolicy = { youtubeDerivedMetrics: process.env["YOUTUBE_DERIVED_METRICS"] === "on" };
const youtubeContentEvidence = process.env["YOUTUBE_CONTENT_EVIDENCE"] === "on";
const logger = createLogger({ level: "info", name: "catalog-backfill" });
const db = createDatabase(url, { max: 2, applicationName: "catalog-backfill", caPem: null });
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
// A cloned catalogue reads the archived responses of the catalogue it was cloned from (no second copy of YouTube data).
const payloadDb = values["payloads-from"] ?? dbName;
if (!/^mushin_catalog_[a-z0-9_]+$/.test(payloadDb)) throw new Error("--payloads-from must name a local catalogue");
const store = join(repo, ".catalog-storage", payloadDb, RAW_PAYLOAD_BUCKET);
const runDir = join(repo, ".catalog-storage", dbName, "backfill");
mkdirSync(runDir, { recursive: true });
const checkpointFile = join(runDir, "checkpoint.json");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

if (values.rollback) {
  const images = JSON.parse(readFileSync(values.rollback, "utf8")) as BeforeImage[];
  const n = await restoreBeforeImages(db, images);
  await createCreatorIndexer({ db, index: null, logger, sourcePolicy }).reconcile();
  logger.info({ restored: n }, "rollback done; search projection reconciled");
  await db.close();
  process.exit(0);
}

const settings = await db.withSystem((tx) => getEnrichmentSettings(tx));
const after = values.resume && existsSync(checkpointFile) ? (JSON.parse(readFileSync(checkpointFile, "utf8")) as { lastId: string }).lastId : null;
const report = await backfillAttributes({
  db,
  apply: values.apply,
  after,
  ...(values.batch ? { batchSize: Number(values.batch) } : {}),
  ...(values.limit ? { limit: Number(values.limit) } : {}),
  readPayload: async (key) => {
    const file = join(store, ...key.split("/"));
    return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as unknown) : null;
  },
  usePostText: (platform) => platform !== "youtube" || youtubeContentEvidence,
  maxPosts: (platform) => (platform === "tiktok" ? settings.tiktokRecentVideos : settings.recentPosts),
  onBatch: ({ lastId, processed }) => {
    if (values.apply) writeFileSync(checkpointFile, JSON.stringify({ lastId, processed, at: new Date().toISOString() }));
    logger.info({ processed }, "batch done");
  },
});

const { beforeImages, needsFreshData, changes, ...summary } = report;
const changedFields: Record<string, number> = {};
for (const ch of changes) for (const k of ch.fields) changedFields[k] = (changedFields[k] ?? 0) + 1;
Object.assign(summary, { changedFields });
const mode = values.apply ? "apply" : "dry-run";
if (values.apply) {
  writeFileSync(join(runDir, `before-images-${stamp}.json`), JSON.stringify(beforeImages));
  const projected = await createCreatorIndexer({ db, index: null, logger, sourcePolicy }).reconcile();
  Object.assign(summary, { projection: projected });
}
writeFileSync(join(runDir, `${mode}-${stamp}.json`), `${JSON.stringify({ db: dbName, ...summary, needsFreshData, changes }, null, 1)}\n`);
const outDir = join(repo, "docs", "completion", "search-v2-evidence");
mkdirSync(outDir, { recursive: true });
// The committed summary holds counts only (no creator text).
writeFileSync(join(outDir, `attribute-backfill-${mode}.json`), `${JSON.stringify({ db: dbName, at: new Date().toISOString(), ...summary, failed: summary.failed.length, needsFreshData: needsFreshData.length }, null, 1)}\n`);
logger.info({ ...summary, needsFreshData: needsFreshData.length, runDir }, `attribute backfill ${mode} done`);
await db.close();
