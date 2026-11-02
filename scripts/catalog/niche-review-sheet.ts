/**
 * Builds the human review sheet for niche and country (owner instruction 2026-10-26): about 150 catalogue profiles,
 * stratified so the known hard cases are present (how-to, gaming, sports, automotive, news, history, religion, Urdu
 * script, empty or vague bios, multi-topic, AI-Lifestyle history, kept-earlier niches), with the stored evidence and the
 * proposed classification. Rater columns are left empty: accuracy is measured only after two people label it.
 *
 *   node --import tsx scripts/catalog/niche-review-sheet.ts --db mushin_catalog_v3
 * Writes eval-v2/niche-benchmark/review-<db>.csv (git-excluded; it contains YouTube API data: delete by 2026-11-12).
 * Reads only; deterministic sample (md5 of the creator id).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import postgres from "postgres";

const { values } = parseArgs({ options: { db: { type: "string" }, size: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue (mushin_catalog_*)");
const size = Number(values.size ?? 150);
const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1 });

type Row = { id: string; platform: string; handle: string; display_name: string; followers: number | null; bio: string | null; niches: string[]; niche_main: string | null; niche_status: string | null; niche_confidence: string | null; country: string | null; country_source: string | null; country_status: string | null; country_reason: string | null; evidence: string | null };
// Country is the profile's own decision (rule elig-2), the one customer search applies, not the creator-level value.
const rows = await sql<Row[]>`
  select c.id, c.primary_platform platform, c.primary_handle handle, c.display_name, p.followers, p.bio, c.niches, c.niche_main, c.niche_status, c.niche_confidence,
    p.country, p.country_source, p.country_status, p.country_reason,
    (select string_agg(e.attribute || ':' || e.value || ' [' || e.source || '/' || e.status || '] ' || left(e.evidence, 120), ' || ' order by e.attribute, e.status)
       from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute in ('niche', 'country')) evidence
  from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id and p.platform = c.primary_platform
  where c.status = 'active' order by md5(c.id::text)`;

// Strata: [name, test, quota]. A creator is taken by the first stratum that still has room.
const t = (r: Row) => `${r.display_name} ${r.bio ?? ""}`.toLowerCase();
const strata: [string, (r: Row) => boolean, number][] = [
  ["instagram", (r) => r.platform === "instagram", 25],
  ["tiktok", (r) => r.platform === "tiktok", 15],
  ["how-to / tutorial", (r) => /how to|tutorial|seekh|course|lesson|diy/.test(t(r)), 10],
  ["gaming", (r) => /gaming|gamer|pubg|free ?fire/.test(t(r)), 8],
  ["sports", (r) => /cricket|sports|football|psl/.test(t(r)), 6],
  ["automotive", (r) => /car|bike|auto|gaari|gari/.test(t(r)), 6],
  ["news / history", (r) => /news|politic|history|tareekh/.test(t(r)), 8],
  ["religion", (r) => /islam|quran|naat|deen|bayan/.test(t(r)), 6],
  ["urdu script", (r) => /[؀-ۿ]{4,}/u.test(r.bio ?? ""), 8],
  ["empty or vague bio", (r) => (r.bio ?? "").trim().length < 40, 10],
  ["variety", (r) => r.niche_status === "variety", 8],
  ["kept earlier niches", (r) => r.niche_status === null && r.niches.length > 0, 10],
  ["unknown", (r) => r.niche_status === "unknown", 10],
  ["business label (marketing check)", (r) => r.niches.includes("Business & Ecommerce"), 6],
  ["any", () => true, size],
];
const taken = new Map<string, string>();
const left = strata.map(([, , q]) => q);
// The named strata first (so rare cases are present), then any profile up to the sheet size.
for (const pass of ["named", "any"] as const) {
  for (const r of rows) {
    if (taken.size >= size) break;
    if (taken.has(r.id)) continue;
    const i = strata.findIndex(([name, test], k) => (pass === "any" || name !== "any") && (left[k] ?? 0) > 0 && test(r));
    if (i < 0) continue;
    left[i] = (left[i] ?? 0) - 1;
    taken.set(r.id, strata[i]?.[0] ?? "any");
  }
}
const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const head = ["creator_id", "stratum", "platform", "handle", "display_name", "followers", "bio", "proposed_status", "proposed_main", "proposed_niches", "proposed_confidence", "proposed_country", "country_source", "country_status", "country_reason", "evidence",
  "rater1_main", "rater1_secondary", "rater1_status", "rater1_country", "rater2_main", "rater2_secondary", "rater2_status", "rater2_country", "adjudicated_main", "notes"];
const lines = [head.join(",")];
for (const r of rows.filter((x) => taken.has(x.id))) {
  lines.push([r.id, taken.get(r.id), r.platform, r.handle, r.display_name, r.followers, (r.bio ?? "").replace(/\s+/g, " ").slice(0, 400), r.niche_status ?? "kept earlier", r.niche_main, r.niches, r.niche_confidence, r.country, r.country_source, r.country_status, r.country_reason, r.evidence, "", "", "", "", "", "", "", "", "", ""].map(csv).join(","));
}
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDir = join(repo, "eval-v2", "niche-benchmark");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `review-${dbName}.csv`);
writeFileSync(out, `\uFEFF${lines.join("\n")}\n`);
const byStratum: Record<string, number> = {};
for (const s of taken.values()) byStratum[s] = (byStratum[s] ?? 0) + 1;
console.log(JSON.stringify({ out, rows: taken.size, byStratum }, null, 1));
await sql.end();
