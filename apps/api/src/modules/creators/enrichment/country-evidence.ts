import { normalizeTerms } from "../terminology";
import { isoCountryCode } from "../rules";
import { CITY_ALT, cityCountry } from "./city-country";
import { quote } from "./quote";

/**
 * Country by source (owner instruction 2026-10-26). Three facts are kept apart and never merged by guesswork:
 *   - platform-declared: the country the platform itself reports (YouTube's channel country), labelled as such;
 *   - creator-stated: a country the creator names in their own bio as where they are based or from
 *     ("Based in Lahore, Pakistan", "I am from Canada", "Pakistani YouTuber");
 *   - creator-confirmed: only what the creator confirmed to Roster (never derived here).
 * Not evidence of country: the language of the content, hashtags, a flag on its own, a city named without a residence
 * statement (origin "from Lahore", travel, a hashtag or username, a topic), a country named in a display name, a video
 * title or as a topic ("developments in China, India, and Pakistan").
 * A city in an explicit residence statement ("Lives in Lahore", "Based in Karachi") resolves through city-country.ts
 * (owner correction 2026-10-27): creator-stated, medium confidence (high when the country is named too); an ambiguous
 * city name (Hyderabad: Pakistan or India) resolves only when the statement names the country.
 * The resolved country (shown and searched) is confirmed, else stated, else platform-declared.
 */
export type CountryConfidence = "high" | "medium" | "low";
export type CountrySource = "creator_confirmed" | "creator_stated" | "platform_declared";
export type CountryObservation = { value: string; source: "profile_text" | "platform_registration"; status: "supported" | "weak" | "conflicting"; evidence: string };
export type CountryDecision = {
  platform: string | null;
  stated: string | null;
  statedConfidence: CountryConfidence | null;
  observations: CountryObservation[];
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// Normalized country name or alias → ISO code. Names come from the runtime's ISO region list, so every country works.
const NAMES = new Map<string, string>();
for (const a of LETTERS) {
  for (const b of LETTERS) {
    const code = `${a}${b}`;
    const name = isoCountryCode(code) === code ? regionNames.of(code) : undefined;
    if (name && name !== code) NAMES.set(normalizeTerms(name), code);
  }
}
const ALIASES: Record<string, string> = {
  usa: "US", "united states of america": "US", america: "US", uk: "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB",
  britain: "GB", "great britain": "GB", uae: "AE", emirates: "AE", "united arab emirates": "AE", ksa: "SA", saudia: "SA", "saudi arabia": "SA",
  holland: "NL", "south korea": "KR", "czech republic": "CZ", turkiye: "TR",
  پاکستان: "PK", امریکہ: "US", برطانیہ: "GB", کینیڈا: "CA", "سعودی عرب": "SA", "متحدہ عرب امارات": "AE", بھارت: "IN", انڈیا: "IN",
};
for (const [k, v] of Object.entries(ALIASES)) NAMES.set(normalizeTerms(k), v);
// A self-description by nationality ("Pakistani YouTuber", "I'm a Canadian chef").
const DEMONYMS: Record<string, string> = {
  pakistani: "PK", indian: "IN", bangladeshi: "BD", afghan: "AF", canadian: "CA", american: "US", british: "GB", emirati: "AE", saudi: "SA",
  turkish: "TR", australian: "AU", german: "DE", french: "FR", italian: "IT", irish: "IE", chinese: "CN", iranian: "IR", "sri lankan": "LK", nepali: "NP",
};
const ROLE = "(?:youtuber|youtubers|vlogger|vloggers|blogger|bloggers|creator|creators|content creator|influencer|chef|artist|comedian|gamer|family|girl|boy|guy|mom|dad|couple|traveller|traveler|streamer|singer|rapper)";

// Most specific first. Names are matched in normalized text (lower case, punctuation removed; 📍 becomes "located in").
const NAME_ALT = [...NAMES.keys()].sort((x, y) => y.length - x.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
// Up to three words (a city) may sit between the cue and the country: "based in lahore pakistan".
const GAP = "(?:\\S+\\s+){0,3}?";
// A city right after one of these verbs is a residence statement (owner correction 2026-10-27).
const CITY_RESIDENCE = new RegExp(`\\b(?:based in|based out of|living in|live in|lives in|located in|residing in|resident of|settled in|moved to|immigrated to|relocated to)\\s+(${CITY_ALT})(?=\\s|$)`, "gu");
const RESIDENCE = new RegExp(`\\b(?:based in|based out of|living in|live in|lives in|located in|residing in|resident of|settled in|moved to|immigrated to|relocated to)\\s+${GAP}(${NAME_ALT})(?=\\s|$)`, "gu");
// "From" counts only in a statement about the creator ("I am from…", "creator from…"), never "recipes from Italy".
const ORIGIN = new RegExp(`\\b(?:(?:i am|i m|im|we are|originally|hailing|proudly|${ROLE})\\s+from|born (?:and raised )?in)\\s+${GAP}(${NAME_ALT})(?=\\s|$)`, "gu");
const URDU = /(پاکستان|امریکہ|برطانیہ|کینیڈا|بھارت|انڈیا)\s*(سے|میں)/gu;
// A demonym counts only when it describes the creator ("Pakistani food blogger"), not a topic ("Pakistani recipes").
const DEMONYM = new RegExp(`\\b(${Object.keys(DEMONYMS).join("|")})\\s+(?:\\S+\\s+){0,2}?${ROLE}(?=\\s|$)`, "gu");
const NAMED = new RegExp(`(?:^|\\s)(${NAME_ALT})(?=\\s|$)`, "gu");

const codesIn = (re: RegExp, text: string, pick: (m: RegExpExecArray) => string | undefined): { code: string; match: string }[] => {
  const out: { code: string; match: string }[] = [];
  for (const m of text.matchAll(re)) {
    const code = pick(m as RegExpExecArray);
    if (code) out.push({ code, match: m[0].trim() });
  }
  return out;
};

/** `bio` is the creator's own profile text with hashtags removed; the display name is deliberately not read. */
export function deriveCountry(bio: string, platformCountry: string | null | undefined): CountryDecision {
  const text = normalizeTerms(bio.replace(/[📍📌]/gu, " located in "));
  const observations: CountryObservation[] = [];
  const nameCode = (m: RegExpExecArray) => NAMES.get(m[1] ?? "");
  const residence: { code: string; match: string; city?: string }[] = codesIn(RESIDENCE, text, nameCode);
  // A known city after a residence verb. Origin ("from Lahore"), travel and topics never reach this: the verb is required.
  for (const m of text.matchAll(CITY_RESIDENCE)) {
    const cc = cityCountry(m[1] ?? "");
    if (!cc) continue;
    if (cc.countries.length === 1) residence.push({ code: cc.countries[0] as string, match: m[0], city: cc.city });
    else if (!residence.some((r) => !r.city && r.match.includes(m[1] ?? ""))) {
      observations.push({ value: cc.countries.join("/"), source: "profile_text", status: "weak", evidence: `"${m[0]}": ${cc.city} is a city in more than one country (${cc.countries.join(", ")}) and the bio does not say which` });
    }
  }
  const viaCityOnly = (code: string) => residence.filter((r) => r.code === code).every((r) => r.city);
  const origin = [
    ...codesIn(ORIGIN, text, nameCode),
    ...codesIn(URDU, text, (m) => NAMES.get(normalizeTerms(m[1] ?? ""))),
    ...codesIn(DEMONYM, text, (m) => DEMONYMS[m[1] ?? ""]),
  ];
  const distinct = (xs: { code: string }[]) => [...new Set(xs.map((x) => x.code))];

  let stated: string | null = null;
  let statedConfidence: CountryConfidence | null = null;
  const rs = distinct(residence);
  const os = distinct(origin);
  if (rs.length > 1) {
    for (const r of residence) observations.push({ value: r.code, source: "profile_text", status: "conflicting", evidence: `The bio names more than one place the creator is based: ${quote(bio, r.match.split(" ").at(-1) ?? r.match)}` });
  } else if (rs.length === 1) {
    stated = rs[0] ?? null;
    const byCity = viaCityOnly(stated as string) ? residence.find((r) => r.code === stated && r.city) : undefined;
    statedConfidence = byCity ? "medium" : "high";
    observations.push({
      value: stated as string,
      source: "profile_text",
      status: "supported",
      evidence: byCity
        ? `Stated as where the creator is based: ${quote(bio, byCity.match.split(" ").slice(-1)[0] ?? byCity.city ?? "")} (city: ${byCity.city}, country: ${stated}; creator-stated, not verified)`
        : `Stated as where the creator is based: "${residence.find((r) => !r.city)?.match ?? residence[0]?.match}"`,
    });
    for (const o of origin.filter((x) => x.code !== stated)) observations.push({ value: o.code, source: "profile_text", status: "weak", evidence: `Stated as where the creator is from, not where they are based: "${o.match}"` });
  } else if (os.length > 1) {
    for (const o of origin) observations.push({ value: o.code, source: "profile_text", status: "conflicting", evidence: `The bio names more than one country the creator is from: "${o.match}"` });
  } else if (os.length === 1) {
    stated = os[0] ?? null;
    statedConfidence = "medium";
    observations.push({ value: stated as string, source: "profile_text", status: "supported", evidence: `Stated by the creator: "${origin[0]?.match}"` });
  }
  // A country named without a statement about the creator (a topic, a destination) is recorded, never stored.
  const seen = new Set([...rs, ...os]);
  for (const m of text.matchAll(NAMED)) {
    const code = NAMES.get(m[1] ?? "");
    if (!code || seen.has(code)) continue;
    seen.add(code);
    observations.push({ value: code, source: "profile_text", status: "weak", evidence: `Named in the bio, but not as where the creator is from or based: ${quote(bio, m[1] ?? "")}` });
    if (seen.size > 6) break;
  }
  if (/🇵🇰/u.test(bio) && !seen.has("PK")) observations.push({ value: "PK", source: "profile_text", status: "weak", evidence: "A Pakistan flag in the bio is not a statement of where the creator is based" });

  const platform = isoCountryCode(platformCountry) ?? null;
  if (platform) {
    const conflicts = stated !== null && stated !== platform;
    observations.push({
      value: platform,
      source: "platform_registration",
      status: conflicts ? "conflicting" : "supported",
      evidence: conflicts
        ? `Declared on the platform; the creator's own bio states ${stated}`
        : "Declared on the platform by the account owner (shown as the platform's country); not proof of residence",
    });
  }
  return { platform, stated, statedConfidence, observations };
}

/** The documented resolution rule; the same value is shown on profiles and used by search filters. */
export function resolveCountry(c: { confirmed: string | null; stated: string | null; statedConfidence: CountryConfidence | null; platform: string | null }): {
  country: string | null;
  source: CountrySource | null;
  confidence: CountryConfidence | null;
} {
  if (c.confirmed) return { country: c.confirmed, source: "creator_confirmed", confidence: "high" };
  if (c.stated) return { country: c.stated, source: "creator_stated", confidence: c.statedConfidence ?? "medium" };
  if (c.platform) return { country: c.platform, source: "platform_declared", confidence: "low" };
  return { country: null, source: null, confidence: null };
}

export type ProfileCountryStatus = "pakistan" | "foreign" | "unknown" | "conflicting";
export type ProfileCountry = { country: string | null; source: CountrySource | null; status: ProfileCountryStatus; confidence: CountryConfidence | null; reason: string };

/**
 * The country of one platform profile (Pakistan-only catalogue, owner instruction 2026-10-27). Each profile is judged on
 * its own evidence: its own bio, and for YouTube the channel's declared country. A country the creator confirmed applies
 * to all their profiles and wins. Conflicting evidence on the profile (two places of residence, or a bio that disagrees
 * with the platform) is kept as "conflicting" for review, never resolved by guessing. A city counts only inside an explicit
 * residence statement; never a language, hashtag, flag, name or topic. `reason` keeps the evidence (the quoted statement
 * and, for a city, which city and country) so staff can audit it.
 */
export function profileCountry(p: { bio: string | null; platformCountry: string | null; confirmed: string | null }): ProfileCountry {
  const status = (code: string): ProfileCountryStatus => (code === "PK" ? "pakistan" : "foreign");
  if (p.confirmed) return { country: p.confirmed, source: "creator_confirmed", status: status(p.confirmed), confidence: "high", reason: "Confirmed by the creator" };
  const d = deriveCountry(p.bio ?? "", p.platformCountry);
  const conflict = d.observations.find((o) => o.status === "conflicting");
  if (conflict) return { country: null, source: null, status: "conflicting", confidence: null, reason: conflict.evidence.slice(0, 300) };
  const r = resolveCountry({ confirmed: null, stated: d.stated, statedConfidence: d.statedConfidence, platform: d.platform });
  if (!r.country) {
    const ambiguous = d.observations.find((o) => o.status === "weak" && o.value.includes("/"));
    return { country: null, source: null, status: "unknown", confidence: null, reason: (ambiguous?.evidence ?? "No country stated in the bio or declared by the platform").slice(0, 300) };
  }
  const stated = d.observations.find((o) => o.source === "profile_text" && o.status === "supported" && o.value === r.country);
  const reason = r.source === "creator_stated" ? (stated?.evidence ?? "Stated in the profile's bio") : "Declared on the platform by the account owner";
  return { country: r.country, source: r.source, status: status(r.country), confidence: r.confidence, reason: reason.slice(0, 300) };
}

/** An explicit country value (ISO code, English name or common alias) as an ISO code; null when it names none. */
export function countryCode(value: string): string | null {
  const v = value.trim();
  return isoCountryCode(v) ?? NAMES.get(normalizeTerms(v)) ?? null;
}
