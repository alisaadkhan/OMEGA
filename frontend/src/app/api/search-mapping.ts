import type { CreatorCard, InterpretResponse, LookupResponse, SearchFilters } from "@mushin/contracts";
import type { Creator } from "../components/dashboard/CreatorProfilePanel";
import type { ContactTrust } from "../components/dashboard/states";

export type UiPlatform = "all" | "instagram" | "tiktok" | "youtube";
export type UiFilters = {
  platform: UiPlatform;
  city: string | null;
  niche: string | null;
  followerBand: string | null;
  minEng: string | null;
  minScore: string | null;
  verifiedOnly: boolean;
  contactOnly: boolean;
  freshOnly: boolean;
  /** Filters the screen has no control for (e.g. from AI chips): sent as-is and shown as removable chips. */
  extra: Partial<SearchFilters>;
};

const BANDS: Record<string, { followersMin: number; followersMax?: number }> = {
  "10K–100K": { followersMin: 10_000, followersMax: 99_999 },
  "100K–1M": { followersMin: 100_000, followersMax: 999_999 },
  "1M+": { followersMin: 1_000_000 },
};
const PERCENT = (v: string | null) => (v ? Number.parseInt(v, 10) : undefined);

export function toFilters(s: UiFilters): SearchFilters {
  const band = s.followerBand ? BANDS[s.followerBand] : undefined;
  const engagementMin = PERCENT(s.minEng);
  const minAuthenticity = PERCENT(s.minScore);
  return {
    ...s.extra,
    ...(s.platform !== "all" ? { platform: s.platform } : {}),
    ...(s.city ? { creatorCity: s.city } : {}),
    niches: s.niche ? [s.niche] : (s.extra.niches ?? []),
    ...(band ? band : {}),
    ...(engagementMin !== undefined ? { engagementMin } : {}),
    ...(minAuthenticity !== undefined ? { minAuthenticity } : {}),
    verifiedOnly: s.verifiedOnly,
    hasContact: s.contactOnly,
    freshOnly: s.freshOnly,
  };
}

export type ChipState = Pick<UiFilters, "platform" | "city" | "niche" | "followerBand" | "minEng" | "verifiedOnly" | "extra">;

/** AI chips are suggestions (SRS REQ-03.06): they only fill the screen's own filter controls when the user applies them. */
export function fromChips(chips: InterpretResponse["chips"]): ChipState {
  const extra: Partial<SearchFilters> = {};
  if (chips.creatorCountry) extra.creatorCountry = chips.creatorCountry;
  if (chips.audienceCountry) extra.audienceCountry = chips.audienceCountry;
  if (chips.niches.length > 1) extra.niches = chips.niches;
  if (chips.followersMax !== undefined && chips.followersMin === undefined) extra.followersMax = chips.followersMax;
  if (chips.engagementMax !== undefined) extra.engagementMax = chips.engagementMax;
  const f = chips.followersMin;
  const e = chips.engagementMin;
  return {
    platform: chips.platform ?? "all",
    city: chips.creatorCity ?? null,
    niche: chips.niches[0] ?? null,
    followerBand: f === undefined ? null : f >= 1_000_000 ? "1M+" : f >= 100_000 ? "100K–1M" : "10K–100K",
    minEng: e === undefined ? null : e >= 8 ? "8%+" : e >= 5 ? "5%+" : e >= 2 ? "2%+" : null,
    verifiedOnly: chips.verifiedOnly,
    extra,
  };
}

export function formatCount(n: number): string {
  const trim = (v: string) => v.replace(/\.0$/, "");
  if (n >= 1_000_000) return `${trim((n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1))}M`;
  if (n >= 1_000) return `${trim((n / 1_000).toFixed(n >= 100_000 ? 0 : 1))}K`;
  return String(n);
}

/** A local initials avatar (no third-party image service) for creators without a stored photo. */
export function initialsAvatar(name: string): string {
  const initials = name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#e0e7ff'/><text x='50%' y='54%' text-anchor='middle' dominant-baseline='middle' font-family='Inter,sans-serif' font-size='30' font-weight='600' fill='#4338ca'>${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function toCreator(c: CreatorCard): Creator {
  return {
    id: c.id,
    handle: c.handle,
    name: c.displayName,
    avatar: c.avatarUrl ?? initialsAvatar(c.displayName),
    platform: c.platform,
    city: c.city ?? "",
    niche: c.niches.join(" · "),
    followers: formatCount(c.followers),
    followersNum: c.followers,
    engagement: c.engagementRate ?? 0,
    authenticity: c.authenticityScore,
    fake: c.fakeFollowerPct,
    score: c.fitScore,
    fitLabel: c.fitLabel,
    verified: c.verified,
    posts: 0,
    avgLikes: "—",
    avgComments: "—",
    tags: c.tags,
    followersFreshness: c.followersFreshness,
    hasContact: c.hasContact,
  };
}

/** An omnibar match opens the same profile panel; the panel loads everything else itself. */
export function matchToCreator(m: LookupResponse["matches"][number]): Creator {
  return {
    id: m.id,
    handle: m.handle,
    name: m.displayName,
    avatar: m.avatarUrl ?? initialsAvatar(m.displayName),
    platform: m.platform,
    city: "",
    niche: "",
    followers: "—",
    followersNum: 0,
    engagement: 0,
    authenticity: null,
    fake: null,
    score: 0,
    fitLabel: "",
    verified: false,
    posts: 0,
    avgLikes: "—",
    avgComments: "—",
    tags: [],
    followersFreshness: "stale",
    hasContact: false,
  };
}

export function uiTrust(trust: string): ContactTrust {
  if (trust === "verified") return "verified";
  if (trust === "likely") return "contactable";
  return "unverified";
}
