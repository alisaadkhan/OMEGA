import { describe, expect, it } from "vitest";
import type { CreatorCard } from "@mushin/contracts";
import { compareLiveCards } from "./live-runner";

const card = (id: string, handle: string, fitScore: number, platform: CreatorCard["platform"] = "instagram"): CreatorCard => ({
  id, displayName: handle, handle, platform, avatarUrl: null, city: null, country: null, niches: [], tags: [], verified: false, followers: null, engagementRate: null,
  authenticityScore: null, fakeFollowerPct: null, hasContact: false, contactAvailability: "none", followersFreshness: "current", fitScore, fitLabel: "Possible match",
});

describe("live result order", () => {
  it("is the same for the same creators whatever ids they were given (replays mint new ids)", () => {
    const fit = (cards: CreatorCard[]) => new Map(cards.map((c) => [c.id, 70]));
    const runA = [card("ffff0000-0000-4000-8000-000000000001", "khojiiii", 60), card("00000000-0000-4000-8000-000000000002", "kkatayon_4", 60)];
    const runB = [card("00000000-0000-4000-8000-000000000003", "khojiiii", 60), card("ffff0000-0000-4000-8000-000000000004", "kkatayon_4", 60)];
    const order = (cards: CreatorCard[]) => [...cards].sort((a, b) => compareLiveCards(a, b, fit(cards))).map((c) => c.handle);
    expect(order(runA)).toEqual(["khojiiii", "kkatayon_4"]);
    expect(order(runB)).toEqual(order(runA));
  });

  it("still ranks by Campaign Fit first, then the catalogue fit score", () => {
    const a = card("00000000-0000-4000-8000-00000000000a", "zz_best", 50);
    const b = card("00000000-0000-4000-8000-00000000000b", "aa_less", 90);
    const c = card("00000000-0000-4000-8000-00000000000c", "mm_unscored", 80);
    const fit = new Map<string, number | null>([[a.id, 95], [b.id, 60], [c.id, null]]);
    expect([b, c, a].sort((x, y) => compareLiveCards(x, y, fit)).map((x) => x.handle)).toEqual(["zz_best", "mm_unscored", "aa_less"]);
  });
});
