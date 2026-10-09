import { describe, expect, it } from "vitest";
import { formatCount, fromChips, matchToCreator, toCreator, toFilters, uiTrust, type UiFilters } from "./search-mapping";

const ui: UiFilters = { platform: "instagram", city: "Lahore", niche: "Bridal", followerBand: "10K–100K", minEng: "5%+", minScore: "70+", verifiedOnly: true, contactOnly: true, freshOnly: false, extra: { creatorCountry: "PK" } };

describe("search mapping", () => {
  it("turns the screen's filter state into API filters", () => {
    expect(toFilters(ui)).toEqual({
      platform: "instagram",
      creatorCity: "Lahore",
      creatorCountry: "PK",
      niches: ["Bridal"],
      followersMin: 10_000,
      followersMax: 99_999,
      engagementMin: 5,
      minAuthenticity: 70,
      verifiedOnly: true,
      hasContact: true,
      freshOnly: false,
    });
    expect(toFilters({ ...ui, platform: "all", city: null, niche: null, followerBand: "1M+", minEng: null, minScore: null, extra: {} })).toEqual({
      followersMin: 1_000_000,
      niches: [],
      verifiedOnly: true,
      hasContact: true,
      freshOnly: false,
    });
  });

  it("turns AI chips into the screen's filters, keeping what the screen has no control for", () => {
    expect(
      fromChips({ platform: "tiktok", creatorCity: "Karachi", creatorCountry: "PK", niches: ["Food", "Travel"], followersMin: 150_000, engagementMin: 6, verifiedOnly: false, hasContact: false, freshOnly: false }),
    ).toEqual({ platform: "tiktok", city: "Karachi", niche: "Food", followerBand: "100K–1M", minEng: "5%+", verifiedOnly: false, extra: { creatorCountry: "PK", niches: ["Food", "Travel"] } });
  });

  it("maps a search card to the screen's creator shape", () => {
    const c = toCreator({
      id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10",
      displayName: "Sana Riaz",
      handle: "sanaa.k",
      platform: "instagram",
      avatarUrl: null,
      city: "Karachi",
      country: "PK",
      niches: ["Lifestyle", "Bridal"],
      tags: ["#bridal"],
      verified: true,
      followers: 412_000,
      engagementRate: 5.2,
      authenticityScore: null,
      fakeFollowerPct: null,
      hasContact: true,
      followersFreshness: "current",
      fitScore: 84,
      fitLabel: "Best match",
    });
    expect(c).toMatchObject({ id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10", name: "Sana Riaz", followers: "412K", niche: "Lifestyle · Bridal", authenticity: null, score: 84, fitLabel: "Best match", hasContact: true });
    expect(c.avatar.startsWith("data:image/svg+xml,")).toBe(true);
    expect(matchToCreator({ id: c.id, displayName: "Sana Riaz", handle: "sanaa.k", platform: "instagram", avatarUrl: null })).toMatchObject({ id: c.id, score: 0 });
  });

  it("formats counts and contact trust", () => {
    expect([formatCount(950), formatCount(18_400), formatCount(412_000), formatCount(1_200_000), formatCount(24_000_000)]).toEqual(["950", "18.4K", "412K", "1.2M", "24M"]);
    expect([uiTrust("verified"), uiTrust("likely"), uiTrust("unverified")]).toEqual(["verified", "contactable", "unverified"]);
  });
});
