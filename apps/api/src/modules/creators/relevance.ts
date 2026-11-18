import { closestWord } from "./aliases";
import { CITIES_V2, NICHES_V2, normalizeTerms, type Concept } from "./terminology";

/**
 * Topic-aware relevance plan for catalogue search (owner directive 18 Nov: "search results must genuinely relate to what
 * the user searches for"). Replaces two faults found in the 18 Nov audit:
 *   1. A niche word was matched only as a literal word in the name, bio, niches or tags. "technology" never met the
 *      stored label "Tech", "health" or "fitness" never met "Wellness", and one passing mention in a bio ("I also
 *      play PUBG sometimes") made any creator a match.
 *   2. (search profile v2) A specific topic was widened to its whole niche: "pubg" became every gaming word (game,
 *      games, free fire, esports), so a PUBG search returned GTA, Minecraft and anyone whose bio said "game".
 *
 * Group kinds:
 *   - topic: a specific subject inside a niche (PUBG, cricket, crypto, makeup). The creator's own content must name it:
 *     their name, handle or content tags; or their bio, only when they also have the parent niche. Having the niche
 *     alone is not enough (a GTA channel is not a PUBG channel).
 *   - niche: a whole niche ("gaming", "health", "education"). Matched by the stored niche label only (the corrected,
 *     evidence-based classification); the niche's words in the creator's text only raise the rank within it.
 *   - city / word: unchanged behaviour (a city matches the text or the declared city; a plain word is full text).
 * Every form below is a reviewed spelling or variant; nothing is translated or guessed at run time.
 */
export type RelevanceGroup =
  | { kind: "topic"; canonical: string; parent: string; forms: string[] }
  | { kind: "niche"; canonical: string; labels: string[]; forms: string[] }
  | { kind: "city"; canonical: string; forms: string[] }
  | { kind: "word"; canonical: string; forms: string[] };

export type RelevancePlan = { groups: RelevanceGroup[]; boost: string[] };

type Topic = { key: string; parent: string; forms: string[] };
const topic = (key: string, parent: string, forms: string[]): Topic => ({ key, parent, forms });

/** Specific subjects: searching one of these asks for that subject, never for its whole niche. */
export const SPECIFIC_TOPICS: readonly Topic[] = [
  topic("pubg", "Gaming", ["pubg", "pubgm", "pubg mobile", "pubgmobile", "pubg lite", "bgmi", "battlegrounds", "battleground mobile", "pmgo", "pmpl", "pmcl", "pmwl", "pmsl", "پب جی"]),
  topic("free fire", "Gaming", ["free fire", "freefire", "free fire max", "garena"]),
  topic("gta", "Gaming", ["gta", "gta 5", "gta v", "gtav", "gta5", "grand theft auto"]),
  topic("minecraft", "Gaming", ["minecraft"]),
  topic("valorant", "Gaming", ["valorant"]),
  topic("fortnite", "Gaming", ["fortnite"]),
  topic("call of duty", "Gaming", ["call of duty", "cod mobile", "codm", "warzone"]),
  topic("tekken", "Gaming", ["tekken"]),
  topic("cricket", "Sports", ["cricket", "کرکٹ", "psl", "pakistan super league"]),
  topic("football", "Sports", ["football", "soccer"]),
  topic("crypto", "Finance", ["crypto", "cryptocurrency", "bitcoin", "btc", "blockchain"]),
  topic("stocks", "Finance", ["stocks", "stock market", "psx", "share market", "shares trading"]),
  topic("yoga", "Wellness", ["yoga"]),
  topic("makeup", "Beauty", ["makeup", "make up", "makeup artist", "makeup artists", "mua", "میک اپ", "lipstick"]),
  topic("skincare", "Beauty", ["skincare", "skin care", "اسکن کیئر", "سکن کیئر", "serum", "sunscreen"]),
  topic("cooking", "Food", ["cooking", "cook", "cooks", "recipe", "recipes", "home cooking", "baking", "baker", "کوکنگ", "ریسپی"]),
  topic("biryani", "Food", ["biryani", "بریانی"]),
  topic("bbq", "Food", ["bbq", "barbecue"]),
  topic("car reviews", "Automotive", ["car review", "car reviews"]),
  topic("bikes", "Automotive", ["bike", "bikes", "motorcycle", "motorcycles", "motorbike"]),
  topic("naat", "Religion", ["naat", "نعت", "naats"]),
  topic("quran", "Religion", ["quran", "قرآن", "tilawat", "تلاوت", "qirat"]),
  topic("poetry", "Literature", ["poetry", "poet", "shayari", "shayri", "شاعری", "ghazal", "غزل"]),
];

type Entry = { kind: "topic"; t: Topic } | { kind: "niche"; c: Concept } | { kind: "city"; c: Concept };
const ENTRIES: { parts: string[]; entry: Entry }[] = [
  ...SPECIFIC_TOPICS.flatMap((t) => t.forms.map((f) => ({ parts: normalizeTerms(f).split(" "), entry: { kind: "topic", t } as Entry }))),
  ...NICHES_V2.flatMap((c) => c.forms.map((f) => ({ parts: normalizeTerms(f).split(" "), entry: { kind: "niche", c } as Entry }))),
  ...CITIES_V2.flatMap((c) => c.forms.map((f) => ({ parts: normalizeTerms(f).split(" "), entry: { kind: "city", c } as Entry }))),
].filter((e) => e.parts.length > 0 && e.parts[0] !== "");

/** Single Latin words of the vocabulary, for misspellings ("pubgg" is not corrected: under 5 letters are never guessed). */
const SINGLE = new Map<string, Entry>();
// First entry wins: specific topics are listed first, so "pubg" means the PUBG topic, not its Gaming niche form.
for (const e of ENTRIES) if (e.parts.length === 1 && /^[a-z]+$/.test(e.parts[0] as string) && !SINGLE.has(e.parts[0] as string)) SINGLE.set(e.parts[0] as string, e.entry);
const entryKey = (e: Entry) => (e.kind === "topic" ? `t:${e.t.key}` : `${e.kind}:${e.c.key}`);

/** True when a word is a vocabulary form (a topic, niche or city word); such words are never role or filler words. */
export function isVocabularyWord(word: string): boolean {
  return SINGLE.has(word);
}

/**
 * The relevance plan of a query's topic text (after filler, platform and range words are removed), or null when it names
 * no topic, niche or city: a name or handle search then keeps its plain full-text behaviour. Specific topics win over
 * their niche ("pubg mobile" is PUBG, not Tech because of "mobile"); the longest form wins. Unrecognised words next to a
 * recognised topic only help ranking ("pubg streamers"): requiring them returned nothing.
 */
export function relevancePlan(text: string): RelevancePlan | null {
  const tokens = normalizeTerms(text).split(" ").filter(Boolean);
  const found: Entry[] = [];
  const words: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let best: { entry: Entry; length: number } | null = null;
    for (const e of ENTRIES) {
      const n = e.parts.length;
      if (n > tokens.length - i) continue;
      if (!e.parts.every((p, k) => tokens[i + k] === p)) continue;
      // Longer forms win; at equal length a specific topic wins over a niche word.
      if (!best || n > best.length || (n === best.length && e.entry.kind === "topic" && best.entry.kind !== "topic")) best = { entry: e.entry, length: n };
    }
    if (best) {
      found.push(best.entry);
      i += best.length;
      continue;
    }
    const w = tokens[i] as string;
    const near = /^[a-z]+$/.test(w) ? closestWord(w, SINGLE.keys(), (x) => { const e = SINGLE.get(x); return e ? entryKey(e) : x; }) : null;
    const e = near ? SINGLE.get(near) : undefined;
    if (e) found.push(e);
    else words.push(w);
    i += 1;
  }
  if (found.length === 0) return null;
  const groups: RelevanceGroup[] = [];
  const seen = new Set<string>();
  const topicParents = new Set(found.flatMap((e) => (e.kind === "topic" ? [e.t.parent] : [])));
  for (const e of found) {
    const key = entryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.kind === "topic") groups.push({ kind: "topic", canonical: e.t.key, parent: e.t.parent, forms: uniq(e.t.forms) });
    else if (e.kind === "city") groups.push({ kind: "city", canonical: e.c.key, forms: uniq(e.c.forms) });
    else {
      const label = e.c.niche as string;
      // "PUBG gaming" asks for PUBG; the niche word adds nothing the topic does not already require.
      if (topicParents.has(label)) continue;
      const same = groups.find((g): g is Extract<RelevanceGroup, { kind: "niche" }> => g.kind === "niche" && g.labels.includes(label));
      if (same) same.forms = uniq([...same.forms, ...e.c.forms]);
      else groups.push({ kind: "niche", canonical: e.c.key, labels: [label], forms: uniq(e.c.forms) });
    }
  }
  const topical = groups.some((g) => g.kind === "topic" || g.kind === "niche");
  if (!topical) {
    // Only a city: the other words stay required, as before.
    for (const w of words) groups.push({ kind: "word", canonical: w, forms: [w] });
    return { groups, boost: [] };
  }
  return { groups, boost: words };
}

const uniq = (forms: string[]) => [...new Set(forms.map((f) => normalizeTerms(f)).filter(Boolean))];
