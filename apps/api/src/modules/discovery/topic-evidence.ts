import type { LiveSearch } from "@mushin/contracts";

const GENERIC = new Set("creator creators influencer influencers blogger bloggers vlogger vloggers account profile instagram tiktok youtube content social media find new best top in at from with for the and of pakistani pakistan lahore karachi islamabad rawalpindi urdu english".split(" "));

// Reviewed equivalents for supported Pakistani niches; unknown terms are never silently translated.
const TOPIC_ALIASES: Record<string, string[]> = {
  bridal: ["bridal", "bride", "dulhan", "دلہن", "shaadi", "shadi", "شادی", "wedding", "mehndi", "مہندی", "mayun", "مایوں", "barat", "baraat", "بارات", "walima", "ولیمہ"],
  beauty: ["beauty", "khubsurti", "khubsuratee", "خوبصورتی", "makeup", "make up", "skincare", "jild", "جلد", "sajna"],
  makeup: ["makeup", "make up", "beauty", "khubsurti", "خوبصورتی", "sajna", "dulhan", "دلہن"],
  fashion: ["fashion", "libaas", "لباس", "kapray", "kapre", "کپڑے", "style", "outfit", "jora", "poshak"],
  food: ["food", "khana", "khaana", "کھانا", "کھانے", "pakwan", "پکوان", "zaika", "ذائقہ", "recipe", "recipes", "cooking", "pakana"],
  foodie: ["food", "khana", "khaana", "کھانا", "کھانے", "pakwan", "پکوان", "zaika", "ذائقہ", "recipe", "recipes", "cooking", "pakana"],
  travel: ["travel", "safar", "سفر", "ghoomna", "گھومنا", "sair", "trip", "musafirat"],
  fitness: ["fitness", "warzish", "ورزش", "exercise", "gym", "sehat", "صحت"],
  technology: ["technology", "tech", "ٹیکنالوجی", "takneek"],
  tech: ["technology", "tech", "ٹیکنالوجی", "takneek"],
};

export function norm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}

export function meaningfulTopics(search: LiveSearch): string[] {
  const candidates = search.filters.niches.length ? search.filters.niches : [search.text];
  return [...new Set(candidates.map(norm).filter((v) => v && v.split(" ").some((w) => w.length >= 4 && !GENERIC.has(w))))];
}

export function topicMatch(text: string, topic: string): boolean {
  const haystack = ` ${norm(text)} `;
  const needle = ` ${norm(topic)} `;
  if (needle.trim() && haystack.includes(needle)) return true;
  const normalizedTopic = norm(topic);
  const aliases = TOPIC_ALIASES[normalizedTopic] ?? Object.entries(TOPIC_ALIASES).find(([key]) => normalizedTopic.split(" ").includes(key))?.[1] ?? [];
  if (aliases.some((alias) => haystack.includes(` ${norm(alias)} `))) return true;
  const terms = norm(topic).split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));
  if (terms.length === 0) return false;
  const matched = terms.filter((word) => haystack.includes(` ${word} `)).length;
  return matched / terms.length >= 0.6;
}

/** Topic-only evidence for pre-extraction; this never establishes individual-creator eligibility. */
export function hasCampaignTopicEvidence(search: LiveSearch, text: string): boolean {
  const topics = meaningfulTopics(search);
  return topics.length > 0 && topics.some((topic) => topicMatch(text, topic));
}
