import { z } from "zod";
import type { CreatorPlatform } from "../rules";

export type StandardPost = {
  postedAt: Date;
  likes: number | null;
  comments: number | null;
  views: number | null;
  isVideo: boolean;
  isPinned: boolean;
  caption: string;
  hashtags: string[];
};

export type StandardProfile = {
  platform: CreatorPlatform;
  handle: string;
  displayName: string;
  bio: string;
  followers: number;
  following: number | null;
  posts: number | null;
  verified: boolean;
  websiteUrls: string[];
  businessEmail: string | null;
  businessPhone: string | null;
  country: string | null;
  avatarUrl: string | null;
  recentPosts: StandardPost[];
};

export type StandardizeResult = { kind: "ok"; profile: StandardProfile } | { kind: "not_found" } | { kind: "private" };

const LIMITS = { name: 200, bio: 2000, caption: 500, hashtag: 60, url: 300, hashtags: 15, links: 5 };
const record = z.record(z.string(), z.unknown());
const records = z.array(record);
type Rec = z.output<typeof record>;

// Invisible formatting and bidi controls are removed too: they can hide text from a human reviewer.
// eslint-disable-next-line no-control-regex -- this pattern exists to find and remove control characters
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

/** Scraped text is hostile input (SRS §5.3): no markup, no control characters, bounded length. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(CONTROL, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

const count = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= 10_000_000_000 ? Math.round(v) : null;
  if (typeof v === "string" && /^\d{1,11}$/.test(v)) return Number(v);
  return null;
};

const httpUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > LIMITS.url) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
};

const when = (v: unknown): Date | null => {
  const d = typeof v === "number" ? new Date(v * 1000) : typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

const sub = (v: unknown): Rec => {
  const r = record.safeParse(v);
  return r.success ? r.data : {};
};

const tags = (v: unknown): string[] => {
  const list = z.array(z.unknown()).catch([]).parse(v);
  return [
    ...new Set(
      list
        .map((t) => (typeof t === "string" ? t : typeof sub(t)["name"] === "string" ? (sub(t)["name"] as string) : ""))
        .map((t) => cleanText(t.replace(/^#/, ""), LIMITS.hashtag))
        .filter(Boolean),
    ),
  ].slice(0, LIMITS.hashtags);
};

const links = (values: unknown[]): string[] => [...new Set(values.map(httpUrl).filter((u): u is string => u !== null))].slice(0, LIMITS.links);
const urlsIn = (text: string): string[] => text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
const email = (v: unknown): string | null => (typeof v === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
const phone = (v: unknown): string | null => (typeof v === "string" && /^\+?[\d\s().-]{7,20}$/.test(v.trim()) ? v.trim() : null);
const newestFirst = (posts: (StandardPost | null)[], max: number): StandardPost[] =>
  posts.filter((p): p is StandardPost => p !== null).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()).slice(0, max);

function instagram(handle: string, raw: unknown, maxPosts: number): StandardizeResult {
  const first = records.catch([]).parse(raw)[0];
  if (!first || first["error"] !== undefined || typeof first["username"] !== "string") return { kind: "not_found" };
  if (first["private"] === true) return { kind: "private" };
  const followers = count(first["followersCount"]);
  if (followers === null) return { kind: "not_found" };
  const posts = records.catch([]).parse(first["latestPosts"]).map((p): StandardPost | null => {
    const postedAt = when(p["timestamp"]);
    if (!postedAt) return null;
    return {
      postedAt,
      likes: count(p["likesCount"]),
      comments: count(p["commentsCount"]),
      views: count(p["videoViewCount"]),
      isVideo: p["type"] === "Video",
      isPinned: p["isPinned"] === true,
      caption: cleanText(p["caption"], LIMITS.caption),
      hashtags: tags(p["hashtags"]),
    };
  });
  const external = records.catch([]).parse(first["externalUrls"]).map((u) => u["url"]);
  return {
    kind: "ok",
    profile: {
      platform: "instagram",
      handle,
      displayName: cleanText(first["fullName"], LIMITS.name) || handle,
      bio: cleanText(first["biography"], LIMITS.bio),
      followers,
      following: count(first["followsCount"]),
      posts: count(first["postsCount"]),
      verified: first["verified"] === true,
      websiteUrls: links([first["externalUrl"], ...external]),
      businessEmail: email(first["businessEmail"] ?? first["publicEmail"]),
      businessPhone: phone(first["businessPhoneNumber"] ?? first["publicPhoneNumber"]),
      country: null,
      avatarUrl: httpUrl(first["profilePicUrlHD"] ?? first["profilePicUrl"]),
      recentPosts: newestFirst(posts, maxPosts),
    },
  };
}

function tiktok(handle: string, raw: unknown, maxPosts: number): StandardizeResult {
  const items = records.catch([]).parse(raw);
  const author = sub(items[0]?.["authorMeta"]);
  if (typeof author["name"] !== "string") return { kind: "not_found" };
  if (author["privateAccount"] === true) return { kind: "private" };
  const followers = count(author["fans"]);
  if (followers === null) return { kind: "not_found" };
  const posts = items.map((v): StandardPost | null => {
    if (typeof v["id"] !== "string") return null;
    const postedAt = when(v["createTimeISO"] ?? v["createTime"]);
    if (!postedAt) return null;
    return {
      postedAt,
      likes: count(v["diggCount"]),
      comments: count(v["commentCount"]),
      views: count(v["playCount"]),
      isVideo: true,
      isPinned: v["isPinned"] === true,
      caption: cleanText(v["text"], LIMITS.caption),
      hashtags: tags(v["hashtags"]),
    };
  });
  return {
    kind: "ok",
    profile: {
      platform: "tiktok",
      handle,
      displayName: cleanText(author["nickName"], LIMITS.name) || cleanText(author["name"], LIMITS.name) || handle,
      bio: cleanText(author["signature"], LIMITS.bio),
      followers,
      following: count(author["following"]),
      posts: count(author["video"]),
      verified: author["verified"] === true,
      websiteUrls: links([author["bioLink"]]),
      businessEmail: null,
      businessPhone: null,
      country: null,
      avatarUrl: httpUrl(author["originalAvatarUrl"] ?? author["avatar"]),
      recentPosts: newestFirst(posts, maxPosts),
    },
  };
}

function youtube(handle: string, raw: unknown, maxPosts: number): StandardizeResult {
  const body = sub(raw);
  const channel = records.catch([]).parse(sub(body["channel"])["items"])[0];
  if (!channel) return { kind: "not_found" };
  const snippet = sub(channel["snippet"]);
  const stats = sub(channel["statistics"]);
  const thumbs = sub(snippet["thumbnails"]);
  const description = cleanText(snippet["description"], LIMITS.bio);
  const videos = records.catch([]).parse(sub(body["videos"])["items"]).map((v): StandardPost | null => {
    const s = sub(v["snippet"]);
    const st = sub(v["statistics"]);
    const postedAt = when(s["publishedAt"]);
    if (!postedAt) return null;
    return {
      postedAt,
      likes: count(st["likeCount"]),
      comments: count(st["commentCount"]),
      views: count(st["viewCount"]),
      isVideo: true,
      isPinned: false,
      caption: cleanText(s["title"], LIMITS.caption),
      hashtags: tags(s["tags"]),
    };
  });
  const country = typeof snippet["country"] === "string" && /^[A-Z]{2}$/.test(snippet["country"]) ? snippet["country"] : null;
  return {
    kind: "ok",
    profile: {
      platform: "youtube",
      handle,
      displayName: cleanText(snippet["title"], LIMITS.name) || handle,
      bio: description,
      followers: stats["hiddenSubscriberCount"] === true ? 0 : (count(stats["subscriberCount"]) ?? 0),
      following: null,
      posts: count(stats["videoCount"]),
      verified: false,
      websiteUrls: links(urlsIn(description)),
      businessEmail: null,
      businessPhone: null,
      country,
      avatarUrl: httpUrl(sub(thumbs["high"])["url"] ?? sub(thumbs["medium"])["url"] ?? sub(thumbs["default"])["url"]),
      recentPosts: newestFirst(videos, maxPosts),
    },
  };
}

/** Turns a provider's raw response into the one shape the rest of the pipeline uses (spec §5.1 step 3). */
export function standardize(platform: CreatorPlatform, handle: string, raw: unknown, o: { maxPosts: number }): StandardizeResult {
  const h = handle.replace(/^@/, "");
  if (platform === "instagram") return instagram(h, raw, o.maxPosts);
  if (platform === "tiktok") return tiktok(h, raw, o.maxPosts);
  return youtube(h, raw, o.maxPosts);
}
