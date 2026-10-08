import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createRedisAccessCache, MemoryAccessCache, type Access, type RedisLike } from "./access-cache";

const access: Access = {
  status: "active",
  planId: "growth",
  entitlements: { audienceViewsPerMonth: null, outreachEmailsPerMonth: 500, campaignLimit: null, export: false },
  spend: "all",
};
const logger = createLogger({ level: "silent" });

describe("access cache", () => {
  it("stores entries in Redis for 60 seconds under a workspace key", async () => {
    const store = new Map<string, unknown>();
    const ttl: number[] = [];
    const redis: RedisLike = {
      get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
      set: async (key, value, opts) => {
        store.set(key, value);
        ttl.push(opts.ex);
      },
      del: async (key) => store.delete(key),
    };
    const cache = createRedisAccessCache(redis, logger);
    await cache.set("w1", access);
    expect(await cache.get("w1")).toEqual(access);
    expect([...store.keys()]).toEqual(["mushin:access:w1"]);
    expect(ttl).toEqual([60]);
    await cache.invalidate("w1");
    expect(await cache.get("w1")).toBeNull();
  });

  it("fails open when Redis is unreachable", async () => {
    const down: RedisLike = {
      get: async () => Promise.reject(new Error("ENOTFOUND")),
      set: async () => Promise.reject(new Error("ENOTFOUND")),
      del: async () => Promise.reject(new Error("ENOTFOUND")),
    };
    const cache = createRedisAccessCache(down, logger);
    await expect(cache.get("w1")).resolves.toBeNull();
    await expect(cache.set("w1", access)).resolves.toBeUndefined();
    await expect(cache.invalidate("w1")).resolves.toBeUndefined();
  });

  it("has an in-memory variant for tests", async () => {
    const cache = new MemoryAccessCache();
    await cache.set("w1", access);
    expect(await cache.get("w1")).toEqual(access);
    await cache.invalidate("w1");
    expect(cache.entries.size).toBe(0);
  });
});
