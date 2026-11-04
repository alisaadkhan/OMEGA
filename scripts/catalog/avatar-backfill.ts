/**
 * Profile photo backfill (owner directive 2026-11-04 §1) for a local operational catalogue, at no provider cost: for
 * every profile without a stored photo, the newest stored provider answer still inside its retention period is read,
 * its photo link (profilePicUrlHD / profilePicUrl / avatar / channel thumbnail, as standardize reads it) downloaded with
 * the avatar safeguards (magic bytes, size, no redirects to other hosts), and saved under the pipeline's own key. The
 * profile (0084) and, for the primary platform, the creator are updated. Platform photo links expire within days, so
 * links that no longer answer are reported; `build.ts refresh --missing-avatars` re-fetches those (paid).
 *
 *   node --import tsx scripts/catalog/avatar-backfill.ts --db mushin_catalog_v4 [--apply]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sha256Hex } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { AVATAR_BUCKET } from "@mushin/integrations";
import { sql } from "drizzle-orm";
import { fetchAvatar } from "../../apps/api/src/modules/creators/enrichment/avatar";
import { standardize } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "avatar-backfill" });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const storageRoot = join(root, ".catalog-storage", dbName);
const payloadRoots = existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const payload = (key: string): unknown => {
  for (const base of payloadRoots) if (existsSync(join(base, key))) return JSON.parse(readFileSync(join(base, key), "utf8"));
  return null;
};

type Row = { profile_id: string; creator_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; canonical_url: string; primary_platform: string; searchable: boolean; key: string | null; youtube_expired: boolean };
const rows = [
  ...(await db.withSystem((tx) =>
    tx.execute<Row>(sql`
      select p.id profile_id, p.creator_id, p.platform, p.handle, p.canonical_url, c.primary_platform,
        exists (select 1 from gcp.creator_search_documents d where d.creator_id = c.id and d.eligible) searchable,
        (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.delete_after > now() order by r.fetched_at desc limit 1) key,
        (p.platform = 'youtube' and coalesce(p.last_scraped_at, p.created_at) < now() - interval '30 days') youtube_expired
      from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
      where c.status = 'active' and (p.avatar_url is null or (p.platform = c.primary_platform and c.avatar_url is null))`),
  )),
];

const tally = { missing: rows.length, searchableMissing: rows.filter((r) => r.searchable).length, saved: 0, savedSearchable: 0, noStoredAnswer: 0, noPhotoLink: 0, linkExpired: 0, youtubeExpired: 0 };
const stillMissingSearchable: string[] = [];
for (const r of rows) {
  if (r.youtube_expired) {
    tally.youtubeExpired++;
    continue;
  }
  const raw = r.key ? payload(r.key) : null;
  if (!raw) {
    tally.noStoredAnswer++;
    if (r.searchable) stillMissingSearchable.push(`${r.platform}/${r.handle}`);
    continue;
  }
  const std = standardize(r.platform, r.handle, raw, { maxPosts: 1 });
  const link = std.kind === "ok" ? std.profile.avatarUrl : null;
  if (!link) {
    tally.noPhotoLink++;
    if (r.searchable) stillMissingSearchable.push(`${r.platform}/${r.handle}`);
    continue;
  }
  const image = await fetchAvatar(link, fetch).catch(() => null);
  if (!image) {
    tally.linkExpired++;
    if (r.searchable) stillMissingSearchable.push(`${r.platform}/${r.handle}`);
    continue;
  }
  const key = `${r.platform}/${sha256Hex(r.canonical_url).slice(0, 32)}.${image.ext}`;
  const url = `file://${join(storageRoot, AVATAR_BUCKET, ...key.split("/"))}`;
  if (values.apply) {
    const file = join(storageRoot, AVATAR_BUCKET, ...key.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, image.bytes);
    await db.withSystem(async (tx) => {
      await tx.execute(sql`update gcp.creator_profiles set avatar_url = ${url}, avatar_key = ${key} where id = ${r.profile_id}`);
      if (r.platform === r.primary_platform) await tx.execute(sql`update gcp.creators set avatar_url = ${url}, avatar_key = ${key}, updated_at = now() where id = ${r.creator_id}`);
    });
  }
  tally.saved++;
  if (r.searchable) tally.savedSearchable++;
}
console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", ...tally, stillMissingSearchable }, null, 1));
await db.close();
