import type { BucketName, LimitResult, RateLimitBuckets, RateLimiter } from "./types";

/** Fixed-window limiter for development and tests. Not shared across processes. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly buckets: RateLimitBuckets,
    private readonly now: () => number = Date.now,
  ) {}

  async limit(bucket: BucketName, key: string): Promise<LimitResult> {
    const b = this.buckets[bucket];
    const t = this.now();
    const k = `${bucket}:${key}`;
    if (this.hits.size > 10_000) this.prune(t);
    let entry = this.hits.get(k);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + b.windowSeconds * 1000 };
      this.hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count <= b.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
