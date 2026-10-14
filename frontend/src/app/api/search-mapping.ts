import type { CreatorCard, InterpretResponse, LookupResponse, SearchFilters, SearchRequest } from "@mushin/contracts";
import { ApiError } from "./http";
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
const ENGAGEMENT_PRESETS = [2, 5, 8];

type ExtraKey = "creatorCountry" | "audienceCountry" | "followers" | "engagementMin" | "engagement" | "niches";

/** Removes one filter the screen has no control for (`followers` and `engagement` remove both ends of the range). */
export function withoutExtra(extra: Partial<SearchFilters>, key: ExtraKey): Partial<SearchFilters> {
  const { creatorCountry, audienceCountry, followersMin, followersMax, engagementMin, engagementMax, niches, ...rest } = extra;
  return {
    ...rest,
    ...(key !== "creatorCountry" && creatorCountry !== undefined ? { creatorCountry } : {}),
    ...(key !== "audienceCountry" && audienceCountry !== undefined ? { audienceCountry } : {}),
    ...(key !== "followers" && followersMin !== undefined ? { followersMin } : {}),
    ...(key !== "followers" && followersMax !== undefined ? { followersMax } : {}),
    ...(key !== "engagement" && key !== "engagementMin" && engagementMin !== undefined ? { engagementMin } : {}),
    ...(key !== "engagement" && engagementMax !== undefined ? { engagementMax } : {}),
    ...(key !== "niches" && niches !== undefined ? { niches } : {}),
  };
}

/** Labels for every filter the screen has no control for, so none is applied silently (SRS REQ-02.02). */
export function extraChips(extra: Partial<SearchFilters>): { key: ExtraKey; label: string }[] {
  const out: { key: ExtraKey; label: string }[] = [];
  if (extra.creatorCountry) out.push({ key: "creatorCountry", label: extra.creatorCountry });
  if (extra.audienceCountry) out.push({ key: "audienceCountry", label: `Audience ${extra.audienceCountry}` });
  const { followersMin: fMin, followersMax: fMax } = extra;
  if (fMin !== undefined && fMax !== undefined) out.push({ key: "followers", label: `Followers ${formatCount(fMin)}–${formatCount(fMax)}` });
  else if (fMin !== undefined) out.push({ key: "followers", label: `Followers ${formatCount(fMin)}+` });
  else if (fMax !== undefined) out.push({ key: "followers", label: `Followers up to ${formatCount(fMax)}` });
  const { engagementMin: eMin, engagementMax: eMax } = extra;
  if (eMin !== undefined && eMax !== undefined) out.push({ key: "engagement", label: `ER ${eMin}–${eMax}%` });
  else if (eMin !== undefined) out.push({ key: "engagement", label: `ER ${eMin}%+` });
  else if (eMax !== undefined) out.push({ key: "engagement", label: `ER up to ${eMax}%` });
  if (extra.niches && extra.niches.length > 0) out.push({ key: "niches", label: extra.niches.join(" + ") });
  return out;
}

/** The one place the screen's state becomes an API request. */
/** The first page of a search; later pages reuse the request with the cursor the API returned. */
export function requestFor(text: string, ui: UiFilters, confirmedCost: number, cursor?: string): SearchRequest {
  return { text: text.trim(), filters: toFilters(ui), confirmedCost, ...(cursor ? { cursor } : {}) };
}

/** Same request = same query key: re-running it must re-fetch, since setting an equal key fetches nothing. */
export function sameRequest(a: SearchRequest | null, b: SearchRequest | null): boolean {
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 4xx means the request itself is wrong; repeating it cannot help. */
export function shouldRetrySearch(failures: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failures < 2;
}

export function searchErrorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong while searching. Please try again.";
}

export function toFilters(s: UiFilters): SearchFilters {
  const band = s.followerBand ? BANDS[s.followerBand] : undefined;
  const engagementMin = PERCENT(s.minEng);
  const minAuthenticity = PERCENT(s.minScore);
  // A preset the user picked replaces the matching exact value from the AI, so the two can never form an impossible range.
  let extra = s.extra;
  if (band) extra = withoutExtra(extra, "followers");
  if (engagementMin !== undefined) extra = withoutExtra(extra, "engagementMin");
  return {
    ...extra,
    ...(s.platform !== "all" ? { platform: s.platform } : {}),
    ...(s.city ? { creatorCity: s.city } : {}),
    niches: s.niche ? [s.niche] : (extra.niches ?? []),
    ...(band ? band : {}),
    ...(engagementMin !== undefined ? { engagementMin } : {}),
    ...(minAuthenticity !== undefined ? { minAuthenticity } : {}),
    verifiedOnly: s.verifiedOnly,
    hasContact: s.contactOnly,
    freshOnly: s.freshOnly,
  };
}

export type ChipState = Pick<UiFilters, "platform" | "city" | "niche" | "followerBand" | "minEng" | "verifiedOnly" | "extra">;

/**
 * Applying the AI's reading fills in what it read and keeps the user's own choices for anything it did not read:
 * a reading without a platform must not widen an explicit YouTube search to every platform (and its pricing).
 */
export function applySuggestion(current: ChipState, suggested: ChipState): ChipState {
  return {
    platform: suggested.platform === "all" ? current.platform : suggested.platform,
    city: suggested.city ?? current.city,
    niche: suggested.niche ?? current.niche,
    followerBand: suggested.followerBand ?? current.followerBand,
    minEng: suggested.minEng ?? current.minEng,
    verifiedOnly: suggested.verifiedOnly || current.verifiedOnly,
    extra: { ...current.extra, ...suggested.extra },
  };
}

/** AI chips are suggestions (SRS REQ-03.06): they only fill the screen's own filter controls when the user applies them. */
export function fromChips(chips: InterpretResponse["chips"]): ChipState {
  const extra: Partial<SearchFilters> = {};
  if (chips.creatorCountry) extra.creatorCountry = chips.creatorCountry;
  if (chips.audienceCountry) extra.audienceCountry = chips.audienceCountry;
  if (chips.niches.length > 1) extra.niches = chips.niches;
  const band = Object.entries(BANDS).find(
    ([, b]) => b.followersMin === chips.followersMin && (b.followersMax === chips.followersMax || (b.followersMax !== undefined && b.followersMax + 1 === chips.followersMax)),
  )?.[0];
  if (!band) {
    if (chips.followersMin !== undefined) extra.followersMin = chips.followersMin;
    if (chips.followersMax !== undefined) extra.followersMax = chips.followersMax;
  }
  const e = chips.engagementMin;
  const minEng = e !== undefined && ENGAGEMENT_PRESETS.includes(e) ? `${e}%+` : null;
  if (e !== undefined && minEng === null) extra.engagementMin = e;
  if (chips.engagementMax !== undefined) extra.engagementMax = chips.engagementMax;
  return {
    platform: chips.platform ?? "all",
    city: chips.creatorCity ?? null,
    niche: chips.niches.length === 1 ? (chips.niches[0] ?? null) : null,
    followerBand: band ?? null,
    minEng,
    verifiedOnly: chips.verifiedOnly,
    extra,
  };
}

export function formatCount(n: number | null): string {
  if (n === null) return "Unknown";
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
    engagement: c.engagementRate, // unknown stays unknown, never 0
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
    followersNum: null,
    engagement: null,
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

/** Opens the profile panel for a creator known only by id (job results, add-by-link); the panel loads the rest. */
export function creatorStub(id: string, platform: Creator["platform"], handle: string): Creator {
  return matchToCreator({ id, displayName: `@${handle}`, handle, platform, avatarUrl: null });
}
