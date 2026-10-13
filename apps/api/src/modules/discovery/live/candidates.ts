import type { WebResult } from "@mushin/integrations";
import { normalizeProfileUrl, type CreatorPlatform } from "../../creators/index";

export type Candidate = { platform: CreatorPlatform; handle: string; canonicalUrl: string; title: string; snippet: string };

/** Instagram post, reel and IGTV links (also under a handle); the short code is group 1. */
export const IG_CONTENT = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/i;
export const isInstagramContent = (url: string): boolean => IG_CONTENT.test(url);

/** Keep a multi-platform brief from consuming its whole extraction cap on the first platform's search ordering. */
export function spreadByPlatform<T extends { platform: CreatorPlatform }>(items: T[]): T[] {
  const buckets = new Map<CreatorPlatform, T[]>([["instagram", []], ["tiktok", []], ["youtube", []]]);
  for (const item of items) buckets.get(item.platform)?.push(item);
  const result: T[] = [];
  for (let index = 0; ; index++) {
    let added = false;
    for (const platform of ["instagram", "tiktok", "youtube"] as const) {
      const item = buckets.get(platform)?.[index];
      if (!item) continue;
      result.push(item);
      added = true;
    }
    if (!added) return result;
  }
}

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
