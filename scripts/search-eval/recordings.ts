import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { standardize, type CreatorPlatform, type StandardProfile } from "../../apps/api/src/modules/creators/index";

/** Reads the public profiles recorded by the live evaluation (raw/<platform>/<hash>.json); nothing is fetched. */
type Rec = Record<string, unknown>;
const first = (raw: unknown): Rec | undefined => (Array.isArray(raw) ? (raw[0] as Rec | undefined) : undefined);
export const RECORDED_HANDLE: Record<CreatorPlatform, (raw: unknown) => string | undefined> = {
  instagram: (raw) => first(raw)?.["username"] as string | undefined,
  tiktok: (raw) => (first(raw)?.["authorMeta"] as Rec | undefined)?.["name"] as string | undefined,
  youtube: (raw) => {
    const items = ((raw as Rec)?.["channel"] as Rec | undefined)?.["items"] as Rec[] | undefined;
    return ((items?.[0]?.["snippet"] as Rec | undefined)?.["customUrl"] as string | undefined)?.replace(/^@/, "");
  },
};

const PROFILE_URL: Record<CreatorPlatform, (handle: string) => string> = {
  instagram: (h) => `https://instagram.com/${h.toLowerCase()}`,
  tiktok: (h) => `https://tiktok.com/@${h.toLowerCase()}`,
  youtube: (h) => `https://youtube.com/@${h.toLowerCase()}`,
};

export type RecordedProfile = { platform: CreatorPlatform; file: string; fetchedAt: string; profile: StandardProfile; url: string };

export function readRecordedProfiles(dir: string): { profiles: RecordedProfile[]; skipped: number } {
  const profiles: RecordedProfile[] = [];
  let skipped = 0;
  for (const platform of ["instagram", "tiktok", "youtube"] as CreatorPlatform[]) {
    for (const file of readdirSync(join(dir, "raw", platform))) {
      const { raw, fetchedAt } = JSON.parse(readFileSync(join(dir, "raw", platform, file), "utf8")) as { raw: unknown; fetchedAt: string };
      const handle = RECORDED_HANDLE[platform](raw);
      const result = handle ? standardize(platform, handle, raw, { maxPosts: 12 }) : null;
      if (!result || result.kind !== "ok") {
        skipped++;
        continue;
      }
      profiles.push({ platform, file, fetchedAt, profile: result.profile, url: PROFILE_URL[platform](result.profile.handle) });
    }
  }
  return { profiles, skipped };
}
