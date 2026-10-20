import { describe, expect, it } from "vitest";
import { deriveAttributes } from "./attribute-evidence";
import type { Assessment } from "./assessment";
import type { StandardProfile } from "./standardize";

const profile = (o: Partial<StandardProfile> & { captions?: string[] } = {}): StandardProfile => ({
  platform: "youtube",
  handle: "x",
  displayName: o.displayName ?? "Creator",
  bio: o.bio ?? "",
  followers: 50_000,
  following: null,
  posts: 10,
  verified: false,
  websiteUrls: [],
  businessEmail: null,
  businessPhone: null,
  country: o.country ?? null,
  avatarUrl: null,
  recentPosts: (o.captions ?? []).map((caption, i) => ({ postedAt: new Date(Date.now() - i * 86_400_000), likes: 1, comments: 1, views: 1, isVideo: true, isPinned: false, caption, hashtags: [] })),
});
const ai = (o: Partial<Assessment>): Assessment => ({ verdict: null, score: null, evidence: [], watchOuts: [], audience: { age: [], gender: null, cities: [], countries: [] }, niches: [], creatorCity: null, creatorCountry: null, minorSigns: { likely: false, reason: "" }, ...o }) as Assessment;
const statusOf = (rows: ReturnType<typeof deriveAttributes>["evidence"], attribute: string, source: string) => rows.find((r) => r.attribute === attribute && r.source === source)?.status;

describe("evidence-based creator attributes (v2)", () => {
  it("stores a city named in the creator's own bio, with a quote", () => {
    const d = deriveAttributes(profile({ bio: "Food vlogger based in Lahore. Collabs via DM" }), null);
    expect(d.city).toBe("Lahore");
    expect(d.country).toBe("PK");
    expect(d.evidence.find((r) => r.attribute === "city")).toMatchObject({ source: "profile_text", status: "supported", evidence: expect.stringContaining("Lahore") });
  });

  it("never stores a city only the AI read, nor a registration country alone", () => {
    const d = deriveAttributes(profile({ bio: "Daily vlogs and challenges", country: "US" }), ai({ creatorCity: "Karachi", creatorCountry: "PK" }));
    expect(d.city).toBeNull();
    expect(d.country).toBeNull();
    expect(statusOf(d.evidence, "city", "ai_assessment")).toBe("weak");
    expect(statusOf(d.evidence, "country", "platform_registration")).toBe("weak");
    expect(statusOf(d.evidence, "country", "ai_assessment")).toBe("weak");
  });

  it("flags a registration country that contradicts the creator's own words, and keeps Pakistan", () => {
    const d = deriveAttributes(profile({ bio: "Pakistani YouTuber 🇵🇰 roasting the internet", country: "US" }), null);
    expect(d.country).toBe("PK");
    expect(statusOf(d.evidence, "country", "platform_registration")).toBe("conflicting");
  });

  it("supports a city from at least half of the recent posts, but not from a few", () => {
    expect(deriveAttributes(profile({ captions: ["Best nihari in Karachi", "Karachi street food tour", "Karachi biryani", "Home recipe"] }), null).city).toBe("Karachi");
    expect(deriveAttributes(profile({ captions: ["Trip to Karachi", "Home recipe", "Q&A"] }), null).city).toBeNull();
  });

  // Regressions from the real catalogue dry run (2026-10-20).
  it("does not read a travel vlogger's visits as where they are based", () => {
    const captions = ["Craziest market 🇵🇰 pakistan peshawar", "Peshawar street food", "Peshawar old city", "Hunza valley", "Skardu road", "Lahore fort", "Lahore food street", "Karachi beach", "Istanbul", "Cairo", "Dubai", "Q&A"];
    const d = deriveAttributes(profile({ displayName: "Travelwithchris", bio: "Let's travel the world together!", country: "US", captions }), null);
    expect(d.city).toBeNull();
    expect(d.country).toBeNull();
    expect(statusOf(d.evidence, "city", "post_text")).toBe("weak");
  });

  it("does not read the abbreviation ISB (Indian School of Business) as Islamabad", () => {
    const d = deriveAttributes(profile({ bio: "One of India's top content creators. He holds an MBA degree from ISB.", country: "IN" }), null);
    expect(d.city).toBeNull();
    expect(d.country).toBeNull();
  });

  it("does not count a city or Pakistan that appears only as a bio hashtag", () => {
    const d = deriveAttributes(profile({ bio: "gadgets, trending products #hania #lahore #srk #pakistan #bollywood", country: "AE" }), null);
    expect(d.city).toBeNull();
    expect(d.country).toBeNull();
  });

  it("flags Pakistan as conflicting when the creator says they live abroad", () => {
    const d = deriveAttributes(profile({ bio: "Daily life of a family that immigrated to Canada from Pakistan in 2023", country: "CA" }), null);
    expect(d.country).toBeNull();
    expect(d.evidence.find((r) => r.attribute === "country" && r.value === "PK")).toMatchObject({ status: "conflicting" });
  });

  it("needs a Pakistan cue for Hyderabad, which is also a city in India", () => {
    expect(deriveAttributes(profile({ bio: "Food reviews in Hyderabad" }), null).city).toBeNull();
    expect(deriveAttributes(profile({ bio: "Food reviews in Hyderabad, Sindh" }), null).city).toBe("Hyderabad");
  });

  it("does not read a city named as an institution in a long bio as where the creator is based", () => {
    const bio = "Javed Chaudhry is an eminent journalist and columnist. He started his career in 1991 and has written columns for decades. He was awarded an honorary doctorate by Islamia University, Bahawalpur in November 2023.";
    const d = deriveAttributes(profile({ displayName: "Javed Chaudhry", bio }), null);
    expect(d.city).toBeNull();
    expect(statusOf(d.evidence, "city", "profile_text")).toBe("weak");
    expect(deriveAttributes(profile({ bio: `${bio} Based in Islamabad.` }), null).city).toBe("Islamabad");
  });

  it("does not read Pakistan named as a topic as the creator's country", () => {
    const d = deriveAttributes(profile({ displayName: "Coffee With Sumeet Jain", bio: "Insights on political and financial developments in China, India, and Pakistan!", country: "US" }), null);
    expect(d.country).toBeNull();
    expect(statusOf(d.evidence, "country", "profile_text")).toBe("weak");
    expect(deriveAttributes(profile({ bio: "I am from Pakistan city Faisalabad. Live streamer" }), null)).toMatchObject({ city: "Faisalabad", country: "PK" });
    expect(deriveAttributes(profile({ displayName: "Tech Valley Pakistan", bio: "Ed-tech and entrepreneurship" }), null).country).toBe("PK");
  });

  it("does not take a niche from words too general to prove it", () => {
    const d = deriveAttributes(profile({ displayName: "Furniture Tech", bio: "Exploring furniture designs that blend style with practicality. Pubg Mobile streamer" }), null);
    expect(d.niches).not.toContain("Travel");
    expect(d.niches).not.toContain("Fashion");
  });

  it("stores no city when two cities are both supported, and marks them conflicting", () => {
    const d = deriveAttributes(profile({ bio: "Lahore | Karachi | Dubai food reviews" }), null);
    expect(d.city).toBeNull();
    expect(d.evidence.filter((r) => r.attribute === "city").every((r) => r.status === "conflicting")).toBe(true);
  });

  it("does not read a city inside another word or handle", () => {
    expect(deriveAttributes(profile({ bio: "lahorebites official" }), null).city).toBeNull();
  });

  it("keeps niches the creator's text supports; an unsupported AI niche is weak", () => {
    const d = deriveAttributes(profile({ bio: "Tech reviews and unboxing", captions: ["iPhone review", "Best gadgets 2026", "Vlog"] }), ai({ niches: ["Tech", "Comedy"] }));
    expect(d.niches).toContain("Tech");
    expect(d.niches).not.toContain("Comedy");
    expect(d.evidence.find((r) => r.attribute === "niche" && r.value === "Comedy")).toMatchObject({ source: "ai_assessment", status: "weak" });
  });

  it("records content language from recent posts as evidence only", () => {
    const d = deriveAttributes(profile({ captions: ["آج کی ویڈیو میں ہم بات کریں گے", "یہ کھانا بہت مزیدار ہے", "Lahore ki sair, aaj hum kya karte hain", "this is my new video"] }), null);
    expect(d.languages).toContain("urdu");
    expect(d.evidence.filter((r) => r.attribute === "language").every((r) => r.source === "post_text")).toBe(true);
  });
});
