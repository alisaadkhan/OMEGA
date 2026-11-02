import type { StandardProfile } from "./enrichment/standardize";
import type { CreatorPlatform } from "./rules";

/**
 * Candidate eligibility policy elig-3 (owner decision 2026-11-02). Evaluated and reported alongside the active rule
 * (elig-2, eligibility.ts); it decides nothing that customers see until the owner approves applying it.
 *
 *   Instagram  5,000 followers   median Reel views 2,000    median engagement rate 2.5% (likes + comments / followers)
 *   TikTok     10,000 followers  median video views 15,000  (median views below 1.5x followers is a warning only)
 *   YouTube    10,000 subscribers median views 5,000        computed only when YouTube-derived metrics are permitted
 *
 * Three statuses: eligible; below_minimum (stored evidence shows a requirement is not met, including a foreign country);
 * awaiting_assessment (evidence missing, stale, too thin or restricted). Medians use up to the latest 10 relevant
 * non-pinned items; fewer than 3 is too thin. Missing values are never read as 0. Warnings never decide the status.
 */
export const ELIGIBILITY_V3 = "elig-3";
export const PERFORMANCE_SAMPLE = 10;
export const MIN_SAMPLE = 3;

export type V3Rule = { minAudience: number; minMedianViews: number; minMedianEngagement: number | null };
export const ELIG3_RULES: Record<CreatorPlatform, V3Rule> = {
  instagram: { minAudience: 5_000, minMedianViews: 2_000, minMedianEngagement: 2.5 },
  tiktok: { minAudience: 10_000, minMedianViews: 15_000, minMedianEngagement: null },
  youtube: { minAudience: 10_000, minMedianViews: 5_000, minMedianEngagement: null },
};

export type ContentPerformance = {
  medianViews: number | null;
  medianEngagementRate: number | null;
  viewsSample: number;
  engagementSample: number;
  format: "reel" | "video";
  sampleFrom: Date | null;
  sampleTo: Date | null;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * Typical content performance from one fetch. Instagram: views from Reels/videos, engagement from the latest posts of
 * any format. TikTok: views from videos. YouTube: null unless `youtubeDerived` (the YouTube derived-metrics decision).
 */
export function contentPerformance(p: StandardProfile, o: { youtubeDerived?: boolean } = {}): ContentPerformance | null {
  if (p.platform === "youtube" && !o.youtubeDerived) return null;
  const recent = [...p.recentPosts].filter((x) => !x.isPinned).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  const withViews = recent.filter((x) => x.isVideo && x.views !== null).slice(0, PERFORMANCE_SAMPLE);
  const forEngagement = p.followers && p.followers > 0 ? recent.filter((x) => x.likes !== null && x.comments !== null).slice(0, PERFORMANCE_SAMPLE) : [];
  const used = [...withViews, ...forEngagement];
  if (used.length === 0) return null;
  const times = used.map((x) => x.postedAt.getTime());
  return {
    medianViews: median(withViews.map((x) => x.views as number)),
    medianEngagementRate: p.platform === "instagram" && forEngagement.length > 0 ? Math.round((median(forEngagement.map((x) => (((x.likes as number) + (x.comments as number)) / (p.followers as number)) * 100)) as number) * 100) / 100 : null,
    viewsSample: withViews.length,
    engagementSample: p.platform === "instagram" ? forEngagement.length : 0,
    format: p.platform === "instagram" ? "reel" : "video",
    sampleFrom: new Date(Math.min(...times)),
    sampleTo: new Date(Math.max(...times)),
  };
}

export type V3Input = {
  platform: CreatorPlatform;
  followers: number | null;
  following: number | null;
  /** Follower count is fresh (elig-2 freshness: 90 days, YouTube 30). */
  followersFresh: boolean;
  countryStatus: "pakistan" | "foreign" | "unknown" | "conflicting" | null;
  available: boolean;
  performance: ContentPerformance | null;
  youtubeDerivedPermitted?: boolean;
};
export type V3Status = "eligible" | "below_minimum" | "awaiting_assessment";
export type V3Result = { version: typeof ELIGIBILITY_V3; status: V3Status; reasons: string[]; warnings: string[] };

export function evaluateV3(i: V3Input, rules: Record<CreatorPlatform, V3Rule> = ELIG3_RULES): V3Result {
  const r = rules[i.platform];
  const below: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!i.available) missing.push("profile_unavailable");
  if (i.followers === null) missing.push("followers_unknown");
  else if (!i.followersFresh) missing.push("followers_stale");
  else if (i.followers < r.minAudience) below.push("below_audience_minimum");
  if (i.countryStatus === "foreign") below.push("country_not_pakistan");
  else if (i.countryStatus !== "pakistan") missing.push(i.countryStatus === "conflicting" ? "country_conflicting" : "country_unknown");
  if (i.platform === "youtube" && !i.youtubeDerivedPermitted) missing.push("youtube_metrics_restricted");
  else if (!i.performance || i.performance.viewsSample < MIN_SAMPLE || i.performance.medianViews === null) missing.push("views_sample_too_small");
  else if (i.performance.medianViews < r.minMedianViews) below.push("below_median_views");
  if (r.minMedianEngagement !== null && !(i.platform === "youtube" && !i.youtubeDerivedPermitted)) {
    const e = i.performance;
    if (!e || e.engagementSample < MIN_SAMPLE || e.medianEngagementRate === null) missing.push("engagement_sample_too_small");
    else if (e.medianEngagementRate < r.minMedianEngagement) below.push("below_median_engagement");
  }
  // Warnings: heuristics for a person to read, never a status (owner: validate before using them as gates).
  if (i.followers && i.following !== null && i.following > i.followers * 0.1) warnings.push("following_over_10pct_of_followers");
  if (i.platform === "tiktok" && i.followers && i.performance?.medianViews != null && i.performance.medianViews < i.followers * 1.5) warnings.push("tiktok_views_below_1_5x_followers");
  const status: V3Status = below.length > 0 ? "below_minimum" : missing.length > 0 ? "awaiting_assessment" : "eligible";
  return { version: ELIGIBILITY_V3, status, reasons: [...below, ...missing], warnings };
}
