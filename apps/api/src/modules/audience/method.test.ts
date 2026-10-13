import { describe, expect, it } from "vitest";
import { audienceEstimateBodySchema } from "@mushin/contracts";
import type { YouTubeCommentSample } from "@mushin/integrations";
import { buildEstimate, countryDimension, METHOD, selectCommenters, wilson } from "./method";

const video = (id: string, comments: [string, string][], commentsOff = false) => ({ id, publishedAt: "2026-10-01T00:00:00Z", commentsOff, comments: comments.map(([authorId, text]) => ({ authorId, text })) });
const sample = (videos: ReturnType<typeof video>[]): YouTubeCommentSample => ({ channelId: "OWNER", videosConsidered: videos.length, videos, quotaUnits: 0 });
const many = (prefix: string, n: number, text = "nice video") => Array.from({ length: n }, (_, i) => [`${prefix}${i}`, `${text} ${i}`] as [string, string]);

describe("commenter selection", () => {
  it("counts each commenter once, skips the creator and caps each video's contribution", () => {
    const s = selectCommenters(
      sample([
        video("v1", [["a", "first"], ["a", "again"], ["OWNER", "thanks all"], ["b", "hello"]]),
        video("v2", [["a", "third time"], ["c", "great"]]),
      ]),
    );
    expect(s.commenterIds.sort()).toEqual(["a", "b", "c"]);
    expect(s).toMatchObject({ commentsRead: 6, uniqueCommenters: 3, excludedCreator: 1, excludedLikelySpam: 0, videosSampled: 2 });
    // One viral video cannot fill the sample: at most perVideoCap new commenters each.
    const capped = selectCommenters(sample([video("v1", many("x", 200)), video("v2", many("y", 10))]), { perVideoCap: 60, maxCommenters: 600 });
    expect(capped.uniqueCommenters).toBe(70);
    expect(selectCommenters(sample([video("v1", many("x", 200))]), { perVideoCap: 500, maxCommenters: 50 }).uniqueCommenters).toBe(50);
  });

  it("drops likely spam: link posters and text copied by three or more commenters", () => {
    const s = selectCommenters(
      sample([
        video("v1", [
          ["l", "win a phone at www.free-prizes.xyz"],
          ["p1", "Check my channel for free gift cards"],
          ["p2", "check my channel   for free gift cards"],
          ["p3", "Check my channel for free gift cards"],
          ["ok", "Check my channel for free gift cards"],
          ["fine", "love this recipe"],
        ]),
      ]),
    );
    expect(s.commenterIds).toEqual(["fine"]);
    expect(s.excludedLikelySpam).toBe(5);
  });

  it("records videos with comments turned off", () => {
    const s = selectCommenters(sample([video("v1", [], true), video("v2", [["a", "hi there"]])]));
    expect(s).toMatchObject({ videosSampled: 1, videosCommentsOff: 1 });
  });
});

describe("country distribution", () => {
  it("is insufficient below the minimum classified sample and never assigns unknowns", () => {
    const d = countryDimension([...Array(29).fill("PK"), ...Array(100).fill(null)]);
    expect(d).toMatchObject({ status: "insufficient", classified: 29, required: 30 });
    expect(countryDimension([])).toMatchObject({ status: "insufficient", reason: expect.stringMatching(/no public comments/) });
  });

  it("estimates shares with 95% intervals, groups small countries and rounds small samples to 5 points", () => {
    const d = countryDimension([...Array(30).fill("PK"), ...Array(6).fill("AE"), "US", "US", "GB", "IN", null, null]);
    expect(d.status).toBe("estimated");
    if (d.status !== "estimated") return;
    expect(d.classified).toBe(40);
    expect(d.shares.map((s) => [s.code, s.count])).toEqual([["PK", 30], ["AE", 6], ["US", 2], ["OTHER", 2]]);
    expect(d.shares[0]).toMatchObject({ share: 0.75 });
    expect(d.shares[0]?.low).toBeCloseTo(0.598, 2);
    expect(d.shares[0]?.high).toBeCloseTo(0.858, 2);
    expect(d).toMatchObject({ confidence: "low", displayStep: 5 });
  });

  it("gives moderate confidence only when every interval is within ±10 points", () => {
    const d = countryDimension([...Array(150).fill("PK"), ...Array(50).fill("AE")]);
    expect(d).toMatchObject({ status: "estimated", confidence: "moderate", displayStep: 1 });
  });

  it("Wilson interval is bounded and sensible", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    const w = wilson(50, 100);
    expect(w.low).toBeCloseTo(0.404, 2);
    expect(w.high).toBeCloseTo(0.596, 2);
  });
});

describe("estimate", () => {
  it("is aggregate-only, labelled, and never estimates age or gender", () => {
    const sel = selectCommenters(sample([video("v1", many("a", 40))]));
    const body = buildEstimate(sel, sel.commenterIds.map((_, i) => (i < 32 ? "PK" : null)), 1);
    expect(audienceEstimateBodySchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({ outcome: "estimated", methodVersion: METHOD.version, population: "sampled_recent_commenters", sample: { uniqueCommenters: 40, classifiable: 32, coverage: 0.8 } });
    expect(body.age.status).toBe("not_estimable");
    expect(body.gender.status).toBe("not_estimable");
    expect(JSON.stringify(body)).not.toMatch(/"a\d+"/); // no commenter ids
    expect(body.label).toBe("Modeled estimate — not verified by the platform");
  });

  it("is insufficient when too few commenters state a country", () => {
    const sel = selectCommenters(sample([video("v1", many("a", 40))]));
    expect(buildEstimate(sel, sel.commenterIds.map(() => null), 1).outcome).toBe("insufficient");
  });
});
