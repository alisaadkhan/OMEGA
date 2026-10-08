import { describe, expect, it } from "vitest";
import { buildTestApp, testLogger } from "../test-support/app";
import { MemoryRateLimiter } from "./memory";
import { ipRateLimitHook } from "./plugin";
import { bucketsFromConfig, type RateLimitBuckets } from "./types";
import { UpstashRateLimiter } from "./upstash";

const buckets: RateLimitBuckets = {
  ip: { limit: 3, windowSeconds: 60 },
  user: { limit: 2, windowSeconds: 60 },
  auth: { limit: 1, windowSeconds: 60 },
};

describe("MemoryRateLimiter", () => {
  it("allows up to the limit then reports retry-after, and resets after the window", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(buckets, () => now);
    expect((await rl.limit("user", "u1")).allowed).toBe(true);
    expect((await rl.limit("user", "u1")).allowed).toBe(true);
    const blocked = await rl.limit("user", "u1");
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect((await rl.limit("user", "u2")).allowed).toBe(true);
    now = 61_000;
    expect((await rl.limit("user", "u1")).allowed).toBe(true);
  });
});

describe("UpstashRateLimiter", () => {
  it("fails open when Redis is unreachable", async () => {
    const down = { limit: async () => Promise.reject(new Error("ENOTFOUND")) };
    const rl = new UpstashRateLimiter({ ip: down, user: down, auth: down }, testLogger());
    expect(await rl.limit("ip", "1.2.3.4")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("converts reset time to retry-after seconds", async () => {
    const full = { limit: async () => ({ success: false, reset: Date.now() + 4_500 }) };
    const rl = new UpstashRateLimiter({ ip: full, user: full, auth: full }, testLogger());
    const r = await rl.limit("ip", "k");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(4);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(5);
  });
});

describe("IP rate limit hook", () => {
  it("returns 429 with Retry-After and skips health checks", async () => {
    const app = await buildTestApp({ onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))] });
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: "/v1/x" })).statusCode).toBe(404);
    const limited = await app.inject({ method: "GET", url: "/v1/x" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
  });

  it("uses the stricter auth bucket for staff auth routes", async () => {
    const app = await buildTestApp({ onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))] });
    expect((await app.inject({ method: "POST", url: "/admin/v1/auth/login" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/admin/v1/auth/login" })).statusCode).toBe(429);
  });

  it("never rate-limits payment webhooks", async () => {
    const app = await buildTestApp({
      onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))],
      modules: [{ name: "hook", register: (a) => void a.post("/webhooks/paddle", async () => ({ ok: true })) }],
    });
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "POST", url: "/webhooks/paddle" })).statusCode).toBe(200);
  });

  it("cannot dodge the auth bucket with encoded or dot-segment paths", async () => {
    for (const variant of ["/admin/v1/%61uth/login", "/%61dmin/v1/auth/login", "/admin/v1/auth/./login"]) {
      const app = await buildTestApp({
        onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))],
        modules: [{ name: "login", register: (a) => void a.post("/admin/v1/auth/login", async () => ({ ok: true })) }],
      });
      expect((await app.inject({ method: "POST", url: variant })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: variant })).statusCode).toBe(429);
    }
  });
});

describe("bucketsFromConfig", () => {
  it("derives ip/user buckets from config and a fixed auth bucket", () => {
    expect(bucketsFromConfig({ windowMs: 30_000, maxRequests: 50 })).toEqual({
      ip: { limit: 50, windowSeconds: 30 },
      user: { limit: 50, windowSeconds: 30 },
      auth: { limit: 10, windowSeconds: 60 },
    });
  });
});
