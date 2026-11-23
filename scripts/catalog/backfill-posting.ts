/**
 * Content consistency backfill (owner, 23 Nov: "make sure every creator card is full and complete"): the posting rate
 * of each Instagram and TikTok profile (0097) from its newest stored fetch, as the pipeline now saves on every fetch.
 * No provider call. YouTube is left out (derived figures are policy restricted). Dry run by default.
 *
 *   node --import tsx scripts/catalog/backfill-posting.ts --db mushin_catalog_v4 [--apply]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { standardize } from "../../apps/api/src/modules/creators/index";
import { postsPerWeek } from "../../apps/api/src/modules/creators/enrichment/signals";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, onnotice: () => {} });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)), ".catalog-storage");
const bases = existsSync(root) ? readdirSync(root).map((d) => join(root, d, "raw-payloads")) : [];

const rows = await sql<{ id: string; platform: "instagram" | "tiktok"; handle: string; key: string | null; fetched_at: Date | null }[]>`
  select p.id, p.platform, p.handle, r.storage_key key, r.fetched_at from gcp.creator_profiles p
  left join lateral (select storage_key, fetched_at from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform order by fetched_at desc limit 1) r on true
  where p.platform in ('instagram', 'tiktok')`;
const tally = { profiles: rows.length, measured: 0, noPayload: 0, tooFewPosts: 0 };
const updates: { id: string; perWeek: number; at: Date }[] = [];
for (const r of rows) {
  const file = r.key ? bases.map((b) => join(b, r.key as string)).find((f) => existsSync(f)) : undefined;
  if (!file || !r.fetched_at) { tally.noPayload++; continue; }
  const std = standardize(r.platform, r.handle, JSON.parse(readFileSync(file, "utf8")), { maxPosts: 30 });
  const posts = std.kind === "ok" ? std.profile.recentPosts.filter((x) => !x.isPinned).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()) : [];
  const perWeek = postsPerWeek(posts);
  if (perWeek === null) { tally.tooFewPosts++; continue; }
  tally.measured++;
  updates.push({ id: r.id, perWeek, at: r.fetched_at });
}
if (values.apply && updates.length)
  await sql`update gcp.creator_profiles p set posts_per_week = u.per_week, posting_measured_at = u.at
    from jsonb_to_recordset(${sql.json(updates.map((u) => ({ id: u.id, per_week: u.perWeek, at: u.at.toISOString() })))}) as u(id uuid, per_week double precision, at timestamptz)
    where p.id = u.id and (p.posting_measured_at is null or p.posting_measured_at <= u.at)`;
console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", ...tally }));
await sql.end();
