import type { LiveSearch } from "@mushin/contracts";

const GENERIC = new Set(("creator creators influencer influencers blogger bloggers vlogger vloggers account profile instagram tiktok youtube content social media find new best top in at from with for the and of pakistani pakistan lahore karachi islamabad rawalpindi urdu english " +
  "video videos channel channels speaking making covering micro small local wala wale walay " +
  // Formats, not subjects: "car reviews" used to match any review because "car" was too short to count (2026-10-13).
  "review reviews reviewer reviewers vlog vlogs ke ka ki are you all any who how " +
  // Role words are not subjects either ("Pakistani gaming YouTuber" matched any video mentioning YouTubers, 2026-10-13).
  "youtuber youtubers tiktoker tiktokers streamer streamers").split(" "));

/** Normalized names of Pakistani cities used as location evidence in a bio (a different city is a negative signal). */
export const KNOWN_CITIES = ["lahore", "karachi", "islamabad", "rawalpindi", "peshawar", "faisalabad", "multan", "quetta", "hyderabad", "sialkot", "gujranwala", "sukkur", "abbottabad", "bahawalpur", "sargodha", "gilgit", "skardu", "hunza", "swat"];

// Reviewed equivalents for the platform.niches taxonomy (and common synonyms); unknown terms are never silently
// translated. Extended 2026-10-13 after the live evaluation found Wellness, Lifestyle, Comedy and Finance had no
// equivalents and "Tech" did not match phone or gadget reviews.
const FOOD = ["food", "foodie", "khana", "khaana", "کھانا", "کھانے", "pakwan", "پکوان", "zaika", "ذائقہ", "recipe", "recipes", "cooking", "pakana", "restaurant", "restaurants", "cafe", "eatery", "street food", "biryani", "karahi", "nihari", "kebab", "bbq", "burger", "pizza", "dessert", "tasty", "golgappay", "golgappa", "chaat", "foodblogger", "foodreview", "foodvlog"];
const TECH = ["technology", "tech", "ٹیکنالوجی", "takneek", "mobile", "smartphone", "phone", "iphone", "android", "samsung", "gadget", "gadgets", "laptop", "unboxing", "pta", "techreview"];
const WELLNESS = ["wellness", "fitness", "fit", "warzish", "ورزش", "exercise", "workout", "gym", "health", "healthy", "nutrition", "diet", "yoga", "sehat", "صحت", "weight loss", "fatloss", "selfcare", "self care", "mental health"];
const TOPIC_ALIASES: Record<string, string[]> = {
  bridal: ["bridal", "bride", "dulhan", "دلہن", "shaadi", "shadi", "شادی", "wedding", "mehndi", "مہندی", "mayun", "مایوں", "barat", "baraat", "بارات", "walima", "ولیمہ"],
  beauty: ["beauty", "khubsurti", "khubsuratee", "خوبصورتی", "makeup", "make up", "skincare", "skin care", "jild", "جلد", "sajna", "mua", "glow", "serum", "haircare", "lipstick", "grwm"],
  makeup: ["makeup", "make up", "beauty", "khubsurti", "خوبصورتی", "sajna", "dulhan", "دلہن", "mua", "grwm"],
  skincare: ["skincare", "skin care", "jild", "جلد", "glow", "serum", "sunscreen", "beauty"],
  fashion: ["fashion", "libaas", "لباس", "kapray", "kapre", "کپڑے", "style", "styling", "outfit", "outfits", "ootd", "jora", "poshak", "lawn", "kurta", "couture", "fit check", "grwm"],
  food: FOOD,
  foodie: FOOD,
  travel: ["travel", "safar", "سفر", "ghoomna", "گھومنا", "sair", "trip", "tour", "musafirat", "hiking", "trek", "mountains", "explore", "exploring", "adventure", "hunza", "skardu", "naran", "swat", "travelvlog"],
  fitness: WELLNESS,
  wellness: WELLNESS,
  technology: TECH,
  tech: TECH,
  comedy: ["comedy", "funny", "comedian", "sketch", "skit", "prank", "mazak", "mazaq", "مزاحیہ", "standup", "stand up", "memes", "humor", "humour"],
  finance: ["finance", "money", "invest", "investing", "investment", "stocks", "stock market", "psx", "crypto", "trading", "savings", "banking", "paisa", "پیسہ", "real estate", "property", "financial"],
  lifestyle: ["lifestyle", "vlog", "daily vlog", "routine", "day in my life", "family", "home", "motherhood", "mom", "parenting", "life"],
};

export function norm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}

export function meaningfulTopics(search: LiveSearch): string[] {
  const candidates = search.filters.niches.length ? search.filters.niches : [search.text];
  return [...new Set(candidates.map(norm).filter((v) => v && v.split(" ").some((w) => w.length >= 3 && !GENERIC.has(w))))];
}

/**
 * A word matches its light stem ("photographer" ~ "photography", "motorcycles" ~ "motorcycle"), and a 4–5 letter word its
 * plural or agent form ("bike" ~ "bikes", "biker"; measured 2026-10-13: #biker posts were "off topic" for a bike brief).
 */
function hasWord(haystack: string, word: string): boolean {
  if (haystack.includes(` ${word} `)) return true;
  if (word.length >= 4 && word.length < 6) return new RegExp(` ${word}(?:s|es|r|rs|er|ers|ie|ies) `, "u").test(haystack);
  if (word.length < 6) return false;
  const stem = word.slice(0, Math.max(5, word.length - 3));
  return haystack.includes(` ${stem}`);
}

/** A brief typed as free text (no niche chosen) lists alternatives ("photographer videographer"), so any word counts. */
export const anyTermCounts = (search: LiveSearch): boolean => search.filters.niches.length === 0;

/** `any`: one meaningful word of a free-text topic suffices; otherwise most of a niche's words must appear. */
export function topicMatch(text: string, topic: string, mode: "most" | "any" = "most"): boolean {
  const haystack = ` ${norm(text)} `;
  const needle = ` ${norm(topic)} `;
  if (needle.trim() && haystack.includes(needle)) return true;
  const normalizedTopic = norm(topic);
  const aliases = TOPIC_ALIASES[normalizedTopic] ?? Object.entries(TOPIC_ALIASES).find(([key]) => normalizedTopic.split(" ").includes(key))?.[1] ?? [];
  if (aliases.some((alias) => haystack.includes(` ${norm(alias)} `))) return true;
  const terms = normalizedTopic.split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
  if (terms.length === 0) return false;
  const matched = terms.filter((word) => hasWord(haystack, word)).length;
  return mode === "any" ? matched > 0 : matched / terms.length >= 0.6;
}

/** Topic-only evidence for pre-extraction; this never establishes individual-creator eligibility. */
export function hasCampaignTopicEvidence(search: LiveSearch, text: string): boolean {
  const topics = meaningfulTopics(search);
  const mode = anyTermCounts(search) ? "any" : "most";
  return topics.length > 0 && topics.some((topic) => topicMatch(text, topic, mode));
}
