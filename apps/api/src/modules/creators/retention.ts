import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";

/**
 * Clears YouTube API data that was not refreshed within the retention period (DATA-004, migration 0029) and returns the
 * creators whose search documents must be rebuilt.
 */
export async function expireYoutubeApiData(db: Db, days = 30): Promise<string[]> {
  const rows = await db.withSystem((tx) => tx.execute<{ ids: string[] | null }>(sql`select platform.expire_youtube_api_data(${days}) as ids`));
  return rows[0]?.ids ?? [];
}
