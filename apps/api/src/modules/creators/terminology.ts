/**
 * Shared search terminology, version 2 (search-v2, owner decision 2026-10-20). One vocabulary for Brain 1 (catalogue
 * query understanding) and Brain 2 (Live Discovery topic evidence), so an equivalent brief means the same thing in both.
 * Version 1 stays in aliases.ts (Brain 1) and discovery/topic-evidence.ts (Brain 2), unchanged, because Search is frozen
 * until rated: v2 is used only with SEARCH_PROFILE=v2.
 *
 * Every form is a reviewed equivalent in English, Roman Urdu or Urdu script (including common inflections, e.g. کھانا /
 * کھانے / کھانوں). Nothing here asserts a fact about a creator: matching a word only says the text mentions it.
 */
export const TERMINOLOGY_VERSION = "mushin-terms-v2";

export type Concept = {
  kind: "niche" | "city" | "format";
  /** Stable key (lower case). */
  key: string;
  /** The platform.niches name when one exists (filters and Live Discovery briefs use those names). */
  niche?: string;
  forms: string[];
};

const niche = (key: string, niche: string | undefined, forms: string[]): Concept => ({ kind: "niche", key, ...(niche ? { niche } : {}), forms });
const city = (key: string, forms: string[]): Concept => ({ kind: "city", key, forms });

// Cooking is its own intent (home cooks, recipes), not the same as food reviews: kept out of the food forms (measured
// 2026-10-20: "home cooking creators" returned 30 restaurant reviewers when cooking forms were part of food).
const COOKING = ["cooking", "cook", "cooks", "recipe", "recipes", "home cooking", "kitchen", "baking", "baker", "pakana", "کوکنگ", "ریسپی", "ترکیب"];

export const NICHES_V2: readonly Concept[] = [
  niche("food", "Food", ["food", "foodie", "foodies", "khana", "khaana", "khanay", "khane", "کھانا", "کھانے", "کھانوں", "فوڈ", "pakwan", "پکوان", "zaika", "ذائقہ", "restaurant", "restaurants", "restaurant review", "restaurant reviews", "eatery", "eateries", "dhaba", "street food", "food review", "food reviews", "food blogger", "food vlog", "foodvlog", "foodblogger", "foodreview", "biryani", "karahi", "nihari", "bbq", "dessert", "desserts"]),
  niche("cooking", "Food", COOKING),
  niche("beauty", "Beauty", ["beauty", "khubsurti", "خوبصورتی", "بیوٹی", "grwm", "glow"]),
  niche("makeup", "Beauty", ["makeup", "make up", "makeup artist", "makeup artists", "mua", "میک اپ", "lipstick"]),
  niche("skincare", "Beauty", ["skincare", "skin care", "jild", "جلد", "اسکن کیئر", "سکن کیئر", "serum", "sunscreen"]),
  niche("bridal", "Bridal", ["bridal", "bride", "brides", "dulhan", "دلہن", "برائیڈل", "wedding", "weddings", "shaadi", "shadi", "شادی", "mehndi", "مہندی"]),
  niche("fashion", "Fashion", ["fashion", "libaas", "لباس", "فیشن", "style", "styling", "stylist", "outfit", "outfits", "ootd", "kapray", "kapre", "کپڑے", "lawn", "kurta", "clothing", "clothes", "textile", "textiles", "fabric", "fabrics"]),
  niche("travel", "Travel", ["travel", "traveller", "traveler", "travelling", "traveling", "safar", "سفر", "ٹریول", "tour", "tourism", "trip", "trips", "hiking", "trekking", "explore", "exploring", "travel vlog"]),
  niche("fitness", "Wellness", ["fitness", "warzish", "ورزش", "فٹنس", "gym", "workout", "workouts", "exercise", "yoga", "health", "healthy", "nutrition", "diet", "sehat", "صحت", "wellness"]),
  niche("technology", "Tech", ["technology", "tech", "ٹیکنالوجی", "ٹیک", "gadget", "gadgets", "mobile", "mobiles", "smartphone", "smartphones", "phone", "phones", "laptop", "laptops", "unboxing", "pta"]),
  niche("gaming", undefined, ["gaming", "gamer", "gamers", "game", "games", "gameplay", "pubg", "free fire", "freefire", "esports", "گیمنگ"]),
  niche("education", undefined, ["education", "educational", "teaching", "tutorial", "tutorials", "study", "studies", "learning", "lecture", "lectures", "تعلیم", "پڑھائی"]),
  niche("history", undefined, ["history", "historical", "tareekh", "tarikh", "تاریخ", "تاریخی"]),
  niche("literature", undefined, ["literature", "literary", "adab", "ادب", "urdu literature", "urdu adab", "اردو ادب", "poetry", "poet", "shayari", "shayri", "شاعری", "nazm", "ghazal", "غزل", "books", "book review", "book reviews", "booktok", "bookstagram", "novel", "novels", "کتاب", "کتابیں"]),
  niche("agriculture", undefined, ["agriculture", "agricultural", "farming", "farmer", "farmers", "farm", "kisan", "کسان", "zaraat", "زراعت", "crops", "livestock", "dairy", "kheti", "کھیتی"]),
  niche("business", undefined, ["business", "businesses", "small business", "entrepreneur", "entrepreneurs", "entrepreneurship", "startup", "startups", "karobar", "کاروبار", "marketing"]),
  niche("ecommerce", undefined, ["ecommerce", "e commerce", "online shopping", "online store", "online stores", "daraz", "product review", "product reviews"]),
  niche("comedy", "Comedy", ["comedy", "comedian", "funny", "sketch", "skits", "prank", "pranks", "mazak", "mazaq", "مزاحیہ", "standup", "stand up", "memes"]),
  niche("finance", "Finance", ["finance", "financial", "money", "investing", "investment", "stocks", "psx", "crypto", "trading", "savings", "paisa", "پیسہ"]),
  niche("lifestyle", "Lifestyle", ["lifestyle", "daily vlog", "daily vlogs", "routine", "family vlog", "family vlogs", "motherhood", "parenting"]),
  niche("automotive", undefined, ["automotive", "car", "cars", "auto", "autos", "bike", "bikes", "motorcycle", "gaari", "gari", "گاڑی", "گاڑیاں"]),
  niche("religion", undefined, ["islamic", "islam", "deen", "دین", "quran", "قرآن", "naat", "نعت", "religious"]),
];

/** Cities: owner-reviewed forms from v1 plus common spellings; a city only ever matches text or a declared city. */
export const CITIES_V2: readonly Concept[] = [
  city("lahore", ["lahore", "lhr", "لاہور"]),
  city("karachi", ["karachi", "khi", "کراچی"]),
  city("islamabad", ["islamabad", "isb", "اسلام آباد"]),
  city("rawalpindi", ["rawalpindi", "pindi", "rwp", "راولپنڈی"]),
  city("peshawar", ["peshawar", "پشاور"]),
  city("faisalabad", ["faisalabad", "fsd", "فیصل آباد"]),
  city("multan", ["multan", "ملتان"]),
  city("quetta", ["quetta", "کوئٹہ"]),
  city("hyderabad", ["hyderabad", "حیدرآباد"]),
  city("sialkot", ["sialkot", "سیالکوٹ"]),
  city("gujranwala", ["gujranwala", "گوجرانوالہ"]),
  city("sukkur", ["sukkur", "سکھر"]),
  city("abbottabad", ["abbottabad", "ایبٹ آباد"]),
  city("bahawalpur", ["bahawalpur", "بہاولپور"]),
];

/** Content formats: describe how a creator works, not what about; they help ranking, never restrict results. */
export const FORMATS_V2: readonly Concept[] = [
  { kind: "format", key: "review", forms: ["review", "reviews", "reviewer", "reviewers", "reviewing", "ریویو", "تبصرہ"] },
  { kind: "format", key: "vlog", forms: ["vlog", "vlogs", "vlogging"] },
];

/** Platform words, including the people who use them ("YouTubers" means YouTube creators). */
export const PLATFORM_WORDS_V2: Record<string, "instagram" | "tiktok" | "youtube"> = {
  instagram: "instagram", insta: "instagram", ig: "instagram", instagrammer: "instagram", instagrammers: "instagram", reels: "instagram", انسٹاگرام: "instagram",
  tiktok: "tiktok", tiktoker: "tiktok", tiktokers: "tiktok", ٹک: "tiktok", ٹاک: "tiktok",
  youtube: "youtube", yt: "youtube", youtuber: "youtube", youtubers: "youtube", یوٹیوب: "youtube", یوٹیوبر: "youtube", یوٹیوبرز: "youtube",
};

/** Words that state a preference ("popular", "budget-friendly"): kept for ranking, never required. */
export const PREFERENCE_WORDS_V2 = new Set(["popular", "top", "best", "famous", "budget", "affordable", "cheap", "friendly", "micro", "nano", "emerging", "upcoming", "verified", "active"]);

/** Words that say how to search rather than what for, in English, Roman Urdu and Urdu (v1's list plus activity verbs). */
export const FILLER_V2 = new Set(
  (
    "a about above account accounts all also and any are around at based below between by channel channels creator creators do does find finding follower followers for from " +
    "get give i in influencer influencers is less list look looking make makes making me more need of on only or over page pages platform plus please profile profiles " +
    "named called related search searching show some than that the to under want we which who with content popular pakistani pakistan speaking making covering " +
    "produce produces producing create creates creating post posts posting talk talks talking speak speaks share shares people person someone " +
    "ke ka ki ko mein main me wala wale walay waly wali hai hain se aur karne karnay karte karta karti walon walo " +
    "میں کے کی کا کو اور سے والے والا والی والوں پاکستان پاکستانی تخلیق کار کاروں بنانے کرنے"
  ).split(" "),
);

/** Creator role words: ranking only (a food creator's text may not say "vlogger"). */
export const ROLE_WORDS_V2 = new Set("blogger bloggers vlogger vloggers creator creators artist artists chef chefs host hosts presenter presenters educator educators teacher teachers tutor tutors reviewer reviewers بلاگر بلاگرز ولاگر ولاگرز".split(" "));

/** Content-language cues: a preference about the content, never something MUSHIN asserts about a creator. */
const LANGUAGE_CUES: [RegExp, string][] = [
  [/\broman[\s-]+urdu\b/u, "roman urdu"],
  [/\burdu[\s-]*(?:speaking|speaker|speakers|language)\b|\bin\s+urdu\b|\burdu\s+(?:me|mein)\b|\bspeak(?:s|ing)?\s+urdu\b/u, "urdu"],
  [/\benglish[\s-]*(?:speaking|speaker|speakers|language)\b|\bin\s+english\b|\bspeak(?:s|ing)?\s+english\b/u, "english"],
  [/\bpunjabi[\s-]*(?:speaking|speaker|speakers|language)\b|\bin\s+punjabi\b/u, "punjabi"],
  [/\bpashto[\s-]*(?:speaking|speaker|speakers|language)\b|\bin\s+pashto\b/u, "pashto"],
  [/\bsindhi[\s-]*(?:speaking|speaker|speakers|language)\b|\bin\s+sindhi\b/u, "sindhi"],
];

export function normalizeTerms(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Content-language preferences stated in a query, and the query with those phrases removed. */
export function languageCues(text: string): { languages: string[]; rest: string } {
  let rest = text.normalize("NFKC").toLowerCase();
  const languages: string[] = [];
  for (const [re, lang] of LANGUAGE_CUES) {
    const m = rest.match(re);
    if (m) {
      languages.push(lang);
      rest = rest.replace(re, " ");
    }
  }
  return { languages: [...new Set(languages)], rest };
}

const ALL_V2 = [...NICHES_V2, ...CITIES_V2, ...FORMATS_V2];

/** Every concept whose forms include this word or phrase (normalized). */
export function conceptsOf(term: string): Concept[] {
  const t = normalizeTerms(term);
  return ALL_V2.filter((c) => c.forms.some((f) => normalizeTerms(f) === t));
}

/**
 * Longest-match segmentation of a normalized query into concept hits and leftover words (multi-word forms first, so
 * "urdu literature" is literature, not the word "urdu", and "street food" is food).
 */
export function segment(text: string): ({ concept: Concept; matched: string } | { word: string })[] {
  const tokens = normalizeTerms(text).split(" ").filter(Boolean);
  const out: ({ concept: Concept; matched: string } | { word: string })[] = [];
  for (let i = 0; i < tokens.length; ) {
    let best: { concept: Concept; length: number } | null = null;
    for (const c of ALL_V2) {
      for (const f of c.forms) {
        const parts = normalizeTerms(f).split(" ");
        if (parts.length > tokens.length - i || (best && parts.length <= best.length)) continue;
        if (parts.every((p, k) => tokens[i + k] === p)) best = { concept: c, length: parts.length };
      }
    }
    if (best) {
      out.push({ concept: best.concept, matched: tokens.slice(i, i + best.length).join(" ") });
      i += best.length;
    } else {
      out.push({ word: tokens[i] as string });
      i += 1;
    }
  }
  return out;
}

/** All forms of the niche concepts a free-text topic names (Brain 2: "khana" means the food concept's forms). */
export function topicFormsV2(topic: string): string[] {
  const forms = new Set<string>();
  for (const s of segment(topic)) if ("concept" in s && s.concept.kind === "niche") for (const f of s.concept.forms) forms.add(normalizeTerms(f));
  return [...forms];
}
