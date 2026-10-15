import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import type { BucketName, LimitResult, RateLimitBuckets, RateLimiter } from "./types";

/**
 * Rate limits counted in PostgreSQL (`platform.rate_limit_hit`, migration 0034): one atomic upsert per check, a sliding
 * window estimated from the current and previous fixed windows (as Upstash's sliding window does), shared by every API
 * process and reset with the database. Keys are stored as SHA-256 hashes, never as raw IPs or user ids. It fails
 * closed: if the database cannot count, the request fails like every other database-backed request.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly buckets: RateLimitBuckets,
  ) {}

  async limit(bucket: BucketName, key: string): Promise<LimitResult> {
    const b = this.buckets[bucket];
    const keyHash = createHash("sha256").update(key).digest("hex");
    const rows = await this.db.withSystem((tx) =>
      tx.execute<{ retry: number }>(sql`select platform.rate_limit_hit(${bucket}, ${keyHash}, ${b.limit}, ${b.windowSeconds}) as retry`),
    );
    const retry = Number(rows[0]?.retry ?? 0);
    return retry === 0 ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: retry };
  }
}
