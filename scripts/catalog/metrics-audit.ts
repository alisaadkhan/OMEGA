/**
 * Metrics audit for named creators (owner master directive 2026-11-03, Part 7/9): for each handle, the stored profile
 * figures next to every post of the latest stored provider answer (type, pinned, views, likes, comments, per-post ER),
 * and the old arithmetic mean against the median. Read-only.
 *
 *   node --import tsx scripts/catalog/metrics-audit.ts --db mushin_catalog_v4 --handles duckybhai,ajffbt [--out file.md]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { standardize } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, handles: { type: "string" }, out: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue (mushin_catalog_*)");
const handles = (values.handles ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
if (handles.length === 0) throw new Error("--handles a,b,c is required");
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, applicationName: "metrics-audit" });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const n = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d }));

type Row = Record<string, unknown> & { handle: string; platform: "instagram" | "tiktok" | "youtube"; key: string | null; followers: number | null };
const rows = await db.withSystem((tx) =>
  tx.execute<Row>(sql`
    select p.handle, p.platform, p.followers, p.engagement_rate, p.avg_likes, p.avg_comments, p.avg_views, p.median_views,
      p.median_engagement_rate, p.performance_views_sample, p.performance_engagement_sample, p.performance_format,
      p.followers_updated_at, p.last_scraped_at, p.bio, c.authenticity_score, c.assessment_status,
      (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform order by r.fetched_at desc limit 1) as key
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
    where lower(p.handle) in (select jsonb_array_elements_text(${JSON.stringify(handles)}::jsonb))`),
);
const lines: string[] = [];
for (const r of rows) {
  lines.push(`## ${r.platform} @${r.handle}`, "");
  lines.push(`Stored: followers ${n(r.followers)} · ER ${String(r.engagement_rate ?? "—")}% · avg views (mean) ${n(r.avg_views as number)} · median views ${n(r.median_views as number)} (sample ${String(r.performance_views_sample ?? "—")}, ${String(r.performance_format ?? "—")}) · median ER ${String(r.median_engagement_rate ?? "—")}% (sample ${String(r.performance_engagement_sample ?? "—")}) · authenticity ${String(r.authenticity_score ?? "—")} (${String(r.assessment_status ?? "—")}) · fetched ${String(r.last_scraped_at ?? "—")}`, "");
  const file = r.key ? join(root, ".catalog-storage", dbName, "raw-payloads", r.key) : "";
  if (!file || !existsSync(file)) {
    lines.push("No stored provider answer on this machine: post-level figures cannot be shown.", "");
    continue;
  }
  const std = standardize(r.platform, r.handle, JSON.parse(readFileSync(file, "utf8")), { maxPosts: 30 });
  if (std.kind !== "ok") {
    lines.push(`Stored answer unusable (${std.kind}).`, "");
    continue;
  }
  const posts = std.profile.recentPosts.slice(0, 12);
  // The product's definition: per follower on Instagram, per view on TikTok and YouTube (signals.ts engagementRaw).
  const perView = r.platform !== "instagram";
  const erOf = (p: (typeof posts)[number]): number | null => {
    if (p.likes === null || p.likes < 0) return null;
    const base = perView ? p.views : r.followers;
    return base ? (((p.likes ?? 0) + (p.comments ?? 0)) / base) * 100 : null;
  };
  lines.push(`| # | posted | type | pinned | views | likes | comments | ER % (per ${perView ? "view" : "follower"}) |`, "|---|---|---|---|---|---|---|---|");
  for (const [i, p] of posts.entries()) {
    const er = erOf(p);
    lines.push(`| ${i + 1} | ${p.postedAt.toISOString().slice(0, 10)} | ${p.format ?? (p.isVideo ? "video" : "post")} | ${p.isPinned ? "yes" : "no"} | ${n(p.views)} | ${n(p.likes)} | ${n(p.comments)} | ${er === null ? "—" : er.toFixed(2)} |`);
  }
  const usable = posts.filter((p) => !p.isPinned);
  const viewSample = usable.filter((p) => p.isVideo && p.views !== null && (r.platform !== "instagram" || p.format !== "post")).slice(0, 10).map((p) => p.views as number);
  const erSample = usable.map(erOf).filter((x): x is number => x !== null).slice(0, 10);
  lines.push("", `Views over ${viewSample.length} non-pinned comparable videos: mean ${n(mean(viewSample))} · **median ${n(median(viewSample))}**`, `ER over ${erSample.length} non-pinned posts with visible likes: mean ${n(mean(erSample), 2)}% · **median ${n(median(erSample), 2)}%**`, "");
}
const missing = handles.filter((h) => !rows.some((r) => r.handle.toLowerCase() === h));
if (missing.length) lines.push(`Not in this catalogue: ${missing.join(", ")}`);
const text = lines.join("\n");
if (values.out) writeFileSync(values.out, text);
console.log(text);
await db.close();
