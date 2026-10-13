import { describe, expect, it } from "vitest";
import { liveSearchSchema } from "@mushin/contracts";
import type { StandardProfile } from "../creators/index";
import type { Kept } from "./live/relevance";
import { evaluateCampaignFit } from "./fit";

const now = new Date("2026-10-13T12:00:00.000Z");
const search = liveSearchSchema.parse({ text: "Bridal creators in Lahore Urdu", filters: { niches: ["bridal"], creatorCity: "Lahore" } });
const candidate: Kept = { platform: "instagram", handle: "sana", canonicalUrl: "https://www.instagram.com/sana", title: "Sana bridal makeup creator", snippet: "Lahore makeup artist", reason: "Bridal makeup posts" };
const profile = (over: Partial<StandardProfile> = {}): StandardProfile => ({
  platform: "instagram", handle: "sana", displayName: "Sana Bridal Creator", bio: "Lahore makeup artist", followers: 50_000, following: 800, posts: 500, verified: false,
  websiteUrls: [], businessEmail: null, businessPhone: null, country: null, avatarUrl: null,
  recentPosts: Array.from({ length: 12 }, (_, i) => ({
    postedAt: new Date(now.getTime() - i * 5 * 86_400_000), likes: 100, comments: 5, views: null, isVideo: false, isPinned: false,
    caption: "Bridal makeup look", hashtags: ["bridal"],
  })),
  ...over,
});

describe("Live Discovery Campaign Fit", () => {
  it("scores a qualifying individual from sampled topic, location, and activity evidence", () => {
    const result = evaluateCampaignFit(search, candidate, profile(), false, now);
    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.topicScore).toBe(1);
    expect(result.sampleSize).toBe(12);
    expect(result.sourceUrl).toBe(candidate.canonicalUrl);
    expect(result.fetchedAt).toBe(now.toISOString());
    expect(result.evidence.some((line) => line.includes("sampled public posts"))).toBe(true);
  });

  it("blocks off-topic profiles even when their location and individual cues match", () => {
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Daily gadget technology review", hashtags: ["technology"] }));
    const result = evaluateCampaignFit(search, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(false);
    expect(result.gate).toBe("off_topic");
    expect(result.score).toBe(0);
  });

  it("fails closed when individual-creator evidence is absent or business cues dominate", () => {
    expect(evaluateCampaignFit(search, { ...candidate, title: "Sana", snippet: "Lahore" }, profile({ displayName: "Sana", bio: "Lahore" }), false, now).gate).toBe("individual_creator_unverified");
    expect(evaluateCampaignFit(search, candidate, profile(), true, now).gate).toBe("minor_or_unclear");
    expect(evaluateCampaignFit(search, { ...candidate, title: "Official bridal shop" }, profile(), false, now).gate).toBe("business_or_non_creator");
  });

  it("gates profiles without recent public posts", () => {
    const recentPost = profile().recentPosts[0];
    if (!recentPost) throw new Error("test profile must include a post");
    const old = profile({ recentPosts: [{ ...recentPost, postedAt: new Date(now.getTime() - 91 * 86_400_000) }] });
    expect(evaluateCampaignFit(search, candidate, old, false, now).gate).toBe("inactive_or_unverified");
  });
});
