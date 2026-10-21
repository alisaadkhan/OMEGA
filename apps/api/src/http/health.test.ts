import { describe, expect, it } from "vitest";
import { searchReadiness } from "./health";

describe("catalogue search readiness", () => {
  it("adds no check for the PostgreSQL backend", () => {
    expect(searchReadiness("postgres", null)).toBeNull();
  });

  it("pings Meilisearch when it is the configured backend", async () => {
    await expect(searchReadiness("meilisearch", async () => "ok")?.check()).resolves.toBe("ok");
  });

  // Regression (2026-10-21): a selected but unconfigured Meilisearch was reported "skipped", so readiness stayed 200.
  it("reports a selected but unconfigured Meilisearch as down, not skipped", async () => {
    await expect(searchReadiness("meilisearch", null)?.check()).rejects.toThrow("not configured");
  });
});
