import { describe, expect, it } from "vitest";
import { cityForms, closestWord, editDistance, handleWords, expandQuery, LIVE_PLACE_URDU, LIVE_TOPIC_TERMS, NICHE_CONCEPTS, normalizeQuery } from "./aliases";

describe("reviewed search aliases", () => {
  it("normalises case, punctuation and Unicode without dropping Urdu letters", () => {
    expect(normalizeQuery("  Khana,  LHR! ")).toBe("khana lhr");
    expect(normalizeQuery("لاہور کا کھانا")).toBe("لاہور کا کھانا");
  });

  it("expands English, Roman Urdu and Urdu-script niche words to the same concept", () => {
    for (const q of ["food", "khana", "کھانا", "Foodie"]) {
      expect(expandQuery(q)).toEqual([{ kind: "niche", canonical: "food", forms: ["food", "foodie", "khana", "کھانا", "فوڈ"] }]);
    }
  });

  it("expands city names and short forms, matching multi-word Urdu forms whole", () => {
    expect(expandQuery("lhr")?.[0]).toMatchObject({ kind: "city", canonical: "Lahore" });
    expect(expandQuery("اسلام آباد tech")).toEqual([
      { kind: "city", canonical: "Islamabad", forms: ["islamabad", "isb", "اسلام آباد"] },
      { kind: "niche", canonical: "technology", forms: ["technology", "tech", "ٹیکنالوجی", "ٹیک"] },
    ]);
  });

  it("keeps unknown words as typed, and returns null when nothing is recognised (plain search unchanged)", () => {
    expect(expandQuery("khana vlogger")).toEqual([
      expect.objectContaining({ canonical: "food" }),
      { kind: "word", canonical: "vlogger", forms: ["vlogger"] },
    ]);
    expect(expandQuery("sana bridal")?.map((g) => g.kind)).toEqual(["word", "niche"]);
    expect(expandQuery("Ayesah Siddiq")).toBeNull();
    expect(expandQuery("   ")).toBeNull();
  });

  it("does not duplicate a concept named twice", () => {
    expect(expandQuery("food khana")).toHaveLength(1);
  });

  it("maps a city filter value to all of its forms, and leaves an unknown city as typed", () => {
    expect(cityForms("LHR")).toEqual(["lahore", "lhr", "لاہور"]);
    expect(cityForms("Lahore")).toEqual(["lahore", "lhr", "لاہور"]);
    expect(cityForms("Sialkot")).toEqual(["sialkot"]);
  });

  it("reads a misspelt vocabulary word as its concept, but never corrects short words or ambiguous ones (panel Q007)", () => {
    expect(expandQuery("peshawer tech")?.map((g) => g.canonical)).toEqual(["Peshawar", "technology"]);
    expect(expandQuery("karachii")?.map((g) => g.canonical)).toEqual(["Karachi"]);
    expect(closestWord("food", ["foods"])).toBeNull(); // under 5 letters
    expect(closestWord("tariq", ["safar", "multan"])).toBeNull();
    expect(closestWord("abcde", ["abcdx", "abcdy"])).toBeNull(); // a tie is not guessed
    expect(editDistance("bloogerz", "bloggers")).toBe(2);
  });

  it("reads 'home cooking' as cooking, not as two required words (panel Q014)", () => {
    expect(expandQuery("home cooking")?.map((g) => g.canonical)).toEqual(["cooking"]);
    expect(expandQuery("recipes")?.map((g) => g.canonical)).toEqual(["cooking"]);
  });

  it("matches the Urdu-script forms of skincare and literature (panel Q002, Q035)", () => {
    expect(expandQuery("لاہور اسکن کیئر")?.map((g) => g.canonical)).toEqual(["Lahore", "skincare"]);
    expect(expandQuery("اردو ادب")?.map((g) => g.canonical)).toEqual(["اردو", "literature"]);
  });

  it("maps every form of the approved catalogue concepts, and nothing else, to that concept", () => {
    for (const c of NICHE_CONCEPTS.filter((n) => ["skincare", "cooking", "literature", "agriculture"].includes(n.canonical))) {
      expect(c.live).toBeUndefined(); // catalogue only: never sent to Live Discovery
      for (const form of c.forms) expect(expandQuery(form)).toEqual([{ kind: "niche", canonical: c.canonical, forms: [...c.forms] }]);
    }
    expect(expandQuery("food")?.[0]?.canonical).toBe("food"); // "food" and "khana" stay food, not cooking
    expect(expandQuery("کھانا")?.[0]?.canonical).toBe("food");
  });

  it("reads English concept and city words inside joined-up handles, not Roman Urdu ones or already separated words", () => {
    expect(handleWords("karachifoodadventure").sort()).toEqual(["food", "karachi"]);
    expect(handleWords("ayeshakhanam")).toEqual([]);
    expect(handleWords("food_diaries")).toEqual([]); // "food" is already its own word
    expect(handleWords("lahoretechreviews").sort()).toEqual(["lahore", "tech"]);
  });

  it("keeps Live Discovery's reviewed phrases exactly as before the move", () => {
    expect(LIVE_TOPIC_TERMS["food"]).toEqual({ roman: "khana foodie", urdu: "کھانا فوڈ" });
    expect(LIVE_TOPIC_TERMS["street food"]).toEqual({ roman: "street food khana", urdu: "اسٹریٹ فوڈ کھانا" });
    expect(Object.keys(LIVE_TOPIC_TERMS).sort()).toEqual(
      ["beauty", "bridal", "fashion", "fitness", "food", "food blogger", "foodie", "makeup", "street food", "tech", "technology", "travel"].sort(),
    );
    expect(LIVE_PLACE_URDU).toMatchObject({ lahore: "لاہور", karachi: "کراچی", islamabad: "اسلام آباد", quetta: "کوئٹہ" });
  });
});
