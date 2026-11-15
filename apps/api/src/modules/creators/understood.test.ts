import { describe, expect, it } from "vitest";
import { searchFiltersShape } from "@mushin/contracts";
import { explainInterpretation } from "./understood";

const chips = (c: Partial<ReturnType<typeof searchFiltersShape.parse>>) => ({ chips: searchFiltersShape.parse({ ...c }) });

describe("what the AI reading took from a search", () => {
  it("marks filters written in the request as stated and deduced ones as inferred, and names a campaign purpose as no filter", () => {
    const text = "Find Pakistani tech influencers on Instagram with at least 50k followers who review smartphones. I need creators suitable for promoting a new mobile phone.";
    const u = explainInterpretation(text, chips({ creatorCountry: "PK", platform: "instagram", followersMin: 50_000, niches: ["Tech"], creatorCity: "Lahore" }));
    expect(u.basis).toEqual({ creatorCountry: "stated", platform: "stated", followers: "stated", "niche:Tech": "stated", creatorCity: "inferred" });
    expect(u.notFilters).toEqual(["for promoting a new mobile phone"]);
  });

  it("a niche the AI deduced from other words is inferred; nothing is invented when the request has no purpose", () => {
    const u = explainInterpretation("smartphone unboxing channels", chips({ niches: ["Tech"], platform: "youtube", verifiedOnly: true, engagementMin: 3 }));
    expect(u.basis).toEqual({ "niche:Tech": "inferred", platform: "inferred", verifiedOnly: "inferred", engagement: "inferred" });
    expect(u.notFilters).toEqual([]);
  });

  it("reads Urdu-script Pakistan, a blue tick, a percentage and an audience country", () => {
    const u = explainInterpretation("پاکستان food bloggers with blue tick, 5% engagement, audience in united arab emirates", chips({ creatorCountry: "PK", verifiedOnly: true, engagementMin: 5, audienceCountry: "AE" }));
    expect(u.basis).toEqual({ creatorCountry: "stated", verifiedOnly: "stated", engagement: "stated", audienceCountry: "stated" });
  });
});
