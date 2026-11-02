import { describe, expect, it } from "vitest";
import { profileCountry, type CountryExtras } from "./country-evidence";

const status = (bio: string, extras?: CountryExtras) => profileCountry({ bio, platformCountry: null, confirmed: null, extras }).status;

describe("country rule: storefront signals (owner 2026-11-03, research verification table)", () => {
  it("SF-01 a Pakistani city or Pakistan/🇵🇰 in a short bio header counts", () => {
    expect(status("Karachi | Food Blogger")).toBe("pakistan");
    expect(status("PR across Pakistan 🇵🇰")).toBe("pakistan");
  });
  it("SF-02 a +92/03xx phone number or a .pk address counts", () => {
    expect(status("Collabs: 0300 1234567")).toBe("pakistan");
    expect(status("WhatsApp +92 321 1234567")).toBe("pakistan");
    expect(status("shop at myshop.com.pk")).toBe("pakistan");
    expect(status("Links below", { urls: ["https://brand.pk/shop"] })).toBe("pakistan");
  });
  it("SF-03 two or more recent posts geotagged in Pakistan count; one does not", () => {
    expect(status("Food reviews", { postLocations: ["Lahore, Pakistan", "Karachi"] })).toBe("pakistan");
    expect(status("Food reviews", { postLocations: ["Lahore, Pakistan"] })).toBe("unknown");
  });
  it("SF-04 a stated life abroad wins: a pinned foreign place, a foreign flag, a residence abroad", () => {
    expect(status("📧 hello@aylasworld.co •📍bangkok 🇹🇭")).toBe("foreign");
    expect(status("📍 Dubai | Lifestyle")).toBe("foreign");
    expect(status("Based in London 🇬🇧 | Pakistani roots")).toBe("foreign");
  });
  it("SF-05 a city inside a long sentence (a topic) and an unrelated bio stay unknown", () => {
    expect(status("Exploring the beautiful old streets of Lahore with my lovely family every weekend")).toBe("unknown");
    expect(status("Gaming videos every week")).toBe("unknown");
  });
  it("SF-06 a public record (curated manifest or staff) resolves to its country, unless the profile states a life abroad", () => {
    const pr = { country: "PK", source: "https://example.org/list" };
    expect(profileCountry({ bio: "Actor", platformCountry: null, confirmed: null, publicRecord: pr })).toMatchObject({ status: "pakistan", source: "public_record", confidence: "high" });
    expect(profileCountry({ bio: "Based in London", platformCountry: null, confirmed: null, publicRecord: pr }).status).toBe("foreign");
  });
  it("SF-07 a linked Pakistani profile corroborates a profile with no evidence of its own, never one that states a life abroad", () => {
    const link = { platform: "youtube", reason: "Declared on the platform" };
    expect(profileCountry({ bio: "Daily vlogs", platformCountry: null, confirmed: null, linkedPakistani: link })).toMatchObject({ status: "pakistan", source: "linked_profile" });
    expect(profileCountry({ bio: "📍 Dubai", platformCountry: null, confirmed: null, linkedPakistani: link }).status).toBe("foreign");
  });
});

describe("country rule: travel pins and multi-flag bios (2026-11-03 review of the v4 run)", () => {
  it("SF-08 a travel pin abroad is weak: a public record still applies; several flags on one line are ambiguous", () => {
    expect(profileCountry({ bio: "Travel vlogger | Mexico📍", platformCountry: null, confirmed: null, publicRecord: { country: "PK", source: "https://en.wikipedia.org/wiki/Abrar_Hassan" } }).status).toBe("pakistan");
    expect(profileCountry({ bio: "📍🇭🇺🇸🇦🇫🇰🇵🇸🇵🇰", platformCountry: null, confirmed: null }).status).toBe("unknown");
  });
});

describe("country rule: ambiguous lines are skipped, not the whole bio", () => {
  it("SF-09 a multi-flag line or a tour line is ignored; another line still decides", () => {
    expect(profileCountry({ bio: "🇵🇰/🇸🇦/🇵🇸\nKARACHI 📍\nFilmmaker", platformCountry: null, confirmed: null }).status).toBe("pakistan");
    expect(profileCountry({ bio: "I make stupid jokes\nOct Pak Tour! 🇵🇰\nTickets below", platformCountry: null, confirmed: null }).status).toBe("unknown");
  });
});
