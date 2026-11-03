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

  it("returns no routes for a bio without any", () => {
    expect(contactRoutes({ bios: ["Just vibes"], links: [], contactKinds: [], ownHandles: [] }).routes).toEqual([]);
  });
});
