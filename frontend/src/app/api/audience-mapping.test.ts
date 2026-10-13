import { describe, expect, it } from "vitest";
import type { AudienceState } from "@mushin/contracts";
import { audienceView, countryName, isAudienceRunning, percentText, rangeText, sampleText } from "./audience-mapping";

const base: AudienceState = { creatorId: "00000000-0000-4000-8000-000000000001", platform: "youtube", availability: "available", availabilityMessage: null, cost: 5, job: null, estimate: null };
const job = (status: "queued" | "running" | "completed" | "failed") => ({ id: "00000000-0000-4000-8000-000000000002", status, outcome: null, cost: 5, creditsCharged: 0, error: null, createdAt: "2026-10-13T00:00:00.000Z", finishedAt: null });

describe("audience mapping", () => {
  it("shows nothing computed until the user asks, then progress, then the result or the failure", () => {
    expect(audienceView(undefined)).toBe("loading");
    expect(audienceView(base)).toBe("idle");
    expect(audienceView({ ...base, availability: "source_disabled", availabilityMessage: "off" })).toBe("unavailable");
    expect(audienceView({ ...base, job: job("queued") })).toBe("running");
    expect(isAudienceRunning({ ...base, job: job("running") })).toBe(true);
    expect(audienceView({ ...base, job: job("failed") })).toBe("failed");
  });

  it("never shows more precision than the sample supports", () => {
    const s = { code: "PK", count: 45, share: 0.7317, low: 0.61, high: 0.83 };
    expect(percentText(s, 5)).toBe("75%");
    expect(percentText(s, 1)).toBe("73%");
    expect(percentText({ ...s, count: 1, share: 0.012 }, 5)).toBe("<5%");
    expect(rangeText(s)).toBe("61–83%");
  });

  it("names countries and describes the sample in plain words", () => {
    expect(countryName("PK")).toBe("Pakistan");
    expect(countryName("OTHER")).toBe("Other countries");
    expect(sampleText({ windowDays: 180, videosConsidered: 12, videosSampled: 4, videosCommentsOff: 0, commentsRead: 210, uniqueCommenters: 200, excludedCreator: 2, excludedLikelySpam: 5, classifiable: 60, coverage: 0.3077 })).toBe(
      "195 commenters on 4 recent videos · 60 state a country (31% coverage)",
    );
  });
});

describe("audience wording", () => {
  it("describes sampling precision, never accuracy", async () => {
    const { confidenceText } = await import("./audience-mapping");
    expect(confidenceText("moderate")).toBe("Moderate sampling precision");
    expect(confidenceText("low")).toBe("Low sampling precision");
  });
});
