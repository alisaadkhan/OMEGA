import type { OnRequestHook } from "../http/types";
import { rateLimitError, type BucketName, type RateLimiter } from "./types";

/** Path with the query dropped, percent-decoding and dot segments resolved, as the router sees it. */
function normalizedPath(url: string): string {
  const path = url.split("?")[0] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed escapes: classify on the raw path.
  }
  return new URL(decoded.replace(/^\/+/, "/"), "http://localhost").pathname;
}

export function ipRateLimitHook(limiter: RateLimiter): OnRequestHook {
  return async (req) => {
    // Prefer the matched route template: encoded or dot-segment variants of a path must not pick a looser bucket.
    const path = req.routeOptions.url ?? normalizedPath(req.url);
    if (path.startsWith("/health/")) return;
    // Signed provider callbacks: the provider retries on 429, and blocking it would delay payments.
    if (path.startsWith("/webhooks/")) return;
    const bucket: BucketName = path.startsWith("/admin/v1/auth/") ? "auth" : "ip";
    const r = await limiter.limit(bucket, req.ip);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
  };
}
