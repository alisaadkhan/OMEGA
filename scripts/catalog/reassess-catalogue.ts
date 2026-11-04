/**
 * Whole-catalogue reassessment (owner master directive 2026-11-03, Phases 2–5). Dry run by default: prints the impact
 * report; --apply writes account type (0075) and content performance (median typical views / median ER, 0066 columns),
 * re-decides every profile's country and re-projects search. Run backfill-evidence.ts first for niche, city and country
 * evidence. Uses only stored provider answers: no provider or AI call, nothing deleted, staff decisions never replaced.
 * Versioned and repeatable: running it again with the same rules changes nothing.
 *
 *   node --import tsx scripts/catalog/reassess-catalogue.ts --db mushin_catalog_v4 [--apply] [--out report.json]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { bulkRefreshProfileCountries, classifyAccountType, contentPerformance, createCreatorIndexer, evaluateV3, NON_TARGET_TYPES, REASSESSMENT_VERSION, standardize, type AccountType } from "../../apps/api/src/modules/creators/index";


const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false }, out: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "reassess-catalogue" });
const logger = createLogger({ level: "info", name: "reassess-catalogue" });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const storageRoots = existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const payload = (key: string | null): unknown => {
  if (!key) return null;
  for (const base of storageRoots) if (existsSync(join(base, key))) return JSON.parse(readFileSync(join(base, key), "utf8"));
  return null;
};

type Row = {
  creator_id: string; profile_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; display_name: string; bio: string | null; followers: number | null;
  country_status: string | null; country: string | null; diaspora: boolean; primary_platform: string; account_type_source: string | null; organisation_override: boolean; is_minor: boolean; key: string | null;
};
const rows = await db.withSystem((tx) =>
  tx.execute<Row>(sql`
    select p.creator_id, p.id profile_id, p.platform, p.handle, c.display_name, p.bio, p.followers, p.country_status, p.country, p.pakistani_diaspora diaspora, c.primary_platform,
      c.account_type_source, c.organisation_override_by_staff_id is not null organisation_override, (c.is_minor and c.minor_override_by_staff_id is null) is_minor,
      (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform order by r.fetched_at desc limit 1) key
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where c.status = 'active'`),
);

// Creators the owner named as creators (owner-named manifest, master directive 2026-11-03 Wave 1): the famous-creator
// safeguard keeps them individual creators whatever their platform category says (e.g. "Actor").
// Owner override 2026-11-04: YouTube derived metrics on unless YOUTUBE_DERIVED_METRICS=off.
const youtubeDerived = process.env["YOUTUBE_DERIVED_METRICS"] !== "off";
const ownerNamed = new Set<string>((JSON.parse(readFileSync(join(root, "docs", "completion", "seed", "owner-named-2026-11-03.json"), "utf8")) as { candidates: { handle: string }[] }).candidates.map((c) => c.handle.toLowerCase()));

const location = (r: Row): string =>
  r.country_status === "pakistan" ? "PAKISTAN_CONFIRMED" : r.country_status === "conflicting" ? "CONFLICTING_EVIDENCE" : r.country_status === "foreign" ? (r.diaspora ? "PAKISTANI_DIASPORA" : "NON_PAKISTANI_CONFIRMED") : "UNKNOWN";

const accountUpdates = new Map<string, { id: string; type: AccountType; source: string | null; confidence: string | null; evidence: string | null }>();
const perfUpdates: { id: string; mv: number | null; mer: number | null; vs: number; es: number; fmt: string; from: string | null; to: string | null }[] = [];
const tally = { creators: new Set<string>(), profiles: rows.length, fromPayload: 0, noPayload: 0 };
const outcome = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const accountTypes = new Map<string, number>();
const locations = new Map<string, number>();
const badges = new Map<string, number>();

for (const r of rows) {
  tally.creators.add(r.creator_id);
  bump(locations, `${r.platform} ${location(r)}`);
  const raw = payload(r.key);
  const std = raw ? standardize(r.platform, r.handle, raw, { maxPosts: 30 }) : null;
  if (std?.kind === "ok") tally.fromPayload++;
  else tally.noPayload++;
  // Account type from the creator's primary profile (the platform category lives there).
  if (r.platform === r.primary_platform && r.account_type_source !== "staff") {
    const d = ownerNamed.has(r.handle.toLowerCase())
      ? { type: "INDIVIDUAL_CREATOR" as const, source: "staff", confidence: "high", evidence: "Named by the owner as a creator (owner-named manifest 2026-11-03)" }
      : classifyAccountType({ category: std?.kind === "ok" ? (std.profile.accountCategory ?? null) : null, bio: r.bio ?? "", handle: r.handle, displayName: r.display_name });
    accountUpdates.set(r.creator_id, { id: r.creator_id, ...d });
    bump(accountTypes, d.type);
  }
  if (std?.kind === "ok" && (r.platform !== "youtube" || youtubeDerived)) {
    const perf = contentPerformance(std.profile, { youtubeDerived });
    if (perf) perfUpdates.push({ id: r.profile_id, mv: perf.medianViews, mer: perf.medianEngagementRate, vs: perf.viewsSample, es: perf.engagementSample, fmt: perf.format, from: perf.sampleFrom?.toISOString() ?? null, to: perf.sampleTo?.toISOString() ?? null });
    const v3 = evaluateV3({ platform: r.platform, followers: r.followers, following: std.profile.following, followersFresh: true, countryStatus: (r.country_status ?? null) as "pakistan" | "foreign" | "unknown" | "conflicting" | null, available: true, performance: perf, youtubeDerivedPermitted: youtubeDerived });
    bump(badges, `${r.platform} ${v3.status === "eligible" ? "Meets High-Performance Standard" : v3.status === "below_minimum" ? "Below View/ER Benchmark" : "Performance Assessment Incomplete"}`);
  } else bump(badges, `${r.platform} Performance Assessment Incomplete`);
}

// Impact per creator (Phase 2 report).
const byCreator = new Map<string, Row[]>();
for (const r of rows) byCreator.set(r.creator_id, [...(byCreator.get(r.creator_id) ?? []), r]);
const minimum: Record<string, number> = { instagram: 10_000, tiktok: 10_000, youtube: 10_000 };
for (const [id, ps] of byCreator) {
  const type = accountUpdates.get(id)?.type ?? "UNKNOWN";
  const conf = accountUpdates.get(id)?.confidence ?? null;
  // Pakistan-based and Pakistani-diaspora profiles are both kept (execution directive 2026-11-04, Stage 1 §4).
  const pk = ps.filter((p) => p.country_status === "pakistan" || (p.country_status === "foreign" && p.diaspora));
  if (ps.every((p) => p.country_status === "foreign" && !p.diaspora)) bump(outcome, "excluded: confirmed non-Pakistani");
  else if (NON_TARGET_TYPES.has(type) && conf !== "low" && !ps[0]?.organisation_override) bump(outcome, `excluded: non-target account type (${type})`);
  else if (pk.length === 0) bump(outcome, "kept unknown: location not confirmed (research or reassess)");
  else if (pk.every((p) => (p.followers ?? 0) < (minimum[p.platform] ?? 10_000))) bump(outcome, "excluded from results: below follower minimum");
  else if (ps[0]?.is_minor) bump(outcome, "excluded: possible minor (staff review)");
  else bump(outcome, type === "UNKNOWN" ? "retained eligible Pakistani creator (account type unknown, shown as such)" : "retained eligible Pakistani individual creator");
}

const report = {
  version: REASSESSMENT_VERSION,
  mode: values.apply ? "apply" : "dry-run",
  database: dbName,
  creators: tally.creators.size,
  profiles: tally.profiles,
  profilesWithStoredAnswer: tally.fromPayload,
  profilesWithoutStoredAnswer: tally.noPayload,
  impact: Object.fromEntries([...outcome.entries()].sort((a, b) => b[1] - a[1])),
  accountTypes: Object.fromEntries([...accountTypes.entries()].sort((a, b) => b[1] - a[1])),
  locationOutcomes: Object.fromEntries([...locations.entries()].sort()),
  elig3Badges: Object.fromEntries([...badges.entries()].sort()),
  performanceRecalculated: perfUpdates.length,
};

if (values.apply) {
  const acc = [...accountUpdates.values()];
  for (let i = 0; i < acc.length; i += 500) {
    await db.withSystem((tx) =>
      tx.execute(sql`
        update gcp.creators c set account_type = u.type, account_type_source = u.source, account_type_confidence = u.confidence, account_type_evidence = left(u.evidence, 300), account_type_assessed_at = now(), updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(acc.slice(i, i + 500))}::jsonb) as u(id uuid, type text, source text, confidence text, evidence text)
        where c.id = u.id and c.account_type_source is distinct from 'staff'`),
    );
  }
  for (let i = 0; i < perfUpdates.length; i += 500) {
    await db.withSystem((tx) =>
      tx.execute(sql`
        update gcp.creator_profiles p set median_views = u.mv, median_engagement_rate = u.mer, performance_views_sample = u.vs, performance_engagement_sample = u.es, performance_format = u.fmt, performance_from = u.f::timestamptz, performance_to = u.t::timestamptz, performance_at = now(), updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(perfUpdates.slice(i, i + 500).map((x) => ({ ...x, f: x.from, t: x.to })))}::jsonb) as u(id uuid, mv double precision, mer double precision, vs integer, es integer, fmt text, f text, t text)
        where p.id = u.id`),
    );
  }
  const ids = [...tally.creators];
  let changed = 0;
  for (let i = 0; i < ids.length; i += 500) changed += (await db.withSystem((tx) => bulkRefreshProfileCountries(tx, ids.slice(i, i + 500), { source: "backfill" }))).length;
  Object.assign(report, { countriesChanged: changed, projection: await createCreatorIndexer({ db, index: null, logger }).reconcile() });
}
const text = JSON.stringify(report, null, 1);
if (values.out) writeFileSync(values.out, text);
console.log(text);
await db.close();
