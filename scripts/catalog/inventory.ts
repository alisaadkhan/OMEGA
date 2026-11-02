/**
 * Read-only catalogue inventory (owner instruction 2026-10-27): creators vs platform profiles, states, the 10,000-follower
 * rule per profile, Pakistani eligibility per profile, niches, countries and a platform × main niche × country table.
 * Every number comes from the named database at run time; nothing is written to it.
 *
 *   node --import tsx scripts/catalog/inventory.ts --db mushin_catalog_v3 --label before
 *
 * Output (aggregate counts only, no creator names or bios): docs/completion/inventory/<date>-<db>-<label>/
 *   summary.json, overall.csv, niches.csv, countries.csv, crosstab.csv, coverage.csv
 * Eligibility is evaluated with the application's own rule (`creatorEligibility`), so the counts match what search shows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { creatorEligibility, type EligibilityProfile, NICHE_TAXONOMY } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, label: { type: "string", default: "current" } } });
const dbName = values.db ?? "";
if (!/^mushin_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local mushin_* database (never an evaluation corpus)");
const label = (values.label ?? "current").replace(/[^a-z0-9-]/gi, "");
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "catalog-inventory" });

type Row = Record<string, unknown>;
const now = new Date();
const PLATFORMS = ["youtube", "instagram", "tiktok"] as const;
const LABELS: string[] = [...NICHE_TAXONOMY];

const hasProfileCountry = async () =>
  (await db.withSystem((tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from information_schema.columns where table_schema = 'gcp' and table_name = 'creator_profiles' and column_name = 'country_status'`)))[0]?.n === 1;

const profileCountry = await hasProfileCountry();
const creators = await db.withSystem((tx) =>
  tx.execute<Row>(sql`
    select c.id, c.status, c.is_minor, c.minor_override_by_staff_id, c.display_name, c.country, c.country_source, c.country_checked_at,
      c.niche_main, c.niche_status, c.niche_confidence, c.niches, c.confirmed_country,
      (select jsonb_agg(e) from (select attribute, value, source, status from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute in ('niche', 'country')) e) evidence
    from gcp.creators c`),
);
const profiles = await db.withSystem((tx) =>
  profileCountry
    ? tx.execute<Row>(sql`select id, creator_id, platform, canonical_url, lower(handle) handle, followers, followers_updated_at, last_post_at, availability, country, country_source, country_status, country_checked_at from gcp.creator_profiles`)
    : tx.execute<Row>(sql`select id, creator_id, platform, canonical_url, lower(handle) handle, followers, followers_updated_at, last_post_at, availability, null country, null country_source, null country_status, null country_checked_at from gcp.creator_profiles`),
);
const docs = await db.withSystem((tx) => tx.execute<Row>(sql`select creator_id, eligible, eligibility_version from gcp.creator_search_documents`));

const byCreator = new Map<string, Row[]>();
for (const p of profiles) byCreator.set(p["creator_id"] as string, [...(byCreator.get(p["creator_id"] as string) ?? []), p]);

const toEligibility = (p: Row): EligibilityProfile => ({
  platform: p["platform"] as EligibilityProfile["platform"],
  canonicalUrl: p["canonical_url"] as string,
  followers: p["platform"] === "youtube" && p["followers"] === 0 ? null : (p["followers"] as number | null),
  followersUpdatedAt: p["followers_updated_at"] as string | null,
  lastPostAt: p["last_post_at"] as string | null,
  availability: (p["availability"] as EligibilityProfile["availability"]) ?? null,
  ...(profileCountry ? { country: { code: (p["country"] as string | null) ?? null, status: (p["country_status"] as never) ?? "unknown", checkedAt: (p["country_checked_at"] as string | null) ?? null } } : {}),
});

// Per-profile verdicts with the application's rule.
type Verdict = { platform: string; creatorId: string; qualifies: boolean; reasons: string[]; meetsFollowers: boolean };
const verdicts: Verdict[] = [];
for (const c of creators) {
  const ps = byCreator.get(c["id"] as string) ?? [];
  const e = creatorEligibility({ status: c["status"] as string, isMinor: c["is_minor"] as boolean, minorOverrideByStaffId: (c["minor_override_by_staff_id"] as string | null) ?? null }, ps.map(toEligibility), now);
  e.profiles.forEach((pe, i) => {
    const creatorBlocked = c["status"] !== "active" || (e.reasons as string[]).some((r) => r === "minor_protected");
    verdicts.push({
      platform: pe.platform,
      creatorId: c["id"] as string,
      qualifies: pe.qualifies && !creatorBlocked,
      reasons: [...pe.reasons, ...(creatorBlocked ? ["creator_blocked"] : [])],
      meetsFollowers: !pe.reasons.some((r) => r === "followers_unknown" || r === "followers_stale" || r === "below_follower_minimum"),
    });
    void i;
  });
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map((v) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";

// ── A. Overall ──
const platformsPerCreator = new Map<string, Set<string>>();
for (const p of profiles) platformsPerCreator.set(p["creator_id"] as string, (platformsPerCreator.get(p["creator_id"] as string) ?? new Set()).add(p["platform"] as string));
const urlDupes = Object.values(profiles.reduce<Record<string, number>>((m, p) => ((m[`${p["platform"]}|${p["canonical_url"]}`] = (m[`${p["platform"]}|${p["canonical_url"]}`] ?? 0) + 1), m), {})).filter((n) => n > 1).length;
const handleDupes = Object.values(profiles.reduce<Record<string, Set<string>>>((m, p) => ((m[`${p["platform"]}|${p["handle"]}`] ??= new Set()).add(p["creator_id"] as string), m), {})).filter((s) => s.size > 1).length;
const nameDupes = Object.values(creators.reduce<Record<string, number>>((m, c) => {
  const k = String(c["display_name"] ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (k.length >= 4) m[k] = (m[k] ?? 0) + 1;
  return m;
}, {})).filter((n) => n > 1).length;
const reasonCount = (platform: string | null, reason: string) => count(verdicts, (v) => (platform === null || v.platform === platform) && v.reasons.includes(reason));

const overall: (string | number | null)[][] = [["measure", "all", ...PLATFORMS]];
const per = (name: string, f: (platform: string | null) => number) => overall.push([name, f(null), ...PLATFORMS.map((p) => f(p))]);
const profilesOf = (platform: string | null) => profiles.filter((p) => platform === null || p["platform"] === platform);
per("platform_profiles", (pl) => profilesOf(pl).length);
per("availability_available", (pl) => count(profilesOf(pl), (p) => p["availability"] === "available"));
per("availability_temporarily_unavailable", (pl) => count(profilesOf(pl), (p) => p["availability"] === "temporarily_unavailable"));
per("availability_missing_unconfirmed", (pl) => count(profilesOf(pl), (p) => p["availability"] === "missing_unconfirmed"));
per("availability_not_found", (pl) => count(profilesOf(pl), (p) => p["availability"] === "not_found"));
per("availability_private", (pl) => count(profilesOf(pl), (p) => p["availability"] === "private"));
per("availability_unknown", (pl) => count(profilesOf(pl), (p) => p["availability"] === null || p["availability"] === undefined));
per("meets_10000_followers_own_profile", (pl) => count(verdicts, (v) => (pl === null || v.platform === pl) && v.meetsFollowers));
per("followers_unknown", (pl) => reasonCount(pl, "followers_unknown"));
per("followers_stale_over_90_days", (pl) => reasonCount(pl, "followers_stale"));
per("below_10000_followers", (pl) => reasonCount(pl, "below_follower_minimum"));
per("country_pakistan", (pl) => (profileCountry ? count(profilesOf(pl), (p) => p["country_status"] === "pakistan") : NaN));
per("country_foreign", (pl) => (profileCountry ? count(profilesOf(pl), (p) => p["country_status"] === "foreign") : NaN));
per("country_unknown", (pl) => (profileCountry ? count(profilesOf(pl), (p) => p["country_status"] === "unknown" || p["country_status"] === null) : NaN));
per("country_conflicting", (pl) => (profileCountry ? count(profilesOf(pl), (p) => p["country_status"] === "conflicting") : NaN));
per("country_stale", (pl) => reasonCount(pl, "country_stale"));
per("eligible_for_customer_search", (pl) => count(verdicts, (v) => (pl === null || v.platform === pl) && v.qualifies));
per("excluded_from_customer_search", (pl) => count(verdicts, (v) => (pl === null || v.platform === pl) && !v.qualifies));
for (const r of ["country_not_pakistan", "country_unknown", "country_conflicting", "country_stale", "inactive", "invalid_profile_url", "profile_not_found", "profile_private", "creator_blocked"])
  per(`excluded_reason_${r}`, (pl) => reasonCount(pl, r));

const summary = {
  database: dbName,
  label,
  reportedAt: now.toISOString(),
  script: "scripts/catalog/inventory.ts",
  eligibilityRule: profileCountry ? "per-profile country rule present (elig-2)" : "per-profile country rule not applied in this database (elig-1)",
  creators: creators.length,
  creatorsByStatus: creators.reduce<Record<string, number>>((m, c) => ((m[c["status"] as string] = (m[c["status"] as string] ?? 0) + 1), m), {}),
  creatorsWithPlatformCount: { one: count([...platformsPerCreator.values()], (s) => s.size === 1), two: count([...platformsPerCreator.values()], (s) => s.size === 2), three: count([...platformsPerCreator.values()], (s) => s.size === 3), none: creators.length - platformsPerCreator.size },
  platformProfiles: Object.fromEntries(PLATFORMS.map((p) => [p, profilesOf(p).length])),
  duplicateProfileUrls: urlDupes,
  sameHandleOnDifferentCreators: handleDupes,
  suspectedDuplicateIdentitiesBySameName: nameDupes,
  storedSearchDocuments: { total: docs.length, eligible: count(docs, (d) => d["eligible"] === true), versions: [...new Set(docs.map((d) => d["eligibility_version"]))] },
  eligibleCreators: new Set(verdicts.filter((v) => v.qualifies).map((v) => v.creatorId)).size,
};

// ── B. Niches (niche is stored per creator; each profile carries its creator's niche) ──
type Reconciliation = Record<string, number>;
const reconciliation: Record<string, Reconciliation> = {};
const nicheEv = (c: Row) => ((c["evidence"] as Row[] | null) ?? []).filter((e) => e["attribute"] === "niche");
const mainSource = (c: Row): string => {
  const main = c["niche_main"] as string | null;
  if (!main) return "none";
  const ev = nicheEv(c).filter((e) => e["value"] === main && e["status"] !== "weak");
  for (const s of ["profile_text", "post_text", "ai_assessment", "display_name"]) if (ev.some((e) => e["source"] === s)) return s;
  return "legacy_without_evidence";
};
const nicheRows: (string | number | null)[][] = [["platform", "label", "main_niche_profiles", "secondary_niche_profiles", "main_high", "main_medium", "main_low", "main_from_bio", "main_from_recent_content", "main_from_ai", "main_from_name_only", "eligible_main"]];
const creatorById = new Map(creators.map((c) => [c["id"] as string, c]));
const eligibleProfile = new Set(verdicts.filter((v) => v.qualifies).map((v) => `${v.creatorId}|${v.platform}`));
for (const pl of PLATFORMS) {
  const ps = profilesOf(pl).map((p) => ({ p, c: creatorById.get(p["creator_id"] as string) as Row }));
  for (const lab of LABELS) {
    const main = ps.filter(({ c }) => c["niche_main"] === lab);
    const secondary = ps.filter(({ c }) => c["niche_main"] !== lab && ((c["niches"] as string[] | null) ?? []).includes(lab));
    nicheRows.push([pl, lab, main.length, secondary.length,
      count(main, ({ c }) => c["niche_confidence"] === "high"), count(main, ({ c }) => c["niche_confidence"] === "medium"), count(main, ({ c }) => c["niche_confidence"] === "low"),
      count(main, ({ c }) => mainSource(c) === "profile_text"), count(main, ({ c }) => mainSource(c) === "post_text"), count(main, ({ c }) => mainSource(c) === "ai_assessment"), count(main, ({ c }) => mainSource(c) === "display_name"),
      count(main, ({ p }) => eligibleProfile.has(`${p["creator_id"]}|${pl}`))]);
  }
  // Status partition (sums to the platform's profile count; checked below). Labels avoid commas: plain CSV cells.
  const isElig = (p: Row) => eligibleProfile.has(`${p["creator_id"]}|${pl}`);
  const statusOf = (c: Row): string => (c["niche_status"] === null || c["niche_status"] === undefined ? "not_assessed" : String(c["niche_status"]));
  for (const [st, labelText] of [["classified", "(status: classified with a main niche)"], ["variety", "(status: variety)"], ["unknown", "(status: unknown - assessed but no reliable niche)"], ["not_assessed", "(status: not assessed under the 0054 model)"]] as const) {
    const inStatus = ps.filter(({ c }) => statusOf(c) === st);
    nicheRows.push([pl, labelText, inStatus.length, null, null, null, null, null, null, null, null, count(inStatus, ({ p }) => isElig(p))]);
  }
  nicheRows.push([pl, "(total: all profiles of this platform)", ps.length, null, null, null, null, null, null, null, null, count(ps, ({ p }) => isElig(p))]);
  // Diagnostics: overlap the partition above; never add them to it.
  nicheRows.push([pl, "(diagnostic: not assessed but keeping niches earlier evidence supported)", count(ps, ({ c }) => statusOf(c) === "not_assessed" && ((c["niches"] as string[] | null) ?? []).length > 0), null, null, null, null, null, null, null, null, null]);
  nicheRows.push([pl, "(diagnostic: conflicting niche evidence recorded)", count(ps, ({ c }) => nicheEv(c).some((e) => e["status"] === "conflicting")), null, null, null, null, null, null, null, null, null]);
  nicheRows.push([pl, "(diagnostic: no niche evidence rows at all)", count(ps, ({ c }) => nicheEv(c).length === 0), null, null, null, null, null, null, null, null, null]);
  reconciliation[pl] = {
    profiles: ps.length,
    classified: count(ps, ({ c }) => statusOf(c) === "classified"),
    variety: count(ps, ({ c }) => statusOf(c) === "variety"),
    unknown: count(ps, ({ c }) => statusOf(c) === "unknown"),
    notAssessed: count(ps, ({ c }) => statusOf(c) === "not_assessed"),
    classifiedByLabelSum: LABELS.reduce((a, lab) => a + count(ps, ({ c }) => c["niche_main"] === lab), 0),
    eligible: count(ps, ({ p }) => isElig(p)),
    eligibleWithMainNiche: count(ps, ({ p, c }) => isElig(p) && c["niche_main"] !== null),
    eligibleVariety: count(ps, ({ p, c }) => isElig(p) && statusOf(c) === "variety"),
    eligibleUnknown: count(ps, ({ p, c }) => isElig(p) && statusOf(c) === "unknown"),
    eligibleNotAssessed: count(ps, ({ p, c }) => isElig(p) && statusOf(c) === "not_assessed"),
  };
}

// ── C. Countries ──
const countryRows: (string | number | null)[][] = [["scope", "country", "source", "platform", "profiles_or_creators"]];
const creatorCountries = creators.reduce<Record<string, number>>((m, c) => {
  const k = `${c["country"] ?? "(none)"}|${c["country_source"] ?? "(none)"}`;
  m[k] = (m[k] ?? 0) + 1;
  return m;
}, {});
for (const [k, n] of Object.entries(creatorCountries).sort()) {
  const [country, source] = k.split("|");
  countryRows.push(["creator (resolved, one per person)", country ?? null, source ?? null, "all", n]);
}
if (profileCountry) {
  const profCountries = profiles.reduce<Record<string, number>>((m, p) => {
    const k = `${p["country"] ?? "(none)"}|${p["country_source"] ?? "(none)"}|${p["platform"]}|${p["country_status"]}`;
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  for (const [k, n] of Object.entries(profCountries).sort()) {
    const [country, source, platform, status] = k.split("|");
    countryRows.push([`profile (${status})`, country ?? null, source ?? null, platform ?? null, n]);
  }
}

// ── D. Crosstab: platform × main niche × profile country ──
const cross = new Map<string, { profiles: number; meets: number; eligible: number }>();
for (const v of verdicts) {
  const c = creatorById.get(v.creatorId) as Row;
  const p = (byCreator.get(v.creatorId) ?? []).find((x) => x["platform"] === v.platform);
  const country = profileCountry ? ((p?.["country"] as string | null) ?? `(${p?.["country_status"] ?? "unknown"})`) : ((c["country"] as string | null) ?? "(none)");
  const niche = (c["niche_main"] as string | null) ?? (c["niche_status"] === "variety" ? "(variety)" : c["niche_status"] === "unknown" ? "(unknown)" : "(not assessed)");
  const k = `${v.platform}|${niche}|${country}`;
  const cell = cross.get(k) ?? { profiles: 0, meets: 0, eligible: 0 };
  cell.profiles++;
  if (v.meetsFollowers) cell.meets++;
  if (v.qualifies) cell.eligible++;
  cross.set(k, cell);
}
const crossRows: (string | number | null)[][] = [["platform", "main_niche", profileCountry ? "profile_country" : "creator_country", "profiles", "meets_10000", "eligible_for_customer_search"]];
for (const [k, v] of [...cross.entries()].sort()) crossRows.push([...k.split("|"), v.profiles, v.meets, v.eligible]);

// ── Coverage matrix: 23 labels × 3 platforms, against the owner's targets (2026-10-28) ──
// Eligible profiles per main niche: initial milestone / longer-term target.
const TARGETS: Record<string, { initial: number; longTerm: number }> = { youtube: { initial: 10, longTerm: 20 }, instagram: { initial: 10, longTerm: 20 }, tiktok: { initial: 5, longTerm: 10 } };
const coverage: (string | number | null)[][] = [["label", "platform", "stored_main", "stored_main_or_secondary", "meets_10000", "pakistan_profile", "eligible", "main_high_or_medium_confidence", "country_evidence_present", "initial_target", "initial_deficit", "long_term_target", "long_term_deficit"]];
for (const lab of LABELS)
  for (const pl of PLATFORMS) {
    const ps = profilesOf(pl).filter((p) => creatorById.get(p["creator_id"] as string)?.["niche_main"] === lab);
    const any = profilesOf(pl).filter((p) => ((creatorById.get(p["creator_id"] as string)?.["niches"] as string[] | null) ?? []).includes(lab));
    const vs = verdicts.filter((v) => v.platform === pl && creatorById.get(v.creatorId)?.["niche_main"] === lab);
    const eligible = count(vs, (v) => v.qualifies);
    const t = TARGETS[pl] as { initial: number; longTerm: number };
    coverage.push([lab, pl, ps.length, any.length, count(vs, (v) => v.meetsFollowers), profileCountry ? count(ps, (p) => p["country_status"] === "pakistan") : null, eligible,
      count(ps, (p) => ["high", "medium"].includes(String(creatorById.get(p["creator_id"] as string)?.["niche_confidence"]))), profileCountry ? count(ps, (p) => p["country_status"] !== "unknown") : count(ps, (p) => creatorById.get(p["creator_id"] as string)?.["country"] != null),
      t.initial, Math.max(0, t.initial - eligible), t.longTerm, Math.max(0, t.longTerm - eligible)]);
  }
const n = (v: number | undefined) => v ?? Number.NaN; // a missing count must fail the check, never pass it
for (const r of Object.values(reconciliation)) {
  r["partitionOk"] = Number(n(r["classified"]) + n(r["variety"]) + n(r["unknown"]) + n(r["notAssessed"]) === r["profiles"] && r["classifiedByLabelSum"] === r["classified"]);
  r["eligibleSplitOk"] = Number(n(r["eligibleWithMainNiche"]) + n(r["eligibleVariety"]) + n(r["eligibleUnknown"]) + n(r["eligibleNotAssessed"]) === r["eligible"]);
}
Object.assign(summary, { reconciliation });
if (Object.values(reconciliation).some((r) => r["partitionOk"] !== 1 || r["eligibleSplitOk"] !== 1)) console.error("RECONCILIATION FAILED: see summary.json reconciliation");
const met = (col: number, target: number) => coverage.slice(1).filter((r) => (r[col] as number) === 0 && target >= 0).length;
Object.assign(summary, {
  targets: TARGETS,
  combinations: coverage.length - 1,
  initialMilestoneMet: met(10, 0),
  longTermTargetMet: met(12, 0),
  initialDeficit: coverage.slice(1).reduce((a, r) => a + (r[10] as number), 0),
  longTermDeficit: coverage.slice(1).reduce((a, r) => a + (r[12] as number), 0),
});

const out = join(root, "docs", "completion", "inventory", `${now.toISOString().slice(0, 10)}-${dbName}-${label}`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(join(out, "overall.csv"), csv(overall.map((r) => r.map((v) => (typeof v === "number" && Number.isNaN(v) ? "n/a" : v)))));
writeFileSync(join(out, "niches.csv"), csv(nicheRows));
writeFileSync(join(out, "countries.csv"), csv(countryRows));
writeFileSync(join(out, "crosstab.csv"), csv(crossRows));
writeFileSync(join(out, "coverage.csv"), csv(coverage));
console.log(JSON.stringify(summary, null, 2));
console.log(`written: ${out}`);
await db.close();
