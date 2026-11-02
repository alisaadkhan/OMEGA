import { describe, expect, it } from "vitest";
import { cityCountry } from "./city-country";
import { profileCountry } from "./country-evidence";

// Owner correction 2026-10-27: an explicit residence statement naming a recognised city resolves to that city's
// country (creator-stated, not verified); origin, travel, usernames, hashtags and topics never do.
const pc = (bio: string, platformCountry: string | null = null) => profileCountry({ bio, platformCountry, confirmed: null });

describe("city residence → country (CITY)", () => {
  it("CITY-01 explicit Pakistani residence statements resolve to Pakistan, creator-stated", () => {
    for (const bio of ["Lives in Lahore", "Based in Karachi", "Living in Rawalpindi", "📍 Islamabad", "Food vlogger based in Faisalabad | DM for collabs"]) {
      expect(pc(bio)).toMatchObject({ country: "PK", source: "creator_stated", status: "pakistan", confidence: "medium" });
    }
    expect(pc("Living in Islamabad, Pakistan")).toMatchObject({ country: "PK", status: "pakistan", confidence: "high" });
  });

  it("CITY-02 keeps the original words, the city and the country as the evidence", () => {
    const r = pc("Chai lover ☕ Lives in Lahore | collabs via DM");
    expect(r.reason).toContain("Lives in Lahore");
    expect(r.reason).toContain("city: lahore, country: PK");
    expect(r.reason).toContain("creator-stated, not verified");
  });

  it("CITY-03 a residence in a city of another country resolves to that country (excluded from the Pakistani catalogue)", () => {
    expect(pc("Based in Dubai")).toMatchObject({ country: "AE", status: "foreign" });
    expect(pc("Lives in Toronto")).toMatchObject({ country: "CA", status: "foreign" });
    expect(pc("Living in London")).toMatchObject({ country: "GB", status: "foreign" });
  });

  it("CITY-04 an ambiguous city stays unknown unless the statement names the country", () => {
    expect(cityCountry("hyderabad")?.countries).toEqual(["PK", "IN"]);
    expect(pc("Based in Hyderabad")).toMatchObject({ country: null, status: "unknown" });
    expect(pc("Based in Hyderabad").reason).toContain("more than one country");
    expect(pc("Based in Hyderabad, Pakistan")).toMatchObject({ country: "PK", status: "pakistan" });
    expect(pc("Based in Hyderabad, India")).toMatchObject({ country: "IN", status: "foreign" });
  });

  it("CITY-05 travel, visits and topics are not residence", () => {
    for (const bio of ["Travelling in Dubai this week", "Currently visiting London", "Best biryani in Karachi reviewed", "Lahore food vlogger"]) expect(pc(bio).status).toBe("unknown");
  });

  it("CITY-06 birthplace or origin is not current residence", () => {
    expect(pc("From Lahore").status).toBe("unknown");
    expect(pc("Food vlogger from Lahore").status).toBe("unknown");
    expect(pc("Born in Lahore, living in London")).toMatchObject({ country: "GB", status: "foreign" });
    expect(pc("Moved to Dubai from Lahore")).toMatchObject({ country: "AE", status: "foreign" });
  });

  it("CITY-07 usernames and hashtags never establish residence", () => {
    expect(pc("lahore_eats official").status).toBe("unknown");
    expect(pc("#lahore #karachi #foodie").status).toBe("unknown");
  });

  it("CITY-08 conflicting evidence stays visible: city vs platform, city vs named country", () => {
    expect(pc("Based in Lahore", "GB")).toMatchObject({ status: "conflicting", country: null });
    expect(pc("Based in Lahore, India")).toMatchObject({ status: "conflicting", country: null });
    // A creator-confirmed country is stronger and wins; the stated city is not silently merged into it.
    expect(profileCountry({ bio: "Based in Dubai", platformCountry: null, confirmed: "PK" })).toMatchObject({ country: "PK", source: "creator_confirmed" });
  });

  it("CITY-09 the Pakistani city list comes from the maintained search concepts; short codes are not places", () => {
    expect(cityCountry("lahore")).toEqual({ city: "lahore", countries: ["PK"] });
    expect(cityCountry("لاہور")?.countries).toEqual(["PK"]);
    expect(cityCountry("lhr")).toBeNull();
    expect(cityCountry("atlantis")).toBeNull();
  });
});
