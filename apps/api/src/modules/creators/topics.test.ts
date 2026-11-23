import { describe, expect, it } from "vitest";
import { creatorTopics, displayNiches } from "./topics";

describe("specific topics on the card (owner, 23 Nov: PUBG, not Gaming)", () => {
  it("names the game a gaming creator plays, from their own handle, tags and bio", () => {
    const t = creatorTopics({ niches: ["Gaming", "Comedy"], displayName: "AJ FF", handle: "aj_ff", tags: ["#free fire", "#garena free fire", "#free fire pakistan"], bios: ["PUBG sometimes"] });
    expect(displayNiches(["Gaming", "Comedy"], t)).toEqual(["Free Fire", "PUBG", "Comedy"]);
  });
  it("keeps the niche when no topic is named, and never adds a topic outside the creator's niches", () => {
    expect(displayNiches(["Gaming"], creatorTopics({ niches: ["Gaming"], displayName: "Game Zone", tags: ["#gaming"] }))).toEqual(["Gaming"]);
    expect(displayNiches(["Food"], creatorTopics({ niches: ["Food"], displayName: "Foodie", tags: ["#pubg"] }))).toEqual(["Food"]);
  });
  it("shows at most two topics per niche, the most named first", () => {
    const t = creatorTopics({ niches: ["Gaming"], tags: ["#pubg", "#pubg mobile", "#bgmi", "#gta 5", "#minecraft", "#minecraft", "#minecraft pe"] });
    expect(t.get("Gaming")).toEqual(["PUBG", "Minecraft"]);
  });
});
