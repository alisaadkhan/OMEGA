import { afterAll, describe, expect, it } from "vitest";
import { engagementScore, type ScorePlatform } from "@mushin/contracts";
import { ownerQuery } from "@mushin/db/testing";
import { createTestDatabase } from "@mushin/db/testing";

const db = createTestDatabase();
afterAll(() => db.close());

describe("Engagement Score in SQL (0104) matches @mushin/contracts", () => {
  it("gives the same score for every platform across the range, and null when unknown", async () => {
    const rates = [0, 0.01, 0.02, 0.05, 0.09, 0.1, 0.15, 0.2, 0.25, 0.3, 0.42, 0.55, 0.6, 0.8, 1, 1.15, 1.7, 2.5, 3, 4.2, 5, 6, 9.9, 25];
    for (const platform of ["instagram", "youtube", "tiktok"] as ScorePlatform[]) {
      const rows = await ownerQuery<{ rate: number; score: string | null }>(
        `select r as rate, platform.engagement_score(r, '${platform}')::text as score from unnest(array[${rates.join(",")}]::double precision[]) r`,
      );
      expect(rows.map((x) => (x.score === null ? null : Number(x.score)))).toEqual(rates.map((r) => engagementScore(r, platform)));
    }
    const [n] = await ownerQuery<{ a: string | null; b: string | null }>(`select platform.engagement_score(null, 'instagram')::text a, platform.engagement_score(1, 'other')::text b`);
    expect(n).toEqual({ a: null, b: null });
  });
});
