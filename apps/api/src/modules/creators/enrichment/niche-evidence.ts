import { NICHES_V2, normalizeTerms } from "../terminology";
import { quote } from "./quote";

/**
 * Niche classification (owner instruction 2026-10-26). A niche is what the creator regularly makes, not a word that
 * appears once. One canonical taxonomy (terminology.ts → platform.niches labels):
 *   1. Bio first: the bio and the platform's own account category. When they clearly name one subject, that is the
 *      main niche and nothing else is needed (no extra AI call).
 *   2. Otherwise (empty, vague or mixed bio), up to 12 recent posts already fetched: a subject in at least 40% of them
 *      (and at least 3) is the main niche; other subjects in at least 25% are secondary (at most two).
 *   3. Several subjects and none dominant: "variety". Too little evidence: "unknown". Never a guess.
 * The display name is weak evidence only ("Marketing Mughal" is not a marketing creator). Format words ("how to",
 * "tutorial", "DIY") count for Education & How-to only when a post or bio names no other subject, so a recipe channel's
 * "how to make biryani" stays Food. The AI's reading is used only to break an exact tie between two subjects the text
 * already supports; an unsupported AI niche (its Lifestyle fallback) is recorded as weak and never stored.
 */
export type NicheStatus = "classified" | "variety" | "unknown";
export type NicheConfidence = "high" | "medium" | "low";
export type NicheObservation = {
  value: string;
  source: "profile_text" | "post_text" | "account_category" | "display_name" | "ai_assessment";
  status: "supported" | "weak" | "conflicting";
  evidence: string;
};
/**
 * `clear`: the evidence is trivially unambiguous (one structured platform category, or a short bio with one obvious
 * subject, no negation or contrast, not contradicted by recent posts), so no semantic (AI) reading is needed. Every
 * other decision is only the rules' first reading and goes to semantic classification where that is permitted.
 */
export type NicheDecision = { status: NicheStatus; main: string | null; niches: string[]; confidence: NicheConfidence | null; observations: NicheObservation[]; clear?: boolean };

export const MAX_POSTS_FOR_NICHE = 12;
const MIN_POSTS = 4;
// Negation, contrast, satire: the words alone may say the opposite of the meaning ("not a food channel").
const CONTRAST = /\b(?:not|no|never|don'?t|doesn'?t|isn'?t|instead|but|except|unlike|satire|satirical|parody|spoof|nahi|nahin|nai)\b|نہیں|بلکہ/iu;
// Above this length a bio that names several subjects equally is not evidence of Variety on its own.
const SHORT_BIO = 300;
const EDUCATION = "Education & How-to";
const FORMAT_FORMS = new Set(["how to", "howto", "tutorial", "tutorials", "diy"]);
// Search forms too general to prove a niche on their own (they still count for search).
export const WEAK_NICHE_FORMS = new Set(["style", "styling", "explore", "exploring", "tour", "trip", "trips", "glow", "lawn", "health", "healthy", "diet", "mobile", "mobiles", "phone", "phones", "game", "games", "study", "studies", "learning", "money", "savings", "trading", "car", "cars", "auto", "autos", "bike", "bikes", "farm", "routine", "marketing", "sketch", "memes", "song", "songs", "drama", "film", "films", "movie", "movies", "property", "properties", "sport", "khel", "کھیل", "news", "political", "exam", "exams", "course", "courses", "science"]);

/** Whole-word (or whole-phrase) occurrence of a normalized form in normalized text; Urdu forms match as substrings. */
export function mentions(text: string, form: string): boolean {
  const f = normalizeTerms(form);
  if (!f) return false;
  return /[؀-ۿ]/u.test(f) ? text.includes(f) : ` ${text} `.includes(` ${f} `);
}

// Contact boilerplate ("for business inquiries email…") says how to reach the creator, not what they make.
const CONTACT_BOILERPLATE = /\b(?:for\s+)?business\s+(?:inquir\w*|enquir\w*|e ?mail\w*|contact\w*|quer\w*|purpose\w*|collab\w*|deal\w*|only|related|partnership\w*|promotion\w*|sponsor\w*)\b|\bfor\s+business\b/gu;

/** Labels a normalized text names, each with the distinct forms that named it. */
function labelsIn(raw: string, opts: { strongOnly: boolean }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const text = raw.replace(CONTACT_BOILERPLATE, " ");
  if (!text.trim()) return out;
  for (const c of NICHES_V2) {
    if (!c.niche) continue;
    const forms = c.forms.filter((f) => !opts.strongOnly || !WEAK_NICHE_FORMS.has(f)).filter((f) => mentions(text, f));
    if (forms.length) out.set(c.niche, [...new Set([...(out.get(c.niche) ?? []), ...forms])]);
  }
  // "How to" + another subject is that subject told as a tutorial.
  const edu = out.get(EDUCATION);
  if (edu && out.size > 1 && edu.every((f) => FORMAT_FORMS.has(f))) out.delete(EDUCATION);
  return out;
}

const ranked = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

type PostReading = { kind: "classified"; main: string; secondary: string[]; confidence: NicheConfidence; counts: Map<string, number>; n: number } | { kind: "variety"; labels: string[]; confidence: NicheConfidence; counts: Map<string, number>; n: number } | { kind: "tie"; labels: [string, string]; counts: Map<string, number>; n: number } | { kind: "insufficient"; counts: Map<string, number>; n: number };

function readPosts(posts: string[]): PostReading {
  const texts = posts.map((p) => normalizeTerms(p)).filter(Boolean);
  const counts = new Map<string, number>();
  for (const t of texts) for (const label of labelsIn(t, { strongOnly: true }).keys()) counts.set(label, (counts.get(label) ?? 0) + 1);
  const n = texts.length;
  if (n < MIN_POSTS || counts.size === 0) return { kind: "insufficient", counts, n };
  const r = ranked(counts);
  const [l1, c1] = r[0] as [string, number];
  const c2 = r[1]?.[1] ?? 0;
  const secondary = (main: string) => r.filter(([l, c]) => l !== main && c >= 2 && c / n >= 0.25).slice(0, 2).map(([l]) => l);
  if (c1 >= 3 && c1 / n >= 0.4 && c1 > c2) return { kind: "classified", main: l1, secondary: secondary(l1), confidence: c1 / n >= 0.6 ? "high" : "medium", counts, n };
  if (c1 >= 3 && c1 / n >= 0.25 && c1 >= 2 * c2) return { kind: "classified", main: l1, secondary: secondary(l1), confidence: "low", counts, n };
  const several = r.filter(([, c]) => c >= 2 && c / n >= 0.15);
  if (several.length === 2 && c1 === c2 && c1 >= 3) return { kind: "tie", labels: [l1, r[1]?.[0] as string], counts, n };
  if (several.length >= 2) return { kind: "variety", labels: several.slice(0, 3).map(([l]) => l), confidence: several.length >= 3 ? "medium" : "low", counts, n };
  return { kind: "insufficient", counts, n };
}

export function classifyNiche(o: { displayName: string; bio: string; accountCategory: string | null; posts: string[]; aiNiches: readonly string[] }): NicheDecision {
  const observations: NicheObservation[] = [];
  const bioNorm = normalizeTerms(o.bio);
  const catNorm = normalizeTerms(o.accountCategory ?? "");
  const bioLabels = labelsIn(bioNorm, { strongOnly: true });
  const catLabels = labelsIn(catNorm, { strongOnly: false });
  // Score = distinct forms in the bio, +2 when the platform's own category names it.
  const score = new Map<string, number>();
  for (const [l, f] of bioLabels) score.set(l, f.length);
  for (const l of catLabels.keys()) score.set(l, (score.get(l) ?? 0) + 2);
  const bioRank = ranked(score);
  const [b1, s1] = bioRank[0] ?? [null, 0];
  const s2 = bioRank[1]?.[1] ?? 0;
  const bioClear = b1 !== null && (bioRank.length === 1 || s1 >= 2 * s2);
  const bioRow = (label: string, status: NicheObservation["status"]): NicheObservation =>
    catLabels.has(label) && !bioLabels.has(label)
      ? { value: label, source: "account_category", status, evidence: `Account category on the platform: ${o.accountCategory}` }
      : { value: label, source: "profile_text", status, evidence: quote(o.bio, bioLabels.get(label)?.[0] ?? "") };

  // The name never decides; it is recorded so a reviewer can see it was considered.
  for (const [l, f] of labelsIn(normalizeTerms(o.displayName), { strongOnly: true })) {
    if (!score.has(l)) observations.push({ value: l, source: "display_name", status: "weak", evidence: `Only the name suggests it ("${f[0]}"); a name alone is not evidence of what the creator makes` });
  }

  const posts = readPosts(o.posts.slice(0, MAX_POSTS_FOR_NICHE));
  const postNote = (l: string) => `${posts.counts.get(l) ?? 0} of ${posts.n} recent posts`;
  const postRow = (l: string): NicheObservation => ({ value: l, source: "post_text", status: "supported", evidence: `${postNote(l)} are about it` });
  const ai = (stored: string[]) => {
    for (const n of o.aiNiches) if (!stored.includes(n)) observations.push({ value: n, source: "ai_assessment", status: "weak", evidence: "Chosen by the AI assessment; the creator's bio and recent posts do not support it" });
  };
  const done = (d: Omit<NicheDecision, "observations">): NicheDecision => {
    ai(d.niches);
    return { ...d, clear: d.clear ?? false, observations };
  };

  if (bioClear && b1) {
    // A clear bio decides, unless the recent posts plainly contradict it (a fashion bio over a channel of recipes).
    const contradicted = posts.kind === "classified" && posts.main !== b1 && posts.confidence !== "low" && (posts.counts.get(b1) ?? 0) <= 1;
    if (contradicted && posts.kind === "classified") {
      observations.push(bioRow(b1, "conflicting"), postRow(posts.main), ...posts.secondary.map(postRow));
      return done({ status: "classified", main: posts.main, niches: [posts.main, ...posts.secondary], confidence: "medium" });
    }
    const secondary = bioRank.slice(1).filter(([, s]) => s >= 1).slice(0, 2).map(([l]) => l);
    const confirmed = posts.kind !== "insufficient" && (posts.counts.get(b1) ?? 0) >= 2;
    observations.push(bioRow(b1, "supported"), ...secondary.map((l) => bioRow(l, "supported")));
    const confidence = s1 >= 2 || confirmed ? "high" : "medium";
    // Clear only when the meaning cannot hide behind the words: one subject, a short bio, no negation or contrast, and
    // recent posts that do not point elsewhere (or no posts to read). A structured category alone is clear too.
    const onlyCategory = catLabels.size === 1 && bioLabels.size === 0;
    const shortPlain = o.bio.trim().length <= SHORT_BIO && !CONTRAST.test(o.bio) && bioRank.length === 1;
    const postsAgree = posts.kind === "insufficient" || (posts.counts.get(b1) ?? 0) / Math.max(posts.n, 1) >= 0.25;
    return done({ status: "classified", main: b1, niches: [b1, ...secondary], confidence, clear: postsAgree && (onlyCategory || shortPlain) });
  }

  if (posts.kind === "classified") {
    observations.push(postRow(posts.main), ...posts.secondary.map(postRow));
    return done({ status: "classified", main: posts.main, niches: [posts.main, ...posts.secondary], confidence: posts.confidence });
  }
  if (posts.kind === "tie") {
    const pick = o.aiNiches.find((n) => posts.labels.includes(n));
    if (pick) {
      const other = posts.labels.find((l) => l !== pick) as string;
      observations.push({ value: pick, source: "ai_assessment", status: "supported", evidence: `AI broke a tie between ${posts.labels.join(" and ")} (${postNote(pick)} each)` }, postRow(other));
      return done({ status: "classified", main: pick, niches: [pick, other], confidence: "low" });
    }
    observations.push(...posts.labels.map(postRow));
    return done({ status: "variety", main: null, niches: [...posts.labels], confidence: "low" });
  }
  if (posts.kind === "variety") {
    observations.push(...posts.labels.map(postRow));
    return done({ status: "variety", main: null, niches: posts.labels, confidence: posts.confidence });
  }
  // A short bio that lists several subjects equally, with no posts to weigh them ("travel / fashion / food vlogs"). A long
  // description names many things in passing, so without posts it is not enough to call the creator Variety.
  if (bioRank.length >= 2 && o.bio.trim().length > SHORT_BIO) {
    for (const [l] of bioRank.slice(0, 3)) observations.push({ ...bioRow(l, "weak"), evidence: `Named in a long description among other subjects: ${quote(o.bio, bioLabels.get(l)?.[0] ?? "")}` });
    return done({ status: "unknown", main: null, niches: [], confidence: null });
  }
  if (bioRank.length >= 2) {
    const labels = bioRank.slice(0, 3).map(([l]) => l);
    observations.push(...labels.map((l) => bioRow(l, "supported")));
    return done({ status: "variety", main: null, niches: labels, confidence: "low" });
  }
  return done({ status: "unknown", main: null, niches: [], confidence: null });
}
