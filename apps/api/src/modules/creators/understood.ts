import type { InterpretResponse } from "@mushin/contracts";

/**
 * What the AI reading took from a plain-language search, said back to the user (natural-language master prompt §4, §10):
 * each suggested filter is "stated" when its value is written in the request, "inferred" when the AI deduced it; and a
 * campaign purpose ("to promote a new phone") is named as not being a filter, so nobody believes results were ranked for
 * it. Computed from the request and the cleaned suggestion only: it cannot claim anything the filters do not hold.
 */
export type Understood = NonNullable<InterpretResponse["understood"]>;

const PLATFORM_WORDS: Record<string, RegExp> = {
  instagram: /\b(instagram|insta|ig)\b/,
  tiktok: /\b(tiktok|tik tok)\b/,
  youtube: /\b(youtube|yt|you tube)\b/,
};
const NUMBER = /\d+(?:[.,]\d+)?\s*(?:k|m|lakh|lac|million|thousand)?\b/;
// A purpose: "to/for promote…", "who can promote…", "endorse…" (2026-11-15 live evaluation missed "fitness creators who
// can promote a protein supplement"); plain "marketing" is a niche, so it counts only after for/to.
const PURPOSE = /\b(?:(?:for|to)\s+(?:promot\w*|advertis\w*|market\w*|launch\w*|endors\w*|sell\w*)|(?:can|could|will|would|who)\s+(?:promot\w*|advertis\w*|endors\w*))\b[^.,;!?]{0,60}|\b(?:campaign|brand deal|sponsor\w*|collab\w*)\b[^.,;!?]{0,40}/i;

function regionName(code: string): string | null {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function countryStated(text: string, code: string): boolean {
  if (code === "PK" && /(pakistan|پاکستان)/.test(text)) return true;
  const name = regionName(code);
  return name !== null && text.includes(name);
}

export function explainInterpretation(request: string, r: Pick<InterpretResponse, "chips">): Understood {
  const text = request.normalize("NFKC").toLowerCase();
  const c = r.chips;
  const basis: Understood["basis"] = {};
  const mark = (key: string, stated: boolean) => {
    basis[key] = stated ? "stated" : "inferred";
  };
  if (c.platform) mark("platform", PLATFORM_WORDS[c.platform]?.test(text) ?? false);
  if (c.creatorCountry) mark("creatorCountry", countryStated(text, c.creatorCountry));
  if (c.audienceCountry) mark("audienceCountry", /\baudience\b/.test(text) && countryStated(text, c.audienceCountry));
  if (c.creatorCity) mark("creatorCity", text.includes(c.creatorCity.toLowerCase()));
  if (c.followersMin !== undefined || c.followersMax !== undefined) mark("followers", NUMBER.test(text) && /(follower|subscriber|fan|k\b|m\b|lakh|million|thousand)/.test(text));
  if (c.engagementMin !== undefined || c.engagementMax !== undefined) mark("engagement", /(engagement|%|percent)/.test(text));
  if (c.verifiedOnly) mark("verifiedOnly", /(verified|blue tick|bluetick|tick)/.test(text));
  for (const n of c.niches) mark(`niche:${n}`, n.toLowerCase().split(/[\s&,/-]+/).filter((w) => w.length >= 3).some((w) => text.includes(w)));
  const purpose = request.match(PURPOSE)?.[0]?.trim();
  return { basis, notFilters: purpose ? [purpose.slice(0, 80)] : [] };
}
