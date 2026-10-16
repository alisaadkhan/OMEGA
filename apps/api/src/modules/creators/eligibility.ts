import { AppError } from "@mushin/core";
import type { CreatorPlatform } from "./rules";
import { isMinorProtected, normalizeProfileUrl } from "./rules";

/**
 * Creator display eligibility (owner requirement 2026-10-16): a hard, server-side gate applied before ranking. A creator
 * is shown to customers (Search, Live Discovery delivery, list and campaign additions) only if the creator record is
 * active and not a protected possible minor, and at least one of their own supported profiles qualifies on its own:
 *   - a valid canonical profile URL on a supported platform;
 *   - a known follower/subscriber count of at least MIN_FOLLOWERS on that profile, observed within maxFollowerAgeDays
 *     (unknown or stale counts never pass by assumption);
 *   - not known to be inactive (latest public post older than activityDays).
 * Activity that the stored evidence cannot show is reported as `activity_unverified` (visible, never silently passed and
 * never invented); it does not exclude, because records collected before the policy carry no post dates.
 * Eligibility is separate from relevance and from the fit score: ineligible creators are filtered, eligible ones ranked.
 * Records are never deleted by this policy; saved list and campaign entries stay and are labelled.
 */
export const ELIGIBILITY_VERSION = "elig-1";
export const MIN_FOLLOWERS = 10_000;

export type EligibilitySettings = { minFollowers: number; maxFollowerAgeDays: number; activityDays: number };
/**
 * Owner rules: 10,000 (2026-10-16) and a count no older than 90 days (confirmed 2026-10-16; older or unknown counts do not
 * qualify until refreshed). Posting activity is a separate 90-day window, matching the Live Discovery activity rule.
 */
export const DEFAULT_ELIGIBILITY: EligibilitySettings = { minFollowers: MIN_FOLLOWERS, maxFollowerAgeDays: 90, activityDays: 90 };

/** Stable reason codes (stored with the search document and shown to staff). */
export type ProfileReason = "invalid_profile_url" | "followers_unknown" | "followers_stale" | "below_follower_minimum" | "inactive";
export type CreatorReason = "creator_not_active" | "minor_protected" | "no_profile";
export type EligibilityFlag = "activity_unverified";

export type EligibilityProfile = {
  platform: CreatorPlatform;
  canonicalUrl: string;
  /** null when unknown (YouTube 0 = hidden count is passed in as null). */
  followers: number | null;
  followersUpdatedAt: Date | string | null;
  lastPostAt?: Date | string | null;
};
export type EligibilityCreator = { status: string; isMinor: boolean; minorOverrideByStaffId: string | null };

export type ProfileEligibility = {
  platform: CreatorPlatform;
  canonicalUrl: string;
  qualifies: boolean;
  reasons: ProfileReason[];
  flags: EligibilityFlag[];
  /** When this qualifying profile's evidence expires (count too old, or latest post outside the window); null if not qualifying. */
  qualifiesUntil: Date | null;
};
export type CreatorEligibility = {
  version: string;
  eligible: boolean;
  /** Why not eligible: creator-level reasons, then every profile reason (deduplicated). Empty when eligible. */
  reasons: (CreatorReason | ProfileReason)[];
  /** Until when the creator stays eligible without new evidence (latest expiry of a qualifying profile); null if not eligible. */
  eligibleUntil: Date | null;
  /** Platforms whose own profile qualifies (only these may be shown as meeting the threshold). */
  qualifyingPlatforms: CreatorPlatform[];
  flags: EligibilityFlag[];
  profiles: ProfileEligibility[];
};

const DAY = 86_400_000;
const time = (v: Date | string | null | undefined): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

export function profileEligibility(p: EligibilityProfile, now: Date, s: EligibilitySettings = DEFAULT_ELIGIBILITY): ProfileEligibility {
  const reasons: ProfileReason[] = [];
  const flags: EligibilityFlag[] = [];
  const url = normalizeProfileUrl(p.canonicalUrl);
  if (!url || url.canonicalUrl !== p.canonicalUrl || url.platform !== p.platform) reasons.push("invalid_profile_url");
  const seen = time(p.followersUpdatedAt);
  if (p.followers === null || !Number.isFinite(p.followers)) reasons.push("followers_unknown");
  else if (seen === null || now.getTime() - seen > s.maxFollowerAgeDays * DAY) reasons.push("followers_stale");
  else if (p.followers < s.minFollowers) reasons.push("below_follower_minimum");
  const last = time(p.lastPostAt);
  if (last === null) flags.push("activity_unverified");
  else if (now.getTime() - last > s.activityDays * DAY) reasons.push("inactive");
  const qualifies = reasons.length === 0;
  const until = qualifies && seen !== null ? Math.min(seen + s.maxFollowerAgeDays * DAY, last === null ? Infinity : last + s.activityDays * DAY) : null;
  return { platform: p.platform, canonicalUrl: p.canonicalUrl, qualifies, reasons, flags, qualifiesUntil: until === null ? null : new Date(until) };
}

export function creatorEligibility(c: EligibilityCreator, profiles: EligibilityProfile[], now: Date, s: EligibilitySettings = DEFAULT_ELIGIBILITY): CreatorEligibility {
  const creatorReasons: CreatorReason[] = [];
  if (c.status !== "active") creatorReasons.push("creator_not_active");
  if (isMinorProtected(c)) creatorReasons.push("minor_protected");
  if (profiles.length === 0) creatorReasons.push("no_profile");
  const evaluated = profiles.map((p) => profileEligibility(p, now, s));
  const qualifying = evaluated.filter((p) => p.qualifies);
  const eligible = creatorReasons.length === 0 && qualifying.length > 0;
  return {
    version: ELIGIBILITY_VERSION,
    eligible,
    reasons: eligible ? [] : [...new Set([...creatorReasons, ...evaluated.flatMap((p) => p.reasons)])],
    eligibleUntil: eligible ? new Date(Math.max(...qualifying.map((p) => p.qualifiesUntil?.getTime() ?? 0))) : null,
    qualifyingPlatforms: [...new Set(qualifying.map((p) => p.platform))],
    // Flags of the profiles that carry the eligibility (what a customer is shown).
    flags: [...new Set((qualifying.length ? qualifying : evaluated).flatMap((p) => p.flags))],
    profiles: evaluated,
  };
}

/** The refusal for adding creators who do not meet the policy (lists, campaigns); nothing already saved is touched. */
export function ineligibleError(creatorIds: string[]): AppError {
  return new AppError(
    "VALIDATION_FAILED",
    `${creatorIds.length === 1 ? "This creator doesn't" : "Some of these creators don't"} meet MUSHIN's creator minimum (a profile with at least ${MIN_FOLLOWERS.toLocaleString("en-US")} followers or subscribers, counted in the last 90 days), so they can't be added.`,
    { reason: "creator_ineligible", creatorIds, policy: ELIGIBILITY_VERSION },
  );
}
