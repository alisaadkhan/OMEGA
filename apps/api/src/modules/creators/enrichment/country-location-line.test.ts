import { describe, expect, it } from "vitest";
import { profileCountry } from "./country-evidence";

const status = (bio: string) => profileCountry({ bio, platformCountry: null, confirmed: null }).status;

describe("country rule: bio location line (owner 2026-11-02)", () => {
  it("LOC-01 a line opening with a city and its own country is the creator's stated location", () => {
    expect(status("Fashion| Beauty| Lifestyle\nIslamabad, Pakistan📍🇵🇰\nRaid my closet")).toBe("pakistan");
    expect(status("Lahore, Pakistan")).toBe("pakistan");
    expect(status("📍Islamabad, Pakistan")).toBe("pakistan");
  });
  it("LOC-02 a topic mid-sentence, a flag alone or a city that is not in the named country is not a location", () => {
    expect(status("Food tours of Lahore Pakistan every week")).toBe("unknown");
    expect(status("🇵🇰")).toBe("unknown");
    expect(status("Karachi, India")).toBe("unknown");
  });
  it("LOC-03 the stated location is creator-stated at medium confidence, never verified", () => {
    const r = profileCountry({ bio: "Lahore, Pakistan", platformCountry: null, confirmed: null });
    expect(r).toMatchObject({ country: "PK", source: "creator_stated", confidence: "medium" });
  });
});
