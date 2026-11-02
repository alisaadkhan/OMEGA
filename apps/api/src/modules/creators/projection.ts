import { truncate } from "@mushin/core";
import type { CreatorDocument } from "@mushin/integrations";
import { handleWords } from "./aliases";
import { creatorEligibility } from "./eligibility";
import type { IndexRow } from "./repository";
import { isMinorProtected } from "./rules";

/** Only active creators that are not protected possible minors are searchable (spec §4.3). */
export function isIndexable(r: IndexRow): boolean {
  return r.status === "active" && !isMinorProtected(r);
}

export function toDocument(r: IndexRow): CreatorDocument {
  return documentAt(r, new Date());
}

/** The search document as of `now` (eligibility depends on how old the evidence is). */
export function documentAt(r: IndexRow, now: Date): CreatorDocument {
  // Eligibility (policy elig-1) is decided here, before ranking; the counts are the stored ones (YouTube 0 = hidden = unknown).
  const eligibility = creatorEligibility(
    r,
    r.profiles.map((p) => ({ platform: p.platform, canonicalUrl: p.canonicalUrl, followers: p.followers, followersUpdatedAt: p.followersUpdatedAt, lastPostAt: p.lastPostAt, availability: p.availability ?? null, country: p.country ?? null })),
    now,
  );
  const primary = r.profiles.find((p) => p.platform === r.primaryPlatform) ?? r.profiles[0];
  const followersAt = primary?.followersUpdatedAt ? Math.floor(new Date(primary.followersUpdatedAt).getTime() / 1000) : null;
  const knownFollowers = r.profiles.map((p) => (p.platform === "youtube" && p.followers === 0 ? null : p.followers)).filter((v): v is number => v !== null);
  return {
    id: r.id,
    display_name: r.displayName,
    name_variants: r.nameVariants,
    primary_handle: r.primaryHandle,
    handles: [...new Set(r.profiles.map((p) => p.handle))],
    handle_words: [...new Set([r.primaryHandle, ...r.profiles.map((p) => p.handle)].flatMap(handleWords))],
    platforms: [...new Set(r.profiles.map((p) => p.platform))],
    primary_platform: r.primaryPlatform,
    city: r.city,
    country: r.country,
    niches: r.niches,
    tags: r.tags,
    bio: truncate(primary?.bio ?? "", 500),
    followers: knownFollowers.length ? Math.max(...knownFollowers) : null,
    engagement_rate: primary?.engagementRate ?? null,
    verified: r.verified,
    authenticity_score: r.authenticityScore,
    has_contact: r.hasContact,
    // No source currently supplies creator audience analytics; omit legacy LLM-derived demographic guesses.
    audience_countries: [],
    followers_updated_epoch: followersAt,
    updated_epoch: r.updatedEpoch,
    eligible: eligibility.eligible,
    eligible_until: eligibility.eligibleUntil ? Math.floor(eligibility.eligibleUntil.getTime() / 1000) : null,
    eligibility_version: eligibility.version,
    eligibility_reasons: eligibility.reasons,
    eligibility_flags: eligibility.flags,
    qualifying_platforms: eligibility.qualifyingPlatforms,
  };
}
