import type { ContactAvailability, CreatorCard, InterpretResponse, SearchFilters } from "@mushin/contracts";
import { sha256Hex } from "@mushin/core";
import { CITY_CONCEPTS, cityForms } from "./aliases";

/** City filter values for an exact-match index: every alias form plus the canonical spelling. */
function cityFilterValues(value: string): string[] {
  const forms = cityForms(value);
  const concept = CITY_CONCEPTS.find((c) => c.forms.includes(forms[0] ?? ""));
  return concept ? [concept.canonical, ...forms] : forms;
}

export type Freshness = "current" | "aging" | "stale";
export type FreshnessThresholds = { currentDays: number; agingDays: number };
export type FitWeights = { text: number; filters: number; engagement: number; authenticity: number; freshness: number };
export type LabelThresholds = { best: number; strong: number; possible: number };
export type FitInput = {
  /** Meilisearch ranking score (0–1); null when the user typed no text. */
  textScore: number | null;
  followers: number | null;
  engagementRate: number | null;
  authenticityScore: number | null;
  followersFreshness: Freshness;
};

const DAY_MS = 86_400_000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** SRS REQ-01.06; thresholds from platform.search_settings (spec D10). */
export function freshnessOf(at: Date | null, now: Date, t: FreshnessThresholds): Freshness {
  if (!at) return "stale";
  const age = now.getTime() - at.getTime();
  if (age <= t.currentDays * DAY_MS) return "current";
  if (age <= t.agingDays * DAY_MS) return "aging";
  return "stale";
}

/** 1 at the centre of a requested follower range (or when no range was asked for), 0.5 at its edges; likewise engagement above its minimum. */
function filterCloseness(f: SearchFilters, followers: number | null, engagement: number | null): number {
  const parts: number[] = [];
  if (followers !== null && f.followersMin !== undefined && f.followersMax !== undefined && f.followersMax > f.followersMin) {
    const centre = (f.followersMin + f.followersMax) / 2;
    const half = (f.followersMax - f.followersMin) / 2;
    parts.push(0.5 + 0.5 * clamp01(1 - Math.abs(followers - centre) / half));
  }
  if (f.engagementMin !== undefined) {
    parts.push(0.5 + 0.5 * clamp01(((engagement ?? 0) - f.engagementMin) / Math.max(f.engagementMin, 1)));
  }
  return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
}

const FRESH_SCORE: Record<Freshness, number> = { current: 1, aging: 0.5, stale: 0 };

/** Deterministic fit score 0–100 (spec D2, §4.2). Authenticity counts as neutral (0.5) while not yet assessed. */
export function fitScore(c: FitInput, f: SearchFilters, w: FitWeights): number {
  const total = w.text + w.filters + w.engagement + w.authenticity + w.freshness;
  if (total <= 0) return 0;
  const weighted =
    w.text * (c.textScore === null ? 1 : clamp01(c.textScore)) +
    w.filters * filterCloseness(f, c.followers, c.engagementRate) +
    w.engagement * clamp01((c.engagementRate ?? 0) / 10) +
    w.authenticity * (c.authenticityScore === null ? 0.5 : clamp01(c.authenticityScore / 100)) +
    w.freshness * FRESH_SCORE[c.followersFreshness];
  return Math.round((100 * weighted) / total);
}

export function fitLabel(score: number, t: LabelThresholds): CreatorCard["fitLabel"] {
  if (score >= t.best) return "Best match";
  if (score >= t.strong) return "Strong match";
  if (score >= t.possible) return "Possible match";
  return "Needs review";
}

/** Meilisearch filter expressions (ANDed). Strings are JSON-quoted, which is Meilisearch's escaping too. */
export function meiliFilter(f: SearchFilters, now: Date, freshCurrentDays: number): string[] {
  const q = (v: string) => JSON.stringify(v);
  // Creator eligibility (elig-1) first: only eligible creators whose evidence still holds; documents without the field
  // (built before the policy) never match, so a stale index fails closed.
  const out: string[] = ["eligible = true", `eligible_until > ${Math.floor(now.getTime() / 1000)}`];
  // Only platforms where the creator qualifies (elig-1 is per profile; counts are never added across platforms).
  if (f.platform) out.push(`qualifying_platforms = ${q(f.platform)}`);
  if (f.creatorCountry) out.push(`country = ${q(f.creatorCountry)}`);
  // Any reviewed alias of the city (lhr → Lahore); the stored value and canonical spelling are included as written.
  if (f.creatorCity) out.push(`city IN [${[...new Set([f.creatorCity, ...cityFilterValues(f.creatorCity)])].map(q).join(", ")}]`);
  if (f.audienceCountry) out.push(`audience_countries = ${q(f.audienceCountry)}`);
  if (f.followersMin !== undefined) out.push(`followers >= ${f.followersMin}`);
  if (f.followersMax !== undefined) out.push(`followers <= ${f.followersMax}`);
  if (f.engagementMin !== undefined) out.push(`engagement_rate >= ${f.engagementMin}`);
  if (f.engagementMax !== undefined) out.push(`engagement_rate <= ${f.engagementMax}`);
  if (f.niches.length > 0) out.push(`niches IN [${f.niches.map(q).join(", ")}]`);
  if (f.verifiedOnly) out.push("verified = true");
  if (f.minAuthenticity !== undefined) out.push(`authenticity_score >= ${f.minAuthenticity}`);
  if (f.hasContact) out.push("has_contact = true");
  if (f.freshOnly) out.push(`followers_updated_epoch >= ${Math.floor(now.getTime() / 1000) - freshCurrentDays * 86_400}`);
  return out;
}

export type RawInterpretation = {
  platform?: string | null;
  creatorCountry?: string | null;
  creatorCity?: string | null;
  audienceCountry?: string | null;
  followersMin?: number | null;
  followersMax?: number | null;
  engagementMin?: number | null;
  engagementMax?: number | null;
  niches?: string[] | null;
  verifiedOnly?: boolean | null;
  keywords?: string[] | null;
};

const PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

// Codes the region list names that are not countries (reserved or grouping codes).
const NOT_COUNTRIES = new Set(["ZZ", "EU", "EZ", "UN", "QO", "XA", "XB"]);

function isoCountry(v: string | null | undefined): string | undefined {
  const raw = v?.trim().toUpperCase();
  // "UK" is the common legacy spelling; the ISO code is GB.
  const code = raw === "UK" ? "GB" : raw;
  if (!code || !/^[A-Z]{2}$/.test(code) || NOT_COUNTRIES.has(code)) return undefined;
  return regionNames.of(code) ? code : undefined;
}

/** A real ISO 3166-1 alpha-2 code (upper-cased, legacy UK → GB) or undefined. */
export const isoCountryCode = isoCountry;

function range(min: number | null | undefined, max: number | null | undefined, lo: number, hi: number, integer: boolean) {
  const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  const fix = (n: number) => (integer ? Math.round(n) : Math.round(n * 100) / 100);
  const a = ok(min) ? fix(min) : undefined;
  const b = ok(max) ? fix(max) : undefined;
  if (a !== undefined && b !== undefined && a > b) return { min: undefined, max: undefined };
  return { min: a, max: b };
}

/** AI output is a suggestion: anything not provably valid is dropped, never invented (SRS REQ-03.06; spec §6). */
export function cleanInterpretation(raw: RawInterpretation, nicheLabels: readonly string[]): InterpretResponse {
  const chips: InterpretResponse["chips"] = { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false };
  const platform = raw.platform?.trim().toLowerCase();
  if (platform && (PLATFORMS as readonly string[]).includes(platform)) chips.platform = platform as (typeof PLATFORMS)[number];
  const creatorCountry = isoCountry(raw.creatorCountry);
  if (creatorCountry) chips.creatorCountry = creatorCountry;
  const audienceCountry = isoCountry(raw.audienceCountry);
  if (audienceCountry) chips.audienceCountry = audienceCountry;
  const city = raw.creatorCity?.trim();
  if (city && city.length <= 60) chips.creatorCity = city;
  const followers = range(raw.followersMin, raw.followersMax, 0, 500_000_000, true);
  if (followers.min !== undefined) chips.followersMin = followers.min;
  if (followers.max !== undefined) chips.followersMax = followers.max;
  const engagement = range(raw.engagementMin, raw.engagementMax, 0, 100, false);
  if (engagement.min !== undefined) chips.engagementMin = engagement.min;
  if (engagement.max !== undefined) chips.engagementMax = engagement.max;
  const byLower = new Map(nicheLabels.map((l) => [l.toLowerCase(), l]));
  chips.niches = [...new Set((raw.niches ?? []).map((n) => byLower.get(n.trim().toLowerCase())).filter((n): n is string => Boolean(n)))].slice(0, 10);
  if (raw.verifiedOnly === true) chips.verifiedOnly = true;
  const keywords = [...new Set((raw.keywords ?? []).map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 40))].slice(0, 8);
  return { chips, keywords };
}

// Any host-like word (name.tld, link shorteners), 9+ digits however they are separated, and "name at gmail dot com".
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}(?:\/|\b))/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /\+?\(?\d(?:[\s().-]{0,2}\d){8,}/;
const SPELLED_EMAIL_RE = /\b[a-z0-9._-]+\s*(?:\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(?:\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}\b/i;
const CONTACT_PATTERNS = [EMAIL_RE, SPELLED_EMAIL_RE, URL_RE, PHONE_RE];

/** Removes contact details and links from scraped text before it is sent to the AI (defence in depth, SRS §5.2). */
export function redactContacts(text: string): string {
  return CONTACT_PATTERNS.reduce((t, re) => t.replace(new RegExp(re.source, "gi"), "[contact removed]"), text);
}

/** Summaries carry public facts only: no links, emails or phone numbers; at most 600 characters (spec §6). */
/** True when the text holds a link, an email, a phone number or a spelled-out email (any length). */
export function hasContactOrLink(text: string): boolean {
  return CONTACT_PATTERNS.some((re) => re.test(text));
}

export function isSafeSummary(text: string): boolean {
  const t = text.trim();
  return t.length >= 20 && t.length <= 600 && !CONTACT_PATTERNS.some((re) => re.test(t));
}

/** Wraps scraped text as data; angle brackets are replaced so the text cannot close or open a block (SRS §5.3). */
export function fenced(tag: string, text: string): string {
  const safe = text.replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›"));
  return `<${tag}>\n${safe}\n</${tag}>`;
}

/**
 * One honest contact state for cards and profiles, from the kinds and statuses of the stored contacts only (no values,
 * so it reveals nothing). A working-looking email wins over a phone; "invalid" is shown only when every email was shown
 * not to work and there is no phone; a public address is never treated as verified.
 */
export function contactAvailability(contacts: readonly { kind: "email" | "phone"; status: string }[]): ContactAvailability {
  const emails = contacts.filter((k) => k.kind === "email");
  if (emails.some((k) => k.status === "verified")) return "email_verified";
  if (emails.some((k) => k.status !== "invalid")) return "email_unverified";
  if (contacts.some((k) => k.kind === "phone" && k.status !== "invalid")) return "phone_unverified";
  return emails.length > 0 ? "email_invalid" : "none";
}
export const isContactable = (a: ContactAvailability): boolean => a !== "none" && a !== "email_invalid";

export function maskContact(kind: "email" | "phone", value: string): string {
  if (kind === "email") {
    const [user = "", domain = ""] = value.split("@");
    const dot = domain.lastIndexOf(".");
    if (!user || dot <= 0) return "•••";
    return `${user[0]}***@${domain[0]}***${domain.slice(dot)}`;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 3)}${"•".repeat(digits.length - 5)}${digits.slice(-2)}`;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The public data a summary is written from; its hash tells when a summary is out of date. */
export type SummarySource = {
  displayName: string;
  niches: string[];
  tags: string[];
  city: string | null;
  country: string | null;
  verdict: string | null;
  evidence: { signal: string; detail: string }[];
  profiles: {
    platform: string;
    followers: number | null;
    engagementRate: number | null;
    posts: number | null;
    avgLikes: number | null;
    avgComments: number | null;
    avgViews: number | null;
    bio: string | null;
  }[];
};

export function sourceHash(s: SummarySource): string {
  return sha256Hex(
    JSON.stringify([
      s.displayName,
      [...s.niches].sort(),
      [...s.tags].sort(),
      s.city,
      s.country,
      s.verdict,
      s.evidence.map((e) => [e.signal, e.detail]),
      [...s.profiles]
        .sort((a, b) => a.platform.localeCompare(b.platform))
        .map((p) => [p.platform, p.followers, p.engagementRate, p.posts, p.avgLikes, p.avgComments, p.avgViews, p.bio]),
    ]),
  );
}

export type CreatorPlatform = (typeof PLATFORMS)[number];

/** Instagram paths that are posts or app pages, not profiles. */
const INSTAGRAM_PAGES = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "legal", "developer", "web", "challenge", "emails", "session", "privacy", "popular", "locations", "share", "s"]);

/** Canonical profile URL as stored in gcp.creator_profiles.canonical_url, or null when it is not a supported profile URL. */
export function normalizeProfileUrl(input: string): { platform: CreatorPlatform; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const first = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  if (!first) return null;
  if (host === "instagram.com" && /^[a-z0-9._]{1,30}$/.test(first) && !INSTAGRAM_PAGES.has(first)) return { platform: "instagram", canonicalUrl: `https://instagram.com/${first}` };
  if (host === "tiktok.com" && /^@[a-z0-9._]{1,30}$/.test(first)) return { platform: "tiktok", canonicalUrl: `https://tiktok.com/${first}` };
  if (host === "youtube.com" && /^@[a-z0-9._-]{1,100}$/.test(first)) return { platform: "youtube", canonicalUrl: `https://youtube.com/${first}` };
  return null;
}

/** SRS §5.5: only MUSHIN staff can lift the possible-minor protection. */
export function isMinorProtected(c: { isMinor: boolean; minorOverrideByStaffId: string | null }): boolean {
  return c.isMinor && c.minorOverrideByStaffId === null;
}

/** TikTok is billed per video by Apify, so adding or refreshing it has its own price (spec D4). */
export function refreshActionFor(platform: CreatorPlatform): "refresh_data" | "refresh_tiktok" {
  return platform === "tiktok" ? "refresh_tiktok" : "refresh_data";
}
