import { z } from "zod";

/**
 * Every link a creator shows in a bio or About section, classified once for the API and the UI (owner, 24 Nov: "parse
 * all bio/about links and render them as clean platform icons"). Pure and shared: the API classifies stored links, the
 * frontend draws one icon per kind. A link is never shown as raw text.
 */
export const LINK_KINDS = [
  "instagram", "youtube", "tiktok",
  "linktree", "beacons", "taplink", "hoobe", "biosite", "campsite",
  "whatsapp", "facebook", "x", "snapchat", "linkedin", "threads", "twitch", "discord", "spotify",
  "website",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const bioLinkSchema = z.object({
  kind: z.enum(LINK_KINDS),
  url: z.string(),
  /** What the tooltip says: the platform name, then the handle or the domain ("Instagram · @handle", "Linktree"). */
  label: z.string(),
  handle: z.string().nullable(),
});
export type BioLink = z.infer<typeof bioLinkSchema>;

export const LINK_KIND_NAME: Record<LinkKind, string> = {
  instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok",
  linktree: "Linktree", beacons: "Beacons", taplink: "Taplink", hoobe: "hoo.be", biosite: "Bio.site", campsite: "Campsite",
  whatsapp: "WhatsApp", facebook: "Facebook", x: "X", snapchat: "Snapchat", linkedin: "LinkedIn", threads: "Threads",
  twitch: "Twitch", discord: "Discord", spotify: "Spotify", website: "Website",
};

/** Host (without www./m.) → kind, and whether the first path segment is the handle. */
const HOSTS: { test: RegExp; kind: LinkKind; handleAt?: "path" | "at-path" }[] = [
  { test: /^instagram\.com$|^instagr\.am$/, kind: "instagram", handleAt: "path" },
  { test: /^youtube\.com$|^youtu\.be$/, kind: "youtube", handleAt: "at-path" },
  { test: /^tiktok\.com$|^vm\.tiktok\.com$/, kind: "tiktok", handleAt: "at-path" },
  { test: /^linktr\.ee$/, kind: "linktree", handleAt: "path" },
  { test: /^beacons\.ai$|^beacons\.page$/, kind: "beacons", handleAt: "path" },
  { test: /(^|\.)taplink\.(cc|at|ws)$/, kind: "taplink", handleAt: "path" },
  { test: /^hoo\.be$/, kind: "hoobe", handleAt: "path" },
  { test: /^bio\.site$/, kind: "biosite", handleAt: "path" },
  { test: /^campsite\.bio$/, kind: "campsite", handleAt: "path" },
  { test: /^wa\.me$|^wa\.link$|^(api|web|chat)\.whatsapp\.com$|^whatsapp\.com$/, kind: "whatsapp" },
  { test: /^facebook\.com$|^fb\.com$|^fb\.me$/, kind: "facebook", handleAt: "path" },
  { test: /^x\.com$|^twitter\.com$/, kind: "x", handleAt: "path" },
  { test: /^snapchat\.com$/, kind: "snapchat" },
  { test: /^linkedin\.com$|^lnkd\.in$/, kind: "linkedin" },
  { test: /^threads\.net$|^threads\.com$/, kind: "threads", handleAt: "at-path" },
  { test: /^twitch\.tv$/, kind: "twitch", handleAt: "path" },
  { test: /^discord\.gg$|^discord\.com$/, kind: "discord" },
  { test: /^open\.spotify\.com$|^spotify\.com$|^spotify\.link$/, kind: "spotify" },
];

/** Path segments that are pages, not a person (instagram.com/p/…, youtube.com/watch…). */
const NOT_A_HANDLE = new Set(["p", "reel", "reels", "stories", "explore", "watch", "channel", "c", "user", "shorts", "playlist", "video", "share", "sharer", "pages", "profile.php", "groups", "add", "in", "company", "send", "intent", "home", "hashtag", "t", "invite"]);

function parse(raw: string): URL | null {
  const s = raw.trim().replace(/[)\].,;!'"]+$/, "");
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  // Only web links: mailto:, tel:, javascript: and the like are never shown as a link icon.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) && !/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** One link → its kind, a clean https URL, the tooltip label and the handle when the URL names one. Null for junk. */
/** A creator-written path segment; malformed percent-encoding ("%E0%A4%A") stays as written instead of throwing. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function classifyLink(raw: string): BioLink | null {
  const u = parse(raw);
  if (!u || !/\.[a-z]{2,}$/i.test(u.hostname)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const rule = HOSTS.find((h) => h.test.test(host));
  const kind: LinkKind = rule?.kind ?? "website";
  const first = safeDecode(u.pathname.split("/").filter(Boolean)[0] ?? "");
  let handle: string | null = null;
  if (rule?.handleAt === "at-path" && first.startsWith("@")) handle = first.slice(1);
  else if (rule?.handleAt === "path" && first && !NOT_A_HANDLE.has(first.toLowerCase())) handle = first.replace(/^@/, "");
  if (handle && !/^[\p{L}\p{N}._-]{1,60}$/u.test(handle)) handle = null;
  u.protocol = "https:";
  u.hash = "";
  const url = u.toString().replace(/\/$/, "");
  const name = LINK_KIND_NAME[kind];
  const label = kind === "website" ? host : handle ? `${name} · @${handle}` : name;
  return { kind, url, label, handle };
}

/** Classified and de-duplicated: one entry per destination (case, www., trailing slash and http/https ignored). */
export function bioLinksFrom(urls: readonly string[], max = 12): BioLink[] {
  const seen = new Set<string>();
  const out: BioLink[] = [];
  for (const raw of urls) {
    const l = classifyLink(raw);
    if (!l) continue;
    const key = l.url.toLowerCase().replace(/^https:\/\/(www\.|m\.)?/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}
