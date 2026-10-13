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

  it("matches reviewed Roman Urdu niche terms and reports Roman Urdu caption evidence", () => {
    const romanSearch = liveSearchSchema.parse({ text: "Roman Urdu bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Aaj dulhan ka makeup look tayyar kiya", hashtags: ["shaadi", "dulhan"] }));
    const result = evaluateCampaignFit(romanSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(true);
    expect(result.topicScore).toBe(1);
    expect(result.evidence).toContain("100% of sampled captions contain roman urdu script/language signal (12 captions)");
  });

  it("matches Urdu-script topic evidence and records Urdu separately from English", () => {
    const urduSearch = liveSearchSchema.parse({ text: "Urdu bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "آج دلہن کا خوبصورت لباس تیار کیا", hashtags: ["شادی", "دلہن"] }));
    const result = evaluateCampaignFit(urduSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(true);
    expect(result.topicScore).toBe(1);
    expect(result.evidence).toContain("100% of sampled captions contain urdu script/language signal (12 captions)");
  });

  it("recognizes English captions without treating the word 'main' as Roman Urdu", () => {
    const englishSearch = liveSearchSchema.parse({ text: "English bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Bridal makeup looks on Main Street", hashtags: ["bridal"] }));
    const result = evaluateCampaignFit(englishSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.evidence).toContain("100% of sampled captions contain english script/language signal (12 captions)");

    const romanSearch = liveSearchSchema.parse({ text: "Roman Urdu bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const romanResult = evaluateCampaignFit(romanSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(romanResult.evidence).toContain("0% of sampled captions contain roman urdu script/language signal (12 captions)");
  });

  it("accepts a first-person Roman Urdu creator cue as lexical individual evidence", () => {
    const romanCandidate = { ...candidate, title: "Sana Bridal", snippet: "Lahore" };
    const result = evaluateCampaignFit(search, romanCandidate, profile({ displayName: "Sana", bio: "Main Lahore ki makeup videos banati hun" }), false, now);
    expect(result.eligible).toBe(true);
    expect(result.evidence).toContain("Individual-creator lexical signal from public title/bio (Roman Urdu first-person creator cue)");
  });

  it("does not treat an unknown follower count as zero or satisfy an explicit size filter", () => {
    const sizedSearch = liveSearchSchema.parse({ text: "Bridal creators in Lahore", filters: { niches: ["bridal"], followersMin: 10_000 } });
    const result = evaluateCampaignFit(sizedSearch, candidate, profile({ followers: null }), false, now);
    expect(result.eligible).toBe(false);
    expect(result.gate).toBe("follower_count_unavailable");
    expect(result.evidence).toContain("Follower count unknown from the source profile");
  });

  it("fails closed when individual-creator evidence is absent or business cues dominate", () => {
    expect(evaluateCampaignFit(search, { ...candidate, title: "Sana", snippet: "Lahore" }, profile({ displayName: "Sana", bio: "Lahore" }), false, now).gate).toBe("individual_creator_unverified");
    expect(evaluateCampaignFit(search, candidate, profile(), true, now).gate).toBe("minor_or_unclear");
    expect(evaluateCampaignFit(search, { ...candidate, title: "Official bridal shop" }, profile({ displayName: "Hina Bridal Boutique", bio: "Order delivery wholesale bridal dresses" }), false, now).gate).toBe("business_or_non_creator");
    expect(evaluateCampaignFit(search, { ...candidate, title: "Bridal shop and makeup artist" }, profile({ displayName: "Sana", bio: "Bridal makeup artist" }), false, now).gate).toBe("individual_creator_unverified");
  });

  it("requires enough of a multiword custom topic to appear in the sampled posts", () => {
    const custom = liveSearchSchema.parse({ text: "Vintage watch creator in Lahore", filters: { niches: ["vintage watches"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Collecting watches from around the world", hashtags: ["watches"] }));
    const result = evaluateCampaignFit(custom, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(false);
    expect(result.gate).toBe("off_topic");
  });

  it("gates profiles without recent public posts", () => {
    const recentPost = profile().recentPosts[0];
    if (!recentPost) throw new Error("test profile must include a post");
    const old = profile({ recentPosts: [{ ...recentPost, postedAt: new Date(now.getTime() - 91 * 86_400_000) }] });
    expect(evaluateCampaignFit(search, candidate, old, false, now).gate).toBe("inactive_or_unverified");
  });
});
