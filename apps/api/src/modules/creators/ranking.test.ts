import { describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { toCards } from "./ranking";
import type { CardRow, SearchSettings } from "./repository";

const now = new Date("2026-10-10T12:00:00Z");
const settings: SearchSettings = {
  weights: { text: 35, filters: 25, engagement: 15, authenticity: 15, freshness: 10 },
  labels: { best: 80, strong: 65, possible: 50 },
  fresh: { currentDays: 30, agingDays: 90 },
  candidatePool: 200,
  pageSize: 24,
  fewResults: 5,
};

function row(id: string, displayName: string, primaryHandle: string, strong: boolean): CardRow {
  return {
    id,
    displayName,
    primaryHandle,
    primaryPlatform: "instagram",
    avatarUrl: null,
    city: null,
    country: null,
    niches: [],
    tags: [],
    verified: false,
    authenticityScore: strong ? 95 : 40,
    fakeFollowerPct: null,
    followers: 100_000,
    engagementRate: strong ? 9 : 0.5,
    followersUpdatedAt: strong ? now : null,
    contactStates: [],
  };
}

const order = (text: string, rows: CardRow[], relevance: Record<string, number>) =>
  toCards(rows, { text, filters: searchFiltersSchema.parse({}) }, settings, now, new Map(Object.entries(relevance))).map((c) => c.displayName);

describe("search order", () => {
  // Measured on the main database 2026-10-10: "Fashion Club" came third, behind stronger creators with similar names.
  it("puts the creator whose name or handle is the search first, even with weaker numbers", () => {
    const rows = [row("a", "Lahore Fashion & Aesthetics Club", "lfac", true), row("b", "Lahore Fashion Club (LFC)", "lfc", true), row("c", "Fashion Club", "fashion.club", false)];
    expect(order("Fashion Club", rows, { a: 0.96, b: 1, c: 1 })[0]).toBe("Fashion Club");
    expect(order("@fashion.club", rows, { a: 0.5, b: 0.5, c: 1 })[0]).toBe("Fashion Club");
    expect(order("fashionclub", rows, { a: 0.5, b: 0.5, c: 1 })[0]).toBe("Fashion Club");
  });

  it("puts names that start with a search of two or more words next", () => {
    const rows = [row("a", "Studio Coke Fans", "fans", true), row("b", "Coke Studio Pakistan", "cokestudio", false)];
    expect(order("coke studio", rows, { a: 0.9, b: 1 })[0]).toBe("Coke Studio Pakistan");
  });

  it("keeps fit order for one-word topic searches", () => {
    const rows = [row("a", "Fashion Weekly", "fw", false), row("b", "Ayesha Styles", "ayesha", true)];
    expect(order("fashion", rows, { a: 1, b: 0.8 })).toEqual(["Ayesha Styles", "Fashion Weekly"]);
  });

  it("keeps an unknown follower count unknown and excludes it from numeric follower filters", () => {
    const unknown = { ...row("yt", "Hidden Subscribers", "hidden", true), primaryPlatform: "youtube" as const, followers: null };
    const unfiltered = toCards([unknown], { text: "", filters: searchFiltersSchema.parse({}) }, settings, now, new Map());
    expect(unfiltered[0]?.followers).toBeNull();
    const filtered = toCards([unknown], { text: "", filters: searchFiltersSchema.parse({ followersMax: 10_000 }) }, settings, now, new Map());
    expect(filtered).toEqual([]);
  });
});
