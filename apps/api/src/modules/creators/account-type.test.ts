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
  });

  it("marks traditional public figures, and leaves the rest unknown rather than assuming a creator", () => {
    expect(c({ category: "Actor", bio: "Managed by @mintcommpk" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ category: "Politician" }).type).toBe("CELEBRITY_PUBLIC_FIGURE");
    expect(c({ bio: "Living the dream 🦋" })).toEqual({ type: "UNKNOWN", source: null, confidence: null, evidence: null });
    expect(c({ category: "Public figure", bio: "Grateful" }).type).toBe("UNKNOWN");
  });
});
