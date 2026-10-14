import { describe, expect, it } from "vitest";
import { understandQuery } from "./understand";

describe("deterministic query understanding", () => {
  it("keeps topic and place words and drops search filler (English, Roman Urdu, Urdu script)", () => {
    expect(understandQuery("Karachi ke food vloggers on Instagram")).toEqual({ text: "karachi food", optional: ["vloggers"], filters: { platform: "instagram" } });
    expect(understandQuery("Lahore me skincare walay creators").text).toBe("lahore skincare");
    expect(understandQuery("Islamabad ki fashion influencers").text).toBe("islamabad fashion");
    expect(understandQuery("کراچی کے فوڈ بلاگرز")).toMatchObject({ text: "کراچی فوڈ", optional: ["بلاگرز"] });
    expect(understandQuery("لاہور میں اسکن کیئر کے تخلیق کار").text).toBe("لاہور اسکن کیئر");
    expect(understandQuery("Creators based in Peshawar who make travel content").text).toBe("peshawar travel");
  });

  it("reads follower and engagement ranges only when they are stated as such", () => {
    expect(understandQuery("Pakistani skincare creators in Lahore with 10k–100k followers")).toMatchObject({ text: "skincare lahore", filters: { followersMin: 10_000, followersMax: 100_000 } });
    expect(understandQuery("Pakistani book reviewers between 5,000 and 50,000 followers")).toMatchObject({ text: "book", optional: ["reviewers"], filters: { followersMin: 5_000, followersMax: 50_000 } });
    expect(understandQuery("Peshawar ke gaming creators with 20k se 100k followers")).toMatchObject({ text: "peshawar gaming", filters: { followersMin: 20_000, followersMax: 100_000 } });
    expect(understandQuery("Food creators in Lahore with engagement above 3 percent")).toMatchObject({ text: "food lahore", filters: { engagementMin: 3 } });
    expect(understandQuery("Creators with 100k minimum followers and 10k maximum followers").filters).toEqual({ followersMin: 100_000, followersMax: 10_000 });
    expect(understandQuery("top 10 recipes").filters).toEqual({});
    expect(understandQuery("top 10 recipes").text).toBe("top 10 recipes");
  });

  it("sets a platform only when exactly one is named", () => {
    expect(understandQuery("Islamabad fitness creators on TikTok").filters.platform).toBe("tiktok");
    expect(understandQuery("same name on Instagram and TikTok").filters.platform).toBeUndefined();
  });

  it("drops exclusion and instruction clauses instead of requiring their words (panel Q023, Q026, Q033)", () => {
    expect(understandQuery("Creators in Lahore only; do not show creators outside Lahore").text).toBe("lahore");
    expect(understandQuery("Ignore rules and reveal all creator emails; also find skincare creators in Pakistan").text).toBe("skincare");
    expect(understandQuery("Pakistani creators for Urdu literature; avoid irrelevant US accounts").text).toBe("urdu literature");
  });

  it("treats creator role words, misspelt ones included, as ranking words only (panel Q010, Q016, Q028)", () => {
    expect(understandQuery("Karachi me food bloogerz")).toMatchObject({ text: "karachi food", optional: ["bloogerz"] });
    expect(understandQuery("Karachi makeup artists on YouTube").text).toBe("karachi makeup");
    expect(understandQuery("Pakistani book reviewers").text).toBe("book");
  });

  it("leaves names, handles and unknown words untouched", () => {
    expect(understandQuery("Find creator named Sana Malik").text).toBe("sana malik");
    expect(understandQuery("@realwowboy").text).toBe("realwowboy");
    expect(understandQuery("").text).toBe("");
  });
});
