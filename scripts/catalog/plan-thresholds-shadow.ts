/**
 * Dry run: the active rule (elig-2) against the owner's elig-3 thresholds (2026-11-02) for every catalogue profile.
 * Report-only: nothing is written to the database; statuses and search stay as they are.
 *   node --import tsx scripts/catalog/plan-thresholds-shadow.ts --db mushin_catalog_v3
 * elig-3 uses the application's own evaluateV3 and contentPerformance (apps/api/src/modules/creators/eligibility-v3.ts).
 * Performance comes from the 0066 columns when a fetch stored them, otherwise from the stored Apify answer of that profile
 * (Instagram and TikTok). YouTube performance is not computed while YouTube-derived metrics are not permitted.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createDatabase } from "@mushin/db";
import { contentPerformance, evaluateV3, type ContentPerformance, type V3Status } from "../../apps/api/src/modules/creators/eligibility-v3";
import { standardize } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue copy (mushin_catalog_*)");
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, applicationName: "elig3-dry-run" });
type Row = Record<string, unknown>;
const now = new Date();

const hasPerf = async () => (await db.withSystem((tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from information_schema.columns where table_schema = 'gcp' and table_name = 'creator_profiles' and column_name = 'median_views'`)))[0]?.n === 1;
const perfCols = (await hasPerf())
  ? sql`p.median_views, p.median_engagement_rate, p.performance_views_sample, p.performance_engagement_sample, p.performance_at`
  : sql`null median_views, null median_engagement_rate, null performance_views_sample, null performance_engagement_sample, null performance_at`;
const rows = await db.withSystem(async (tx) => {
  await tx.execute(sql`set transaction read only`);
  return [...(await tx.execute<Row>(sql`
    select p.creator_id, p.platform, p.handle, p.followers, p.following, p.followers_updated_at, p.country_status, p.availability, ${perfCols},
      (c.is_minor and c.minor_override_by_staff_id is null) minor, c.status creator_status,
      (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.provider = 'apify' order by r.fetched_at desc limit 1) storage_key,
      exists (select 1 from gcp.creator_search_documents d where d.creator_id = p.creator_id and p.platform::text = any(d.qualifying_platforms::text[])) elig2
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id`))];
});
await db.close();

const storageRoots = existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const payload = (key: string): unknown => {
  for (const base of storageRoots) if (existsSync(join(base, key))) return JSON.parse(readFileSync(join(base, key), "utf8"));
  return null;
};
const DAY = 86_400_000;
type Out = { platform: string; elig2: boolean; v3: V3Status | "excluded_minor"; reasons: string[]; warnings: string[]; source: string };
const out: Out[] = [];
for (const r of rows) {
  const platform = r["platform"] as "youtube" | "instagram" | "tiktok";
  const elig2 = r["elig2"] === true;
  if (r["minor"] === true || r["creator_status"] !== "active") { out.push({ platform, elig2, v3: "excluded_minor", reasons: ["possible_minor_or_inactive_creator"], warnings: [], source: "-" }); continue; }
  let perf: ContentPerformance | null = null;
  let source = "none";
  if (r["performance_at"]) {
    perf = { medianViews: (r["median_views"] as number | null) ?? null, medianEngagementRate: r["median_engagement_rate"] === null ? null : Number(r["median_engagement_rate"]), viewsSample: Number(r["performance_views_sample"] ?? 0), engagementSample: Number(r["performance_engagement_sample"] ?? 0), format: platform === "instagram" ? "reel" : "video", sampleFrom: null, sampleTo: null };
    source = "stored";
  } else if (platform !== "youtube" && r["storage_key"]) {
    const std = standardize(platform, String(r["handle"]), payload(String(r["storage_key"])), { maxPosts: 30 });
    if (std.kind === "ok") { perf = contentPerformance(std.profile); source = "stored_payload"; }
  }
  const updated = r["followers_updated_at"] ? new Date(String(r["followers_updated_at"])).getTime() : null;
  const fresh = updated !== null && now.getTime() - updated <= (platform === "youtube" ? 30 : 90) * DAY;
  const res = evaluateV3({
    platform,
    followers: (r["followers"] as number | null) ?? null,
    following: (r["following"] as number | null) ?? null,
    followersFresh: fresh,
    countryStatus: (r["country_status"] as never) ?? "unknown",
    available: !["not_found", "private"].includes(String(r["availability"])),
    performance: perf,
  });
  out.push({ platform, elig2, v3: res.status, reasons: res.reasons, warnings: res.warnings, source });
}

const summary: Record<string, Record<string, number>> = {};
const inc = (p: string, k: string) => { const s = (summary[p] ??= {}); s[k] = (s[k] ?? 0) + 1; };
for (const o of out) {
  inc(o.platform, "profiles");
  inc(o.platform, `elig3_${o.v3}`);
  if (o.elig2) inc(o.platform, "elig2_eligible");
  inc(o.platform, `change: ${o.elig2 ? "eligible" : "not eligible"} -> ${o.v3}`);
  if (o.source !== "none" && o.source !== "-") inc(o.platform, `performance_from_${o.source}`);
  for (const w of o.warnings) inc(o.platform, `warning_${w}`);
}
const reasons: Record<string, number> = {};
for (const o of out) for (const r of o.reasons) reasons[`${o.platform} ${o.v3} ${r}`] = (reasons[`${o.platform} ${o.v3} ${r}`] ?? 0) + 1;
const file = join(root, "docs", "completion", "inventory", `${now.toISOString().slice(0, 10)}-elig3-dry-run-${dbName}.json`);
mkdirSync(join(root, "docs", "completion", "inventory"), { recursive: true });
writeFileSync(file, JSON.stringify({ database: dbName, at: now.toISOString(), writes: "none", activePolicy: "elig-2 (unchanged)", summary, reasons }, null, 2));
console.log(JSON.stringify({ summary, reasons }, null, 1));
