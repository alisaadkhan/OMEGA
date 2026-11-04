import { describe, expect, it } from "vitest";
import { contactRoutes } from "./contact-routes";

// Owner master directive 2026-11-03 (Part 7.6): the duckybhai bio showed "Direct contact" and "No contact info" at once.
describe("contact routes", () => {
  it("reads business and other-enquiry handles with their cues, and links, without inventing an email or phone", () => {
    const r = contactRoutes({
      bios: ["YouTuber | Gamer | For Business Queries: @haziqalikhan | For Other Queries: @subhan_ch06"],
      links: [{ platform: "youtube", url: "https://youtube.com/@duckybhai" }],
      contactKinds: [],
      ownHandles: ["duckybhai"],
    });
    expect(r.email).toBe("not_listed");
    expect(r.phone).toBe("not_listed");
    expect(r.routes).toEqual([
      { kind: "business_contact", handle: "haziqalikhan", cue: "Business Queries" },
      { kind: "social_contact", handle: "subhan_ch06", cue: "Other Queries" },
      { kind: "linked_profile", platform: "youtube", url: "https://youtube.com/@duckybhai" },
    ]);
  });

  it("recognises management cues and link-in-bio pages; ignores handles with no contact cue and the creator's own handle", () => {
    const r = contactRoutes({
      bios: ["Food reviews in Lahore\nManaged by @mintcommpk\nShot with @canonpk\nMe: @ali.eats", "Collab: @ali.eats"],
      links: [{ platform: "website", url: "https://linktr.ee/alieats" }],
      contactKinds: ["email"],
      ownHandles: ["ali.eats"],
    });
    expect(r.email).toBe("listed");
    expect(r.routes).toEqual([
      { kind: "business_contact", handle: "mintcommpk", cue: "Managed by" },
      { kind: "external_link", url: "https://linktr.ee/alieats" },
    ]);
  });

  it("keeps a creator's own 'DM for paid collab' statement as a collab route (execution directive 2026-11-04)", () => {
    const routes = (bio: string) => contactRoutes({ bios: [bio], links: [], contactKinds: [], ownHandles: [] }).routes;
    expect(routes("Lahore food blogger\nDM for paid collab 📩")).toEqual([{ kind: "collab_route", statement: "DM for paid collab 📩" }]);
    expect(routes("DM 4 PR")).toEqual([{ kind: "collab_route", statement: "DM 4 PR" }]);
    expect(routes("For collaborations inbox")).toEqual([{ kind: "collab_route", statement: "For collaborations inbox" }]);
    expect(routes("Inbox for business inquiries | Karachi")).toEqual([{ kind: "collab_route", statement: "Inbox for business inquiries" }]);
    expect(routes("I love my DMs being full of memes")).toEqual([]);
  });

  it("returns no routes for a bio without any", () => {
    expect(contactRoutes({ bios: ["Just vibes"], links: [], contactKinds: [], ownHandles: [] }).routes).toEqual([]);
  });

  // Security review 2026-11-03: an email is a paid contact; its "@domain" is never read as a handle.
  it("never reads an email address as a handle", () => {
    const r = contactRoutes({ bios: ["Business: sana.bridal@gmail.com"], links: [], contactKinds: [], ownHandles: [] });
    expect(r.routes).toEqual([]);
  });
});
