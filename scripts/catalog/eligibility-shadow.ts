/**
 * Shadow (dry-run) eligibility report: the active rule (elig-2) against candidate policies, over a local catalogue copy.
 * Reads only: no status, search document, index or enrichment setting is changed, and nothing is written to the database.
 *   node --import tsx scripts/catalog/eligibility-shadow.ts --db mushin_catalog_v3
 * Writes docs/completion/inventory/<date>-eligibility-shadow-<db>/ (summary.json, outcomes.csv, transitions.csv,
 * review-cases.csv). Review cases list internal creator ids only: no handle, name, bio or contact.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createDatabase } from "@mushin/db";
import { creatorEligibility, type EligibilityProfile } from "../../apps/api/src/modules/creators/index";
import { bandOf, evaluate, FOLLOWER_BANDS, SCENARIOS, type Outcome, type Platform, type ShadowProfile } from "./shadow-policy";

const { values } = parseArgs({ options: { db: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local mushin_* database (never an evaluation corpus)");
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "eligibility-shadow" });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const now = new Date();
const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];
const OUTCOMES: Outcome[] = ["eligible", "ineligible", "review", "unknown"];
const DAY = 86_400_000;
type Row = Record<string, unknown>;

const [creators, profiles] = await db.withSystem(async (tx) => {
  await tx.execute(sql`set transaction read only`);
  return [
    [...(await tx.execute<Row>(sql`select id, status, is_minor, minor_override_by_staff_id from gcp.creators`))],
    [...(await tx.execute<Row>(sql`select creator_id, platform, canonical_url, followers, followers_updated_at, last_post_at, availability, engagement_rate, avg_views,
      country, country_status, country_source, country_checked_at from gcp.creator_profiles`))],
  ] as const;
});
await db.close();

const toEligibility = (p: Row): EligibilityProfile => ({
  platform: p["platform"] as Platform,
  canonicalUrl: p["canonical_url"] as string,
  followers: p["platform"] === "youtube" && p["followers"] === 0 ? null : (p["followers"] as number | null),
  followersUpdatedAt: p["followers_updated_at"] as string | null,
  lastPostAt: p["last_post_at"] as string | null,
  availability: (p["availability"] as EligibilityProfile["availability"]) ?? null,
  country: { code: (p["country"] as string | null) ?? null, status: (p["country_status"] as never) ?? "unknown", checkedAt: (p["country_checked_at"] as string | null) ?? null },
});

type Item = { creatorId: string; platform: Platform; band: string; countrySource: string | null; shadow: ShadowProfile; results: Record<string, ReturnType<typeof evaluate>> };
const byCreator = new Map<string, Row[]>();
for (const p of profiles) byCreator.set(p["creator_id"] as string, [...(byCreator.get(p["creator_id"] as string) ?? []), p]);
const items: Item[] = [];
let activeEligibleCreators = 0;
for (const c of creators) {
  const ps = byCreator.get(c["id"] as string) ?? [];
  const e = creatorEligibility({ status: c["status"] as string, isMinor: c["is_minor"] as boolean, minorOverrideByStaffId: (c["minor_override_by_staff_id"] as string | null) ?? null }, ps.map(toEligibility), now);
  if (e.eligible) activeEligibleCreators++;
  const profileCodes = new Set(e.profiles.flatMap((x) => x.reasons));
  const creatorReasons = e.reasons.filter((r) => !profileCodes.has(r as never));
  ps.forEach((p, i) => {
    const v = e.profiles[i];
    if (!v) return;
    const shadow: ShadowProfile = {
      platform: p["platform"] as Platform,
      followers: toEligibility(p).followers,
      lastPostAt: p["last_post_at"] ? new Date(p["last_post_at"] as string) : null,
      engagementRate: (p["engagement_rate"] as number | null) ?? null,
      avgViews: (p["avg_views"] as number | null) ?? null,
      baseline: { qualifies: v.qualifies, reasons: [...v.reasons], creatorReasons },
    };
    items.push({ creatorId: c["id"] as string, platform: shadow.platform, band: bandOf(shadow.followers), countrySource: (p["country_source"] as string | null) ?? null, shadow, results: Object.fromEntries(SCENARIOS.map((s) => [s.id, evaluate(shadow, s, now)])) });
  });
}

// Sanity: the elig-2 scenario must reproduce the application's own count, or the comparison means nothing.
const shadowEligible = items.filter((i) => i.results["elig-2"]?.outcome === "eligible").length;
if (shadowEligible !== activeEligibleCreators) throw new Error(`elig-2 scenario gives ${shadowEligible} eligible profiles, the application ${activeEligibleCreators}`);

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);
const count = <T>(xs: T[], f: (x: T) => boolean) => xs.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
const of = (p: Platform) => items.filter((i) => i.platform === p);

const outcomes = SCENARIOS.flatMap((s) =>
  PLATFORMS.map((p) => {
    const xs = of(p);
    return { scenario: s.id, kind: s.kind, platform: p, profiles: xs.length, ...Object.fromEntries(OUTCOMES.flatMap((o) => { const n = count(xs, (x) => x.results[s.id]?.outcome === o); return [[o, n], [`${o}Pct`, pct(n, xs.length)]]; })) };
  }),
);

const transitions: { scenario: string; platform: Platform; from: Outcome; to: Outcome; reasonAdded: string; profiles: number }[] = [];
for (const s of SCENARIOS.filter((x) => x.id !== "elig-2")) {
  const m = new Map<string, number>();
  for (const i of items) {
    const a = i.results["elig-2"], b = i.results[s.id];
    if (!a || !b || a.outcome === b.outcome) continue;
    const added = b.reasons.filter((r) => !a.reasons.includes(r)).join("+") || "(reasons removed: " + a.reasons.filter((r) => !b.reasons.includes(r)).join("+") + ")";
    const k = [s.id, i.platform, a.outcome, b.outcome, added].join("|");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  for (const [k, n] of m) { const [scenario, platform, from, to, reasonAdded] = k.split("|") as [string, Platform, Outcome, Outcome, string]; transitions.push({ scenario, platform, from, to, reasonAdded, profiles: n }); }
}

// Reason counts under the active rule (why profiles are not eligible today).
const activeReasons = PLATFORMS.flatMap((p) => {
  const m = new Map<string, number>();
  for (const i of of(p)) for (const r of i.results["elig-2"]?.reasons ?? []) m.set(r, (m.get(r) ?? 0) + 1);
  return [...m].map(([reason, n]) => ({ platform: p, reason, profiles: n })).sort((a, b) => b.profiles - a.profiles);
});

// Data availability for every metric a rule uses or a proposal needs.
const availability = PLATFORMS.map((p) => {
  const xs = of(p);
  return {
    platform: p, profiles: xs.length,
    followerCount: count(xs, (x) => x.shadow.followers !== null),
    latestPostDate: count(xs, (x) => x.shadow.lastPostAt !== null),
    engagementRate: count(xs, (x) => x.shadow.engagementRate !== null),
    engagementRateAt0or100: count(xs, (x) => x.shadow.engagementRate === 0 || x.shadow.engagementRate === 100),
    averageViews: count(xs, (x) => x.shadow.avgViews !== null),
    countryDecided: count(xs, (x) => !x.shadow.baseline.reasons.includes("country_unknown")),
    perPostTimestamps: 0, perPostEngagement: 0, perPostViews: 0, longFormVsShortsFlag: 0, instagramPostType: 0,
  };
});

// Threshold and activity sensitivity among profiles that pass everything else under the active rule.
const otherwiseEligible = (i: Item, ignore: string) => (i.results["elig-2"]?.reasons ?? []).every((r) => r === ignore) && i.shadow.baseline.creatorReasons.length === 0;
const followerBands = PLATFORMS.flatMap((p) => FOLLOWER_BANDS.map((b) => ({ platform: p, band: b.band, profilesPassingEverythingElse: count(of(p), (i) => i.band === b.band && otherwiseEligible(i, "below_follower_minimum")) })));
const activityWindows = PLATFORMS.map((p) => {
  const xs = of(p).filter((i) => otherwiseEligible(i, "inactive"));
  const within = (d: number) => count(xs, (i) => i.shadow.lastPostAt !== null && now.getTime() - i.shadow.lastPostAt.getTime() <= d * DAY);
  return { platform: p, profilesPassingEverythingElse: xs.length, within30d: within(30), within45d: within(45), within60d: within(60), within90d: within(90), noPostDate: count(xs, (i) => i.shadow.lastPostAt === null) };
});

// TikTok research metrics: what can be approximated from stored aggregates (labelled proxies, never applied).
const tt = of("tiktok");
const ratio = (i: Item) => (i.shadow.avgViews !== null && i.shadow.followers ? i.shadow.avgViews / i.shadow.followers : null);
const tiktokProxies = {
  profiles: tt.length,
  aggregateEngagementAvailable: count(tt, (i) => i.shadow.engagementRate !== null),
  aggregateEngagementAtLeast3_5: count(tt, (i) => (i.shadow.engagementRate ?? -1) >= 3.5),
  averageViewsAvailable: count(tt, (i) => i.shadow.avgViews !== null),
  averageViewsToFollowersAtLeast15pct: count(tt, (i) => (ratio(i) ?? -1) >= 0.15),
  averageViewsToFollowersAtLeast20pct: count(tt, (i) => (ratio(i) ?? -1) >= 0.2),
  postingFrequencyAvailable: 0,
};

// Review cases: where the active verdict may be wrong (ids only).
const cases: { creatorId: string; platform: Platform; band: string; kind: string; detail: string }[] = [];
for (const i of items) {
  const a = i.results["elig-2"];
  if (!a) continue;
  const add = (kind: string, detail: string) => cases.push({ creatorId: i.creatorId, platform: i.platform, band: i.band, kind, detail });
  if (a.outcome === "eligible") {
    if (i.shadow.engagementRate !== null && i.shadow.engagementRate < 1) add("possible_false_positive", "eligible with engagement under 1%");
    if (i.shadow.engagementRate === 100) add("possible_false_positive", "eligible with engagement 100% (data quality)");
    if (i.shadow.lastPostAt === null) add("possible_false_positive", "eligible without a stored post date (activity unverified)");
    else if (i.platform === "youtube" && now.getTime() - i.shadow.lastPostAt.getTime() > 45 * DAY) add("possible_false_positive", "eligible YouTube channel with no upload in 45 days");
    if (i.countrySource === "platform_declared") add("low_confidence_eligible", "Pakistan only from the platform-declared country (low confidence)");
  } else {
    const r = a.reasons;
    if (r.length === 1 && r[0] === "country_unknown") add("possible_false_negative", "passes everything except an unknown country");
    if (r.length === 1 && r[0] === "below_follower_minimum" && (i.shadow.followers ?? 0) >= 9_000) add("possible_false_negative", "9,000-9,999 followers, passes everything else");
    if (r.length === 1 && r[0] === "inactive" && i.shadow.lastPostAt && now.getTime() - i.shadow.lastPostAt.getTime() <= 120 * DAY) add("possible_false_negative", "last post 91-120 days ago, passes everything else");
    if (r.includes("country_conflicting")) add("needs_review", "conflicting country evidence");
  }
}

const csv = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0] ?? {});
  const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
};
const outDir = join(root, "docs", "completion", "inventory", `${now.toISOString().slice(0, 10)}-eligibility-shadow-${dbName}`);
mkdirSync(outDir, { recursive: true });
const caseSummary = [...cases.reduce((m, c) => m.set(`${c.platform}|${c.kind}|${c.detail}`, (m.get(`${c.platform}|${c.kind}|${c.detail}`) ?? 0) + 1), new Map<string, number>())].map(([k, n]) => { const [platform, kind, detail] = k.split("|"); return { platform, kind, detail, profiles: n }; });
const summary = {
  database: dbName, at: now.toISOString(), activePolicy: "elig-2 (unchanged)", writes: "none",
  profiles: items.length, creators: creators.length, activeEligibleProfiles: activeEligibleCreators,
  scenarios: SCENARIOS.map((s) => ({ id: s.id, kind: s.kind, label: s.label })),
  outcomes, activeReasons, availability, followerBands, activityWindows, tiktokProxies, reviewCases: caseSummary,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "outcomes.csv"), csv(outcomes));
writeFileSync(join(outDir, "transitions.csv"), csv(transitions));
writeFileSync(join(outDir, "review-cases.csv"), csv(cases));
console.log(JSON.stringify({ profiles: items.length, activeEligibleProfiles: activeEligibleCreators, outDir }, null, 1));
