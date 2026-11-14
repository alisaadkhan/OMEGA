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

/**
 * The author of an Instagram post or reel as Google titles it: "Name (@handle) on Instagram: ..." or "Name (@handle) •"
 * (owner plan 2026-11-14, Phase 1). Only the author position counts: an @handle inside the quoted caption is often a
 * different account (measured 2026-10-13), so it is never taken from there.
 */
const IG_TITLE_AUTHOR = /^[^"“@]{0,80}?\(\s*@([A-Za-z0-9._]{2,30})\s*\)\s*(?:on Instagram\b|•)/i;
const IG_PATH_AUTHOR = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/([A-Za-z0-9._]{2,30})\/(?:p|reel|reels|tv)\//i;
const IG_RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories"]);
export function instagramPostAuthor(link: string, title: string): string | null {
  if (!IG_CONTENT.test(link)) return null;
  // A handle in the link's path is written by Instagram, not by the account: it wins over the title.
  const path = IG_PATH_AUTHOR.exec(link)?.[1]?.toLowerCase();
  if (path && !IG_RESERVED.has(path)) return path.replace(/\.$/, "");
  // The display name before "(@handle)" is the account's own text: a name that itself holds "(@someone)" could point
  // the parser at another account (security review 2026-11-15), so a title with more than one is not read at all.
  const head = title.trim().split(/["“]/)[0] ?? "";
  if ((head.match(/\(\s*@/g) ?? []).length !== 1) return null;
  const m = IG_TITLE_AUTHOR.exec(title.trim());
  return m ? (m[1] as string).toLowerCase().replace(/\.$/, "") : null;
}

/** Spec §4.2 step 2: result links → unique profiles of the platform searched (posts, reels and app pages are not profiles). */
export function collectCandidates(groups: { platform: CreatorPlatform; results: WebResult[] }[], max = 60): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const g of groups) {
    for (const r of g.results) {
      // A post or reel whose title names its author becomes that author's profile at no extra cost. (TikTok video links
      // already carry the author in the path and normalize to the profile below.)
      const author = g.platform === "instagram" ? instagramPostAuthor(r.link, r.title) : null;
      const n = author ? normalizeProfileUrl(`https://instagram.com/${author}`) : normalizeProfileUrl(r.link);
      if (!n || n.platform !== g.platform || seen.has(n.canonicalUrl)) continue;
      const handle = (n.canonicalUrl.split("/").pop() ?? "").replace(/^@/, "");
      seen.set(n.canonicalUrl, { platform: n.platform, handle, canonicalUrl: n.canonicalUrl, title: r.title, snippet: r.snippet });
    }
  }
  return [...seen.values()].slice(0, max);
}
