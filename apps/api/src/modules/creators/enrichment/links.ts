import { normalizeProfileUrl } from "../rules";
import type { StandardProfile } from "./standardize";

export type ExtractedContact = { kind: "email" | "phone"; value: string; trust: "likely" | "unverified"; source: "business_field" | "bio" };
export type ExtractedLink = { platform: "instagram" | "tiktok" | "youtube" | "website"; url: string; source: "bio" | "profile_link" };

const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}/gi;
// A phone number: optional +, then 10–13 digits with common separators; long plain numbers like follower counts have commas.
const PHONE_RE = /(?:\+|\b)\d(?:[\s().-]?\d){9,12}\b/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

const normPhone = (v: string): string | null => {
  const digits = v.replace(/[^\d+]/g, "");
  const n = digits.replace(/^\+/, "");
  if (n.length < 10 || n.length > 13) return null;
  // Pakistani mobile written locally (03xx…) becomes +92…
  if (/^03\d{9}$/.test(n)) return `+92${n.slice(1)}`;
  return digits.startsWith("+") ? digits : `+${n}`;
};

/** Business-contact fields are set by the account owner (likely); contacts typed in a bio are unverified (spec §5.6). */
export function extractContacts(p: StandardProfile): ExtractedContact[] {
  const out: ExtractedContact[] = [];
  const seen = new Set<string>();
  const add = (c: ExtractedContact) => {
    const key = `${c.kind}:${c.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  if (p.businessEmail) add({ kind: "email", value: p.businessEmail.toLowerCase(), trust: "likely", source: "business_field" });
  const bizPhone = p.businessPhone ? normPhone(p.businessPhone) : null;
  if (bizPhone) add({ kind: "phone", value: bizPhone, trust: "likely", source: "business_field" });
  for (const m of p.bio.match(EMAIL_RE) ?? []) add({ kind: "email", value: m.toLowerCase(), trust: "unverified", source: "bio" });
  for (const m of p.bio.match(PHONE_RE) ?? []) {
    const phone = normPhone(m);
    if (phone) add({ kind: "phone", value: phone, trust: "unverified", source: "bio" });
  }
  return out.slice(0, 6);
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
  return out.slice(0, 10);
}
