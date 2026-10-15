import type { MatchReason } from "@mushin/contracts";
import { expandQuery, handleWords, normalizeQuery, type QueryGroup } from "./aliases";
import { nameKey } from "./postgres-search";

/** The searchable text of one creator, as the search projection indexes it. */
export type MatchFields = {
  displayName: string;
  nameVariants: string[];
  handles: string[];
  niches: string[];
  tags: string[];
  city: string | null;
  bio: string;
};

type Field = MatchReason["field"];

const tokens = (text: string) => normalizeQuery(text).split(" ").filter(Boolean);

/** True when every word of `form` appears in order, side by side, in `words` (a phrase match, like phraseto_tsquery). */
function hasPhrase(words: string[], form: string): boolean {
  const parts = tokens(form);
  if (!parts.length) return false;
  for (let i = 0; i + parts.length <= words.length; i += 1) if (parts.every((p, k) => words[i + k] === p)) return true;
  return false;
}

/**
 * Why a catalogue result matched the query (CAT-005): for each query concept or word, the first creator field that
 * contains one of its forms, in the order name, handle, niche, city, tag, bio. It explains the match only; it never
 * changes which creators are returned or their order. A word matched only by a close spelling of the creator's name is
 * reported as `exact: false`. Anything the explanation cannot locate (for example a typo-tolerant match) is left out
 * rather than guessed, so an empty list means "matched, cause not shown", never "did not match".
 */
export function matchReasons(text: string, f: MatchFields): MatchReason[] {
  const groups: QueryGroup[] = expandQuery(text) ?? tokens(text).map((w) => ({ kind: "word" as const, canonical: w, forms: [w] }));
  const fields: [Field, string[][]][] = [
    ["name", [f.displayName, ...f.nameVariants].map(tokens)],
    ["handle", f.handles.map((h) => [...tokens(h.replace(/[._-]+/g, " ")), ...handleWords(h)])],
    ["niche", f.niches.map(tokens)],
    ["city", f.city ? [tokens(f.city)] : []],
    ["tag", f.tags.map(tokens)],
    ["bio", f.bio ? [tokens(f.bio)] : []],
  ];
  const reasons: MatchReason[] = [];
  for (const g of groups) {
    let found: MatchReason | null = null;
    for (const [field, values] of fields) {
      for (const form of g.forms) {
        if (values.some((words) => hasPhrase(words, form))) {
          found = { term: g.canonical, matched: form, field, exact: true };
          break;
        }
      }
      if (found) break;
    }
    if (!found && g.kind === "word" && /^[a-z]+$/.test(g.canonical)) {
      // The name tier: same consonant skeleton as a word of the display name ("Malik" for "Mullick").
      const key = nameKey(g.canonical);
      const word = key.length >= 2 ? tokens(f.displayName).find((w) => /^[a-z]+$/.test(w) && nameKey(w) === key) : undefined;
      if (word) found = { term: g.canonical, matched: word, field: "name", exact: false };
    }
    if (found) reasons.push(found);
  }
  return reasons;
}
