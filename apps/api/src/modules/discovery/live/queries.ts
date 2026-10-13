import type { LiveSearch } from "@mushin/contracts";
import type { CreatorPlatform } from "../../creators/index";

export type PlannedQuery = { platform: CreatorPlatform; query: string; country: string; hl: string; round: 1 | 2 | 3; num: number };

// TikTok and YouTube profile pages live under /@handle: restricting to them leaves out videos (measured 2026-10-10).
const SITE: Record<CreatorPlatform, string> = { instagram: "site:instagram.com", tiktok: "site:tiktok.com/@", youtube: "site:youtube.com/@" };
const ALL: CreatorPlatform[] = ["instagram", "tiktok", "youtube"];

// Reviewed, deterministic Urdu/Roman Urdu equivalents. Unknown niches stay in their
// original language; we never ask a model to invent operators or silently translate.
const URDU_TERMS: Record<string, { roman: string; urdu: string }> = {
  food: { roman: "khana foodie", urdu: "کھانا فوڈ" },
  foodie: { roman: "khana foodie", urdu: "کھانا فوڈ" },
  "food blogger": { roman: "khana blogger", urdu: "کھانے کا بلاگر" },
  "street food": { roman: "street food khana", urdu: "اسٹریٹ فوڈ کھانا" },
  beauty: { roman: "khubsurti beauty", urdu: "خوبصورتی بیوٹی" },
  makeup: { roman: "makeup beauty", urdu: "میک اپ بیوٹی" },
  bridal: { roman: "dulhan bridal", urdu: "دلہن برائیڈل" },
  fashion: { roman: "libaas fashion", urdu: "لباس فیشن" },
  travel: { roman: "safar travel", urdu: "سفر ٹریول" },
  fitness: { roman: "warzish fitness", urdu: "ورزش فٹنس" },
  technology: { roman: "technology tech", urdu: "ٹیکنالوجی ٹیک" },
  tech: { roman: "technology tech", urdu: "ٹیکنالوجی ٹیک" },
};

const URDU_PLACES: Record<string, string> = {
  lahore: "لاہور", karachi: "کراچی", islamabad: "اسلام آباد", rawalpindi: "راولپنڈی",
  peshawar: "پشاور", faisalabad: "فیصل آباد", multan: "ملتان", quetta: "کوئٹہ",
};

export const platformsFor = (s: LiveSearch): CreatorPlatform[] => (s.filters.platform ? [s.filters.platform] : ALL);

/** Lower-case letters, digits, spaces, # and - only: the user's text can never become Google operators (site:, OR, "…"). */
function words(text: string, max: number): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}#\s-]/gu, " ").replace(/(^|\s)-+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Words that say how to search, not what for: kept in, they turn a Google search's results into posts and videos. */
const FILLER = new Set(
  (
    "a about above account accounts all and any are around at based below between by channel channels creator creators find finding follower followers for from " +
    "get give i ig in influencer influencers insta instagram is less list look looking me more need of on or over page pages platform plus profile profiles " +
    "related search searching show some subscriber subscribers than that the tiktok to under want we which who with youtube yt " +
    // Role words are added by the planner itself; repeating them produced queries like "khana bloggers blogger" (2026-10-13).
    "blogger bloggers vlogger vloggers pakistani pakistan speaking making covering videos video " +
    // Roman Urdu and Urdu-script particles carry no topic.
    "ke ka ki ko mein main wala wale walay waly hai hain میں کے کی کا کو اور سے والے والا والی"
  ).split(" "),
);

/** The topic words of the user's text: no filler, no follower counts, no place already searched. */
function keywords(text: string, places: string[]): string {
  const placeWords = new Set(places.flatMap((p) => p.split(" ")));
  return words(text, 120)
    .split(" ")
    .filter((w) => w && !FILLER.has(w) && !placeWords.has(w) && !/^\d+[km]?$/.test(w))
    .slice(0, 6)
    .join(" ");
}

/** Latin-script words only: Urdu-script words get their own Urdu-locale query instead of English role words. */
const latinOnly = (text: string): string => text.split(" ").filter((w) => /^[\p{Script=Latin}\p{N}#-]+$/u.test(w)).join(" ");
const nonLatin = (text: string): string => text.split(" ").filter((w) => w && !/^[\p{Script=Latin}\p{N}#-]+$/u.test(w)).join(" ");

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? "";
  } catch {
    return "";
  }
}

/** Spec §4.2 step 1: 2–3 targeted searches per platform in scope, built by code from the chips (the text only adds topic words). */
export function buildQueries(s: LiveSearch, round: 1 | 2 | 3 = 1): PlannedQuery[] {
  const niches = s.filters.niches.map((n) => words(n, 40)).filter(Boolean);
  const place = words(s.filters.creatorCity ?? "", 60) || words(s.filters.creatorCountry ? regionName(s.filters.creatorCountry) : "", 60);
  const country = (s.filters.creatorCountry ?? "PK").toLowerCase();
  const isPakistan = country === "pk";
  const localizedPlace = isPakistan ? (URDU_PLACES[place] ?? "") : "";
  const allTyped = keywords(s.text, [place, localizedPlace]);
  const typed = latinOnly(allTyped);
  const typedUrdu = nonLatin(allTyped);
  const topic = niches.join(" ") || typed;
  const roleTopic = typed || topic;
  // Measured 2026-10-10: a bare niche word finds shops and brands, "content creator" finds people; without a place, the
  // market's name keeps a search local (Google's country setting alone does not).
  const market = place ? "" : words(regionName(country.toUpperCase()), 60);
  const out: PlannedQuery[] = [];
  for (const platform of platformsFor(s)) {
    const seen = new Set<string>();
    const known = URDU_TERMS[topic] ?? URDU_TERMS[typed];
    // Urdu-script text mixed with English role words returned 0 results in every measured query (2026-10-13).
    const urduTyped = typedUrdu ? [{ parts: [typedUrdu, localizedPlace || place], hl: "ur" }] : [];
    const planned: { parts: string[]; hl: string }[] = round === 1
      ? [...[[topic, "content creator", place || market], [roleTopic, "blogger", place || market], [roleTopic, "influencer", place || market]].map((parts) => ({ parts, hl: "en" })), ...urduTyped]
      : round === 2 && isPakistan && known
        ? [
            { parts: [known.roman, place], hl: "en" },
            { parts: [known.urdu, localizedPlace || place], hl: "ur" },
          ]
        : round === 2
          ? [{ parts: [typed, "blogger", place || market], hl: "en" }, { parts: [topic, "vlogger", place || market], hl: "en" }]
          : known && isPakistan
            ? [
                { parts: [topic, known.roman, place], hl: "en" },
                { parts: [topic, known.urdu, localizedPlace || place], hl: "ur" },
              ]
            : [{ parts: [topic, "influencer", place || market], hl: "en" }, { parts: [typed, "creator", place || market], hl: "en" }];
    for (const { parts, hl } of planned) {
      const query = [SITE[platform], ...parts.filter(Boolean)].join(" ").slice(0, 240);
      if (query === SITE[platform] || seen.has(`${hl}|${query}`) || seen.size === 4) continue;
      seen.add(`${hl}|${query}`);
      out.push({ platform, query, country, hl, round, num: 10 });
    }
  }
  return out;
}
