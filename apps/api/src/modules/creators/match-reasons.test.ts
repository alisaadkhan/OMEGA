import { describe, expect, it } from "vitest";
import { matchReasons, type MatchFields } from "./match-reasons";

const creator = (over: Partial<MatchFields> = {}): MatchFields => ({
  displayName: "Sana Mullick",
  nameVariants: [],
  handles: ["karachifoodadventure"],
  niches: ["food"],
  tags: ["street food"],
  city: "Karachi",
  bio: "Home cooking and desi recipes from Karachi. Collabs: DM",
  ...over,
});

describe("matchReasons (CAT-005)", () => {
  it("names the field each query concept matched, in the order name, handle, niche, city, tag, bio", () => {
    expect(matchReasons("karachi food", creator())).toEqual([
      { term: "Karachi", matched: "karachi", field: "handle", exact: true },
      { term: "food", matched: "food", field: "handle", exact: true },
    ]);
    expect(matchReasons("karachi food", creator({ handles: ["sana.m"] }))).toEqual([
      { term: "Karachi", matched: "karachi", field: "city", exact: true },
      { term: "food", matched: "food", field: "niche", exact: true },
    ]);
  });

  it("reports the reviewed form found when the query used another form (Roman Urdu, Urdu script, short city names)", () => {
    const c = creator({ handles: ["sana.m"], niches: [], tags: [], city: null, bio: "Lahore based, khana and travel" });
    expect(matchReasons("lhr food", c)).toEqual([
      { term: "Lahore", matched: "lahore", field: "bio", exact: true },
      { term: "food", matched: "khana", field: "bio", exact: true },
    ]);
    expect(matchReasons("کھانا", c)).toEqual([{ term: "food", matched: "khana", field: "bio", exact: true }]);
  });

  it("matches multi-word forms only as phrases", () => {
    expect(matchReasons("home cooking", creator({ handles: ["x"], niches: [], tags: [] }))).toEqual([
      { term: "cooking", matched: "cooking", field: "bio", exact: true },
    ]);
    expect(matchReasons("skin care", creator({ handles: ["x"], niches: [], tags: [], bio: "hair care for glowing skin" }))).toEqual([]);
  });

  it("marks a close spelling of the creator's name as not exact", () => {
    expect(matchReasons("sana malik", creator())).toEqual([
      { term: "sana", matched: "sana", field: "name", exact: true },
      { term: "malik", matched: "mullick", field: "name", exact: false },
    ]);
  });

  it("leaves out what it cannot locate instead of guessing", () => {
    expect(matchReasons("zzz", creator())).toEqual([]);
    expect(matchReasons("karachi gaming", creator()).map((r) => r.term)).toEqual(["Karachi"]);
  });

  it("never reads a city from another person's mention: only the creator's own fields are examined", () => {
    // The explanation only looks at this creator's indexed text; there is no other source to read a place from.
    expect(matchReasons("quetta", creator())).toEqual([]);
  });
});
