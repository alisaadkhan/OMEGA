import { describe, expect, it } from "vitest";
import { extractContacts, extractLinks } from "./links";
import { minorByRules } from "./minors";
import type { StandardProfile } from "./standardize";

const now = new Date("2026-10-09T12:00:00Z");

describe("possible-minor rules (SRS §5.2)", () => {
  it.each([
    ["15 y/o makeup lover", /15 y\/o/],
    ["16yo | Lahore", /16yo/],
    ["age 14 ✨", /age 14/],
    ["Class 9 student from Karachi", /class 9/i],
    ["matric student 📚", /matric student/i],
    ["O levels student", /o levels student/i],
    ["born 2011 🎂", /born 2011/],
    ["17 years old dancer", /17 years old/],
  ])("flags %s", (bio, reason) => {
    expect(minorByRules([bio], now)).toMatch(reason);
  });

  it.each(["class of 2015", "15 years of experience in bridal makeup", "born in 1998", "teaching class 9 maths", "tutor for class 10 and O levels", "25 y/o", "2011 memories"])(
    "does not flag %s",
    (bio) => {
      expect(minorByRules([bio], now)).toBeNull();
    },
  );

  it("looks at captions too and quotes the matching text", () => {
    expect(minorByRules(["Lahore food", "my 9th class result day!"], now)).toMatch(/9th class/);
  });
});

const base = (over: Partial<StandardProfile>): StandardProfile => ({
  platform: "instagram",
  handle: "sana",
  displayName: "Sana",
  bio: "",
  followers: 1,
  following: 1,
  posts: 1,
  verified: false,
  websiteUrls: [],
  businessEmail: null,
  businessPhone: null,
  country: null,
  avatarUrl: null,
  recentPosts: [],
  ...over,
});

describe("contacts", () => {
  it("takes business fields as likely and bio contacts as unverified, without duplicates", () => {
    const p = base({ businessEmail: "Bookings@Sana.pk", bio: "Collabs: bookings@sana.pk · WhatsApp 0300-1234567 · sana at gmail dot com", businessPhone: "+92 300 1234567" });
    expect(extractContacts(p)).toEqual([
      { kind: "email", value: "bookings@sana.pk", trust: "likely", source: "business_field" },
      { kind: "phone", value: "+923001234567", trust: "likely", source: "business_field" },
    ]);
    expect(extractContacts(base({ bio: "DM or mail hello@studio.com, call +92 321 7654321" }))).toEqual([
      { kind: "email", value: "hello@studio.com", trust: "unverified", source: "bio" },
      { kind: "phone", value: "+923217654321", trust: "unverified", source: "bio" },
    ]);
    expect(extractContacts(base({ bio: "Followers 1,234,567 and 2024 goals" }))).toEqual([]);
    // Not addresses at all: an image file name, a reserved example domain, a malformed string. Never stored or shown.
    expect(extractContacts(base({ bio: "Banner logo@2x.png · demo me@example.com · bad a..b@gmail.com" }))).toEqual([]);
  });
});

describe("linked accounts (spec D6)", () => {
  it("records other platforms and websites the creator links, never their own profile", () => {
    const p = base({
      websiteUrls: ["https://cokeurl.com/Nu.WAV", "https://www.tiktok.com/@sana_tt"],
      bio: "YouTube: https://youtube.com/@sanavlogs and https://instagram.com/sana",
    });
    expect(extractLinks(p, "https://instagram.com/sana")).toEqual([
      { platform: "website", url: "https://cokeurl.com/Nu.WAV", source: "profile_link" },
      { platform: "tiktok", url: "https://tiktok.com/@sana_tt", source: "profile_link" },
      { platform: "youtube", url: "https://youtube.com/@sanavlogs", source: "bio" },
    ]);
  });
});
