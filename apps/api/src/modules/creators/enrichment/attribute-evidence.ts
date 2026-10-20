import { CITIES_V2, NICHES_V2, normalizeTerms } from "../terminology";
import type { Assessment } from "./assessment";
import type { StandardProfile } from "./standardize";

/**
 * Evidence-based creator attributes (search-v2, owner instruction 2026-10-20). A value is stored on the creator only
 * when the creator's own public text supports it; everything else is recorded with its source and status but kept
 * unknown:
 *   - city: a full city name in the creator's own name/bio (not a hashtag, not an abbreviation such as ISB, which is
 *     also the Indian School of Business), or in at least half of the recent posts (min. 3) with no other city in two
 *     posts: a travel vlogger who visits Peshawar in 3 of 12 posts is not based there ("weak"). Hyderabad needs a
 *     Pakistan cue (it is also a city in India). An AI-read city the text does not show is "weak". Two different
 *     supported cities are "conflicting" and none is stored.
 *   - country: Pakistan only from the creator's own words (Pakistan / Pakistani / پاکستان / 🇵🇰, not a hashtag) or a
 *     supported Pakistani city, and not when the same text says the creator lives abroad ("immigrated to Canada from
 *     Pakistan", "Pakistani in Dubai": "conflicting", none stored). The platform registration country (YouTube) and the
 *     AI's reading are recorded as "weak" and never stored on their own; a registration country that disagrees with
 *     supported evidence is flagged "conflicting".
 *   - niche: a niche whose reviewed terms appear in the creator's own name/bio or in at least two recent posts; words
 *     too general to prove a niche (style, explore, mobile, money, car…) count for search but not here.
 *   - language: content language from the recent posts' script (Urdu script, Roman Urdu, English); evidence only.
 */
export type AttributeName = "city" | "country" | "niche" | "language";
export type EvidenceSource = "profile_text" | "post_text" | "platform_registration" | "ai_assessment";
export type EvidenceStatus = "supported" | "weak" | "conflicting";
export type EvidenceRow = { attribute: AttributeName; value: string; source: EvidenceSource; status: EvidenceStatus; evidence: string };
export type AttributeDecision = { city: string | null; country: string | null; niches: string[]; languages: string[]; evidence: EvidenceRow[] };

const POSTS_FOR_SUPPORT = 2;
// Pakistan as the creator's identity or base, not as a topic ("developments in China, India, and Pakistan").
const PK_SELF = /\bpaki?stani\b|پاکستانی|🇵🇰|\b(?:from|in|based in|lives in|living in|across)\s+pakistan\b|پاکستان\s*(?:سے|میں)/iu;
const PK_NAMED = /\bpakistan\b|پاکستان/iu;
// A city named in a long bio needs a location cue ("based in Lahore", "📍 Karachi"); "Islamia University, Bahawalpur" is not one.
const SHORT_BIO = 160;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const locatedCue = (form: string) =>
  /[؀-ۿ]/u.test(form)
    ? new RegExp(`${escapeRe(form)}\\s*(?:سے|میں|شہر)`, "u")
    : new RegExp(`(?:\\b(?:in|from|based|city|lives|living|located)\\b|📍|📌)[\\s,:|-]*(?:in\\s+)?${escapeRe(form)}\\b`, "iu");
const PK_CUE = /\b(?:pakistan|pakistani|sindh)\b|پاکستان|سندھ|🇵🇰/iu;
const ABROAD =
  /\b(?:based in|living in|lives in|live in|settled in|immigrated to|moved to|in)\s+(?:the\s+)?(?:canada|usa|us|america|united states|uk|united kingdom|england|london|dubai|uae|abu dhabi|saudi arabia|saudia|riyadh|jeddah|qatar|doha|australia|germany|italy|india)\b/iu;
const AMBIGUOUS_CITY = new Set(["hyderabad"]);
// Search forms too general to prove a niche on their own.
const WEAK_NICHE_FORMS = new Set(["style", "styling", "explore", "exploring", "tour", "trip", "trips", "glow", "lawn", "health", "healthy", "diet", "mobile", "mobiles", "phone", "phones", "game", "games", "study", "studies", "learning", "money", "savings", "trading", "car", "cars", "auto", "autos", "bike", "bikes", "farm", "routine", "marketing", "sketch", "memes"]);
const cityForms = (forms: readonly string[]) => forms.filter((f) => /[؀-ۿ]/u.test(f) || f.length >= 5);
const stripHashtags = (t: string) => t.replace(/#[\p{L}\p{N}_]+/gu, " ");
const ROMAN_URDU = new Set("main mein mera meri mujhe hum aap tum hai hain tha thi hoon hun karta karti karte kya kiya ka ki ke ko se nahi nahin aur bhi".split(" "));
const CITY_NAMES: Record<string, string> = Object.fromEntries(CITIES_V2.map((c) => [c.key, c.key.charAt(0).toUpperCase() + c.key.slice(1)]));

/** Whole-word (or whole-phrase) occurrence of a normalized form in normalized text; Urdu forms match as substrings. */
function mentions(text: string, form: string): boolean {
  const f = normalizeTerms(form);
  if (!f) return false;
  return /[؀-ۿ]/u.test(f) ? text.includes(f) : ` ${text} `.includes(` ${f} `);
}
const quote = (raw: string, form: string): string => {
  const i = raw.toLowerCase().indexOf(form.toLowerCase());
  const s = i < 0 ? raw.slice(0, 120) : raw.slice(Math.max(0, i - 60), i + form.length + 60);
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
};

export function deriveAttributes(p: StandardProfile, a: Assessment | null): AttributeDecision {
  const ownRaw = stripHashtags([p.displayName, p.bio, p.accountCategory ?? ""].join(" \n "));
  const own = normalizeTerms(ownRaw);
  const posts = p.recentPosts.slice(0, 30).map((x) => ({ raw: `${x.caption} ${x.hashtags.join(" ")}`, norm: normalizeTerms(`${x.caption} ${x.hashtags.join(" ")}`) }));
  const evidence: EvidenceRow[] = [];
  const shortBio = stripHashtags(p.bio).trim().length <= SHORT_BIO;

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
    const aiKey = normalizeTerms(a.creatorCity);
    const corroborated = city !== null && normalizeTerms(city) === aiKey;
    if (!corroborated) evidence.push({ attribute: "city", value: a.creatorCity, source: "ai_assessment", status: supportedCities.length > 1 ? "conflicting" : "weak", evidence: "Read by the AI assessment; not shown in the creator's own text" });
  }

  // Country: only Pakistan can be supported from the creator's own words (the catalogue's market).
  const pkSelf = PK_SELF.exec(ownRaw) ?? (PK_NAMED.test(p.displayName) ? PK_NAMED.exec(p.displayName) : null);
  const abroad = ABROAD.exec(ownRaw);
  const pkClaimed = Boolean(pkSelf) || city !== null;
  const pkTopic = !pkClaimed ? PK_NAMED.exec(ownRaw) : null;
  if (pkTopic) evidence.push({ attribute: "country", value: "PK", source: "profile_text", status: "weak", evidence: `Pakistan is named, but not as where the creator is from or based: ${quote(ownRaw, pkTopic[0])}` });
  const pkSupported = pkClaimed && !abroad;
  const country = pkSupported ? "PK" : null;
  if (pkClaimed) {
    const why = pkSelf ? quote(ownRaw, pkSelf[0]) : `City ${city} named in the creator's own text`;
    evidence.push({ attribute: "country", value: "PK", source: "profile_text", status: abroad ? "conflicting" : "supported", evidence: abroad ? `${why}; but the same text says "${abroad[0]}"` : why });
  }
  if (p.country) evidence.push({ attribute: "country", value: p.country, source: "platform_registration", status: pkSupported && p.country !== "PK" ? "conflicting" : "weak", evidence: "Channel registration country set by the owner on the platform; not proof of where the creator is based" });
  if (a?.creatorCountry && a.creatorCountry !== country) evidence.push({ attribute: "country", value: a.creatorCountry, source: "ai_assessment", status: pkSupported ? "conflicting" : "weak", evidence: "Read by the AI assessment; not shown in the creator's own text" });

  // Niches: reviewed terms in the creator's own text, or in at least two recent posts.
  const nicheScore = new Map<string, { score: number; row: EvidenceRow }>();
  for (const c of NICHES_V2) {
    if (!c.niche) continue;
    const forms = c.forms.filter((f) => !WEAK_NICHE_FORMS.has(f));
    const ownForm = forms.find((f) => mentions(own, f));
    const postHits = posts.filter((x) => forms.some((f) => mentions(x.norm, f))).length;
    const score = (ownForm ? 3 : 0) + postHits;
    if (!ownForm && postHits < POSTS_FOR_SUPPORT) continue;
    const prev = nicheScore.get(c.niche);
    if (prev && prev.score >= score) continue;
    nicheScore.set(c.niche, { score, row: { attribute: "niche", value: c.niche, source: ownForm ? "profile_text" : "post_text", status: "supported", evidence: ownForm ? quote(ownRaw, ownForm) : `${postHits} of ${posts.length} recent posts use its terms` } });
  }
  const niches = [...nicheScore.values()].sort((x, y) => y.score - x.score).slice(0, 3).map((n) => n.row);
  evidence.push(...niches);
  for (const n of a?.niches ?? []) if (!niches.some((s) => s.value === n)) evidence.push({ attribute: "niche", value: n, source: "ai_assessment", status: "weak", evidence: "Chosen by the AI assessment; its terms are not in the creator's own text or recent posts" });

  // Content language of recent posts (evidence only).
  const languages: string[] = [];
  if (posts.length >= 3) {
    const share = (pred: (t: string) => boolean) => posts.filter((x) => pred(x.raw)).length / posts.length;
    const urdu = share((t) => /[؀-ۿ]{3,}/u.test(t));
    const roman = share((t) => (normalizeTerms(t).split(" ").filter((w) => ROMAN_URDU.has(w)).length >= 3));
    const english = share((t) => /\b(?:the|and|this|with|for|you|my|is|are|of)\b/i.test(t));
    for (const [lang, s] of [["urdu", urdu], ["roman urdu", roman], ["english", english]] as const) {
      if (s >= 0.3) {
        languages.push(lang);
        evidence.push({ attribute: "language", value: lang, source: "post_text", status: "supported", evidence: `${Math.round(s * 100)}% of ${posts.length} recent posts` });
      }
    }
  }
  return { city, country, niches: niches.map((n) => n.value), languages, evidence };
}
