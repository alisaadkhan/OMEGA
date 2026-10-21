import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The public landing page promises only what MUSHIN does (2026-10-21: the FAQ and feature tabs claimed SSO, continuous
 * data refresh, lookalike search, engagement-pod detection, seat pricing and spend caps, none of which exist).
 * Add a phrase here when a feature is removed or never built; take it out only when the feature ships.
 */
// The landing page and the sign-in screens (2026-10-21: the login page had a "Continue with SSO" button with no action).
const copy = ["../components/landing/", "../components/auth/"]
  .map((d) => new URL(d, import.meta.url))
  .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(new URL(f, dir), "utf8")))
  .join("\n");

const UNBUILT: [string, RegExp][] = [
  ["single sign-on", /\bSSO\b|single sign-on|\bSAML\b/i],
  ["continuous refresh", /refreshed continuously|real[- ]time/i],
  ["lookalike search", /lookalike/i],
  ["engagement-pod detection", /engagement pods?/i],
  ["a score that does not exist", /Creator IQ/i],
  ["seat pricing", /\bseats?\b/i],
  ["spend caps customers can set", /soft caps?|hard caps?|per-workflow caps?/i],
  ["dedicated infrastructure or data residency", /dedicated infrastructure|data residency/i],
  ["sending outreach from MUSHIN by default", /send, and track/i],
];

describe("landing page claims", () => {
  it.each(UNBUILT)("does not promise %s", (_name, pattern) => {
    expect(copy).not.toMatch(pattern);
  });
});
