import { describe, expect, it } from "vitest";
import { NICHES_V2 } from "../terminology";
import { deriveAttributes } from "./attribute-evidence";
import { classifyNiche } from "./niche-evidence";
import type { StandardProfile } from "./standardize";

const rep = (xs: string[], n = 12) => Array.from({ length: n }, (_, i) => xs[i % xs.length] as string);
const niche = (o: { name?: string; bio?: string; category?: string | null; posts?: string[]; ai?: string[] }) =>
  classifyNiche({ displayName: o.name ?? "Creator", bio: o.bio ?? "", accountCategory: o.category ?? null, posts: o.posts ?? [], aiNiches: o.ai ?? [] });

// The canonical labels seeded by migration 0054 (platform.niches).
const TAXONOMY = ["Bridal", "Fashion", "Beauty", "Tech", "Food", "Travel", "Comedy", "Finance", "Wellness", "Lifestyle", "Education & How-to", "Gaming", "History", "Literature", "Agriculture", "Business & Ecommerce", "Automotive", "Religion", "Music", "News & Commentary", "Sports", "Entertainment", "Real Estate"];

describe("one niche taxonomy", () => {
  it("maps every niche concept to exactly one label of the canonical list", () => {
    for (const c of NICHES_V2) expect(TAXONOMY, c.key).toContain(c.niche);
  });
});

describe("niche classification: bio first", () => {
  it("classifies from a clear bio without needing posts", () => {
    expect(niche({ bio: "Math lessons, exam preparation and study tips" })).toMatchObject({ status: "classified", main: "Education & How-to" });
    expect(niche({ bio: "Home cooking recipes and baking" })).toMatchObject({ status: "classified", main: "Food" });
    expect(niche({ bio: "Car repair tips and automobile reviews" })).toMatchObject({ status: "classified", main: "Automotive", confidence: "high" });
    expect(niche({ bio: "", category: "Musician/band" })).toMatchObject({ status: "classified", main: "Music" });
  });

  it("does not read a misleading channel name as the niche", () => {
    const d = niche({ name: "Marketing Mughal", bio: "Property tours, housing society plots and real estate updates" });
    expect(d).toMatchObject({ status: "classified", main: "Real Estate" });
    expect(d.niches).not.toContain("Business & Ecommerce");
    expect(niche({ name: "The Foodie Gamer", bio: "PUBG and Free Fire gameplay" }).main).toBe("Gaming");
    // A name alone is weak evidence: recorded, never stored.
    const nameOnly = niche({ name: "Lahore Food Diaries" });
    expect(nameOnly).toMatchObject({ status: "unknown", niches: [] });
    expect(nameOnly.observations).toEqual([expect.objectContaining({ value: "Food", source: "display_name", status: "weak" })]);
  });

  it("keeps a recipe channel's how-to titles as Food, and how-to on its own as Education & How-to", () => {
    expect(niche({ posts: rep(["How to make biryani", "How to cook nihari", "Chicken karahi recipe"]) }).main).toBe("Food");
    expect(niche({ posts: rep(["How to fix a leaking tap", "DIY wall shelf", "How to change a fuse"]) }).main).toBe("Education & How-to");
    expect(niche({ bio: "Excel aur computer seekhein Urdu mein", posts: rep(["Excel formulas", "VLOOKUP tutorial"]) }).main).toBe("Education & How-to");
  });

  it("lets recent posts overrule a bio they plainly contradict, and records the conflict", () => {
    const d = niche({ bio: "Fashion blogger", posts: rep(["Chicken karahi recipe", "Baking a cake", "Easy dinner recipe", "Biryani at home"]) });
    expect(d).toMatchObject({ status: "classified", main: "Food", confidence: "medium" });
    expect(d.observations).toContainEqual(expect.objectContaining({ value: "Fashion", source: "profile_text", status: "conflicting" }));
  });
});

describe("niche classification: recent posts when the bio is unclear", () => {
  it("finds the main niche and up to two secondary niches", () => {
    const d = niche({ bio: "Subscribe for more", posts: [...rep(["PSL final analysis", "Cricket highlights reaction"], 8), "Biryani review", "Street food tour", "Karahi night", "Vlog"] });
    expect(d).toMatchObject({ status: "classified", main: "Sports" });
    expect(d.niches).toEqual(["Sports", "Food"]);
  });

  it("calls a creator with several subjects and no dominant one Variety", () => {
    const d = niche({ posts: rep(["Cricket highlights", "New song cover", "Prank on brother", "PUBG stream", "Biryani recipe", "Breaking news today"]) });
    expect(d.status).toBe("variety");
    expect(d.main).toBeNull();
    expect(d.niches.length).toBeGreaterThanOrEqual(2);
  });

  it("returns Unknown when evidence is empty, vague or too thin", () => {
    expect(niche({ bio: "Subscribe for more", posts: rep(["Part 3", "New video", "Watch till end"]) })).toMatchObject({ status: "unknown", niches: [], confidence: null });
    expect(niche({ bio: "", posts: ["Vlog 1", "Vlog 2"] }).status).toBe("unknown");
    expect(niche({ bio: "" }).status).toBe("unknown");
  });

  it("handles Urdu and Roman Urdu content", () => {
    expect(niche({ bio: "اسلامی بیانات", posts: rep(["نعت شریف", "قرآن کی تلاوت"]) }).main).toBe("Religion");
    expect(niche({ bio: "Gaari aur bike reviews" }).main).toBe("Automotive");
    expect(niche({ posts: rep(["بریانی کی ترکیب", "نہاری کا کھانا", "کوکنگ ویڈیو"]) }).main).toBe("Food");
    expect(niche({ posts: rep(["Political analysis today", "Breaking news Pakistan", "Current affairs talk show"]) }).main).toBe("News & Commentary");
    expect(niche({ bio: "Mughal history and tareekh", posts: rep(["Mughal empire history", "Partition history"]) }).main).toBe("History");
  });
});

describe("niche classification: the AI's reading", () => {
  it("never stores the AI's unsupported Lifestyle fallback", () => {
    const d = niche({ bio: "Subscribe for more", ai: ["Lifestyle"] });
    expect(d.status).toBe("unknown");
    expect(d.observations).toContainEqual(expect.objectContaining({ value: "Lifestyle", source: "ai_assessment", status: "weak" }));
  });

  it("only breaks an exact tie between subjects the posts support", () => {
    const posts = rep(["PUBG rank push", "Biryani recipe"]);
    expect(niche({ posts, ai: ["Food"] })).toMatchObject({ status: "classified", main: "Food", niches: ["Food", "Gaming"], confidence: "low" });
    expect(niche({ posts, ai: ["Lifestyle"] })).toMatchObject({ status: "variety", main: null });
    expect(niche({ posts })).toMatchObject({ status: "variety" });
  });
});

describe("YouTube policy gate", () => {
  const yt = (bio: string, captions: string[]): StandardProfile => ({
    platform: "youtube", handle: "x", displayName: "Channel", bio, followers: 50_000, following: null, posts: 12, verified: false, websiteUrls: [], businessEmail: null, businessPhone: null, country: null, avatarUrl: null,
    recentPosts: captions.map((caption, i) => ({ postedAt: new Date(Date.now() - i * 86_400_000), likes: 1, comments: 1, views: 1, isVideo: true, isPinned: false, caption, hashtags: [] })),
  });

  it("reads only the channel description when video text is not permitted", () => {
    const p = yt("Subscribe for more", rep(["PUBG rank push", "Free Fire headshot tips"]));
    expect(deriveAttributes(p, null, { usePostText: true }).niche).toMatchObject({ status: "classified", main: "Gaming" });
    expect(deriveAttributes(p, null, { usePostText: false }).niche).toMatchObject({ status: "unknown" });
    expect(deriveAttributes(yt("PUBG gameplay every day", []), null, { usePostText: false }).niche.main).toBe("Gaming");
  });
});

describe("niche classification: long descriptions", () => {
  it("does not call a long description that names many subjects in passing Variety", () => {
    const long = `${"Welcome to our channel about life in our city. ".repeat(7)}We sometimes cover food, travel and cricket.`;
    expect(long.length).toBeGreaterThan(300);
    expect(niche({ bio: long })).toMatchObject({ status: "unknown", niches: [] });
    expect(niche({ bio: "Travel vlogs / fashion vlogs / food vlogs" })).toMatchObject({ status: "variety" });
  });
});

describe("niche classification: contact boilerplate", () => {
  it("does not read 'for business inquiries' as a business creator", () => {
    expect(niche({ bio: "Daily comedy skits. For business inquiries: email below" })).toMatchObject({ status: "classified", main: "Comedy", niches: ["Comedy"] });
    expect(niche({ bio: "Business email in the about section" }).status).toBe("unknown");
    expect(niche({ bio: "Small business tips for entrepreneurs" }).main).toBe("Business & Ecommerce");
  });
});
