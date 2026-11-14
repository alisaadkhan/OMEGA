import { describe, expect, it } from "vitest";
import { classifyAccountType } from "./account-type";

const c = (o: Partial<{ category: string | null; bio: string; handle: string; displayName: string }>) =>
  classifyAccountType({ category: o.category ?? null, bio: o.bio ?? "", handle: o.handle ?? "someone", displayName: o.displayName ?? "Someone" });

// Owner master directive 2026-11-03 (Part 5).
describe("account type", () => {
  it("keeps famous individual creators individual (safeguard)", () => {
    expect(c({ bio: "YouTuber | Gamer | For Business Queries: @haziqalikhan", handle: "duckybhai" }).type).toBe("INDIVIDUAL_CREATOR");
    expect(c({ category: "Public figure", bio: "Vlogger and podcaster" }).type).toBe("INDIVIDUAL_CREATOR");
    expect(c({ category: "Actor", bio: "Content creator, comedy reels" }).type).toBe("INDIVIDUAL_CREATOR");
    expect(c({ category: "Digital creator" })).toMatchObject({ type: "INDIVIDUAL_CREATOR", confidence: "high" });
  });

  it("separates companies, brands, shops, media and fan pages", () => {
    expect(c({ category: "Restaurant" }).type).toBe("BUSINESS_STORE");
    expect(c({ category: "Clothing (Brand)" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ category: "Magazine" }).type).toBe("MEDIA_PUBLICATION");
    expect(c({ category: "Marketing Agency" }).type).toBe("COMPANY_CORPORATE");
    expect(c({ bio: "Fan page of Sajal Aly. Not affiliated", handle: "sajal_fanpage" }).type).toBe("FAN_PAGE_AGGREGATOR");
    expect(c({ handle: "pakistani.memes", bio: "Daily laughs. Credits to owners" }).type).toBe("FAN_PAGE_AGGREGATOR");
    // From the bio's own wording when the platform gives no category (directive 2026-11-04).
    expect(c({ bio: "Pakistan's leading entertainment channel. Home to the nation's most loved dramas." }).type).toBe("MEDIA_PUBLICATION");
    expect(c({ bio: "Daily Mumtaz Digital is pioneer digital news platform of Pakistan." }).type).toBe("MEDIA_PUBLICATION");
    expect(c({ bio: "Korean & Japanese Beauty Store ✨ Shipping all over Pakistan 🚚 100% Original Products" }).type).toBe("BUSINESS_STORE");
    expect(c({ bio: "Kashee's Kingdom • Bridal | Glam | Makeovers • Beauty Parlour" }).type).toBe("BUSINESS_STORE");
    // A creator who mentions a shop stays a creator.
    expect(c({ bio: "Fashion blogger | Shop my looks | Lahore" }).type).toBe("INDIVIDUAL_CREATOR");
    expect(c({ bio: "Makeup artist, salon owner, Karachi" }).type).toBe("INDIVIDUAL_CREATOR");
  });

  // Owner unified plan 2026-11-14, Phase 5.
  it("excludes official game, brand and media accounts and storefront boilerplate, but never a creator using a brand's name", () => {
    expect(c({ handle: "pubgm_pk_official", displayName: "PUBG MOBILE Pakistan" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ handle: "samsungpakistan", displayName: "Samsung Pakistan" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ handle: "kfcpakistan", displayName: "KFC Pakistan" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ handle: "freefire_pk_official" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ bio: "Official account of Foodies Co. Order online, nationwide delivery" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ category: "Video game" }).type).toBe("BRAND_ACCOUNT");
    expect(c({ category: "Sports team" }).type).toBe("COMPANY_CORPORATE");
    // Creators keep their creator status even with a game or brand in the handle.
    expect(c({ handle: "pubg_pakistan_gamer", bio: "PUBG streamer and content creator" }).type).toBe("INDIVIDUAL_CREATOR");
    expect(c({ handle: "aryan.vlogs", bio: "Daily vlogs" }).type).toBe("INDIVIDUAL_CREATOR");
    expect(c({ handle: "applebeauty", bio: "Living the dream" }).type).toBe("UNKNOWN");
  });

  it("separates traditional celebrities from creators: an actor's bio is a public figure, a vlogging actor stays a creator", () => {
    expect(c({ bio: "TV actress | Drama serial Mere Paas Tum Ho" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ bio: "Politician, Member of the National Assembly" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ bio: "Cricketer. Pakistan national team" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ bio: "Actor and YouTuber, weekly vlogs" }).type).toBe("INDIVIDUAL_CREATOR");
  });

  it("marks traditional public figures, and leaves the rest unknown rather than assuming a creator", () => {
    expect(c({ category: "Actor", bio: "Managed by @mintcommpk" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ category: "Politician" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ bio: "Living the dream 🦋" })).toEqual({ type: "UNKNOWN", source: null, confidence: null, evidence: null });
    expect(c({ category: "Public figure", bio: "Grateful" }).type).toBe("UNKNOWN");
  });
});

describe("account type: self-audit 2026-11-14", () => {
  it("does not treat Instagram's 'Artist' category as a creator: actresses and actors choose it too", () => {
    expect(classifyAccountType({ category: "Artist", bio: "Official manager : @djmaq", handle: "sarahkhanofficial", displayName: "Sarah Khan" }).type).toBe("UNKNOWN");
    expect(classifyAccountType({ category: "Artist", bio: "Digital artist and illustrator, reels every week", handle: "x", displayName: "X" }).type).toBe("INDIVIDUAL_CREATOR");
  });
});
