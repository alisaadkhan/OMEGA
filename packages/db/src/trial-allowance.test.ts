import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL("../migrations/0050_founder_assisted_trial.sql", import.meta.url)), "utf8");

/** Owner decision 2026-10-19: an approved trial is 14 days with 2,500 credits. Test databases pin 200 (global setup). */
describe("trial allowance shipped by migration 0050", () => {
  it("sets 2,500 trial credits and leaves the 14-day length (set in 0005) unchanged", () => {
    expect(migration).toMatch(/update platform\.billing_settings set trial_credits = 2500;/);
    expect(migration).not.toMatch(/trial_days\s*=/);
    expect(readFileSync(fileURLToPath(new URL("../migrations/0005_billing.sql", import.meta.url)), "utf8")).toMatch(/values \(14, 200, 'explorer'/);
  });
});
