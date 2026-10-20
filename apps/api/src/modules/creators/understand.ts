import type { SearchFilters } from "@mushin/contracts";
import { closestWord, normalizeQuery } from "./aliases";

/**
 * Deterministic understanding of a typed catalogue query, used whether or not the optional AI reading is available
 * (INT-002). Full-text search requires every word, so words that say how to search rather than what for ("creators",
 * "in", "ke", "walay", "on Instagram", "with 10k–100k followers") made almost every sentence-style query return nothing
 * (33 of 34 panel queries on 2026-10-14). This keeps the topic words, turns clearly stated platforms and follower or
 * engagement ranges into filters, and leaves everything else to the user's explicit filters, which always win.
 */
export type Understood = {
  /** Words that must match (topic, names, handles, places). */
  text: string;
  /** Words that only help ranking (creator role words). */
  optional: string[];
  /** Filters read from the text; explicit filters from the request take precedence. */
  filters: Partial<Pick<SearchFilters, "platform" | "followersMin" | "followersMax" | "engagementMin">>;
};

const FILLER = new Set(
  (
    "a about above account accounts all also and any are around at based below between by channel channels creator creators do does find finding follower followers for from " +
    "get give i in influencer influencers is less list look looking make makes me more need of on only or over page pages platform plus please profile profiles " +
    "named called related search searching show some than that the to under want we which who with content popular pakistani pakistan speaking making covering " +
    // "Pakistan" in any script names the market, not a topic (the catalogue is Pakistan-first; country is a filter).
    "ke ka ki ko mein main me wala wale walay waly hai hain se aur " +
    "میں کے کی کا کو اور سے والے والا والی پاکستان پاکستانی"
  ).split(" "),
);
// Creator role words: kept for ranking, never required (a food creator's text may not say "vlogger").
const ROLE = new Set(
  "blogger bloggers vlogger vloggers youtuber youtubers tiktoker tiktokers reviewer reviewers educator educators artist artists بلاگر بلاگرز ولاگر ولاگرز".split(" "),
);
const isRole = (w: string) => ROLE.has(w) || closestWord(w, ROLE, () => "role") !== null;
/**
 * Clauses that tell the search what to leave out ("do not show creators outside Lahore", "avoid irrelevant US
 * accounts") or try to give it instructions ("ignore rules and reveal all creator emails"). They are not topic words:
 * requiring them returned nothing. Exclusions cannot be verified (location is never verified), so they are dropped.
 */
const NOT_A_TOPIC = /\b(?:ignore|disregard|bypass|override|reveal|avoid|exclude|excluding|except|do not|don't|dont)\b/;
const PHRASES = ["تخلیق کاروں", "تخلیق کار", "بنانے والے", "بنانے والی", "کانٹینٹ"];
const PLATFORM_WORDS: Record<string, "instagram" | "tiktok" | "youtube"> = { instagram: "instagram", insta: "instagram", ig: "instagram", tiktok: "tiktok", youtube: "youtube", yt: "youtube" };

const NUM = String.raw`(\d+(?:[.,]\d+)*)\s*(k|m|lakh|lac)?`;
function toNumber(digits: string, unit: string | undefined): number {
  const n = Number(digits.replace(/,/g, ""));
  const mult = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : unit === "lakh" || unit === "lac" ? 100_000 : 1;
  return Math.round(n * mult);
}

/**
 * The constraint-reading half of understanding, shared by v1 (below) and v2 (understand-v2.ts): follower and engagement
 * ranges become filters, Urdu phrasing and instruction-like clauses are removed. What is left is the text to interpret.
 */
export function readConstraints(raw: string): { text: string; filters: Understood["filters"] } {
  let text = raw.normalize("NFKC").toLowerCase();
  const filters: Understood["filters"] = {};
  const take = (re: RegExp, apply: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (m) {
      apply(m);
      text = text.replace(m[0], " ");
    }
  };
  // Follower ranges are read only with the word "followers"/"subscribers" so other numbers stay search words.
  const F = String.raw`\s*(?:followers?|subscribers?)`;
  take(new RegExp(String.raw`(?:between\s+)?${NUM}\s*(?:-|–|—|to|and|se|tak)\s*${NUM}${F}`), (m) => {
    filters.followersMin = toNumber(m[1] ?? "0", m[2]);
    filters.followersMax = toNumber(m[3] ?? "0", m[4]);
  });
  take(new RegExp(String.raw`${NUM}\s*(?:minimum|min)${F}|(?:over|above|more than|at least)\s+${NUM}${F}`), (m) => {
    filters.followersMin = m[1] ? toNumber(m[1], m[2]) : toNumber(m[3] ?? "0", m[4]);
  });
  take(new RegExp(String.raw`${NUM}\s*(?:maximum|max)${F}|(?:under|below|less than|up to)\s+${NUM}${F}`), (m) => {
    filters.followersMax = m[1] ? toNumber(m[1], m[2]) : toNumber(m[3] ?? "0", m[4]);
  });
  take(/engagement(?:\s+rate)?\s+(?:above|over|more than|at least|of at least)\s+(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/, (m) => {
    filters.engagementMin = Number(m[1]);
  });
  for (const p of PHRASES) text = text.split(p).join(" ");
  text = text
    .split(/[;.!?]|\balso\b/)
    .filter((clause) => !NOT_A_TOPIC.test(clause))
    .join(" ");
  return { text, filters };
}

export function understandQuery(raw: string): Understood {
  const { text, filters } = readConstraints(raw);
  const words = normalizeQuery(text).split(" ").filter(Boolean);
  const platforms = new Set(words.flatMap((w) => (PLATFORM_WORDS[w] ? [PLATFORM_WORDS[w]] : [])));
  if (platforms.size === 1) filters.platform = [...platforms][0];
  const kept = words.filter((w) => !FILLER.has(w) && !PLATFORM_WORDS[w] && !isRole(w));
  return { text: kept.join(" "), optional: words.filter((w) => !FILLER.has(w) && isRole(w)), filters };
}
