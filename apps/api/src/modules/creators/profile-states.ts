import { evaluateV3 } from "./eligibility-v3";

/**
 * Honest per-profile states for the creator profile (owner master directive 2026-11-03, Parts 4 and 8).
 *
 * Location: one of five outcomes from the profile's own country decision. Diaspora is only said when a foreign-based
 * profile itself says Pakistani in its bio (never from a name, language or appearance).
 *
 * Performance: the elig-3 quality badge. It is a badge only; elig-2 stays the hard gate for being shown at all.
 */
export const LOCATION_OUTCOMES = ["PAKISTAN_CONFIRMED", "NON_PAKISTANI_CONFIRMED", "PAKISTANI_DIASPORA", "UNKNOWN", "CONFLICTING_EVIDENCE"] as const;
export type LocationOutcome = (typeof LOCATION_OUTCOMES)[number];
const DIASPORA = /(?:^|[^\p{L}])(pakistani|pak(?:istan)?[- ]?born)(?![\p{L}])|🇵🇰/iu;

export function locationOutcome(countryStatus: string | null, bio: string | null): LocationOutcome {
  if (countryStatus === "pakistan") return "PAKISTAN_CONFIRMED";
  if (countryStatus === "conflicting") return "CONFLICTING_EVIDENCE";
  if (countryStatus === "foreign") return DIASPORA.test(bio ?? "") ? "PAKISTANI_DIASPORA" : "NON_PAKISTANI_CONFIRMED";
  return "UNKNOWN";
}

export type PerformanceBadge = "meets_standard" | "below_benchmark" | "incomplete";
const FRESH_DAYS = { instagram: 90, tiktok: 90, youtube: 30 } as const;

/** Soft quality signals for a person to read (never a filter or a deletion): elig-3 warnings, in plain words. */
export const QUALITY_SIGNAL_TEXT: Record<string, string> = {
  following_over_10pct_of_followers: "Follows many accounts for its size (following is over 10% of followers)",
  tiktok_views_below_1_5x_followers: "Typical TikTok views are below 1.5x followers",
};

export function performanceBadge(
  p: {
    platform: "instagram" | "tiktok" | "youtube";
    followers: number | null;
    following: number | null;
    followersUpdatedAt: Date | null;
    countryStatus: string | null;
    medianViews: number | null;
    medianEngagementRate: number | null;
    performanceViewsSample: number | null;
    performanceEngagementSample: number | null;
    performanceFormat: string | null;
  },
  opts: { restricted: boolean; now: Date },
): PerformanceBadge {
  return performanceAssessment(p, opts).badge;
}

/** The badge and the soft quality signals from one evaluation. */
export function performanceAssessment(p: Parameters<typeof performanceBadge>[0], opts: { restricted: boolean; now: Date }): { badge: PerformanceBadge; signals: string[] } {
  if (opts.restricted) return { badge: "incomplete", signals: [] };
  const fresh = p.followersUpdatedAt !== null && opts.now.getTime() - p.followersUpdatedAt.getTime() <= FRESH_DAYS[p.platform] * 86_400_000;
  const performance =
    p.performanceViewsSample === null && p.performanceEngagementSample === null
      ? null
      : {
          medianViews: p.medianViews,
          medianEngagementRate: p.medianEngagementRate,
          viewsSample: p.performanceViewsSample ?? 0,
          engagementSample: p.performanceEngagementSample ?? 0,
          format: (p.performanceFormat === "video" ? "video" : "reel") as "reel" | "video",
          sampleFrom: null,
          sampleTo: null,
        };
  const v = evaluateV3({
    platform: p.platform,
    followers: p.followers,
    following: p.following,
    followersFresh: fresh,
    countryStatus: (p.countryStatus ?? null) as "pakistan" | "foreign" | "unknown" | "conflicting" | null,
    available: true,
    performance,
  });
  return {
    badge: v.status === "eligible" ? "meets_standard" : v.status === "below_minimum" ? "below_benchmark" : "incomplete",
    signals: v.warnings.map((w) => QUALITY_SIGNAL_TEXT[w]).filter((x): x is string => Boolean(x)),
  };
}
