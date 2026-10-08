import { AppError } from "@mushin/core";

export type Bucket = { limit: number; windowSeconds: number };
export type RateLimitBuckets = { ip: Bucket; user: Bucket; auth: Bucket; ai: Bucket };
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
  };
}

export function rateLimitError(retryAfterSeconds: number): AppError {
  return new AppError("RATE_LIMITED", "Too many requests. Please slow down.", { retryAfterSeconds });
}
