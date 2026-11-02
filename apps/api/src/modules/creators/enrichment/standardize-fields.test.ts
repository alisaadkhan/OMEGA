import { describe, expect, it } from "vitest";
import { isoDurationSeconds, standardize } from "./standardize";

describe("standardize: fields for discovery and eligibility (owner addendum 2026-11-03)", () => {
  it("STD-01 Instagram keeps geotags, Reel type, mentions/co-authors and related profiles", () => {
    const raw = [{ username: "a", followersCount: 20000, relatedProfiles: [{ username: "B.One" }, { username: "bad handle!" }], latestPosts: [
      { timestamp: "2026-10-30T10:00:00Z", likesCount: 100, commentsCount: 5, type: "Video", productType: "clips", locationName: "Lahore, Pakistan", mentions: ["@Friend1"], coauthorProducers: [{ username: "collab_x" }] },
      { timestamp: "2026-10-29T10:00:00Z", likesCount: 90, commentsCount: 2, type: "Image" },
    ] }];
    const r = standardize("instagram", "a", raw, { maxPosts: 10 });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.profile.related).toEqual(["b.one"]);
    expect(r.profile.recentPosts[0]).toMatchObject({ location: "Lahore, Pakistan", format: "reel", mentions: ["friend1", "collab_x"] });
    expect(r.profile.recentPosts[1]).toMatchObject({ location: null, format: "post" });
  });
  it("STD-02 YouTube duration separates Shorts (60 s or less) from long-form", () => {
    expect(isoDurationSeconds("PT59S")).toBe(59);
    expect(isoDurationSeconds("PT1H2M3S")).toBe(3723);
    expect(isoDurationSeconds("bad")).toBeNull();
  });
});
