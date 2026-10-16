import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BillingPlans } from "@mushin/contracts";
import { planFeatures, type CatalogPlan } from "../lib/plans";

/**
 * Owner plan model 2026-10-16. The page reads the server catalogue; this checks how plan cards describe a catalogue
 * shaped like migration 0038, and that no price or allowance is written into frontend code. The browser journey
 * compares the rendered page with the live API.
 */
const migration = readFileSync(new URL("../../../../packages/db/migrations/0038_plan_entitlements.sql", import.meta.url), "utf8");
function planFromMigration(id: CatalogPlan["id"]): CatalogPlan {
  const m = new RegExp(String.raw`update platform\.plans set name = '([^']+)', monthly_credits = (\d+), display_monthly_minor = (\d+),\s+entitlements = '([^']+)'\s+where id = '${id}'`).exec(migration);
  if (!m) throw new Error(`no row for ${id}`);
  const money = (amountMinor: number) => ({ amountMinor, currency: "PKR" });
  return { id, name: m[1]!, monthlyCredits: Number(m[2]), display: { monthly: money(Number(m[3])), yearlyPerMonth: money(0) }, charge: { monthly: money(0), yearly: money(0) }, entitlements: JSON.parse(m[4]!) as CatalogPlan["entitlements"] };
}
const off: BillingPlans["availability"] = { audienceDetails: false, outreachEmail: "off", export: true };
const row = (p: CatalogPlan, key: string, a = off) => planFeatures(p, a).find((f) => f.key === key);

describe("plan cards from the server catalogue", () => {
  it("matches the owner's table: prices, credits and names", () => {
    expect((["explorer", "growth", "scale"] as const).map((id) => { const p = planFromMigration(id); return [p.name, p.display.monthly.amountMinor / 100, p.monthlyCredits]; })).toEqual([
      ["Starter", 4900, 2500],
      ["Growth", 12900, 12000],
      ["Scale", 24900, 35000],
    ]);
  });

  it("describes every entitlement cell, and never shows a gated feature as live", () => {
    const [starter, growth, scale] = (["explorer", "growth", "scale"] as const).map(planFromMigration) as [CatalogPlan, CatalogPlan, CatalogPlan];
    expect(row(starter, "campaigns")).toMatchObject({ value: "Up to 3", included: true });
    expect(row(growth, "campaigns")?.value).toBe("Unlimited");
    expect(row(starter, "audience")).toMatchObject({ value: "Not included", included: false });
    expect(row(growth, "audience")).toMatchObject({ value: "Included", status: "coming_soon" });
    expect(row(growth, "audience", { ...off, audienceDetails: true })?.status).toBeUndefined();
    expect(row(starter, "email")).toMatchObject({ value: "Not included", included: false });
    expect(row(growth, "email")).toMatchObject({ value: "500 per billing period", status: "coming_soon" });
    expect(row(scale, "email", { ...off, outreachEmail: "test" })).toMatchObject({ value: "2,000 per billing period", status: "test_mode" });
    expect(row(scale, "email", { ...off, outreachEmail: "live" })?.status).toBeUndefined();
    expect([row(starter, "export")?.value, row(growth, "export")?.value, row(scale, "export")?.value]).toEqual(["Not included", "Not included", "Included"]);
    for (const p of [starter, growth, scale]) for (const k of ["existing", "new", "contact", "lists", "outreach_log"]) expect(row(p, k)?.included, `${p.id} ${k}`).toBe(true);
  });

  it("has no price, credit allowance or annual discount written into frontend code", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(fileURLToPath(new URL("..", import.meta.url)));
    const offenders = files.filter((f) => /\b(4,?900|12,?900|24,?900|35,?000|12,?000)\b|save 20%/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
