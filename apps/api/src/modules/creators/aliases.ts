/**
 * Reviewed search vocabulary shared by catalogue Search (Brain 1) and Live Discovery query planning (Brain 2): one
 * concept → its English, Roman Urdu (`roman_urdu`) and Urdu-script forms. Only listed forms are used; nothing is
 * translated or guessed at run time, and an unknown word is searched as typed.
 *
 * `live` keeps the exact Roman Urdu / Urdu phrases Live Discovery has always sent to the web search provider.
 */
export type AliasConcept = {
  kind: "niche" | "city";
  canonical: string;
  /** Lower-case forms, any of which means this concept in a query. */
  forms: readonly string[];
  live?: { roman: string; urdu: string };
};

const niche = (canonical: string, forms: string[], live?: { roman: string; urdu: string }): AliasConcept => ({ kind: "niche", canonical, forms, ...(live ? { live } : {}) });
const city = (canonical: string, forms: string[]): AliasConcept => ({ kind: "city", canonical, forms });

// Niche forms: the terms reviewed for Live Discovery (2026-10-13), unchanged.
export const NICHE_CONCEPTS: readonly AliasConcept[] = [
  niche("food", ["food", "foodie", "khana", "کھانا", "فوڈ"], { roman: "khana foodie", urdu: "کھانا فوڈ" }),
  niche("beauty", ["beauty", "khubsurti", "خوبصورتی", "بیوٹی"], { roman: "khubsurti beauty", urdu: "خوبصورتی بیوٹی" }),
  niche("makeup", ["makeup", "میک اپ"], { roman: "makeup beauty", urdu: "میک اپ بیوٹی" }),
  niche("bridal", ["bridal", "dulhan", "دلہن", "برائیڈل"], { roman: "dulhan bridal", urdu: "دلہن برائیڈل" }),
  niche("fashion", ["fashion", "libaas", "لباس", "فیشن"], { roman: "libaas fashion", urdu: "لباس فیشن" }),
  niche("travel", ["travel", "safar", "سفر", "ٹریول"], { roman: "safar travel", urdu: "سفر ٹریول" }),
  niche("fitness", ["fitness", "warzish", "ورزش", "فٹنس"], { roman: "warzish fitness", urdu: "ورزش فٹنس" }),
  niche("technology", ["technology", "tech", "ٹیکنالوجی", "ٹیک"], { roman: "technology tech", urdu: "ٹیکنالوجی ٹیک" }),
  // Catalogue-only concepts from the Brain 1 panel diagnosis (2026-10-14), approved by the owner 2026-10-15 as query
  // vocabulary only: they widen which documents match, carry no ranking weight, and are not sent to Live Discovery.
  // Urdu forms are standard spellings (search-quality.md, "Concept vocabulary"): the Urdu-script panel queries for
  // skincare and literature could never match their English forms.
  niche("skincare", ["skincare", "skin care", "اسکن کیئر", "سکن کیئر"]),
  // "home cooking" means cooking: requiring "home" lost 8 cooking channels on the panel corpus (Q014).
  niche("cooking", ["cooking", "cook", "recipe", "recipes", "home cooking", "کوکنگ", "ریسپی"]),
  niche("literature", ["literature", "adab", "ادب"]),
  niche("agriculture", ["agriculture", "farming", "zaraat", "زراعت"]),
];

// City forms: Urdu-script names reviewed for Live Discovery, LHR (owner-listed) and the short forms KHI, ISB, RWP, Pindi
// and FSD (owner-approved 2026-10-14). They expand queries deterministically; they never verify a creator's location.
export const CITY_CONCEPTS: readonly AliasConcept[] = [
  city("Lahore", ["lahore", "lhr", "لاہور"]),
  city("Karachi", ["karachi", "khi", "کراچی"]),
  city("Islamabad", ["islamabad", "isb", "اسلام آباد"]),
  city("Rawalpindi", ["rawalpindi", "pindi", "rwp", "راولپنڈی"]),
  city("Peshawar", ["peshawar", "پشاور"]),
  city("Faisalabad", ["faisalabad", "fsd", "فیصل آباد"]),
  city("Multan", ["multan", "ملتان"]),
  city("Quetta", ["quetta", "کوئٹہ"]),
];

const ALL = [...NICHE_CONCEPTS, ...CITY_CONCEPTS];

/** Live Discovery phrases by English topic (food, foodie, food blogger, street food, tech …), as before. */
export const LIVE_TOPIC_TERMS: Record<string, { roman: string; urdu: string }> = {
  ...Object.fromEntries(NICHE_CONCEPTS.flatMap((c) => (c.live ? [[c.canonical, c.live]] : []))),
  foodie: { roman: "khana foodie", urdu: "کھانا فوڈ" },
  "food blogger": { roman: "khana blogger", urdu: "کھانے کا بلاگر" },
  "street food": { roman: "street food khana", urdu: "اسٹریٹ فوڈ کھانا" },
  tech: { roman: "technology tech", urdu: "ٹیکنالوجی ٹیک" },
};

/** Urdu-script city names for Live Discovery queries, keyed by the lower-case English name. */
export const LIVE_PLACE_URDU: Record<string, string> = Object.fromEntries(
  CITY_CONCEPTS.map((c) => [c.canonical.toLowerCase(), c.forms.find((f) => /[؀-ۿ]/u.test(f)) ?? ""]),
);

/** NFKC, lower case, punctuation to spaces; Urdu letters and digits are kept. */
export function normalizeQuery(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export type QueryGroup = { kind: "niche" | "city" | "word"; canonical: string; forms: string[] };

/** Levenshtein distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j] ?? best);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * The one vocabulary word a misspelt Latin-script word most likely means ("peshawer" → "peshawar", "bloogerz" →
 * "bloggers"): at most 1 edit for words of 5–7 letters, 2 from 8 letters; shorter words are never corrected, nor ties
 * between words that mean different things (`meaning` maps a word to what it means; by default itself).
 */
export function closestWord(word: string, vocabulary: Iterable<string>, meaning: (w: string) => string = (w) => w): string | null {
  if (word.length < 5 || !/^[a-z]+$/.test(word)) return null;
  const max = word.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  let tie = false;
  for (const v of vocabulary) {
    if (v === word || !/^[a-z]+$/.test(v)) continue;
    const d = editDistance(word, v, max);
    if (d < bestD) [best, bestD, tie] = [v, d, false];
    else if (d === bestD && best !== null && meaning(v) !== meaning(best)) tie = true;
  }
  return bestD <= max && !tie ? best : null;
}

const SINGLE_WORD_FORMS = new Map(ALL.flatMap((c) => c.forms.filter((f) => !f.includes(" ")).map((f) => [f, c] as const)));

/**
 * Splits a query into groups that must all match; a recognised concept becomes one group of its forms (any of them
 * matches), every other word stays a one-form group. Returns null when nothing was recognised, so the caller keeps its
 * plain behaviour. Multi-word forms ("اسلام آباد", "میک اپ") are matched before single words.
 */
export function expandQuery(text: string): QueryGroup[] | null {
  const q = normalizeQuery(text);
  if (!q) return null;
  const tokens = q.split(" ");
  const groups: QueryGroup[] = [];
  let recognised = false;
  for (let i = 0; i < tokens.length; ) {
    let hit: { concept: AliasConcept; length: number } | null = null;
    for (const concept of ALL) {
      for (const form of concept.forms) {
        const parts = form.split(" ");
        if (parts.length > tokens.length - i) continue;
        if (parts.every((p, k) => tokens[i + k] === p) && (!hit || parts.length > hit.length)) hit = { concept, length: parts.length };
      }
    }
    if (hit) {
      recognised = true;
      if (!groups.some((g) => g.kind === hit.concept.kind && g.canonical === hit.concept.canonical)) {
        groups.push({ kind: hit.concept.kind, canonical: hit.concept.canonical, forms: [...hit.concept.forms] });
      }
      i += hit.length;
    } else {
      const word = tokens[i] ?? "";
      const near = closestWord(word, SINGLE_WORD_FORMS.keys(), (w) => SINGLE_WORD_FORMS.get(w)?.canonical ?? w);
      const concept = near ? SINGLE_WORD_FORMS.get(near) : undefined;
      if (concept) {
        recognised = true;
        if (!groups.some((g) => g.kind === concept.kind && g.canonical === concept.canonical)) groups.push({ kind: concept.kind, canonical: concept.canonical, forms: [...concept.forms] });
      } else {
        groups.push({ kind: "word", canonical: word, forms: [word] });
      }
      i += 1;
    }
  }
  return recognised ? groups : null;
}

/**
 * English concept and city words that can be read inside a joined-up handle. Roman Urdu forms are left out on purpose:
 * short Roman Urdu words hide inside names ("khana" in "khanam").
 */
const HANDLE_VOCABULARY = [...new Set([...ALL.map((c) => c.canonical.toLowerCase()), "foodie", "tech", "pindi", "blogger", "vlogger"])].filter((w) => w.length >= 4 && /^[a-z]+$/.test(w));

/** Vocabulary words inside a handle, for handles that join words together; words the handle already separates are skipped. */
export function handleWords(handle: string): string[] {
  const h = handle.toLowerCase();
  const separated = new Set(h.split(/[^a-z]+/));
  return HANDLE_VOCABULARY.filter((w) => h.includes(w) && !separated.has(w));
}

/** All forms of a city filter value (any alias accepted), or the value itself when it is not a listed city. */
export function cityForms(value: string): string[] {
  const v = normalizeQuery(value);
  const concept = CITY_CONCEPTS.find((c) => c.forms.includes(v) || c.canonical.toLowerCase() === v);
  return concept ? [...concept.forms] : [v];
}
