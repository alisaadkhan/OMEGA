import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { Logger } from "@mushin/core";
import type { Bucket, BucketName, LimitResult, RateLimitBuckets, RateLimiter } from "./types";

export type SlidingLimiter = { limit(key: string): Promise<{ success: boolean; reset: number }> };

/** Fails open: if Redis is down the request is allowed and a warning is logged (readiness shows redis "down"). */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly limiters: Record<BucketName, SlidingLimiter>,
    private readonly logger: Logger,
  ) {}

  async limit(bucket: BucketName, key: string): Promise<LimitResult> {
    try {
      const r = await this.limiters[bucket].limit(key);
      if (r.success) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
    } catch (err) {
      this.logger.warn({ err, bucket }, "rate limiter unavailable; allowing request");
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}

export function createUpstashRateLimiter(
  c: { url: string; token: string },
  buckets: RateLimitBuckets,
  logger: Logger,
): { limiter: UpstashRateLimiter; ping(): Promise<"ok"> } {
  const redis = new Redis({ url: c.url, token: c.token });
  const make = (name: BucketName, b: Bucket) =>
    new Ratelimit({ redis, prefix: `mushin:rl:${name}`, limiter: Ratelimit.slidingWindow(b.limit, `${b.windowSeconds} s`) });
  const limiter = new UpstashRateLimiter(
    { ip: make("ip", buckets.ip), user: make("user", buckets.user), auth: make("auth", buckets.auth), ai: make("ai", buckets.ai) },
    logger,
  );
  return {
    limiter,
    async ping() {
      await redis.ping();
      return "ok";
    },
  };
}
