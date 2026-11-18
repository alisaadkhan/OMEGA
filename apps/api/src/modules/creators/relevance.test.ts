import { describe, expect, it } from "vitest";
import { relevancePlan } from "./relevance";
import { relevanceTier } from "./ranking";
import { understandQuery } from "./understand";

const kinds = (text: string) => relevancePlan(understandQuery(text).text)?.groups.map((g) => `${g.kind}:${g.canonical}`) ?? null;

describe("relevance plan (18 Nov directive)", () => {
  it("reads a specific game as that game, never as the whole Gaming niche", () => {
    const plan = relevancePlan("pubg");
    expect(plan?.groups).toEqual([expect.objectContaining({ kind: "topic", canonical: "pubg", parent: "Gaming" })]);
    const forms = plan?.groups[0]?.forms ?? [];
    expect(forms).toEqual(expect.arrayContaining(["pubg", "pubgm", "pubg mobile", "bgmi", "pmgo"]));
    // Not the niche's other words: a GTA or Free Fire channel is not a PUBG channel.
    for (const other of ["gaming", "game", "games", "free fire", "gta"]) expect(forms).not.toContain(other);
  });

  it("keeps 'PUBG mobile' one topic (not PUBG plus Tech because of 'mobile')", () => {
    expect(kinds("PUBG mobile gamers")).toEqual(["topic:pubg"]);
    expect(kinds("pubg streamers")).toEqual(["topic:pubg"]);
    expect(relevancePlan("pubg streamers")?.boost).toEqual(["streamers"]);
    expect(kinds("PUBG gaming creators")).toEqual(["topic:pubg"]);
  });

  it("maps niche words to the stored taxonomy labels", () => {
    const label = (t: string) => relevancePlan(understandQuery(t).text)?.groups.flatMap((g) => (g.kind === "niche" ? g.labels : [])) ?? [];
    expect(label("technology")).toEqual(["Tech"]);
    expect(label("health")).toEqual(["Wellness"]);
    expect(label("fitness")).toEqual(["Wellness"]);
    expect(label("education")).toEqual(["Education & How-to"]);
    expect(label("history")).toEqual(["History"]);
    expect(label("religion")).toEqual(["Religion"]); // two edits from the reviewed form "religious"
    expect(label("islamic")).toEqual(["Religion"]);
    expect(label("finance")).toEqual(["Finance"]);
    expect(label("automotive")).toEqual(["Automotive"]);
    expect(label("food")).toEqual(["Food"]);
    expect(label("travel")).toEqual(["Travel"]);
    expect(label("beauty")).toEqual(["Beauty"]);
    expect(label("gaming")).toEqual(["Gaming"]);
  });

  it("corrects a misspelt topic word but never guesses short words", () => {
    expect(kinds("helth")).toEqual(["niche:fitness"]); // one edit from "health" (Wellness)
    expect(kinds("pubgg")).toEqual(["topic:pubg"]);
    expect(kinds("gta")).toEqual(["topic:gta"]); // exact short forms match; only fuzzy matching needs 5+ letters
    expect(kinds("technolgy")).toEqual(["niche:technology"]);
    expect(kinds("cricet")).toEqual(["topic:cricket"]);
  });

  it("leaves name and handle searches to plain full-text search", () => {
    expect(relevancePlan("ayesha omar")).toBeNull();
    expect(relevancePlan("irfan junejo")).toBeNull();
  });

  it("keeps a city required next to a topic", () => {
    expect(kinds("food creators in lahore")).toEqual(["niche:food", "city:lahore"]);
  });

  it("no longer drops 'education' as a misspelt role word (v1 returned every creator)", () => {
    expect(understandQuery("education").text).toBe("education");
    expect(understandQuery("education creators").text).toBe("education");
    // Real role words and their typos still only rank.
    expect(understandQuery("food bloogers").optional).toEqual(["bloogers"]);
  });

  it("orders relevance tiers so a niche-and-content match is never below a content-only one", () => {
    const score = (tier: number, rank: number) => 0.95 * tier + 0.05 * rank;
    expect(relevanceTier(score(1, 0))).toBe(10);
    expect(relevanceTier(score(0.9, 1))).toBe(9);
    expect(relevanceTier(score(0.8, 0.5))).toBe(8);
    expect(relevanceTier(score(0.5, 1))).toBe(5);
    expect(relevanceTier(score(1, 0))).toBeGreaterThan(relevanceTier(score(0.9, 1)));
  });
});
