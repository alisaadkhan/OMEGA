import type { WebResult } from "@mushin/integrations";
import { normalizeProfileUrl, type CreatorPlatform } from "../../creators/index";

export type Candidate = { platform: CreatorPlatform; handle: string; canonicalUrl: string; title: string; snippet: string };

/** Spec §4.2 step 2: result links → unique profiles of the platform searched (posts, reels and app pages are not profiles). */
export function collectCandidates(groups: { platform: CreatorPlatform; results: WebResult[] }[], max = 60): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const g of groups) {
    for (const r of g.results) {
      const n = normalizeProfileUrl(r.link);
      if (!n || n.platform !== g.platform || seen.has(n.canonicalUrl)) continue;
      const handle = (n.canonicalUrl.split("/").pop() ?? "").replace(/^@/, "");
      seen.set(n.canonicalUrl, { platform: n.platform, handle, canonicalUrl: n.canonicalUrl, title: r.title, snippet: r.snippet });
    }
  }
  return [...seen.values()].slice(0, max);
}
