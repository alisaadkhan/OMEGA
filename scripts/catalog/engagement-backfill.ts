/**
 * Engagement backfill (owner directive 2026-11-03): every stored engagement rate is recomputed with the median rule
 * (latest 10 non-pinned posts, never capped, fewer than 3 usable posts = no value) from the profile's stored provider
 * answer; a rate with no stored posts behind it (e.g. "100%" from the 13 Oct recordings) is cleared to null, never 0.
 *
 *   node --import tsx scripts/catalog/engagement-backfill.ts --db mushin_catalog_v4 [--apply]
 *   node --env-file=.env --import tsx scripts/catalog/engagement-backfill.ts --live [--apply]   (clears unsupported values only)
 * YouTube is left untouched while YouTube-derived metrics are not permitted.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { createCreatorIndexer, profileMetrics, standardize } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false }, live: { type: "boolean", default: false } } });
const liveUrl = values.live ? process.env["DIRECT_URL"] : undefined;
if (values.live && !liveUrl) throw new Error("--live needs DIRECT_URL (run with --env-file=.env)");
const dbName = values.db ?? "";
if (!liveUrl && (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName))) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const db = liveUrl ? createDatabase(liveUrl, { max: 2, applicationName: "engagement-backfill", caPem: null }) : createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "engagement-backfill" });
const logger = createLogger({ level: "info", name: "engagement-backfill" });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const storageRoots = !liveUrl && existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const payload = (key: string): unknown => {
  for (const base of storageRoots) if (existsSync(join(base, key))) return JSON.parse(readFileSync(join(base, key), "utf8"));
  return null;
};

const rows = await db.withSystem((tx) =>
  tx.execute<{ id: string; platform: "instagram" | "tiktok"; handle: string; engagement_rate: number | null; avg_likes: number | null; storage_key: string | null }>(sql`
    select p.id, p.platform, p.handle, p.engagement_rate, p.avg_likes,
      (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.provider = 'apify' order by r.fetched_at desc limit 1) storage_key
    from gcp.creator_profiles p where p.platform in ('instagram', 'tiktok')`),
);
const updates: { id: string; er: number | null; likes: number | null; comments: number | null; views: number | null }[] = [];
const tally = { recomputed: 0, cleared: 0, unchanged: 0, noPayloadKept: 0 };
for (const r of rows) {
  const raw = r.storage_key ? payload(r.storage_key) : null;
  const std = raw ? standardize(r.platform, r.handle, raw, { maxPosts: 30 }) : null;
  if (std?.kind === "ok") {
    const m = profileMetrics(std.profile);
    if (m.engagementRate === r.engagement_rate) tally.unchanged++;
    else {
      tally.recomputed++;
      updates.push({ id: r.id, er: m.engagementRate, likes: m.avgLikes, comments: m.avgComments, views: m.avgViews });
    }
  } else if (r.engagement_rate !== null && r.avg_likes === null) {
    // No post sample was ever stored behind this figure: not supported, cleared until the next fetch.
    tally.cleared++;
    updates.push({ id: r.id, er: null, likes: null, comments: null, views: null });
  } else tally.noPayloadKept++;
}
if (values.apply && updates.length > 0) {
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    await db.withSystem((tx) =>
      tx.execute(sql`
        update gcp.creator_profiles p set engagement_rate = u.er, avg_likes = u.likes, avg_comments = u.comments, avg_views = u.views, updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as u(id uuid, er double precision, likes integer, comments integer, views integer)
        where p.id = u.id`),
    );
  }
}
const projection = values.apply ? await createCreatorIndexer({ db, index: null, logger }).reconcile() : null;
console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", profiles: rows.length, ...tally, projection }));
await db.close();
