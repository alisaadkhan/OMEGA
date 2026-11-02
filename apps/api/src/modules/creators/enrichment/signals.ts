import type { EngagementBenchmarks } from "@mushin/db";
import type { StandardPost, StandardProfile } from "./standardize";

export type SignalKey =
  | "engagement_vs_tier"
  | "likes_to_comments"
  | "views_to_followers"
  | "follow_ratio"
  | "posting_regularity"
  | "engagement_consistency"
  | "follower_growth";
export type Signal = { key: SignalKey; value: number; status: "ok" | "watch" | "risk"; subScore: number; weight: number; fact: string };
export type PreviousMetrics = { followers: number | null; avgLikes: number | null; capturedAt: Date };
export type SignalSettings = { benchmarks: EngagementBenchmarks; minPostsForScore: number; growthMinDays: number; scoreBand: number };
export type SignalReport =
  | { kind: "scored"; signals: Signal[]; base: number; range: { min: number; max: number }; tier: string; confidence: number }
  | { kind: "insufficient"; reason: string; signals: Signal[]; tier: string };

const WEIGHTS: Record<SignalKey, number> = {
  engagement_vs_tier: 30,
  likes_to_comments: 15,
  views_to_followers: 15,
  follow_ratio: 10,
  posting_regularity: 10,
  engagement_consistency: 10,
  follower_growth: 10,
};
const DAY = 86_400_000;
const num = new Intl.NumberFormat("en-US");
const pct = (n: number) => `${n.toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const status = (score: number): Signal["status"] => (score >= 70 ? "ok" : score >= 45 ? "watch" : "risk");

export function tierOf(followers: number | null): string {
  if (followers === null) return "unknown";
  if (followers >= 1_000_000) return "1M+";
  if (followers >= 100_000) return "100K–1M";
  if (followers >= 10_000) return "10K–100K";
  return "under 10K";
}

/** Posts that carry engagement numbers (hidden likes are null and left out). */
const engaged = (posts: StandardPost[]) => posts.filter((p) => p.likes !== null);

/** Engagement (%): per follower on Instagram, per view on TikTok and YouTube (industry convention). Unrounded. */
function engagementRaw(p: StandardProfile): number | null {
  const posts = engaged(p.recentPosts);
  if (posts.length === 0) return null;
  if (p.platform === "instagram") {
    const followers = p.followers;
    return followers !== null && followers > 0 ? mean(posts.map((x) => ((x.likes ?? 0) + (x.comments ?? 0)) / followers)) * 100 : null;
  }
  const withViews = posts.filter((x) => (x.views ?? 0) > 0);
  return withViews.length ? mean(withViews.map((x) => ((x.likes ?? 0) + (x.comments ?? 0)) / (x.views ?? 1))) * 100 : null;
}

/** Latest posts used for the stored engagement rate (owner 2026-11-02: a typical post, never one viral post). */
export const ENGAGEMENT_SAMPLE = 10;
export const ENGAGEMENT_MIN_SAMPLE = 3;

/**
 * Stored engagement rate (%): the MEDIAN per-post rate over the latest ${ENGAGEMENT_SAMPLE} non-pinned posts that show
 * their likes (per follower on Instagram, per view on TikTok and YouTube). Never capped: a capped average hid viral
 * outliers as "100%". Fewer than ${ENGAGEMENT_MIN_SAMPLE} usable posts gives null (not enough evidence), never 0.
 */
export function storedEngagementRate(p: StandardProfile): number | null {
  const recent = engaged(p.recentPosts).filter((x) => !x.isPinned).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  const rates =
    p.platform === "instagram"
      ? p.followers && p.followers > 0
        ? recent.slice(0, ENGAGEMENT_SAMPLE).map((x) => ((x.likes ?? 0) + (x.comments ?? 0)) / (p.followers as number))
        : []
      : recent.filter((x) => (x.views ?? 0) > 0).slice(0, ENGAGEMENT_SAMPLE).map((x) => ((x.likes ?? 0) + (x.comments ?? 0)) / (x.views as number));
  if (rates.length < ENGAGEMENT_MIN_SAMPLE) return null;
  return Math.round(median(rates) * 100 * 100) / 100;
}

/** Stored profile metrics (rounded). */
export function profileMetrics(p: StandardProfile): { engagementRate: number | null; avgLikes: number | null; avgComments: number | null; avgViews: number | null } {
  const posts = engaged(p.recentPosts);
  if (posts.length === 0) return { engagementRate: null, avgLikes: null, avgComments: null, avgViews: null };
  const withViews = posts.filter((x) => (x.views ?? 0) > 0);
  return {
    engagementRate: storedEngagementRate(p),
    avgLikes: Math.round(mean(posts.map((x) => x.likes ?? 0))),
    avgComments: Math.round(mean(posts.map((x) => x.comments ?? 0))),
    avgViews: withViews.length ? Math.round(mean(withViews.map((x) => x.views ?? 0))) : null,
  };
}

function engagementVsTier(p: StandardProfile, s: SignalSettings): Signal | null {
  const followers = p.followers;
  if (followers === null) return null;
  const rate = engagementRaw(p);
  if (rate === null) return null;
  const b = s.benchmarks[p.platform];
  const tier = [...b.tiers].reverse().find(([min]) => followers >= min) ?? b.tiers[0] ?? [0, 1, 5];
  const [, lo, hi] = tier;
  let score: number;
  if (rate < lo) score = Math.max(0, Math.round((rate / lo) * 100) - 10);
  else if (rate <= hi * 3) score = 100;
  else score = 55; // far above typical for the size: possible engagement pods
  const per = b.per === "followers" ? "of followers" : "of views";
  const fact =
    rate < lo
      ? `Engagement ${pct(rate)} ${per} is below the ${lo}–${hi}% typical for ${tierOf(p.followers)} accounts`
      : rate <= hi * 3
        ? `Engagement ${pct(rate)} ${per} is within or above the ${lo}–${hi}% typical for ${tierOf(p.followers)} accounts`
        : `Engagement ${pct(rate)} ${per} is far above the ${lo}–${hi}% typical for ${tierOf(p.followers)} accounts`;
  return { key: "engagement_vs_tier", value: Math.round(rate * 1000) / 1000, status: status(score), subScore: score, weight: WEIGHTS.engagement_vs_tier, fact };
}

function likesToComments(posts: StandardPost[]): Signal | null {
  const withComments = posts.filter((x) => x.comments !== null);
  if (withComments.length === 0) return null;
  const likes = withComments.reduce((a, x) => a + (x.likes ?? 0), 0);
  const comments = withComments.reduce((a, x) => a + (x.comments ?? 0), 0);
  const ratio = likes / Math.max(1, comments);
  const score = ratio <= 150 ? 100 : ratio <= 400 ? Math.round(100 - ((ratio - 150) / 250) * 60) : 20;
  const fact = `About ${num.format(Math.round(ratio))} likes for every comment${ratio > 400 ? ", unusual for a genuine audience" : ""}`;
  return { key: "likes_to_comments", value: Math.round(ratio), status: status(score), subScore: score, weight: WEIGHTS.likes_to_comments, fact };
}

function viewsToFollowers(p: StandardProfile, s: SignalSettings): Signal | null {
  const views = p.recentPosts.map((x) => x.views).filter((v): v is number => v !== null && v > 0);
  if (views.length === 0 || p.followers === null || p.followers === 0) return null;
  const ratio = mean(views) / p.followers;
  const low = s.benchmarks[p.platform].viewsLow;
  const score = ratio >= low ? 100 : Math.max(0, Math.round((ratio / low) * 100));
  const fact = `Videos average ${pct(ratio * 100)} of the follower count in views${ratio < low ? ", low for this platform" : ""}`;
  return { key: "views_to_followers", value: Math.round(ratio * 10_000) / 10_000, status: status(score), subScore: score, weight: WEIGHTS.views_to_followers, fact };
}

function followRatio(p: StandardProfile): Signal | null {
  if (p.following === null || p.followers === null || p.followers === 0) return null;
  const ratio = p.following / p.followers;
  const score = ratio < 0.5 ? 100 : ratio < 0.9 ? 60 : p.followers >= 5_000 ? 25 : 55;
  const fact = `Follows ${num.format(p.following)} accounts against ${num.format(p.followers)} followers${score <= 60 ? "; some growth may be follow-for-follow" : ""}`;
  return { key: "follow_ratio", value: Math.round(ratio * 1000) / 1000, status: status(score), subScore: score, weight: WEIGHTS.follow_ratio, fact };
}

function postingRegularity(posts: StandardPost[], now: Date): Signal | null {
  if (posts.length < 2) return null;
  const newest = posts[0]?.postedAt.getTime() ?? now.getTime();
  const oldest = posts[posts.length - 1]?.postedAt.getTime() ?? newest;
  const weeks = Math.max(1 / 7, (newest - oldest) / (7 * DAY));
  const perWeek = (posts.length - 1) / weeks;
  const idleDays = (now.getTime() - newest) / DAY;
  const score = idleDays > 90 ? 25 : perWeek >= 1 ? 100 : perWeek >= 0.25 ? 70 : 45;
  const fact =
    idleDays > 90 ? `No new posts for ${Math.round(idleDays)} days` : `Posts about ${perWeek >= 1 ? Math.round(perWeek) : perWeek.toFixed(1)} times a week recently`;
  return { key: "posting_regularity", value: Math.round(perWeek * 100) / 100, status: status(score), subScore: score, weight: WEIGHTS.posting_regularity, fact };
}

/** Engagement far above the creator's own median without matching views looks bought; a viral post brings views too. */
function engagementConsistency(posts: StandardPost[]): Signal | null {
  const pool = engaged(posts).filter((x) => !x.isPinned);
  if (pool.length < 4) return null;
  const likes = median(pool.map((x) => x.likes ?? 0));
  const views = median(pool.map((x) => x.views ?? 0));
  const suspicious = pool.filter((x) => likes > 0 && (x.likes ?? 0) >= 5 * likes && !(views > 0 && (x.views ?? 0) >= 3 * views)).length;
  const score = suspicious === 0 ? 100 : suspicious === 1 ? 70 : 35;
  const fact =
    suspicious === 0
      ? "Engagement is consistent across recent posts"
      : `${suspicious} recent post${suspicious > 1 ? "s have" : " has"} 5× the usual likes without matching views`;
  return { key: "engagement_consistency", value: suspicious, status: status(score), subScore: score, weight: WEIGHTS.engagement_consistency, fact };
}

function followerGrowth(p: StandardProfile, prev: PreviousMetrics | null, s: SignalSettings, now: Date): Signal | null {
  if (!prev || prev.followers === null || prev.followers <= 0 || p.followers === null) return null;
  const days = (now.getTime() - prev.capturedAt.getTime()) / DAY;
  if (days < s.growthMinDays) return null;
  const growth = (p.followers - prev.followers) / prev.followers;
  const monthly = growth * (30 / days);
  const likesNow = profileMetrics(p).avgLikes ?? 0;
  const likesGrowth = prev.avgLikes && prev.avgLikes > 0 ? (likesNow - prev.avgLikes) / prev.avgLikes : 0;
  const unexplained = monthly - Math.max(0, likesGrowth);
  const score = unexplained > 0.3 ? 30 : unexplained > 0.15 ? 65 : 100;
  const fact = `${growth >= 0 ? "Grew" : "Shrank"} from ${num.format(prev.followers)} followers to ${num.format(p.followers)} in ${Math.round(days)} days${
    score < 100 ? " without a matching rise in engagement" : ""
  }`;
  return { key: "follower_growth", value: Math.round(monthly * 1000) / 1000, status: status(score), subScore: score, weight: WEIGHTS.follower_growth, fact };
}

/** Spec §5.3: code measures; the AI later explains and picks the score inside `range`. */
export function measureSignals(p: StandardProfile, previous: PreviousMetrics | null, s: SignalSettings, now: Date): SignalReport {
  const posts = p.recentPosts;
  const signals = [
    engagementVsTier(p, s),
    likesToComments(engaged(posts)),
    viewsToFollowers(p, s),
    followRatio(p),
    postingRegularity(posts, now),
    engagementConsistency(posts),
    followerGrowth(p, previous, s, now),
  ].filter((x): x is Signal => x !== null);
  const tier = tierOf(p.followers);
  if (engaged(posts).length < s.minPostsForScore) {
    return { kind: "insufficient", reason: `Only ${engaged(posts).length} recent posts with public engagement; at least ${s.minPostsForScore} are needed to assess`, signals, tier };
  }
  const totalWeight = signals.reduce((a, x) => a + x.weight, 0);
  const base = Math.round(signals.reduce((a, x) => a + x.subScore * x.weight, 0) / Math.max(1, totalWeight));
  return {
    kind: "scored",
    signals,
    base,
    range: { min: Math.max(0, base - s.scoreBand), max: Math.min(100, base + s.scoreBand) },
    tier,
    // Share of the full signal weight that could be measured (growth needs a second scrape).
    confidence: Math.round((totalWeight / 100) * 100) / 100,
  };
}
