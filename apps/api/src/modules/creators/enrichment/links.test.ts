import { describe, expect, it } from "vitest";
import { extractContacts, extractLinks } from "./links";
import type { StandardProfile, StandardPost } from "./standardize";

const post = (caption: string, description = ""): StandardPost => ({ postedAt: new Date("2026-11-01"), likes: 1, comments: 1, views: 1, isVideo: true, isPinned: false, caption, hashtags: [], description });
const profile = (o: Partial<StandardProfile>): StandardProfile => ({
  platform: "youtube", handle: "x", displayName: "X", bio: "", followers: 200_000, following: null, posts: 10, verified: false, websiteUrls: [], businessEmail: null, businessPhone: null, country: null, avatarUrl: null, recentPosts: [], ...o,
});

// Owner unified plan 2026-11-14, Phase 4.1: bio/About first, then the last 5 video descriptions / captions.
describe("contacts from video descriptions", () => {
  it("reads the bio first and never the descriptions when the bio already has a contact", () => {
    const p = profile({ bio: "Business: me@studio.pk", recentPosts: [post("v", "For business inquiries: other@studio.pk")] });
    expect(extractContacts(p)).toEqual([expect.objectContaining({ value: "me@studio.pk", source: "bio" })]);
  });

  it("falls back to a cued or recurring contact in the last 5 descriptions, recorded as from a video description", () => {
    const cued = profile({ recentPosts: [post("Phone review", "Watch till end.\nFor business inquiries: tech.ali@gmail.com")] });
    expect(extractContacts(cued)).toEqual([{ kind: "email", value: "tech.ali@gmail.com", trust: "unverified", source: "video_description" }]);
    const recurring = profile({ recentPosts: [post("a", "WhatsApp 0300 1234567"), post("b", "0300 1234567"), post("c")] });
    expect(extractContacts(recurring)).toEqual([expect.objectContaining({ kind: "phone", value: "+923001234567" })]);
  });

  it("ignores a sponsor's number that appears once without a cue, and anything beyond the last 5 posts", () => {
    const sponsor = profile({ recentPosts: [post("Unboxing", "Order now at 0321 7654321, free delivery")] });
    expect(extractContacts(sponsor)).toEqual([]);
    const old = profile({ recentPosts: [...Array.from({ length: 5 }, () => post("v")), post("old", "For business: old@studio.pk")] });
    expect(extractContacts(old)).toEqual([]);
  });

  it("keeps own social links that recur under 3+ of the last 5 videos", () => {
    const desc = "Follow me: https://instagram.com/techali";
    const p = profile({ recentPosts: [post("a", desc), post("b", desc), post("c", desc), post("d", "collab https://instagram.com/friend"), post("e")] });
    expect(extractLinks(p, "https://youtube.com/@techali")).toEqual([{ platform: "instagram", url: "https://instagram.com/techali", source: "video_description" }]);
  });
});

describe("location from video descriptions (Phase 4.2)", () => {
  it("needs an explicit residence statement, or Pakistani evidence in 2+ of the last 5; a stated life abroad cancels it", async () => {
    const { captionCountryEvidence } = await import("./country-evidence");
    expect(captionCountryEvidence(["Vlog", "I am based in Lahore, Pakistan", "Haul"])).toMatch(/based in Lahore/i);
    expect(captionCountryEvidence(["Visiting Lahore this week!", "Food tour", "Haul"])).toBeNull(); // a visit is not where they live
    expect(captionCountryEvidence(["Based in Lahore", "Now living in Dubai"])).toBeNull();
  });
});
