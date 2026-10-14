import { sql } from "drizzle-orm";
import { AVATAR_BUCKET, type ObjectStorage } from "@mushin/integrations";
import type { Db } from "@mushin/db";

/**
 * Clears YouTube API data, and what MUSHIN derived from it, that was not refreshed within the retention period
 * (DATA-004, migrations 0029 and 0031), deletes the cleared avatar images and returns the creators whose search
 * documents must be rebuilt.
 */
export async function expireYoutubeApiData(db: Db, o: { days?: number; storage?: Pick<ObjectStorage, "remove"> } = {}): Promise<string[]> {
  const rows = await db.withSystem((tx) => tx.execute<{ creator_id: string; avatar_key: string | null }>(sql`select creator_id, avatar_key from platform.expire_youtube_api_data(${o.days ?? 30})`));
  const keys = rows.flatMap((r) => (r.avatar_key ? [r.avatar_key] : []));
  if (keys.length > 0 && o.storage) await o.storage.remove(AVATAR_BUCKET, keys);
  return [...new Set(rows.map((r) => r.creator_id))].sort();
}
