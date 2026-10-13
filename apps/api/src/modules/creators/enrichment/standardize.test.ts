import { describe, expect, it } from "vitest";
import { scraperFixture } from "@mushin/integrations";
import { cleanText, standardize, type StandardProfile } from "./standardize";

const ok = (r: ReturnType<typeof standardize>): StandardProfile => {
  if (r.kind !== "ok") throw new Error(`expected a profile, got ${r.kind}`);
  return r.profile;
};
const igRaw = () => structuredClone(scraperFixture("instagram-profile.json")) as Record<string, unknown>[];

describe("standardize", () => {
  it("reads an Instagram profile and its latest posts, newest first", () => {
    const p = ok(standardize("instagram", "coke_studio", scraperFixture("instagram-profile.json"), { maxPosts: 12 }));
    expect(p).toMatchObject({ platform: "instagram", handle: "coke_studio", displayName: "Coke Studio Pakistan", followers: 946416, following: 119, posts: 1381, verified: true });
    expect(p.websiteUrls).toContain("https://cokeurl.com/Nu.WAV");
    expect(p.recentPosts).toHaveLength(12);
    const times = p.recentPosts.map((x) => x.postedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(p.recentPosts.some((x) => x.isPinned)).toBe(true);
  });

  it("recognises missing and private Instagram accounts", () => {
    expect(standardize("instagram", "x", scraperFixture("instagram-notfound.json"), { maxPosts: 12 })).toEqual({ kind: "not_found" });
    expect(standardize("instagram", "x", scraperFixture("instagram-private.json"), { maxPosts: 12 })).toEqual({ kind: "private" });
    expect(standardize("instagram", "x", [], { maxPosts: 12 })).toEqual({ kind: "not_found" });
    expect(standardize("instagram", "x", "not even json", { maxPosts: 12 })).toEqual({ kind: "not_found" });
  });

  it("reads a TikTok profile from its video items, including an account with no videos", () => {
    const p = ok(standardize("tiktok", "cokestudiopakistan", scraperFixture("tiktok-videos.json"), { maxPosts: 6 }));
    expect(p).toMatchObject({ displayName: "Coke Studio Pakistan", followers: 1_000_000, posts: 449, verified: true, websiteUrls: ["https://cokeurl.com/Nu.WAV"] });
    expect(p.recentPosts).toHaveLength(6);
    expect(p.recentPosts[0]).toMatchObject({ isVideo: true, hashtags: ["cokestudionuwav"] });
    expect(p.recentPosts.every((x) => x.views !== null)).toBe(true);
    const empty = ok(standardize("tiktok", "cokestudio", scraperFixture("tiktok-novideos.json"), { maxPosts: 6 }));
    expect(empty).toMatchObject({ followers: 7, recentPosts: [] });
    expect(standardize("tiktok", "x", scraperFixture("tiktok-private.json"), { maxPosts: 6 })).toEqual({ kind: "private" });
    expect(standardize("tiktok", "x", [], { maxPosts: 6 })).toEqual({ kind: "not_found" });
  });

  it("reads a YouTube channel and its videos, and recognises an unknown handle", () => {
    const raw = { channel: scraperFixture("youtube-channel.json"), videos: scraperFixture("youtube-videos.json") };
    const p = ok(standardize("youtube", "cokestudio", raw, { maxPosts: 12 }));
    expect(p).toMatchObject({ displayName: "Coke Studio Pakistan", followers: 17_800_000, posts: 804, following: null, country: "PK" });
    expect(p.recentPosts).toHaveLength(12);
    expect(p.recentPosts[0]?.likes).not.toBeNull();
    expect(standardize("youtube", "x", { channel: scraperFixture("youtube-notfound.json"), videos: null }, { maxPosts: 12 })).toEqual({ kind: "not_found" });
  });

  it("keeps hidden or missing YouTube subscriber counts unknown", () => {
    const channel = scraperFixture("youtube-channel.json") as Record<string, unknown>;
    const hidden = structuredClone(channel) as Record<string, unknown>;
    const hiddenItems = hidden["items"] as Record<string, unknown>[];
    const hiddenStats = hiddenItems[0]?.["statistics"] as Record<string, unknown>;
    hiddenStats["hiddenSubscriberCount"] = true;
    hiddenStats["subscriberCount"] = "0";
    const profile = ok(standardize("youtube", "hidden-channel", { channel: { ...channel, items: hiddenItems }, videos: [] }, { maxPosts: 12 }));
    expect(profile.followers).toBeNull();

    const missingItems = structuredClone(channel["items"]) as Record<string, unknown>[];
    const missingStats = missingItems[0]?.["statistics"] as Record<string, unknown>;
    delete missingStats["subscriberCount"];
    expect(ok(standardize("youtube", "missing-count", { channel: { ...channel, items: missingItems }, videos: [] }, { maxPosts: 12 })).followers).toBeNull();
  });

  it("strips HTML, control characters and caps lengths; rejects impossible numbers (SRS §5.3)", () => {
    const raw = igRaw();
    const first = raw[0] as Record<string, unknown> & { latestPosts: Record<string, unknown>[] };
    first["biography"] = "<script>alert(1)</script>Bridal\u0000 looks <b>Lahore</b>";
    first["fullName"] = "x".repeat(5000);
    const post0 = first.latestPosts[0] as Record<string, unknown>;
    post0["timestamp"] = "2026-10-09T00:00:00.000Z"; // newest, so it is among the 3 kept
    post0["caption"] = "y".repeat(50_000);
    post0["likesCount"] = -1;
    post0["commentsCount"] = Number.POSITIVE_INFINITY;
    const p = ok(standardize("instagram", "coke_studio", raw, { maxPosts: 3 }));
    expect(p.bio).toBe("alert(1) Bridal looks Lahore");
    expect(p.displayName.length).toBe(200);
    expect(p.recentPosts).toHaveLength(3);
    const edited = p.recentPosts.find((x) => x.caption.startsWith("yyy"));
    expect(edited?.caption.length).toBe(500);
    expect(edited?.likes).toBeNull();
    expect(edited?.comments).toBeNull();
    const broken = igRaw();
    (broken[0] as Record<string, unknown>)["followersCount"] = "lots";
    expect(standardize("instagram", "coke_studio", broken, { maxPosts: 12 })).toEqual({ kind: "not_found" });
  });

  it("keeps long signed photo links but still caps website links (live check: Instagram photo links exceed 300 characters)", () => {
    const raw = igRaw();
    const signed = `https://scontent.cdninstagram.com/v/t51.2885-19/1234_n.jpg?stp=dst-jpg_s320x320&_nc_ht=scontent.cdninstagram.com&oh=${"a".repeat(300)}&oe=6720F1A2`;
    raw[0] = { ...raw[0], profilePicUrlHD: signed, externalUrl: `https://example.com/${"b".repeat(320)}` };
    const p = ok(standardize("instagram", "coke_studio", raw, { maxPosts: 12 }));
    expect(p.avatarUrl).toBe(signed);
    expect(p.websiteUrls.some((u) => u.includes("bbbb"))).toBe(false);
    raw[0] = { ...raw[0], profilePicUrlHD: `https://scontent.cdninstagram.com/${"c".repeat(2100)}` };
    expect(ok(standardize("instagram", "coke_studio", raw, { maxPosts: 12 })).avatarUrl).toBeNull();
  });

  it("cleans text consistently", () => {
    expect(cleanText("  a\t\tb\n\n\n\nc  ", 100)).toBe("a b\n\nc");
    expect(cleanText(42, 10)).toBe("");
    expect(cleanText("\u202Eevil\u2066", 10)).toBe("evil");
  });
});
