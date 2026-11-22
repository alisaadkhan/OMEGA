import { isUsableEmail } from "../email-check";
import { normalizeProfileUrl } from "../rules";
import type { StandardProfile } from "./standardize";

export type ExtractedContact = { kind: "email" | "phone"; value: string; trust: "likely" | "unverified"; source: ContactSource };
/** whatsapp_link: a wa.me / api.whatsapp.com link the creator set; linked_profile: the creator's own profile on another
 * platform, linked from this one; bio_link_page: the creator's own website or link page (owner, 22 Nov). */
export type ContactSource = "business_field" | "bio" | "video_description" | "post_caption" | "whatsapp_link" | "linked_profile" | "bio_link_page";
export type ExtractedLink = { platform: "instagram" | "tiktok" | "youtube" | "website"; url: string; source: "bio" | "profile_link" | "video_description" | "post_caption" };

const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}/gi;
// A phone number: optional +, then 10–13 digits with common separators; long plain numbers like follower counts have commas.
const PHONE_RE = /(?:\+|\b)\d(?:[\s().-]?\d){9,12}\b/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/** The number in a WhatsApp click-to-chat link (wa.me/923001234567, api.whatsapp.com/send?phone=…), or null. */
export function whatsappNumber(url: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:wa\.me\/\+?(\d{10,13})|(?:api|web)\.whatsapp\.com\/send\/?\?(?:[^#]*&)?phone=\+?(\d{10,13}))/i.exec(url.trim());
  const digits = m?.[1] ?? m?.[2];
  return digits ? normPhone(digits) : null;
}

const normPhone = (v: string): string | null => {
  const digits = v.replace(/[^\d+]/g, "");
  const n = digits.replace(/^\+/, "");
  if (n.length < 10 || n.length > 13) return null;
  // Pakistani mobile written locally (03xx…) becomes +92…
  if (/^03\d{9}$/.test(n)) return `+92${n.slice(1)}`;
  return digits.startsWith("+") ? digits : `+${n}`;
};

/**
 * Business-contact fields are set by the account owner (likely); contacts typed in a bio are unverified (spec §5.6).
 * `trust` records the source only: neither is evidence that the address works. Emails that are malformed, reserved or
 * file names ("logo@2x.png") are not contacts and are dropped; nothing is ever inferred from a handle or name.
 */
export function extractContacts(p: StandardProfile): ExtractedContact[] {
  const out: ExtractedContact[] = [];
  const seen = new Set<string>();
  const add = (c: ExtractedContact) => {
    const key = `${c.kind}:${c.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  if (p.businessEmail && isUsableEmail(p.businessEmail)) add({ kind: "email", value: p.businessEmail.toLowerCase(), trust: "likely", source: "business_field" });
  const bizPhone = p.businessPhone ? normPhone(p.businessPhone) : null;
  if (bizPhone) add({ kind: "phone", value: bizPhone, trust: "likely", source: "business_field" });
  // A WhatsApp link the creator set on the profile (bio link or a link in the bio) is their own business number.
  for (const u of [...p.websiteUrls, ...(p.bio.match(URL_RE) ?? [])]) {
    const wa = whatsappNumber(u);
    if (wa) add({ kind: "phone", value: wa, trust: "likely", source: "whatsapp_link" });
  }
  for (const m of (p.bio.match(EMAIL_RE) ?? []).filter(isUsableEmail)) add({ kind: "email", value: m.toLowerCase(), trust: "unverified", source: "bio" });
  for (const m of p.bio.match(PHONE_RE) ?? []) {
    const phone = normPhone(m);
    if (phone) add({ kind: "phone", value: phone, trust: "unverified", source: "bio" });
  }
  // Step B (owner unified plan 2026-11-14, Phase 4.1): no email and no phone in the bio/About, so the last 5 video
  // descriptions (YouTube) or captions are read. A sponsored post carries the brand's number ("order at 0300…"), so a
  // contact counts only when it recurs in 2+ of those posts or sits right after a business cue.
  if (out.length === 0) {
    const source = p.platform === "youtube" ? "video_description" : "post_caption";
    const texts = recentTexts(p);
    const found = new Map<string, { kind: "email" | "phone"; value: string; posts: Set<number>; cued: boolean }>();
    texts.forEach((t, i) => {
      const hits = [
        ...(t.match(EMAIL_RE) ?? []).filter(isUsableEmail).map((m) => ({ kind: "email" as const, raw: m, value: m.toLowerCase() })),
        ...(t.match(PHONE_RE) ?? []).map((m) => ({ kind: "phone" as const, raw: m, value: normPhone(m) })),
      ];
      for (const h of hits) {
        if (!h.value) continue;
        const at = t.indexOf(h.raw);
        const cued = BUSINESS_CUE.test(t.slice(Math.max(0, at - 60), at));
        const f = found.get(`${h.kind}:${h.value}`) ?? { kind: h.kind, value: h.value, posts: new Set<number>(), cued: false };
        f.posts.add(i);
        f.cued ||= cued;
        found.set(`${h.kind}:${h.value}`, f);
      }
    });
    for (const f of found.values()) if (f.posts.size >= 2 || f.cued) add({ kind: f.kind, value: f.value, trust: "unverified", source });
  }
  return out.slice(0, 6);
}

/** Text a contact may be cued by in a description: "for business", "inquiries", "collab", "email me", "contact". */
const BUSINESS_CUE = /(business|enquir|inquir|queries|collab|sponsor|promotion|bookings?|contact|e-?mail\s*(me|us)?|whatsapp|reach\s+(me|us)|work\s+with)[^.\n]{0,20}$/i;

/** The last 5 posts' text: YouTube descriptions (with titles), Instagram/TikTok captions. */
function recentTexts(p: StandardProfile): string[] {
  return p.recentPosts.slice(0, 5).map((x) => [x.caption, x.description ?? ""].join("\n"));
}

export function extractLinks(p: StandardProfile, ownCanonicalUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>([ownCanonicalUrl]);
  const add = (raw: string, source: ExtractedLink["source"]) => {
    const social = normalizeProfileUrl(raw);
    const url = social ? social.canonicalUrl : raw.replace(/\/$/, "");
    if (seen.has(url) || url.length > 300) return;
    seen.add(url);
    out.push({ platform: social ? social.platform : "website", url, source });
  };
  for (const u of p.websiteUrls) add(u, "profile_link");
  for (const u of p.bio.match(URL_RE) ?? []) add(u, "bio");
  // The creator's own social profiles linked under their videos: only social profiles that recur in 3+ of the last 5
  // (a collaborator's channel may appear once or twice; links feed identity and location evidence).
  const counts = new Map<string, number>();
  for (const t of recentTexts(p)) {
    for (const u of new Set((t.match(URL_RE) ?? []).map((x) => normalizeProfileUrl(x)?.canonicalUrl).filter((x): x is string => Boolean(x)))) counts.set(u, (counts.get(u) ?? 0) + 1);
  }
  for (const [u, n] of counts) if (n >= 3) add(u, p.platform === "youtube" ? "video_description" : "post_caption");
  return out.slice(0, 10);
}
