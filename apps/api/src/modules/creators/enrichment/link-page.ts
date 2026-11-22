import { isUsableEmail } from "../email-check";
import { normPhone, whatsappNumber } from "./links";

/**
 * Contacts on the page a creator links from their bio (owner, 22 Nov, step 3): their own website, shop or link page
 * (Linktree and the like). Read from the page as published, nothing guessed:
 *   - emails: mailto links, addresses written in the page text, and Cloudflare-protected addresses (data-cfemail);
 *   - phones: tel links and WhatsApp click-to-chat links only (bare digits on a web page are too often order numbers,
 *     prices or a courier's line);
 *   - contact pages: links on the same site whose path reads as a contact or collaboration page, to read next.
 * Addresses of the page builder or its services (Linktree, Wix, Shopify, Sentry…) and placeholders are dropped.
 */
export type PageContacts = { emails: string[]; phones: string[]; contactPages: string[] };

const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}/gi;
/** Addresses that belong to the page builder, a widget or a template, not to the creator. */
const SERVICE_DOMAIN = /(?:^|\.)(?:linktr\.ee|linktree\.com|beacons\.ai|wix\.com|wixpress\.com|shopify\.com|squarespace\.com|sentry\.io|sentry-next\.wixpress\.com|godaddy\.com|wordpress\.com|wpengine\.com|cloudflare\.com|domain\.com|yourdomain\.com|yoursite\.com|mysite\.com|email\.com|company\.com|sitename\.com|taplink\.cc|campsite\.bio|hoo\.be|bio\.link|lnk\.bio|carrd\.co|stan\.store|mailchimp\.com|hubspot\.com|zendesk\.com)$/i;
/** Government and academic addresses: a link that ends on such a site (a short link, a news story) is not the creator. */
const INSTITUTION_DOMAIN = /\.(?:gov|go|gob|govt|mil|edu|ac)(?:\.[a-z]{2})?$|\.gov$|\.edu$/i;
const PLACEHOLDER_USER = /^(?:you|your|name|yourname|user|username|email|test|john\.?doe|jane\.?doe|someone|info@example)$/i;
const CONTACT_PATH = /\/(?:contact|contact-us|contactus|pages\/contact|about|about-us|collab|collaborate|work-with-me|business|enquir|inquir)[^/]*\/?$/i;

/** Cloudflare's email protection: the first byte is the key every following byte is XORed with. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const entities = (s: string) => s.replace(/&#64;|&#x40;|&commat;/gi, "@").replace(/&#46;|&#x2e;|&period;/gi, ".").replace(/&amp;/g, "&");

function keepEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0] ?? "";
  if (!isUsableEmail(e)) return null;
  const [user = "", domain = ""] = e.split("@");
  if (SERVICE_DOMAIN.test(domain) || INSTITUTION_DOMAIN.test(domain) || PLACEHOLDER_USER.test(user)) return null;
  return e;
}

export function contactsFromPage(html: string, pageUrl: string): PageContacts {
  const page = new URL(pageUrl);
  const emails = new Set<string>();
  const phones = new Set<string>();
  const contactPages = new Set<string>();
  // Script and style bodies hold library addresses and minified noise, never the creator's contact.
  const visible = entities(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " "));
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const e = keepEmail(decodeCfEmail(m[1] ?? "") ?? "");
    if (e) emails.add(e);
  }
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = entities(m[1] ?? "").trim();
    if (/^mailto:/i.test(href)) {
      for (const part of decode(href.slice(7)).split(/[,;]/)) {
        const e = keepEmail(part);
        if (e) emails.add(e);
      }
      continue;
    }
    if (/^tel:/i.test(href)) {
      const p = normPhone(decode(href.slice(4)));
      if (p) phones.add(p);
      continue;
    }
    const wa = whatsappNumber(href);
    if (wa) {
      phones.add(wa);
      continue;
    }
    let u: URL;
    try {
      u = new URL(href, page);
    } catch {
      continue;
    }
    if (/^https?:$/.test(u.protocol) && u.hostname === page.hostname && CONTACT_PATH.test(u.pathname) && u.pathname !== page.pathname) {
      contactPages.add(`${u.origin}${u.pathname}`);
    }
  }
  const text = visible.replace(/<[^>]+>/g, " ");
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = keepEmail(m);
    if (e) emails.add(e);
  }
  // A page listing many addresses is a directory or a shop's staff list, not one creator's contact: keep the first 3.
  return { emails: [...emails].slice(0, 3), phones: [...phones].slice(0, 3), contactPages: [...contactPages].slice(0, 3) };
}
