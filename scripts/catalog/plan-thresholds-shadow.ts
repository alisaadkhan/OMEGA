/**
 * Shadow check of the 2 November 2026 Creator Supply & Eligibility plan thresholds (report-only; nothing is written to
 * the database and the active rule stays elig-2):
 *   Instagram 5,000 followers + median Reel views 2,000 (and 3,000)
 *   TikTok    10,000 followers + median video views 15,000
 *   YouTube   10,000 subscribers + median video views 5,000 (not computed: see below)
 * Median of up to the latest 10 relevant items from the stored Apify payloads (Instagram videos/Reels with a view count;
 * TikTok non-pinned videos). Items without the metric are left out, never read as 0; fewer than 3 items = awaiting assessment.
 * YouTube medians are NOT computed: they would be a metric derived from YouTube API data, which needs the owner's
 * derived-metrics decision (YOUTUBE_DECISION_BRIEF.md, decision 2).
 *   node --import tsx scripts/catalog/plan-thresholds-shadow.ts --db mushin_catalog_v3
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createDatabase } from "@mushin/db";

const { values } = parseArgs({ options: { db: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue copy (mushin_catalog_*)");
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, applicationName: "plan-thresholds-shadow" });
type Row = Record<string, unknown>;

const rows = await db.withSystem(async (tx) => {
  await tx.execute(sql`set transaction read only`);
  return [...(await tx.execute<Row>(sql`
    select p.creator_id, p.platform, p.followers, p.country_status,
      (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.provider = 'apify' order by r.fetched_at desc limit 1) storage_key,
      exists (select 1 from gcp.creator_search_documents d where d.creator_id = p.creator_id and p.platform::text = any(d.qualifying_platforms::text[])) eligible_now
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
    where c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`))];
});
await db.close();

// Payload files: stored under .catalog-storage/<catalogue>/raw-payloads/<key>; the v3 copy points at v2's files.
const storageRoots = existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const readPayload = (key: string): unknown => {
  for (const base of storageRoots) {
    const f = join(base, key);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  return null;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
function sample(platform: string, payload: unknown): number[] {
  if (platform === "instagram") {
    const p = (Array.isArray(payload) ? payload[0] : payload) as { latestPosts?: Row[]; latestIgtvVideos?: Row[] } | null;
    const posts = [...(p?.latestPosts ?? []), ...(p?.latestIgtvVideos ?? [])]
      .filter((x) => num(x["videoViewCount"]) !== null)
      .sort((a, b) => String(b["timestamp"]).localeCompare(String(a["timestamp"])));
    const seen = new Set<unknown>();
    return posts.filter((x) => !seen.has(x["id"]) && seen.add(x["id"])).slice(0, 10).map((x) => num(x["videoViewCount"]) as number);
  }
  if (platform === "tiktok") {
    const items = (Array.isArray(payload) ? payload : []) as Row[];
    return items.filter((x) => x["isPinned"] !== true && num(x["playCount"]) !== null)
      .sort((a, b) => String(b["createTimeISO"]).localeCompare(String(a["createTimeISO"])))
      .slice(0, 10).map((x) => num(x["playCount"]) as number);
  }
  return [];
}

type Out = { platform: string; outcome: "eligible" | "below_minimum" | "awaiting_assessment" | "not_pakistan_evidence"; reason: string; sample: number; median: number | null; eligibleNow: boolean };
const results: Out[] = [];
const MIN = { instagram: 5_000, tiktok: 10_000, youtube: 10_000 } as Record<string, number>;
const VIEWS = { instagram: [2_000, 3_000], tiktok: [15_000, 15_000], youtube: [5_000, 5_000] } as Record<string, [number, number]>;
for (const r of rows) {
  const platform = r["platform"] as string;
  const followers = num(r["followers"]);
  const eligibleNow = r["eligible_now"] === true;
  const base = { platform, eligibleNow };
  // The plan keeps the evidence requirement: no Pakistani country evidence = not in the qualified pool (kept, not deleted).
  if (r["country_status"] !== "pakistan") { results.push({ ...base, outcome: "not_pakistan_evidence", reason: String(r["country_status"]), sample: 0, median: null }); continue; }
  if (followers === null) { results.push({ ...base, outcome: "awaiting_assessment", reason: "followers unknown", sample: 0, median: null }); continue; }
  if (followers < (MIN[platform] ?? Infinity)) { results.push({ ...base, outcome: "below_minimum", reason: "audience", sample: 0, median: null }); continue; }
  if (platform === "youtube") { results.push({ ...base, outcome: "awaiting_assessment", reason: "median views not computed (YouTube derived-metrics decision)", sample: 0, median: null }); continue; }
  const key = r["storage_key"] as string | null;
  const views = key ? sample(platform, readPayload(key)) : [];
  const m = median(views);
  if (views.length < 3 || m === null) { results.push({ ...base, outcome: "awaiting_assessment", reason: key ? "fewer than 3 recent items with views" : "no stored content", sample: views.length, median: m }); continue; }
  const [low] = VIEWS[platform] ?? [Infinity];
  results.push({ ...base, outcome: m >= (low ?? Infinity) ? "eligible" : "below_minimum", reason: m >= (low ?? Infinity) ? "meets audience and median views" : "median views", sample: views.length, median: m });
}

const summary: Record<string, Record<string, number>> = {};
for (const r of results) {
  const s = (summary[r.platform] ??= { profiles: 0, eligible: 0, below_minimum: 0, awaiting_assessment: 0, not_pakistan_evidence: 0, eligibleUnderElig2: 0, igAt3000: 0 });
  s["profiles"] = (s["profiles"] ?? 0) + 1;
  s[r.outcome] = (s[r.outcome] ?? 0) + 1;
  if (r.eligibleNow) s["eligibleUnderElig2"] = (s["eligibleUnderElig2"] ?? 0) + 1;
  if (r.platform === "instagram" && r.median !== null && r.sample >= 3 && r.median >= 3_000 && r.outcome === "eligible") s["igAt3000"] = (s["igAt3000"] ?? 0) + 1;
}
const reasons: Record<string, number> = {};
for (const r of results) reasons[`${r.platform}|${r.outcome}|${r.reason}`] = (reasons[`${r.platform}|${r.outcome}|${r.reason}`] ?? 0) + 1;
const out = join(root, "docs", "completion", "inventory", `${new Date().toISOString().slice(0, 10)}-plan-thresholds-${dbName}.json`);
mkdirSync(join(root, "docs", "completion", "inventory"), { recursive: true });
writeFileSync(out, JSON.stringify({ database: dbName, at: new Date().toISOString(), writes: "none", summary, reasons }, null, 2));
console.log(JSON.stringify({ summary, reasons }, null, 1));
