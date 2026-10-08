import type { CreatorDocument } from "@mushin/integrations";
import type { IndexRow } from "./repository";
import { isMinorProtected } from "./rules";

/** Only active creators that are not protected possible minors are searchable (spec §4.3). */
export function isIndexable(r: IndexRow): boolean {
  return r.status === "active" && !isMinorProtected(r);
}

export function toDocument(r: IndexRow): CreatorDocument {
  const primary = r.profiles.find((p) => p.platform === r.primaryPlatform) ?? r.profiles[0];
  const followersAt = primary?.followersUpdatedAt ? Math.floor(new Date(primary.followersUpdatedAt).getTime() / 1000) : null;
  return {
    id: r.id,
    display_name: r.displayName,
    name_variants: r.nameVariants,
    primary_handle: r.primaryHandle,
    handles: [...new Set(r.profiles.map((p) => p.handle))],
    platforms: [...new Set(r.profiles.map((p) => p.platform))],
    primary_platform: r.primaryPlatform,
    city: r.city,
    country: r.country,
    niches: r.niches,
    tags: r.tags,
    bio: (primary?.bio ?? "").slice(0, 500),
    followers: Math.max(0, ...r.profiles.map((p) => p.followers)),
    engagement_rate: primary?.engagementRate ?? null,
    verified: r.verified,
    authenticity_score: r.authenticityScore,
    has_contact: r.hasContact,
    audience_countries: (r.audience?.countries ?? []).map((c) => c.code),
    followers_updated_epoch: followersAt,
    updated_epoch: r.updatedEpoch,
  };
}
