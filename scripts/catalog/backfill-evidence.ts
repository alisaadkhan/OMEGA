/**
 * No-cost evidence backfill for the operational catalogue (search-v2; owner instruction 2026-10-20: store city, country
 * and niches only with evidence, keep unknown values unknown, treat a YouTube registration country as insufficient).
 * Creators refreshed before the evidence layer existed are re-derived from their archived payload on local disk; no
 * provider is called. Dry run by default; --apply writes the creator fields, the evidence rows and an outbox event.
 *
 *   node --env-file=.env --import tsx scripts/catalog/backfill-evidence.ts --db mushin_catalog_v2 [--apply]
 * The frozen evaluation corpus (mushin_eval_disposable) is refused as a target.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { creators, createDatabase, writeOutbox } from "@mushin/db";
import { RAW_PAYLOAD_BUCKET } from "@mushin/integrations";
import { eq, sql } from "drizzle-orm";
import { createCreatorIndexer, deriveAttributes, getEnrichmentSettings, placeAttributes, replaceAttributeEvidence, standardize, type Assessment } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const config = loadWorkerConfig({ ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_FILE: "", SEARCH_PROFILE: "v2" });
const logger = createLogger({ level: "info", name: "catalog-evidence" });
const db = createDatabase(url, { max: 2, applicationName: "catalog-evidence", caPem: null });
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const store = join(repo, ".catalog-storage", dbName, RAW_PAYLOAD_BUCKET);
const settings = await db.withSystem((tx) => getEnrichmentSettings(tx));

// The newest archived payload of every creator profile (only refreshed or discovered creators have one).
const rows = await db.withSystem((tx) =>
  tx.execute<{ creator_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; payload_id: string; storage_key: string; niches: string[]; city: string | null; country: string | null }>(sql`
    select distinct on (pr.creator_id) pr.creator_id, pr.platform, pr.handle, rp.id payload_id, rp.storage_key, c.niches, c.city, c.country
    from gcp.creator_profiles pr
    join gcp.creators c on c.id = pr.creator_id and c.status = 'active'
    join platform.raw_payloads rp on rp.canonical_url = pr.canonical_url
    order by pr.creator_id, rp.fetched_at desc`),
);

const tally = { creators: rows.length, missingPayload: 0, unreadable: 0, city: { before: 0, after: 0 }, country: { before: 0, after: 0, cleared: 0, pkAfter: 0 }, changed: 0 };
const changes: Record<string, unknown>[] = [];
for (const r of rows) {
  const file = join(store, ...r.storage_key.split("/"));
  if (!existsSync(file)) {
    tally.missingPayload++;
    continue;
  }
  const std = standardize(r.platform, r.handle, JSON.parse(readFileSync(file, "utf8")), { maxPosts: r.platform === "tiktok" ? settings.tiktokRecentVideos : settings.recentPosts });
  if (std.kind !== "ok") {
    tally.unreadable++;
    continue;
  }
  // The AI's niches were stored on the creator; they are kept as "weak" evidence unless the text supports them.
  const d = deriveAttributes(std.profile, { niches: r.niches } as Assessment);
  const placed = await db.withSystem((tx) => placeAttributes(tx, r.creator_id, d, [std.profile.country], []));
  if (r.city) tally.city.before++;
  if (r.country) tally.country.before++;
  if (placed.city) tally.city.after++;
  if (placed.country) tally.country.after++;
  if (placed.country === "PK") tally.country.pkAfter++;
  if (r.country && !placed.country) tally.country.cleared++;
  const moved = placed.city !== r.city || placed.country !== r.country || (placed.niches !== undefined && placed.niches.join("|") !== r.niches.join("|"));
  if (moved) {
    tally.changed++;
    changes.push({ handle: r.handle, platform: r.platform, before: { city: r.city, country: r.country, niches: r.niches }, after: placed, registration: std.profile.country });
  }
  if (values.apply) {
    await db.withSystem(async (tx) => {
      await tx.update(creators).set(placed).where(eq(creators.id, r.creator_id));
      await replaceAttributeEvidence(tx, r.creator_id, d, r.payload_id);
      await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: r.creator_id, workspaceId: null, payload: { creatorId: r.creator_id }, requestId: null });
    });
  }
}
if (values.apply) await createCreatorIndexer({ db, index: null, logger, sourcePolicy: config.sourcePolicy }).reconcile();

const outDir = join(repo, "docs", "completion", "search-v2-evidence");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `catalog-evidence-backfill-${values.apply ? "apply" : "dry-run"}.json`);
writeFileSync(out, `${JSON.stringify({ db: dbName, applied: values.apply, at: new Date().toISOString(), tally, changes }, null, 1)}\n`);
logger.info({ tally, out }, "evidence backfill done");
await db.close();
