import { CITIES_V2, normalizeTerms } from "../terminology";
import type { Assessment } from "./assessment";
import { deriveCountry, type CountryConfidence } from "./country-evidence";
import { classifyNiche, mentions, MAX_POSTS_FOR_NICHE, type NicheConfidence, type NicheDecision, type NicheStatus } from "./niche-evidence";
import { quote } from "./quote";
import type { SemanticInput } from "./semantic-niche";
import type { StandardProfile } from "./standardize";

/**
 * Evidence-based creator attributes. A value is stored on the creator only when evidence supports it; every observation
 * (supported, weak or conflicting) is kept with its source:
 *   - niche: niche-evidence.ts (bio first, then recent posts; main, up to two secondary, variety or unknown).
 *   - country: country-evidence.ts (platform-declared, creator-stated and creator-confirmed kept apart; any country).
 *     Country never depends on city.
 *   - city: a full city name in the creator's own name/bio (not a hashtag, not an abbreviation such as ISB), or in at
 *     least half of the recent posts (min. 3) with no other city in two posts. Hyderabad needs a Pakistan cue. Two
 *     different supported cities are "conflicting" and none is stored. City is kept for a later release; search does
 *     not offer it as a filter for now.
 *   - language: content language from the recent posts' script (Urdu script, Roman Urdu, English); evidence only.
 * `usePostText: false` reads the profile only (YouTube video text stays out until the policy decision allows it).
 */
export type AttributeName = "city" | "country" | "niche" | "language";
export type EvidenceSource = "profile_text" | "post_text" | "platform_registration" | "ai_assessment" | "display_name" | "account_category";
export type EvidenceStatus = "supported" | "weak" | "conflicting";
export type EvidenceRow = { attribute: AttributeName; value: string; source: EvidenceSource; status: EvidenceStatus; evidence: string };
export type AttributeDecision = {
  city: string | null;
  /** The resolved country without a creator confirmation (stated, else platform-declared); placement adds confirmation. */
  country: string | null;
  niches: string[];
  languages: string[];
  evidence: EvidenceRow[];
  /** `clear`: no semantic reading needed. `semanticInput`: the permitted text a semantic reading may use (not stored). */
  niche: { status: NicheStatus; main: string | null; confidence: NicheConfidence | null; clear: boolean; semanticInput: SemanticInput };
  countries: { platform: string | null; stated: string | null; statedConfidence: CountryConfidence | null };
};
export type DeriveOptions = { usePostText?: boolean };

const POSTS_FOR_SUPPORT = 2;
// A city named in a long bio needs a location cue ("based in Lahore", "📍 Karachi"); "Islamia University, Bahawalpur" is not one.
const SHORT_BIO = 160;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const locatedCue = (form: string) =>
  /[؀-ۿ]/u.test(form)
    ? new RegExp(`${escapeRe(form)}\\s*(?:سے|میں|شہر)`, "u")
    : new RegExp(`(?:\\b(?:in|from|based|city|lives|living|located)\\b|📍|📌)[\\s,:|-]*(?:in\\s+)?${escapeRe(form)}\\b`, "iu");
const PK_CUE = /\b(?:pakistan|pakistani|sindh)\b|پاکستان|سندھ|🇵🇰/iu;
const AMBIGUOUS_CITY = new Set(["hyderabad"]);
const cityForms = (forms: readonly string[]) => forms.filter((f) => /[؀-ۿ]/u.test(f) || f.length >= 5);
const stripHashtags = (t: string) => t.replace(/#[\p{L}\p{N}_]+/gu, " ");
const ROMAN_URDU = new Set("main mein mera meri mujhe hum aap tum hai hain tha thi hoon hun karta karti karte kya kiya ka ki ke ko se nahi nahin aur bhi".split(" "));
const CITY_NAMES: Record<string, string> = Object.fromEntries(CITIES_V2.map((c) => [c.key, c.key.charAt(0).toUpperCase() + c.key.slice(1)]));


export function deriveAttributes(p: StandardProfile, a: Assessment | null, o: DeriveOptions = {}): AttributeDecision {
  const bio = stripHashtags(p.bio);
  const ownRaw = stripHashtags([p.displayName, p.bio, p.accountCategory ?? ""].join(" \n "));
  const own = normalizeTerms(ownRaw);
  const recent = o.usePostText === false ? [] : p.recentPosts.slice(0, Math.max(MAX_POSTS_FOR_NICHE, 30));
  const posts = recent.map((x) => ({ raw: `${x.caption} ${x.hashtags.join(" ")}`, norm: normalizeTerms(`${x.caption} ${x.hashtags.join(" ")}`) }));
  const evidence: EvidenceRow[] = [];
  const shortBio = bio.trim().length <= SHORT_BIO;

  // City.
  const supportedCities: { key: string; row: EvidenceRow }[] = [];
  const postCityHits = CITIES_V2.map((c) => ({ c, hits: posts.filter((x) => cityForms(c.forms).some((f) => mentions(x.norm, f))) }));
  const citiesInPosts = postCityHits.filter((x) => x.hits.length >= POSTS_FOR_SUPPORT).length;
  for (const { c, hits } of postCityHits) {
    const value = CITY_NAMES[c.key] ?? c.key;
    const ownForm = cityForms(c.forms).find((f) => mentions(own, f));
    const ambiguous = AMBIGUOUS_CITY.has(c.key) && !PK_CUE.test(ownRaw);
    const postNote = `${hits.length} of ${posts.length} recent posts mention it, e.g. "${quote(hits[0]?.raw ?? "", c.forms[0] ?? "")}"`;
    const located = ownForm !== undefined && (mentions(normalizeTerms(p.displayName), ownForm) || shortBio || locatedCue(ownForm).test(ownRaw));
    if (ownForm && !located) evidence.push({ attribute: "city", value, source: "profile_text", status: "weak", evidence: `Named in a long bio without a location cue: ${quote(ownRaw, ownForm)}` });
    else if (ownForm && ambiguous) evidence.push({ attribute: "city", value, source: "profile_text", status: "weak", evidence: `Ambiguous without a Pakistan cue (also a city in India): ${quote(ownRaw, ownForm)}` });
    else if (ownForm) supportedCities.push({ key: c.key, row: { attribute: "city", value, source: "profile_text", status: "supported", evidence: quote(ownRaw, ownForm) } });
    else if (hits.length >= Math.max(3, posts.length / 2) && citiesInPosts === 1 && !ambiguous) supportedCities.push({ key: c.key, row: { attribute: "city", value, source: "post_text", status: "supported", evidence: postNote } });
    else if (hits.length >= POSTS_FOR_SUPPORT) evidence.push({ attribute: "city", value, source: "post_text", status: "weak", evidence: `Mentioned in posts, not enough to show the creator is based there: ${postNote}` });
  }
  let city: string | null = null;
  if (supportedCities.length === 1) {
    city = supportedCities[0]?.row.value ?? null;
    evidence.push(...supportedCities.map((s) => s.row));
  } else if (supportedCities.length > 1) {
    evidence.push(...supportedCities.map((s) => ({ ...s.row, status: "conflicting" as const })));
  }
  if (a?.creatorCity) {
    const corroborated = city !== null && normalizeTerms(city) === normalizeTerms(a.creatorCity);
    if (!corroborated) evidence.push({ attribute: "city", value: a.creatorCity, source: "ai_assessment", status: supportedCities.length > 1 ? "conflicting" : "weak", evidence: "Read by the AI assessment; not shown in the creator's own text" });
  }

  // Country: the bio and the platform's declaration only (never the name, a city, a title or the language).
  const c = deriveCountry(bio, p.country);
  evidence.push(...c.observations.map((r) => ({ attribute: "country" as const, ...r })));
  const country = c.stated ?? c.platform;
  if (a?.creatorCountry && a.creatorCountry !== country) evidence.push({ attribute: "country", value: a.creatorCountry, source: "ai_assessment", status: "weak", evidence: "Read by the AI assessment; not stated by the creator or the platform" });

  // Niche.
  const nicheInput = { displayName: p.displayName, bio, accountCategory: p.accountCategory ?? null, posts: posts.slice(0, MAX_POSTS_FOR_NICHE).map((x) => x.raw) };
  const n = classifyNiche({ ...nicheInput, aiNiches: a?.niches ?? [] });
  evidence.push(...n.observations.map((r) => ({ attribute: "niche" as const, ...r })));

  // Content language of recent posts (evidence only).
  const languages: string[] = [];
  if (posts.length >= 3) {
    const share = (pred: (t: string) => boolean) => posts.filter((x) => pred(x.raw)).length / posts.length;
    const urdu = share((t) => /[؀-ۿ]{3,}/u.test(t));
    const roman = share((t) => normalizeTerms(t).split(" ").filter((w) => ROMAN_URDU.has(w)).length >= 3);
    const english = share((t) => /\b(?:the|and|this|with|for|you|my|is|are|of)\b/i.test(t));
    for (const [lang, s] of [["urdu", urdu], ["roman urdu", roman], ["english", english]] as const) {
      if (s >= 0.3) {
        languages.push(lang);
        evidence.push({ attribute: "language", value: lang, source: "post_text", status: "supported", evidence: `${Math.round(s * 100)}% of ${posts.length} recent posts` });
      }
    }
  }
  return {
    city,
    country,
    niches: n.niches,
    languages,
    evidence,
    niche: { status: n.status, main: n.main, confidence: n.confidence, clear: n.clear ?? false, semanticInput: nicheInput },
    countries: { platform: c.platform, stated: c.stated, statedConfidence: c.statedConfidence },
  };
}

/**
 * Replaces the rules' first reading of the niche with a semantic one. The rules' observations stay, marked weak, so a
 * reviewer can see what the keywords suggested and why it was not used.
 */
export function withSemanticNiche(d: AttributeDecision, sem: NicheDecision): AttributeDecision {
  const ruleRows = d.evidence.filter((r) => r.attribute === "niche").map((r) => ({ ...r, status: "weak" as const, evidence: `Keyword reading, not used: ${r.evidence}`.slice(0, 300) }));
  return {
    ...d,
    niches: sem.niches,
    niche: { ...d.niche, status: sem.status, main: sem.main, confidence: sem.confidence, clear: false },
    evidence: [...d.evidence.filter((r) => r.attribute !== "niche"), ...sem.observations.map((r) => ({ attribute: "niche" as const, ...r })), ...ruleRows],
  };
}
