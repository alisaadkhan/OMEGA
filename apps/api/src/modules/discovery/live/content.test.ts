import { describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { contentGroup, isInstagramContent, mentionLeads, postsToResolve } from "./content";
import type { SearchGroup } from "./trail";

const search = (text: string, filters: Record<string, unknown> = {}) => ({ text, filters: searchFiltersSchema.parse(filters) });
const ig = (results: { link: string; title: string; snippet: string }[]): SearchGroup => ({ platform: "instagram", query: "site:instagram.com food karachi", round: 1, results });

// Paraphrased from post results recorded in the 2026-10-13 live evaluation.
const posts = ig([
  { link: "https://www.instagram.com/p/SHOP00001/", title: "2026 Bridal Collection", snippet: "Order now on WhatsApp, worldwide shipping" },
  { link: "https://www.instagram.com/reel/OFFTOPIC1/", title: "Sunday vibes", snippet: "Just a calm day at home" },
  { link: "https://www.instagram.com/reel/FOODPOST1/", title: "Bahar ka khana chhor do?", snippet: "My food cravings in Karachi, tag a foodie friend" },
  { link: "https://www.instagram.com/p/MEDIA0001/", title: "Meet Sana, Karachi's favourite food creator", snippet: "Sana is a food blogger known for street food" },
  { link: "https://www.instagram.com/reel/FOODPOST1/?igsh=x", title: "duplicate link", snippet: "food" },
  { link: "https://www.instagram.com/sana/", title: "Sana (@sana)", snippet: "Food creator" },
]);

describe("posts and reels as discovery evidence", () => {
  it("recognizes post and reel links, including ones under a handle", () => {
    expect(isInstagramContent("https://www.instagram.com/p/DaDb8TLjEAJ/")).toBe(true);
    expect(isInstagramContent("https://www.instagram.com/nothingjustsaba/reel/DcEVHuSoCM-/")).toBe(true);
    expect(isInstagramContent("https://www.instagram.com/sana/")).toBe(false);
  });

  it("resolves only posts in the creator's own voice, never shop or media posts, and respects the limit", () => {
    const s = search("food blogger", { niches: ["Food"], creatorCity: "Karachi" });
    const one = postsToResolve(s, [posts], 1);
    expect(one.business.map((c) => c.url)).toEqual(["https://www.instagram.com/p/SHOP00001/"]);
    expect(one.chosen.map((c) => c.url)).toEqual(["https://www.instagram.com/reel/FOODPOST1/"]);
    expect(one.overLimit).toEqual([]);
    expect(one.thirdPerson.map((c) => c.url)).toEqual(["https://www.instagram.com/reel/OFFTOPIC1/", "https://www.instagram.com/p/MEDIA0001/"]);
    expect(postsToResolve(s, [posts], 0).chosen).toEqual([]);
  });

  it("turns only creator-role mentions into leads, never plain brand tags", () => {
    const leads = mentionLeads([ig([
      { link: "https://www.instagram.com/reel/AWARD0001/", title: "Food content creator @sunias_kitchen has been honoured", snippet: "Dress by @ayraapparel_" },
      { link: "https://www.instagram.com/reel/TALK00001/", title: "The Ultimate Lahore Food Talk ft. @arsfoodie.", snippet: "" },
      { link: "https://www.instagram.com/p/MEET00001/", title: "Meet Asjad Ali", snippet: "@asjad_.ali is a finance educator and content creator" },
    ])]);
    expect(leads.map((l) => l.handle).sort()).toEqual(["arsfoodie", "asjad_.ali", "sunias_kitchen"]);
  });

  // From the 2026-10-13 replay: an email address became a "gmail.com" lead, and shop/bank posts tagged their partners.
  it("ignores email addresses, corporate-looking handles and mentions inside shop promotions", () => {
    const leads = mentionLeads([ig([
      { link: "https://www.instagram.com/p/EMAIL0001/", title: "Wedding photographer in Karachi", snippet: "Bookings: studio.creator@gmail.com" },
      { link: "https://www.instagram.com/p/BANK00001/", title: "Finance educator and creator @alfalahinvestments explains", snippet: "" },
      { link: "https://www.instagram.com/p/SHOP00002/", title: "Food blogger @realfoodie tries our new menu", snippet: "Order now on WhatsApp" },
    ])]);
    expect(leads).toEqual([]);
  });

  it("carries the post's own title and snippet forward as evidence for a recovered profile", () => {
    const [g] = contentGroup("post_author", [{ handle: "tanzil.zeeshan", from: { url: "https://www.instagram.com/reel/FOODPOST1/", result: { title: "T", link: "x", snippet: "S" }, query: "q", round: 2, position: 3 } }]);
    expect(g).toMatchObject({ platform: "instagram", query: "post_author: q", round: 2, results: [{ title: "T", link: "https://www.instagram.com/tanzil.zeeshan/", snippet: "S" }] });
  });
});
