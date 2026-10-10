import type { LiveSearch } from "@mushin/contracts";
import type { CreatorPlatform } from "../../creators/index";

export type PlannedQuery = { platform: CreatorPlatform; query: string; country: string };

// TikTok and YouTube profile pages live under /@handle: restricting to them leaves out videos (measured 2026-10-10).
const SITE: Record<CreatorPlatform, string> = { instagram: "site:instagram.com", tiktok: "site:tiktok.com/@", youtube: "site:youtube.com/@" };
const ALL: CreatorPlatform[] = ["instagram", "tiktok", "youtube"];

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
    "related search searching show some subscriber subscribers than that the tiktok to under want we which who with youtube yt"
  ).split(" "),
);

/** The topic words of the user's text: no filler, no follower counts, no place already searched. */
function keywords(text: string, place: string): string {
  const placeWords = new Set(place.split(" "));
  return words(text, 120)
    .split(" ")
    .filter((w) => w && !FILLER.has(w) && !placeWords.has(w) && !/^\d+[km]?$/.test(w))
    .slice(0, 6)
    .join(" ");
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? "";
  } catch {
    return "";
  }
}

/** Spec §4.2 step 1: 2–3 targeted searches per platform in scope, built by code from the chips (the text only adds topic words). */
export function buildQueries(s: LiveSearch): PlannedQuery[] {
  const niches = s.filters.niches.map((n) => words(n, 40)).filter(Boolean);
  const place = words(s.filters.creatorCity ?? "", 60) || words(s.filters.creatorCountry ? regionName(s.filters.creatorCountry) : "", 60);
  const country = (s.filters.creatorCountry ?? "PK").toLowerCase();
  const typed = keywords(s.text, place);
  const topic = niches.join(" ") || typed;
  // Measured 2026-10-10: a bare niche word finds shops and brands, "content creator" finds people; without a place, the
  // market's name keeps a search local (Google's country setting alone does not).
  const market = place ? "" : words(regionName(country.toUpperCase()), 60);
  const out: PlannedQuery[] = [];
  for (const platform of platformsFor(s)) {
    const seen = new Set<string>();
    for (const parts of [[topic, place], [topic, "content creator", place], [typed, place], ...(market ? [[topic, market]] : [])]) {
      const query = [SITE[platform], ...parts.filter(Boolean)].join(" ");
      if (query === SITE[platform] || seen.has(query) || seen.size === 3) continue;
      seen.add(query);
      out.push({ platform, query, country });
    }
  }
  return out;
}
