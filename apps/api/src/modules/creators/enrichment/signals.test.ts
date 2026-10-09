import { describe, expect, it } from "vitest";
import type { EngagementBenchmarks } from "@mushin/db";
import { measureSignals, profileMetrics, tierOf, type SignalSettings } from "./signals";
import type { StandardPost, StandardProfile } from "./standardize";

const now = new Date("2026-10-09T12:00:00Z");
const day = 86_400_000;
const benchmarks: EngagementBenchmarks = {
  instagram: { per: "followers", viewsLow: 0.2, tiers: [[0, 3, 8], [10_000, 1.5, 5], [100_000, 1, 3.5], [1_000_000, 0.7, 2.5]] },
  tiktok: { per: "views", viewsLow: 0.1, tiers: [[0, 4, 12], [10_000, 4, 12], [100_000, 3, 10], [1_000_000, 3, 9]] },
  youtube: { per: "views", viewsLow: 0.03, tiers: [[0, 2, 6], [10_000, 2, 6], [100_000, 1.5, 5], [1_000_000, 1, 4]] },
};
const S: SignalSettings = { benchmarks, minPostsForScore: 3, growthMinDays: 14, scoreBand: 5 };

const post = (daysAgo: number, likes: number, comments: number, views: number | null = null, isPinned = false): StandardPost => ({
  postedAt: new Date(now.getTime() - daysAgo * day),
  likes,
  comments,
  views,
  isVideo: views !== null,
  isPinned,
  caption: "",
  hashtags: [],
});

const profile = (over: Partial<StandardProfile> = {}): StandardProfile => ({
  platform: "instagram",
  handle: "sana",
  displayName: "Sana",
  bio: "",
  followers: 50_000,
  following: 800,
  posts: 400,
  verified: false,
  websiteUrls: [],
  businessEmail: null,
  businessPhone: null,
  country: null,
  avatarUrl: null,
  // ~3% engagement, steady, posting twice a week, healthy likes/comments.
  recentPosts: Array.from({ length: 12 }, (_, i) => post(i * 3.5, 1400 + (i % 3) * 50, 40 + (i % 4) * 5, 18_000)),
  ...over,
});

const byKey = (r: ReturnType<typeof measureSignals>) => Object.fromEntries(r.signals.map((s) => [s.key, s]));

describe("signals", () => {
  it("scores a healthy mid-size creator high, inside a ±5 range, with a fact per signal", () => {
    const r = measureSignals(profile(), null, S, now);
    if (r.kind !== "scored") throw new Error("expected a score");
    expect(r.base).toBeGreaterThanOrEqual(85);
    expect(r.range).toEqual({ min: Math.max(0, r.base - 5), max: Math.min(100, r.base + 5) });
    expect(r.tier).toBe("10K–100K");
    expect(r.signals.map((s) => s.key).sort()).toEqual(["engagement_consistency", "engagement_vs_tier", "follow_ratio", "likes_to_comments", "posting_regularity", "views_to_followers"]);
    expect(r.signals.every((s) => s.fact.length > 10 && s.status === "ok")).toBe(true);
    expect(byKey(r)["engagement_vs_tier"]?.fact).toMatch(/2\.9%|3\.0%|3\.1%/);
  });

  it("flags bought followers: very low engagement for the size and follow-for-follow", () => {
    const r = measureSignals(profile({ followers: 400_000, following: 380_000, recentPosts: Array.from({ length: 12 }, (_, i) => post(i * 3, 600, 12)) }), null, S, now);
    if (r.kind !== "scored") throw new Error("expected a score");
    expect(byKey(r)["engagement_vs_tier"]?.status).toBe("risk");
    expect(byKey(r)["follow_ratio"]?.status).toBe("risk");
    expect(r.base).toBeLessThan(55);
  });

  it("flags bought likes: thousands of likes with almost no comments", () => {
    const r = measureSignals(profile({ recentPosts: Array.from({ length: 12 }, (_, i) => post(i * 3, 1500, 2)) }), null, S, now);
    expect(byKey(r)["likes_to_comments"]?.status).toBe("risk");
  });

  it("separates a viral post from a bought one using views", () => {
    const steady = Array.from({ length: 11 }, (_, i) => post(i * 3 + 3, 1000, 30, 15_000));
    const viral = measureSignals(profile({ recentPosts: [post(1, 12_000, 300, 200_000), ...steady] }), null, S, now);
    expect(byKey(viral)["engagement_consistency"]?.status).toBe("ok");
    const bought = measureSignals(profile({ recentPosts: [post(1, 12_000, 300, 15_000), post(2, 11_000, 280, 14_000), ...steady.slice(2)] }), null, S, now);
    expect(byKey(bought)["engagement_consistency"]?.status).toBe("risk");
  });

  it("measures TikTok and YouTube engagement per view and skips follow ratio on YouTube", () => {
    const tt = measureSignals(profile({ platform: "tiktok", followers: 1_000_000, following: 0, recentPosts: Array.from({ length: 6 }, (_, i) => post(i * 2, 4000, 60, 80_000)) }), null, S, now);
    expect(byKey(tt)["engagement_vs_tier"]?.value).toBeCloseTo(5.075, 2);
    const yt = measureSignals(profile({ platform: "youtube", following: null, followers: 200_000, recentPosts: Array.from({ length: 12 }, (_, i) => post(i * 7, 900, 80, 30_000)) }), null, S, now);
    expect(byKey(yt)["follow_ratio"]).toBeUndefined();
    expect(yt.kind).toBe("scored");
  });

  it("adds the growth signal only with a snapshot old enough, and flags growth without engagement", () => {
    const fresh = measureSignals(profile(), { followers: 30_000, avgLikes: 1450, capturedAt: new Date(now.getTime() - 3 * day) }, S, now);
    expect(byKey(fresh)["follower_growth"]).toBeUndefined();
    const spike = measureSignals(profile(), { followers: 25_000, avgLikes: 1450, capturedAt: new Date(now.getTime() - 21 * day) }, S, now);
    expect(byKey(spike)["follower_growth"]?.status).toBe("risk");
    expect(byKey(spike)["follower_growth"]?.fact).toMatch(/25,000 followers/);
  });

  it("refuses to score fewer than the minimum number of recent posts, and dormant accounts lose regularity", () => {
    const few = measureSignals(profile({ recentPosts: [post(1, 100, 5), post(5, 100, 5)] }), null, S, now);
    expect(few).toMatchObject({ kind: "insufficient", reason: expect.stringMatching(/2 recent posts/) });
    const dormant = measureSignals(profile({ recentPosts: Array.from({ length: 12 }, (_, i) => post(120 + i * 3, 1400, 40)) }), null, S, now);
    expect(byKey(dormant)["posting_regularity"]?.status).toBe("risk");
  });

  it("derives profile metrics and tiers", () => {
    expect(profileMetrics(profile())).toMatchObject({ avgViews: 18_000 });
    expect(profileMetrics(profile()).engagementRate).toBeCloseTo(2.97, 1);
    expect(profileMetrics(profile({ recentPosts: [] }))).toEqual({ engagementRate: null, avgLikes: null, avgComments: null, avgViews: null });
    expect([tierOf(5_000), tierOf(10_000), tierOf(250_000), tierOf(3_000_000)]).toEqual(["under 10K", "10K–100K", "100K–1M", "1M+"]);
  });
});
