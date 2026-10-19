import { AppError } from "@mushin/core";

export type Bucket = { limit: number; windowSeconds: number };
export type RateLimitBuckets = { ip: Bucket; user: Bucket; auth: Bucket; ai: Bucket; jobs: Bucket; workspaceJobs: Bucket; callback: Bucket };
export type BucketName = keyof RateLimitBuckets;
export type LimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  limit(bucket: BucketName, key: string): Promise<LimitResult>;
}

export function bucketsFromConfig(c: { windowMs: number; maxRequests: number }): RateLimitBuckets {
  const windowSeconds = Math.max(1, Math.ceil(c.windowMs / 1000));
  return {
    ip: { limit: c.maxRequests, windowSeconds },
    user: { limit: c.maxRequests, windowSeconds },
    auth: { limit: 10, windowSeconds: 60 },
    // AI calls are free to users but cost MUSHIN money (spec §4.1).
    ai: { limit: 20, windowSeconds: 60 },
    // Each job spends real money on Apify (spec §3.3): 20 starts per hour per user.
    jobs: { limit: 20, windowSeconds: 3600 },
    // The same paid starts counted for the whole workspace, so many members cannot multiply the spend (RATE-002).
    workspaceJobs: { limit: 100, windowSeconds: 3600 },
    // The public trial callback form (no sign-in): a few honest retries per address, not a spam channel.
    callback: { limit: 5, windowSeconds: 3600 },
  };
}

/** A paid job start counts against the user and against the workspace; the first exhausted limit refuses it. */
export async function limitPaidStart(limiter: RateLimiter, ctx: { userId: string; workspaceId: string }): Promise<void> {
  for (const [bucket, key] of [["jobs", ctx.userId], ["workspaceJobs", ctx.workspaceId]] as const) {
    const r = await limiter.limit(bucket, key);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
  }
}

export function rateLimitError(retryAfterSeconds: number): AppError {
  return new AppError("RATE_LIMITED", "Too many requests. Please slow down.", { retryAfterSeconds });
}
