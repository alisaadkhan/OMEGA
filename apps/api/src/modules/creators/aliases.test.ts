import { describe, expect, it } from "vitest";
import { cityForms, expandQuery, LIVE_PLACE_URDU, LIVE_TOPIC_TERMS, normalizeQuery } from "./aliases";

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

  it("keeps Live Discovery's reviewed phrases exactly as before the move", () => {
    expect(LIVE_TOPIC_TERMS["food"]).toEqual({ roman: "khana foodie", urdu: "کھانا فوڈ" });
    expect(LIVE_TOPIC_TERMS["street food"]).toEqual({ roman: "street food khana", urdu: "اسٹریٹ فوڈ کھانا" });
    expect(Object.keys(LIVE_TOPIC_TERMS).sort()).toEqual(
      ["beauty", "bridal", "fashion", "fitness", "food", "food blogger", "foodie", "makeup", "street food", "tech", "technology", "travel"].sort(),
    );
    expect(LIVE_PLACE_URDU).toMatchObject({ lahore: "لاہور", karachi: "کراچی", islamabad: "اسلام آباد", quetta: "کوئٹہ" });
  });
});
