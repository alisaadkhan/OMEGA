/**
 * Candidate eligibility policies for a shadow (dry-run) comparison with the active rule. Report-only: nothing here is used
 * by the application, and nothing here writes. The active rule stays `elig-2` (apps/api/src/modules/creators/eligibility.ts);
 * each candidate starts from that rule's verdict for the profile and changes only the dimensions it names.
 *
 * Outcomes keep policy results apart from missing evidence:
 *   eligible   - passes every rule of the scenario on stored evidence
 *   ineligible - fails a rule on evidence that is stored (below a threshold, foreign, inactive, gone)
 *   review     - needs a person: conflicting country, protected possible minor, engagement in a review band
 *   unknown    - a rule needs evidence MUSHIN does not store for this profile (never passed or failed by assumption)
 */
export type Platform = "youtube" | "instagram" | "tiktok";
export type Outcome = "eligible" | "ineligible" | "review" | "unknown";

export type ShadowProfile = {
  platform: Platform;
  followers: number | null;
  lastPostAt: Date | null;
  engagementRate: number | null; // percent, as stored (profileMetrics)
  avgViews: number | null;
  /** The active rule's verdict for this profile (profileEligibility), plus creator-level reasons (possible minor, status). */
  baseline: { qualifies: boolean; reasons: string[]; creatorReasons: string[] };
};

export type Scenario = {
  id: string;
  label: string;
  /** "policy": a rule MUSHIN could apply. "shadow": a research rule whose metric is not stored; reported, never applied. */
  kind: "policy" | "shadow";
  minFollowers: Record<Platform, number>;
  /** Days since the latest post beyond which a profile is inactive. */
  activityDays: Record<Platform, number>;
  /** A profile without a stored post date: the active rule flags it (passes); a strict scenario makes it unknown. */
  missingActivity: "flag" | "unknown";
  /** Research sanity check: review below `reviewBelow`% for 10K-500K accounts; below `flagBelow`% is only flagged. */
  engagement?: { flagBelow: number; reviewBelow: number };
  /** Research rules that need per-post data (posting frequency, median engagement, median views/followers). */
  perPostRules?: { platform: Platform; rule: string }[];
};

const P = (yt: number, ig: number, tt: number): Record<Platform, number> => ({ youtube: yt, instagram: ig, tiktok: tt });
const BASE = { minFollowers: P(10_000, 10_000, 10_000), activityDays: P(90, 90, 90), missingActivity: "flag" as const };

export const SCENARIOS: Scenario[] = [
  { id: "elig-2", label: "Active rule: 10K on the own profile, 90-day activity, Pakistani country (YouTube counts at most 30 days old)", kind: "policy", ...BASE },
  { id: "cand-tt20k", label: "TikTok floor 20K (others unchanged)", kind: "policy", ...BASE, minFollowers: P(10_000, 10_000, 20_000) },
  { id: "cand-tt25k", label: "TikTok floor 25K (others unchanged)", kind: "policy", ...BASE, minFollowers: P(10_000, 10_000, 25_000) },
  { id: "cand-all50k", label: "50K on every platform (comparison only; the research does not support it)", kind: "policy", ...BASE, minFollowers: P(50_000, 50_000, 50_000) },
  { id: "cand-yt45", label: "YouTube latest upload within 45 days (research), others 90", kind: "policy", ...BASE, activityDays: P(45, 90, 90) },
  { id: "cand-30d", label: "Latest post within 30 days on every platform", kind: "policy", ...BASE, activityDays: P(30, 30, 30) },
  { id: "cand-strict-activity", label: "Activity must be shown: no stored post date = unknown (90 days)", kind: "policy", ...BASE, missingActivity: "unknown" },
  { id: "cand-engagement", label: "Engagement sanity: review under 1.5% (10K-500K), flag under 1%", kind: "policy", ...BASE, engagement: { flagBelow: 1, reviewBelow: 1.5 } },
  {
    id: "shadow-research-posts",
    label: "Research per-post rules (TikTok 4 videos/30 days, median engagement 3.5% of last 10, median views/followers 15%; Instagram 2 posts/30 days; YouTube 1 long-form/45 days)",
    kind: "shadow",
    ...BASE,
    perPostRules: [
      { platform: "tiktok", rule: "posting_4_in_30d" },
      { platform: "tiktok", rule: "median_engagement_last10_3_5pct" },
      { platform: "tiktok", rule: "median_views_to_followers_15pct" },
      { platform: "instagram", rule: "posting_2_in_30d" },
      { platform: "youtube", rule: "long_form_upload_in_45d" },
    ],
  },
];

const KNOWN_FAIL = new Set(["below_follower_minimum", "followers_stale", "country_not_pakistan", "country_stale", "inactive", "profile_not_found", "profile_private", "invalid_profile_url", "creator_not_active", "no_profile"]);
const REVIEW = new Set(["country_conflicting", "minor_protected", "engagement_review"]);
const MISSING = new Set(["followers_unknown", "country_unknown", "activity_unknown", "per_post_data_missing"]);
/** Reasons a scenario recomputes from raw values instead of taking from the active rule. */
const RECOMPUTED = new Set(["below_follower_minimum", "inactive"]);
const DAY = 86_400_000;

export function outcomeOf(reasons: string[]): Outcome {
  if (reasons.some((r) => KNOWN_FAIL.has(r))) return "ineligible";
  if (reasons.some((r) => REVIEW.has(r))) return "review";
  if (reasons.some((r) => MISSING.has(r))) return "unknown";
  return "eligible";
}

export function evaluate(p: ShadowProfile, s: Scenario, now: Date): { outcome: Outcome; reasons: string[]; flags: string[] } {
  const reasons = [...p.baseline.creatorReasons, ...p.baseline.reasons.filter((r) => !RECOMPUTED.has(r))];
  const flags: string[] = [];
  // The active rule checks "fresh" before "minimum": only a known, fresh count is compared with the scenario's floor.
  const countKnownAndFresh = p.followers !== null && !p.baseline.reasons.includes("followers_stale") && !p.baseline.reasons.includes("followers_unknown");
  if (countKnownAndFresh && (p.followers ?? 0) < s.minFollowers[p.platform]) reasons.push("below_follower_minimum");
  if (p.lastPostAt === null) {
    if (s.missingActivity === "unknown") reasons.push("activity_unknown");
    else flags.push("activity_unverified");
  } else if (now.getTime() - p.lastPostAt.getTime() > s.activityDays[p.platform] * DAY) reasons.push("inactive");
  if (s.engagement) {
    const f = p.followers ?? 0;
    if (p.engagementRate === null) flags.push("engagement_unknown");
    else {
      if (p.engagementRate < s.engagement.reviewBelow && f >= 10_000 && f < 500_000) reasons.push("engagement_review");
      if (p.engagementRate < s.engagement.flagBelow) flags.push("engagement_below_1pct");
    }
  }
  if (s.perPostRules?.some((r) => r.platform === p.platform)) reasons.push("per_post_data_missing");
  return { outcome: outcomeOf(reasons), reasons: [...new Set(reasons)], flags };
}

export const FOLLOWER_BANDS = [
  { band: "<10K", min: 0, max: 10_000 },
  { band: "10K-20K", min: 10_000, max: 20_000 },
  { band: "20K-25K", min: 20_000, max: 25_000 },
  { band: "25K-50K", min: 25_000, max: 50_000 },
  { band: "50K-100K", min: 50_000, max: 100_000 },
  { band: "100K-500K", min: 100_000, max: 500_000 },
  { band: "500K+", min: 500_000, max: Infinity },
] as const;
export const bandOf = (followers: number | null) => (followers === null ? "unknown" : (FOLLOWER_BANDS.find((b) => followers >= b.min && followers < b.max)?.band ?? "unknown"));
