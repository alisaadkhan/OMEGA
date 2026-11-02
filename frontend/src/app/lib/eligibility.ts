import type { CreatorEligibilityView } from "@mushin/contracts";

/** Plain-language reasons for the creator eligibility policy (elig-2); one line each, no invented detail. */
const REASON_TEXT: Record<string, string> = {
  below_follower_minimum: "Below MUSHIN's 10,000-follower minimum",
  followers_unknown: "Follower count unknown",
  followers_stale: "Follower count older than 90 days",
  evidence_expired: "Follower count older than 90 days",
  inactive: "No public post in the last 90 days",
  invalid_profile_url: "No valid profile link",
  profile_not_found: "Profile no longer found on the platform (checked twice)",
  profile_private: "Profile is private",
  // elig-2 (2026-10-27): MUSHIN's catalogue shows Pakistani profiles only.
  country_not_pakistan: "Based outside Pakistan",
  country_unknown: "Country not confirmed as Pakistan",
  country_conflicting: "Country evidence conflicts (under review)",
  country_stale: "Country evidence older than a year",
  creator_not_active: "No longer available",
  minor_protected: "Hidden by MUSHIN's minor protection",
  no_profile: "No profile on record",
  not_evaluated: "Not checked yet",
};

/** Null when the creator is eligible; otherwise the reason to show (the first known reason, others summarised). */
export function ineligibleText(e: CreatorEligibilityView | undefined | null): string | null {
  if (!e || e.eligible) return null;
  const known = e.reasons.map((r) => REASON_TEXT[r]).filter((t): t is string => Boolean(t));
  const first = known[0] ?? "Doesn't meet MUSHIN's creator rules";
  return known.length > 1 ? `${first} (+${known.length - 1} more)` : first;
}

/** For eligible creators whose activity the evidence cannot show: an honest note, never a claim of activity. */
export function eligibilityNote(e: CreatorEligibilityView | undefined | null): string | null {
  return e?.eligible && e.flags.includes("activity_unverified") ? "Recent activity not verified" : null;
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Why an add/save action is blocked for these creators, or null when all of them may be added. */
export function blockedReasonFor(eligibilities: (CreatorEligibilityView | undefined)[]): string | null {
  const blocked = eligibilities.filter((e) => e && !e.eligible).length;
  if (blocked === 0) return null;
  return blocked === 1 && eligibilities.length === 1
    ? `Can't be added: ${lowerFirst(ineligibleText(eligibilities[0]) ?? "")}.`
    : `${blocked} of the selected creators don't meet MUSHIN's creator minimum and can't be added.`;
}
