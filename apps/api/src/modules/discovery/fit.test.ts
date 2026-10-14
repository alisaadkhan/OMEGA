import { describe, expect, it } from "vitest";
import { liveSearchSchema } from "@mushin/contracts";
import type { StandardProfile } from "../creators/index";
import type { Kept } from "./live/relevance";
import { evaluateCampaignFit, individualSignal } from "./fit";

const now = new Date("2026-10-13T12:00:00.000Z");
const search = liveSearchSchema.parse({ text: "Bridal creators in Lahore Urdu", filters: { niches: ["bridal"], creatorCity: "Lahore" } });
const candidate: Kept = { platform: "instagram", handle: "sana", canonicalUrl: "https://www.instagram.com/sana", title: "Sana bridal makeup creator", snippet: "Lahore makeup artist", reason: "Bridal makeup posts" };
const profile = (over: Partial<StandardProfile> = {}): StandardProfile => ({
  platform: "instagram", handle: "sana", displayName: "Sana Bridal Creator", bio: "Lahore makeup artist", followers: 50_000, following: 800, posts: 500, verified: false,
  websiteUrls: [], businessEmail: null, businessPhone: null, country: null, avatarUrl: null,
  recentPosts: Array.from({ length: 12 }, (_, i) => ({
    postedAt: new Date(now.getTime() - i * 5 * 86_400_000), likes: 100, comments: 5, views: null, isVideo: false, isPinned: false,
    caption: "Bridal makeup look", hashtags: ["bridal"],
  })),
  ...over,
});

describe("Live Discovery Campaign Fit", () => {
  it("scores a qualifying individual from sampled topic, location, and activity evidence", () => {
    const result = evaluateCampaignFit(search, candidate, profile(), false, now);
    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.topicScore).toBe(1);
    expect(result.sampleSize).toBe(12);
    expect(result.sourceUrl).toBe(candidate.canonicalUrl);
    expect(result.fetchedAt).toBe(now.toISOString());
    expect(result.evidence.some((line) => line.includes("sampled public posts"))).toBe(true);
  });

  it("blocks off-topic profiles even when their location and individual cues match", () => {
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Daily gadget technology review", hashtags: ["technology"] }));
    const result = evaluateCampaignFit(search, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(false);
    expect(result.gate).toBe("off_topic");
    expect(result.score).toBe(0);
  });

  it("matches reviewed Roman Urdu niche terms and reports Roman Urdu caption evidence", () => {
    const romanSearch = liveSearchSchema.parse({ text: "Roman Urdu bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Aaj dulhan ka makeup look tayyar kiya", hashtags: ["shaadi", "dulhan"] }));
    const result = evaluateCampaignFit(romanSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(true);
    expect(result.topicScore).toBe(1);
    expect(result.evidence).toContain("100% of sampled captions contain roman urdu script/language signal (12 captions)");
  });

  it("matches Urdu-script topic evidence and records Urdu separately from English", () => {
    const urduSearch = liveSearchSchema.parse({ text: "Urdu bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "آج دلہن کا خوبصورت لباس تیار کیا", hashtags: ["شادی", "دلہن"] }));
    const result = evaluateCampaignFit(urduSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(true);
    expect(result.topicScore).toBe(1);
    expect(result.evidence).toContain("100% of sampled captions contain urdu script/language signal (12 captions)");
  });

  it("recognizes English captions without treating the word 'main' as Roman Urdu", () => {
    const englishSearch = liveSearchSchema.parse({ text: "English bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Bridal makeup looks on Main Street", hashtags: ["bridal"] }));
    const result = evaluateCampaignFit(englishSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.evidence).toContain("100% of sampled captions contain english script/language signal (12 captions)");

    const romanSearch = liveSearchSchema.parse({ text: "Roman Urdu bridal creators in Lahore", filters: { niches: ["bridal"] } });
    const romanResult = evaluateCampaignFit(romanSearch, candidate, profile({ recentPosts: posts }), false, now);
    expect(romanResult.evidence).toContain("0% of sampled captions contain roman urdu script/language signal (12 captions)");
  });

  it("accepts a first-person Roman Urdu creator cue as lexical individual evidence", () => {
    const romanCandidate = { ...candidate, title: "Sana Bridal", snippet: "Lahore" };
    const result = evaluateCampaignFit(search, romanCandidate, profile({ displayName: "Sana", bio: "Main Lahore ki makeup videos banati hun" }), false, now);
    expect(result.eligible).toBe(true);
    expect(result.evidence).toContain("Individual-creator lexical signal from public title/bio (Roman Urdu first-person creator cue)");
  });

  it("does not treat an unknown follower count as zero or satisfy an explicit size filter", () => {
    const sizedSearch = liveSearchSchema.parse({ text: "Bridal creators in Lahore", filters: { niches: ["bridal"], followersMin: 10_000 } });
    const result = evaluateCampaignFit(sizedSearch, candidate, profile({ followers: null }), false, now);
    expect(result.eligible).toBe(false);
    expect(result.gate).toBe("follower_count_unavailable");
    expect(result.evidence).toContain("Follower count unknown from the source profile");
  });

  it("fails closed when individual-creator evidence is absent or business cues dominate", () => {
    expect(evaluateCampaignFit(search, { ...candidate, title: "Sana", snippet: "Lahore" }, profile({ displayName: "Sana", bio: "Lahore" }), false, now).gate).toBe("individual_creator_unverified");
    expect(evaluateCampaignFit(search, candidate, profile(), true, now).gate).toBe("minor_or_unclear");
    expect(evaluateCampaignFit(search, { ...candidate, title: "Official bridal shop" }, profile({ displayName: "Hina Bridal Boutique", bio: "Order delivery wholesale bridal dresses" }), false, now).gate).toBe("business_or_non_creator");
    expect(evaluateCampaignFit(search, { ...candidate, title: "Bridal shop and makeup artist" }, profile({ displayName: "Sana", bio: "Bridal makeup artist" }), false, now).gate).toBe("individual_creator_unverified");
  });

  // Paraphrased from genuine creators the earlier either/or cue test rejected in the 2026-10-13 live evaluation.
  it("recognizes individual creators whose bios mention businesses only as subjects, mentions or collaborations", () => {
    const ok = (name: string, bio: string, title = name) => individualSignal({ name, title, bio }).value;
    expect(ok("Munir | Lahore Food Blogger", "Lahore Food Blogger | Restaurant Reviews | Hidden food gems | PR / Collabs → DM")).toBe(1);
    expect(ok("Asad", "Food creator. Founder @asadbrand and partner @kolachirestaurant")).toBe(1);
    expect(ok("Ducky", "Subscribe for random stuff. For business inquiries: mail me", "YouTuber Ducky")).toBe(1);
    expect(ok("Zain", "Hello, my name is Zain and this channel is about cars. I make car reviews")).toBe(1);
    expect(ok("Hamza", "Personal Trainer | Nutritionist | Home, online and gym coaching")).toBe(1);
    expect(ok("Hamnah | Solo Female Traveler", "I quit my 9-5 to travel the world. Vlogs and travel guides")).toBe(1);
    expect(ok("Tasha", "Fashion | Beauty | Lifestyle. DM for paid collaborations")).toBe(1);
    expect(ok("Rushill", "Gaming streamer and content creator building a growing community of players")).toBe(1);
    expect(ok("Saqib", "Buy caps from our partners. Business Queries and Promotion Email below")).toBe(1);
  });

  // Paraphrased from YouTube channels rejected as unverified in the 2026-10-13 evaluation.
  it("recognizes YouTube channels that describe their own videos, sponsorship contacts and Urdu-script first person", () => {
    const ok = (name: string, bio: string) => individualSignal({ name, title: name, bio }).value;
    expect(ok("MAS TECH", "Salam we are a Pakistani tech channel. We do tech reviews, unboxing and comparisons")).toBe(1);
    expect(ok("Gaming Fun Army", "Love you all my YouTube family. For sponsorships or paid promotion contact me")).toBe(1);
    expect(ok("AFC Food", "السلام علیکم میرا نام محمد ابرار احمد، یہاں آپ کو آسان کھانے ملیں گے")).toBe(1);
    expect(ok("Cooking with Ashfaq", "میرے یوٹیوب چینل سے ناظرین کو کھانے بنانے کی ویڈیوز ملیں گی")).toBe(1);
    // Businesses describing what they sell, and empty bios, stay out.
    expect(ok("Malwari Kitchen", "Paratha kabab, Faisal Town Lahore since 1990. We deliver across Lahore")).toBeNull();
    expect(ok("Digital World Tech Solutions", "Our platform offers tech services. We do video editing for companies")).toBe(0);
    expect(ok("Mubashir Saddique", "")).toBeNull();
  });

  it("uses the category the owner declared on the platform before bio wording", () => {
    const sig = (category: string | null, bio = "", name = "Sana", seller?: boolean) => individualSignal({ name, title: name, bio, category, ...(seller ? { seller } : {}) });
    expect(sig("Digital creator")).toMatchObject({ value: 1, cue: "platform category: Digital creator" });
    expect(sig("Food Critic", "Restaurant reviews")).toMatchObject({ value: 1 });
    expect(sig("Clothing (Brand)", "Fashion blogger vibes")).toMatchObject({ value: 0, cue: "platform category: Clothing (Brand)" });
    expect(sig("Travel agency")).toMatchObject({ value: 0 });
    // Ambiguous categories, a shop name or a seller account fall back to the existing rules.
    expect(sig("Photography Videography", "")).toMatchObject({ value: null });
    expect(sig("Digital creator", "", "Hina Bridal Boutique")).toMatchObject({ value: 0, cue: "business name" });
    expect(sig("Digital creator", "", "Sana", true)).toMatchObject({ value: 0, cue: "business cue" });
    expect(sig(null, "Food blogger")).toMatchObject({ value: 1, cue: "creator cue" });
  });

  // Paraphrased from TikTok profiles in the 2026-10-13 evaluation.
  it("recognizes TikTok self-promotion, and matches free-text briefs on any of their words, including plural/agent forms", () => {
    const ok = (name: string, bio: string) => individualSignal({ name, title: name, bio }).value;
    expect(ok("Muneezay", "Follow Me on YT")).toBe(1);
    expect(ok("Max", "FOLLOW for more hilarious comedy :) Tickets on sale for my world tour")).toBe(1);
    expect(ok("Mairi jan", "mara shock mare Marzi")).toBeNull();
    const bikes = liveSearchSchema.parse({ text: "motorcycles bike riders Pakistan", filters: { platform: "tiktok", creatorCountry: "PK" } });
    const riding = profile({ platform: "tiktok", bio: "biker from Karachi", recentPosts: profile().recentPosts.map((post) => ({ ...post, caption: "Sunday ride", hashtags: ["biker", "kawasakigto125pakistan"] })) });
    expect(evaluateCampaignFit(bikes, { ...candidate, platform: "tiktok" }, riding, false, now).topicScore).toBe(1);
    // A chosen niche still needs most of its words: "vintage watches" is not satisfied by "watches" alone (test below).
    // A role word is not a subject: "Pakistani gaming YouTuber" is not satisfied by videos about being a YouTuber.
    const gaming = liveSearchSchema.parse({ text: "Pakistani gaming YouTuber", filters: { platform: "youtube", creatorCountry: "PK" } });
    const coaching = profile({ platform: "youtube", recentPosts: profile().recentPosts.map((post) => ({ ...post, caption: "How every new YouTuber can grow a channel", hashtags: ["youtuber"] })) });
    expect(evaluateCampaignFit(gaming, { ...candidate, platform: "youtube" }, coaching, false, now).gate).toBe("off_topic");
  });

  it("treats a short subject word as the topic and review formats as generic", () => {
    const cars = liveSearchSchema.parse({ text: "car reviews Pakistan", filters: {} });
    const phones = profile().recentPosts.map((post) => ({ ...post, caption: "Tecno Pova review, price in Pakistan", hashtags: [] }));
    expect(evaluateCampaignFit(cars, candidate, profile({ recentPosts: phones }), false, now).gate).toBe("off_topic");
    const drives = profile().recentPosts.map((post) => ({ ...post, caption: "Honda Civic 2026 car review and test drive", hashtags: [] }));
    expect(evaluateCampaignFit(cars, candidate, profile({ recentPosts: drives }), false, now).topicScore).toBe(1);
  });

  it("keeps businesses and unclear accounts out of the individual-creator pool", () => {
    const ok = (name: string, bio: string) => individualSignal({ name, title: name, bio }).value;
    expect(ok("Safar Travel & Tours", "Explore Pakistan with us. Group tours and honeymoon trips")).toBe(0);
    expect(ok("Hina Bridal Boutique", "Bridals, formals, worldwide shipping")).toBe(0);
    expect(ok("Foodies Of Multan Community", "Food promoter, weekly giveaways")).toBe(0);
    expect(individualSignal({ name: "Sana", title: "Bridal shop and makeup artist", bio: "Bridal makeup artist" }).value).toBeNull();
    expect(ok("TBP", "Your Pakistan experience starts here.")).toBeNull();
  });

  it("excludes a profile whose platform-declared country differs from the requested one, but not an unknown country", () => {
    const pk = liveSearchSchema.parse({ text: "Bridal creators", filters: { niches: ["bridal"], creatorCountry: "PK" } });
    const elsewhere = evaluateCampaignFit(pk, candidate, profile({ country: "IN" }), false, now);
    expect(elsewhere.gate).toBe("location_mismatch");
    expect(elsewhere.evidence).toContain("Platform-declared country IN differs from requested PK");
    expect(evaluateCampaignFit(pk, candidate, profile({ country: null }), false, now).eligible).toBe(true);
  });

  it("lowers location evidence when the bio names a different city than the requested one", () => {
    const karachi = liveSearchSchema.parse({ text: "Bridal creators", filters: { niches: ["bridal"], creatorCity: "Karachi" } });
    const result = evaluateCampaignFit(karachi, candidate, profile({ bio: "Bridal makeup artist 📍 Lahore" }), false, now);
    expect(result.evidence).toContain("Profile names lahore, not the requested Karachi");
    // Regression: a matching country was reported as "Location signal matched … (Karachi)" although no city was named.
    const pkKarachi = liveSearchSchema.parse({ text: "Bridal creators", filters: { niches: ["bridal"], creatorCity: "Karachi", creatorCountry: "PK" } });
    const countryOnly = evaluateCampaignFit(pkKarachi, candidate, profile({ bio: "Bridal makeup artist", country: "PK" }), false, now);
    expect(countryOnly.evidence).toContain("Profile country matches (PK); Karachi is not named in the public profile");
    expect(countryOnly.evidence.join(" ")).not.toMatch(/matched public profile evidence/);
    const pk = liveSearchSchema.parse({ text: "Bridal creators", filters: { niches: ["bridal"], creatorCountry: "PK" } });
    expect(evaluateCampaignFit(pk, candidate, profile({ bio: "Bridal makeup artist", country: "PK" }), false, now).evidence).toContain("Profile country matches the requested PK");
    expect(evaluateCampaignFit(karachi, candidate, profile({ bio: "Bridal makeup artist 📍 Karachi" }), false, now).evidence).toContain("Profile names the requested location (Karachi)");
    expect(result.score).toBeLessThan(evaluateCampaignFit(karachi, candidate, profile({ bio: "Bridal makeup artist 📍 Karachi" }), false, now).score ?? 0);
  });

  it("gives a declared niche partial topic credit only when a sampled post also matches", () => {
    const posts = profile().recentPosts.map((post, i) => ({ ...post, caption: i === 0 ? "Bridal look of the week" : "Sunday with family", hashtags: [] }));
    const declared = evaluateCampaignFit(search, candidate, profile({ bio: "Lahore bridal makeup artist", recentPosts: posts }), false, now);
    expect(declared.topicScore).toBe(0.5);
    expect(declared.gate).not.toBe("off_topic");
    const none = posts.map((post) => ({ ...post, caption: "Sunday with family" }));
    expect(evaluateCampaignFit(search, candidate, profile({ bio: "Lahore bridal makeup artist", recentPosts: none }), false, now).gate).toBe("off_topic");
  });

  it("matches taxonomy niches through reviewed equivalents: phone reviews are Tech, gym posts are Wellness", () => {
    const tech = liveSearchSchema.parse({ text: "Phone reviewers", filters: { niches: ["Tech"] } });
    const phones = profile().recentPosts.map((post) => ({ ...post, caption: "Tecno Pova 7 price in Pakistan with review", hashtags: ["unboxing"] }));
    expect(evaluateCampaignFit(tech, candidate, profile({ bio: "Phone reviewer", recentPosts: phones }), false, now).topicScore).toBe(1);
    const wellness = liveSearchSchema.parse({ text: "Fitness coaches", filters: { niches: ["Wellness"] } });
    const gym = profile().recentPosts.map((post) => ({ ...post, caption: "Leg day at the gym, high protein meal after", hashtags: [] }));
    expect(evaluateCampaignFit(wellness, candidate, profile({ bio: "Personal trainer", recentPosts: gym }), false, now).topicScore).toBe(1);
  });

  it("requires enough of a multiword custom topic to appear in the sampled posts", () => {
    const custom = liveSearchSchema.parse({ text: "Vintage watch creator in Lahore", filters: { niches: ["vintage watches"] } });
    const posts = profile().recentPosts.map((post) => ({ ...post, caption: "Collecting watches from around the world", hashtags: ["watches"] }));
    const result = evaluateCampaignFit(custom, candidate, profile({ recentPosts: posts }), false, now);
    expect(result.eligible).toBe(false);
    expect(result.gate).toBe("off_topic");
  });

  it("gates profiles without recent public posts", () => {
    const recentPost = profile().recentPosts[0];
    if (!recentPost) throw new Error("test profile must include a post");
    const old = profile({ recentPosts: [{ ...recentPost, postedAt: new Date(now.getTime() - 91 * 86_400_000) }] });
    expect(evaluateCampaignFit(search, candidate, old, false, now).gate).toBe("inactive_or_unverified");
  });
});
