import type { InterpretResponse, SearchFilters } from "@mushin/contracts";

/**
 * Follow-up searches (natural-language master prompt §13, 2026-11-16): after "Pakistani gaming creators", a message like
 * "only YouTube" or "at least 50k" refines that search instead of starting an unrelated one. The AI reads the new message
 * on its own (as for any search); this combines that reading with the current search by fixed rules, so nothing is
 * carried over or dropped without being said:
 *   - a different niche, or "new search" / "start over", starts a new search (old filters are not carried into it);
 *   - otherwise every current filter is kept unless the message sets it again or clears it ("any platform");
 *   - a new value that contradicts a kept one (at least 100K after at most 50K) replaces it, and the reply says so.
 */
export type Previous = { text: string; filters: SearchFilters };
export type FollowUp = { mode: "refine" | "new"; text: string; kept: string[]; replaced: string[]; cleared: string[] };
type Chips = InterpretResponse["chips"];

const NEW_SEARCH = /\b(new search|start (?:over|again)|fresh search|something else|different search)\b/i;
const CLEAR: Record<string, RegExp> = {
  platform: /\b(any|all|every) platforms?\b/i,
  creatorCity: /\b(any|all) cit(?:y|ies)\b|\banywhere\b/i,
  followers: /\b(any (?:size|follower count|number of followers)|no follower (?:limit|minimum|maximum))\b/i,
  engagement: /\b(any engagement|no engagement (?:limit|minimum))\b/i,
  verifiedOnly: /\b(not only verified|verified or not|unverified (?:too|also|as well))\b/i,
};
const LABEL: Record<string, string> = {
  platform: "platform",
  creatorCountry: "country",
  creatorCity: "city",
  audienceCountry: "audience country",
  followers: "follower range",
  engagement: "engagement range",
  niches: "niche",
  verifiedOnly: "verified only",
};
// Words that only steer the follow-up; they are not topics to search for.
const FILLER = new Set(["only", "just", "also", "and", "with", "at", "least", "most", "more", "less", "than", "now", "show", "me", "creators", "influencers", "please", "but", "the", "a", "on", "from", "in", "followers", "subscribers"]);

const has = (f: Partial<Chips>, key: string): boolean => {
  if (key === "followers") return f.followersMin !== undefined || f.followersMax !== undefined;
  if (key === "engagement") return f.engagementMin !== undefined || f.engagementMax !== undefined;
  if (key === "niches") return (f.niches ?? []).length > 0;
  if (key === "verifiedOnly") return f.verifiedOnly === true;
  return f[key as keyof Chips] !== undefined;
};
const KEYS = ["platform", "creatorCountry", "creatorCity", "audienceCountry", "followers", "engagement", "niches", "verifiedOnly"] as const;

export function combineFollowUp(prev: Previous, next: InterpretResponse, message: string): { chips: Chips; followUp: FollowUp; basis: InterpretResponse["understood"]["basis"] } {
  const prevNiches = prev.filters.niches;
  const changesNiche = next.chips.niches.length > 0 && prevNiches.length > 0 && !next.chips.niches.some((n) => prevNiches.includes(n));
  if (NEW_SEARCH.test(message) || changesNiche) {
    return { chips: next.chips, followUp: { mode: "new", text: message.trim(), kept: [], replaced: [], cleared: [] }, basis: next.understood.basis };
  }
  const p = prev.filters;
  const n = next.chips;
  const cleared = KEYS.filter((k) => CLEAR[k]?.test(message) && has(p, k) && !has(n, k));
  const keep = (k: string) => !cleared.includes(k as (typeof KEYS)[number]);
  const chips: Chips = {
    niches: n.niches.length > 0 ? n.niches : keep("niches") ? p.niches : [],
    verifiedOnly: n.verifiedOnly || (keep("verifiedOnly") && p.verifiedOnly),
    hasContact: p.hasContact,
    freshOnly: p.freshOnly,
  };
  for (const k of ["platform", "creatorCountry", "creatorCity", "audienceCountry"] as const) {
    const v = n[k] ?? (keep(k) ? p[k] : undefined);
    if (v !== undefined) (chips as Record<string, unknown>)[k] = v;
  }
  const replaced: string[] = [];
  // Ranges: a bound the message sets wins; a kept bound that contradicts it is replaced, and named in the reply.
  for (const [key, lo, hi] of [["followers", "followersMin", "followersMax"], ["engagement", "engagementMin", "engagementMax"]] as const) {
    let min = n[lo] ?? (keep(key) ? p[lo] : undefined);
    let max = n[hi] ?? (keep(key) ? p[hi] : undefined);
    if (min !== undefined && max !== undefined && min > max) {
      if (n[lo] !== undefined) max = undefined;
      else min = undefined;
      replaced.push(LABEL[key] ?? key);
    }
    if (min !== undefined) chips[lo] = min;
    if (max !== undefined) chips[hi] = max;
  }
  if (p.minAuthenticity !== undefined) chips.minAuthenticity = p.minAuthenticity;

  const kept = KEYS.filter((k) => has(p, k) && keep(k) && !has(n, k)).map((k) => LABEL[k] ?? k);
  for (const k of KEYS) if (has(p, k) && has(n, k) && JSON.stringify(pick(p, k)) !== JSON.stringify(pick(n, k)) && !replaced.includes(LABEL[k] ?? k)) replaced.push(LABEL[k] ?? k);
  const prevWords = new Set(prev.text.toLowerCase().split(/\s+/));
  const extra = next.keywords.map((w) => w.trim()).filter((w) => w && !FILLER.has(w.toLowerCase()) && !prevWords.has(w.toLowerCase()));
  const basis: InterpretResponse["understood"]["basis"] = { ...next.understood.basis };
  for (const k of KEYS) if (has(p, k) && keep(k) && !has(n, k)) basis[k === "niches" ? "niche" : k] = "kept";
  return {
    chips,
    followUp: { mode: "refine", text: [prev.text.trim(), ...extra].filter(Boolean).join(" ").slice(0, 300), kept, replaced, cleared: cleared.map((k) => LABEL[k] ?? k) },
    basis,
  };
}

function pick(f: Partial<Chips>, key: string): unknown {
  if (key === "followers") return [f.followersMin, f.followersMax];
  if (key === "engagement") return [f.engagementMin, f.engagementMax];
  return f[key as keyof Chips];
}
