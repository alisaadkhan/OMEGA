import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Owner decision 2026-10-15 and YouTube API Services policy (30-day retention): the Search evaluation data recorded on
 * 2026-10-13 must be gone by 2026-11-12. On a machine that still holds it after that date, `npm run verify` fails until
 * `scripts/search-eval/purge-eval-data.ts --confirm` is run. Machines without eval-data/ (CI, other clones) pass.
 */
export const DELETE_BY = "2026-11-12";

/** Whether eval-data/ still holds creator-level evaluation data (anything other than aggregate reports). */
export function evalDataPresent(root: string): string[] {
  return existsSync(root) ? readdirSync(root).filter((n) => n !== "reports") : [];
}

/** Today's date in Pakistan, where the deadline applies. */
const todayPk = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now);

describe("Search evaluation data retention", () => {
  it(`no YouTube evaluation data is kept after ${DELETE_BY}`, () => {
    const root = join(resolve(fileURLToPath(new URL("../..", import.meta.url))), "eval-data");
    const left = evalDataPresent(root);
    if (todayPk(new Date()) > DELETE_BY) {
      expect(left, `eval-data/ still holds ${left.join(", ")}: run node --import tsx scripts/search-eval/purge-eval-data.ts --confirm`).toEqual([]);
    } else {
      expect(Array.isArray(left)).toBe(true);
    }
  });

  it("compares dates in Pakistan time", () => {
    expect(todayPk(new Date("2026-11-12T18:59:00Z"))).toBe("2026-11-12");
    expect(todayPk(new Date("2026-11-12T19:01:00Z"))).toBe("2026-11-13");
    expect(todayPk(new Date("2026-11-13T00:00:00+05:00")) > DELETE_BY).toBe(true);
  });
});
