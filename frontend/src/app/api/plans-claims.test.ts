import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLANS } from "../lib/plans";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const migration = read("../../../../packages/db/migrations/0005_billing.sql");

/** Plan rows as seeded: id → [monthly credits, monthly price (minor), yearly per-month price (minor)]. */
function seededPlans(): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  for (const m of migration.matchAll(/\('(explorer|growth|scale)', '[^']*', (\d+), (\d+), (\d+),/g)) {
    out.set(m[1]!, [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return out;
}

describe("public plan claims", () => {
  it("prices and credits on the landing page equal the server's plans", () => {
    const seeded = seededPlans();
    expect(seeded.size).toBe(3);
    for (const p of PLANS) {
      expect(seeded.get(p.id), p.id).toEqual([p.credits, p.monthly * 100, p.yearly * 100]);
    }
  });

  it("uses the approved public names while keeping the persisted ids", () => {
    expect(PLANS.map((p) => [p.id, p.name])).toEqual([
      ["explorer", "STARTER"],
      ["growth", "GROWTH"],
      ["scale", "SCALE"],
    ]);
  });

  it("promises nothing the product does not do yet", () => {
    const features = PLANS.flatMap((p) => p.features.map((f) => `${f.label} ${f.value ?? ""} ${f.note ?? ""}`)).join("\n");
    const pages = [read("../lib/plans.ts"), read("../components/landing/Pricing.tsx"), read("../components/landing/Metrics.tsx")].join("\n");
    for (const claim of [/audience details/i, /AI-estimated/i, /outreach emails/i, /data export/i, /roll ?over/i, /\d+ campaigns/i]) {
      expect(features).not.toMatch(claim);
      expect(pages.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(claim);
    }
    // Catalogue search is a paid action now; the landing page must not call it free.
    expect(read("../components/landing/Metrics.tsx")).not.toMatch(/for free/i);
  });
});
