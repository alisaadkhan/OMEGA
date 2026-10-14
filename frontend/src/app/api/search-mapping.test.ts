import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import {
  extraChips,
  formatCount,
  applySuggestion,
  fromChips,
  matchToCreator,
  pageCount,
  requestFor,
  sameRequest,
  searchErrorMessage,
  shouldRetrySearch,
  toCreator,
  toFilters,
  uiTrust,
  withoutExtra,
  type UiFilters,
} from "./search-mapping";

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

  it("turns AI chips into the screen's filters, keeping exact values the screen's presets cannot express", () => {
    expect(
      fromChips({ platform: "tiktok", creatorCity: "Karachi", creatorCountry: "PK", niches: ["Food", "Travel"], followersMin: 150_000, engagementMin: 6, verifiedOnly: false, hasContact: false, freshOnly: false }),
    ).toEqual({
      platform: "tiktok",
      city: "Karachi",
      niche: null,
      followerBand: null,
      minEng: null,
      verifiedOnly: false,
      extra: { creatorCountry: "PK", niches: ["Food", "Travel"], followersMin: 150_000, engagementMin: 6 },
    });
    // Ranges that match a preset still use it.
    expect(fromChips({ niches: ["Bridal"], followersMin: 100_000, followersMax: 999_999, engagementMin: 5, verifiedOnly: true, hasContact: false, freshOnly: false })).toMatchObject({
      niche: "Bridal",
      followerBand: "100K–1M",
      minEng: "5%+",
      extra: {},
    });
  });

  it("applying the AI's reading keeps the user's choices for anything it did not read", () => {
    // Regression: a reading with no platform used to reset an explicit YouTube search to "all" (and TikTok pricing).
    const current = { platform: "youtube" as const, city: "Lahore", niche: null, followerBand: null, minEng: null, verifiedOnly: false, extra: {} };
    const reading = fromChips({ niches: ["Food"], verifiedOnly: false, hasContact: false, freshOnly: false });
    expect(applySuggestion(current, reading)).toEqual({ ...current, niche: "Food" });
    // What the reading does name still replaces the user's value.
    expect(applySuggestion(current, fromChips({ platform: "instagram", creatorCity: "Karachi", niches: [], verifiedOnly: false, hasContact: false, freshOnly: false }))).toMatchObject({
      platform: "instagram",
      city: "Karachi",
    });
  });

  it("never snaps an AI range onto a different one ('1k–10k', '500K–2M')", () => {
    const small = fromChips({ niches: [], followersMin: 1_000, followersMax: 10_000, verifiedOnly: false, hasContact: false, freshOnly: false });
    expect(small).toMatchObject({ followerBand: null, extra: { followersMin: 1_000, followersMax: 10_000 } });
    const wide = fromChips({ niches: [], followersMin: 500_000, followersMax: 2_000_000, verifiedOnly: false, hasContact: false, freshOnly: false });
    expect(toFilters({ ...ui, ...wide, minScore: null, contactOnly: false, freshOnly: false })).toMatchObject({ followersMin: 500_000, followersMax: 2_000_000 });
  });

  it("lets a preset the user picks replace a conflicting AI value instead of sending an impossible range", () => {
    const f = toFilters({ ...ui, followerBand: "1M+", minEng: "8%+", niche: "Food", extra: { followersMax: 50_000, followersMin: 1_000, engagementMin: 3, niches: ["Bridal", "Beauty"] } });
    expect(f).toMatchObject({ followersMin: 1_000_000, engagementMin: 8, niches: ["Food"] });
    expect(f.followersMax).toBeUndefined();
  });

  it("labels every filter the screen has no control for, so nothing is applied silently", () => {
    expect(extraChips({ creatorCountry: "PK", audienceCountry: "AE", followersMin: 1_000, followersMax: 10_000, engagementMin: 3, engagementMax: 9, niches: ["Food", "Travel"] }).map((c) => c.label)).toEqual([
      "PK",
      "Audience AE",
      "Followers 1K–10K",
      "ER 3–9%",
      "Food + Travel",
    ]);
    expect(extraChips({ followersMax: 50_000 }).map((c) => c.label)).toEqual(["Followers up to 50K"]);
    expect(extraChips({ engagementMin: 3 }).map((c) => c.label)).toEqual(["ER 3%+"]);
    expect(withoutExtra({ followersMin: 1, followersMax: 2, creatorCountry: "PK" }, "followers")).toEqual({ creatorCountry: "PK" });
  });

  it("builds one request from the screen state, and tells when a search must be re-fetched rather than re-keyed", () => {
    const r = requestFor("bridal", ui, 2, 50);
    expect(r).toEqual({ text: "bridal", filters: toFilters(ui), page: 2, confirmedCost: 50 });
    expect(sameRequest(r, requestFor("bridal", { ...ui }, 2, 50))).toBe(true);
    expect(sameRequest(r, requestFor("bridal", { ...ui, platform: "tiktok" }, 2, 50))).toBe(false);
    expect(sameRequest(null, r)).toBe(false);
  });

  it("counts pages and only retries server-side failures", () => {
    expect([pageCount(0, 24), pageCount(24, 24), pageCount(25, 24), pageCount(200, 24)]).toEqual([1, 1, 2, 9]);
    expect(shouldRetrySearch(0, new ApiError("VALIDATION_FAILED", "bad", 400, null))).toBe(false);
    expect(shouldRetrySearch(0, new ApiError("PROVIDER_UNAVAILABLE", "down", 503, null))).toBe(true);
    expect(shouldRetrySearch(2, new ApiError("PROVIDER_UNAVAILABLE", "down", 503, null))).toBe(false);
    expect(searchErrorMessage(new ApiError("PROVIDER_UNAVAILABLE", "Search is temporarily unavailable.", 503, null))).toBe("Search is temporarily unavailable.");
    expect(searchErrorMessage(new Error("boom"))).toBe("Something went wrong while searching. Please try again.");
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
