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

const niche = (canonical: string, forms: string[], live: { roman: string; urdu: string }): AliasConcept => ({ kind: "niche", canonical, forms, live });
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
];

// City forms: Urdu-script names reviewed for Live Discovery, LHR (owner-listed) and common short forms (KHI, ISB,
// RWP, Pindi, FSD) listed in docs/readiness/search-aliases.md for confirmation.
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
      groups.push({ kind: "word", canonical: word, forms: [word] });
      i += 1;
    }
  }
  return recognised ? groups : null;
}

/** All forms of a city filter value (any alias accepted), or the value itself when it is not a listed city. */
export function cityForms(value: string): string[] {
  const v = normalizeQuery(value);
  const concept = CITY_CONCEPTS.find((c) => c.forms.includes(v) || c.canonical.toLowerCase() === v);
  return concept ? [...concept.forms] : [v];
}
