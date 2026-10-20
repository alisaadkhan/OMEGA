import type { SearchFilters } from "@mushin/contracts";
import { closestWord } from "./aliases";
import { CITIES_V2, FILLER_V2, FORMATS_V2, languageCues, NICHES_V2, PLATFORM_WORDS_V2, PREFERENCE_WORDS_V2, ROLE_WORDS_V2, segment, TERMINOLOGY_VERSION, type Concept } from "./terminology";
import { readConstraints } from "./understand";

/** A required term group: any of its forms matches; single Latin words of 5+ letters also match their inflections. */
export type PlanGroup = { kind: "niche" | "city" | "word"; canonical: string; forms: string[]; prefix: boolean };

/**
 * Query understanding v2 (SEARCH_PROFILE=v2). Separates mandatory constraints from preferences:
 *   - required: every named topic (any reviewed form, any language) and every named city;
 *   - filters: an explicit platform ("on TikTok", "YouTubers"), follower and engagement ranges;
 *   - preferences (ranking only, never required): content language ("in Urdu"), formats ("review"), role words
 *     ("vloggers"), preference words ("popular", "budget-friendly"), and words outside the vocabulary once a recognised
 *     topic already says what the query is about.
 * A language preference is never turned into a claim about a creator: MUSHIN has no verified language data.
 */
export type UnderstoodV2 = {
  version: typeof TERMINOLOGY_VERSION;
  text: string;
  groups: PlanGroup[];
  boost: string[];
  filters: Partial<Pick<SearchFilters, "platform" | "followersMin" | "followersMax" | "engagementMin">>;
  languages: string[];
  preferences: string[];
};

const SINGLE_WORD_FORMS = new Map(
  [...NICHES_V2, ...CITIES_V2].flatMap((c) => c.forms.filter((f) => !f.includes(" ") && /^[a-z]+$/.test(f)).map((f) => [f, c] as const)),
);
const latinWord = (w: string) => /^[a-z]+$/.test(w);
const group = (c: Concept): PlanGroup => ({ kind: c.kind === "city" ? "city" : "niche", canonical: c.key, forms: [...new Set(c.forms.map((f) => f.toLowerCase()))], prefix: false });

export function understandQueryV2(raw: string): UnderstoodV2 {
  const { text: constrained, filters } = readConstraints(raw);
  const { languages, rest } = languageCues(constrained);
  const groups: PlanGroup[] = [];
  const boost: string[] = [];
  const preferences: string[] = [];
  const unknown: string[] = [];
  const platforms = new Set<"instagram" | "tiktok" | "youtube">();
  const add = (c: Concept) => {
    if (!groups.some((g) => g.kind === (c.kind === "city" ? "city" : "niche") && g.canonical === c.key)) groups.push(group(c));
  };

  for (const s of segment(rest)) {
    if ("concept" in s) {
      if (s.concept.kind === "format") boost.push(...s.concept.forms.filter((f) => !f.includes(" ")).slice(0, 4));
      else add(s.concept);
      continue;
    }
    const w = s.word;
    const platform = PLATFORM_WORDS_V2[w];
    if (platform) platforms.add(platform);
    else if (FILLER_V2.has(w) || /^\d+$/.test(w)) continue;
    else if (ROLE_WORDS_V2.has(w)) boost.push(w);
    else if (PREFERENCE_WORDS_V2.has(w)) {
      preferences.push(w);
      boost.push(w);
    } else {
      // A misspelt vocabulary word within the edit limit ("peshawer", "restaurent") means that concept.
      const near = latinWord(w) ? closestWord(w, SINGLE_WORD_FORMS.keys(), (x) => SINGLE_WORD_FORMS.get(x)?.key ?? x) : null;
      const concept = near ? SINGLE_WORD_FORMS.get(near) : undefined;
      if (concept) add(concept);
      else if (FORMATS_V2.some((f) => f.forms.includes(w))) boost.push(w);
      else unknown.push(w);
    }
  }
  const hasTopic = groups.some((g) => g.kind === "niche");
  // Words outside the vocabulary: with a recognised topic they only refine ranking ("textile" in "Faisalabad textile and
  // fashion creators"); without one they are what the query is about, so they stay required (with inflections).
  if (hasTopic) boost.push(...unknown);
  else for (const w of unknown) groups.push({ kind: "word", canonical: w, forms: [w], prefix: latinWord(w) && w.length >= 5 });
  if (platforms.size === 1) filters.platform = [...platforms][0];
  return {
    version: TERMINOLOGY_VERSION,
    text: groups.map((g) => g.canonical).join(" "),
    groups,
    boost: [...new Set(boost)],
    filters,
    languages,
    preferences,
  };
}
