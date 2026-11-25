/**
 * @handles written in a bio without a link (owner, 25 Nov). A bare "@name" is NOT turned into a URL by guessing the
 * platform (many point to an Instagram account or a manager, not TikTok). Only two cases become a link:
 *   1. the bio names the platform right before it: "IG: @name", "insta - name", "TikTok: @name", "tt @name", "YT: @name";
 *   2. the handle is already a profile in the catalogue (resolved by the caller with `bareMentions`), so its platform is known.
 */
export type MentionPlatform = "instagram" | "tiktok" | "youtube";

const HANDLE = "([A-Za-z0-9._]{2,30})";
const PREFIX: [MentionPlatform, string][] = [
  ["instagram", "ig|insta|instagram"],
  ["tiktok", "tt|tiktok|tik tok"],
  ["youtube", "yt|youtube"],
];
const URL_FOR: Record<MentionPlatform, (h: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
};

/** A handle may not end in a dot, and "name.com" is a website, not a handle. */
const clean = (h: string): string | null => {
  const t = h.replace(/\.+$/, "");
  return t.length >= 2 && !/\.(com|pk|net|org|io|me|co)$/i.test(t) ? t : null;
};

/** Handles with a platform named right before them: a separator (":", "-", "|", "→") or an "@" is required. */
export function prefixedHandleUrls(text: string): string[] {
  const out: string[] = [];
  for (const [platform, words] of PREFIX) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])(?:${words})\\s*(?:[:：\\-–—|→]+\\s*@?|@)${HANDLE}`, "gi");
    for (const m of text.matchAll(re)) {
      const h = clean(m[1] ?? "");
      if (h) out.push(URL_FOR[platform](h));
    }
  }
  return out;
}

/** Every "@name" in the text that is not part of an email address or a URL (for the catalogue lookup). */
export function bareMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9._%+\-/@])@([A-Za-z0-9._]{2,30})/g)) {
    const h = clean(m[1] ?? "");
    if (h) out.add(h.toLowerCase());
  }
  return [...out];
}
