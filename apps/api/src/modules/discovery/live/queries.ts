import type { LiveSearch } from "@mushin/contracts";
import type { CreatorPlatform } from "../../creators/index";

export type PlannedQuery = { platform: CreatorPlatform; query: string; country: string };

const SITE: Record<CreatorPlatform, string> = { instagram: "site:instagram.com", tiktok: "site:tiktok.com", youtube: "site:youtube.com" };
const ALL: CreatorPlatform[] = ["instagram", "tiktok", "youtube"];

export const platformsFor = (s: LiveSearch): CreatorPlatform[] => (s.filters.platform ? [s.filters.platform] : ALL);

/** Lower-case letters, digits, spaces, # and - only: the user's text can never become Google operators (site:, OR, "…"). */
function words(text: string, max: number): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}#\s-]/gu, " ").replace(/(^|\s)-+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? "";
  } catch {
    return "";
  }
}

/** Spec §4.2 step 1: 2–3 targeted searches per platform in scope, built by code from the chips. */
export function buildQueries(s: LiveSearch): PlannedQuery[] {
  const text = words(s.text, 80);
  const niches = s.filters.niches.map((n) => words(n, 40)).filter(Boolean);
  const place = words(s.filters.creatorCity ?? "", 60) || words(s.filters.creatorCountry ? regionName(s.filters.creatorCountry) : "", 60);
  const country = (s.filters.creatorCountry ?? "PK").toLowerCase();
  const topic = text || niches.join(" ") || "creator";
  const out: PlannedQuery[] = [];
  for (const platform of platformsFor(s)) {
    const role = platform === "youtube" ? "channel" : "influencer";
    const seen = new Set<string>();
    for (const parts of [[topic, place], [niches[0] ?? "", place, role], [topic, role]]) {
      const query = [SITE[platform], ...parts.filter(Boolean)].join(" ");
      if (query === SITE[platform] || seen.has(query)) continue;
      seen.add(query);
      out.push({ platform, query, country });
    }
  }
  return out;
}
