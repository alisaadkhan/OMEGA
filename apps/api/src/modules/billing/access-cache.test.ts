import { describe, expect, it } from "vitest";
import { MemoryAccessCache, type Access } from "./access-cache";

const access: Access = {
  status: "active",
  planId: "growth",
  entitlements: { audienceViewsPerMonth: null, outreachEmailsPerMonth: 500, campaignLimit: null, export: false },
  spend: "all",
};

describe("access cache", () => {
  it("has an in-memory variant for tests", async () => {
    const cache = new MemoryAccessCache();
    await cache.set("w1", access);
    expect(await cache.get("w1")).toEqual(access);
    await cache.invalidate("w1");
    expect(cache.entries.size).toBe(0);
  });
});
