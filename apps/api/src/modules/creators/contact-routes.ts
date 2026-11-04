/**
 * Structured contact routes (owner master directive 2026-11-03, Part 7.6). One "has contact" flag could not describe a
 * bio such as "For Business Queries: @haziqalikhan | For Other Queries: @subhan_ch06", so the profile showed both
 * "Direct contact" and "No contact info". Routes are read from the creator's own public bio and links: a handle after
 * a business cue is a business contact route, after an "other queries" cue a social contact route; link-in-bio and
 * websites are external contact links; the creator's other platform accounts are linked profiles. Emails and phone
 * numbers are never read from here (they are paid, revealed contacts); only whether MUSHIN holds one is reported.
 */
export type ContactRoute =
  | { kind: "business_contact"; handle: string; cue: string }
  | { kind: "social_contact"; handle: string; cue: string }
  | { kind: "external_link"; url: string }
  | { kind: "linked_profile"; platform: string; url: string }
  /** "DM for paid collab", "DM for PR", "For collaborations inbox": the creator's own words (execution directive 2026-11-04). */
  | { kind: "collab_route"; statement: string };

export type ContactRoutes = {
  email: "listed" | "not_listed";
  phone: "listed" | "not_listed";
  routes: ContactRoute[];
};

import { maskBioContacts } from "./rules";

const BUSINESS_CUE = /\b(business(?:\s+(?:queries|inquiries|enquiries|contact))?|collab(?:oration)?s?|pr(?:\s+(?:queries|inquiries))?|bookings?|managed\s+by|management|mgmt|manager|work(?:\s+(?:queries|inquiries))?|sponsorships?|brand\s+deals?|ads?)\b/i;
const OTHER_CUE = /\b(other\s+(?:queries|inquiries|enquiries)|personal|fan\s+(?:page|account)|dm|queries)\b/i;
// A handle starts a word: "@ali" or ": @ali", never the "@domain" of an email address (security review 2026-11-03).
const HANDLE = /(?:^|[\s:(,|])@([A-Za-z0-9._]{2,30})/g;
const COLLAB_TOPIC = String.raw`(?:paid\s+)?(?:collab(?:oration)?s?|pr|business|inquiries|enquiries|queries|promotions?|sponsorships?|brand\s+deals?|ads|bookings?)`;
// "DM for paid collab", "DM 📩 4 PR", "Inbox for business" / "For collabs DM", "Collab? DM me".
const COLLAB_DM = new RegExp(String.raw`\b(?:dm|inbox|message\s+(?:me|us))\b[^\n]{0,12}?\b(?:for|4)\b[^\n]{0,12}?\b${COLLAB_TOPIC}\b|\b(?:for\s+)?${COLLAB_TOPIC}\b[^\n]{0,12}?\b(?:dm|inbox|message\s+(?:me|us))\b`, "i");
const EXTERNAL_HOSTS = /(linktr\.ee|beacons\.ai|lnk\.bio|bio\.link|taplink|campsite\.bio|carrd\.co|msha\.ke|solo\.to|komi\.io)/i;

/** The bio split into segments at line breaks and separators, so each handle is read with its own cue. */
function segments(bio: string): string[] {
  return bio.split(/\n|\||•|·|\/\/|;/).map((s) => s.trim()).filter(Boolean);
}

export function contactRoutes(o: { bios: string[]; links: { platform: string; url: string }[]; contactKinds: string[]; ownHandles: string[] }): ContactRoutes {
  const own = new Set(o.ownHandles.map((h) => h.toLowerCase()));
  const routes: ContactRoute[] = [];
  const seen = new Set<string>();
  for (const bio of o.bios) {
    for (const seg of segments(bio)) {
      const handles = [...seg.matchAll(HANDLE)].map((m) => (m[1] as string).replace(/\.$/, ""));
      if (handles.length === 0) {
        const dm = COLLAB_DM.exec(seg);
        // Masked here too, whatever the caller passed: a statement never carries a paid contact (security review).
        const statement = dm ? maskBioContacts(seg).replace(/\s+/g, " ").slice(0, 80) : "";
        if (dm && !seen.has(`collab:${statement.toLowerCase()}`)) {
          seen.add(`collab:${statement.toLowerCase()}`);
          routes.push({ kind: "collab_route", statement });
        }
        continue;
      }
      const before = seg.slice(0, seg.search(/(?:^|[\s:(,|])@/));
      const business = BUSINESS_CUE.exec(before);
      const other = business ? null : OTHER_CUE.exec(before);
      if (!business && !other) continue;
      for (const h of handles) {
        const key = h.toLowerCase();
        if (own.has(key) || seen.has(key)) continue;
        seen.add(key);
        const cue = (business ?? other)?.[0] ?? "";
        routes.push(business ? { kind: "business_contact", handle: h, cue } : { kind: "social_contact", handle: h, cue });
      }
    }
  }
  for (const l of o.links) {
    const key = l.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (["instagram", "tiktok", "youtube", "facebook", "x", "twitter", "snapchat", "linkedin"].includes(l.platform)) routes.push({ kind: "linked_profile", platform: l.platform, url: l.url });
    else if (l.platform === "website" || EXTERNAL_HOSTS.test(l.url)) routes.push({ kind: "external_link", url: l.url });
  }
  return {
    email: o.contactKinds.includes("email") ? "listed" : "not_listed",
    phone: o.contactKinds.includes("phone") ? "listed" : "not_listed",
    routes,
  };
}
