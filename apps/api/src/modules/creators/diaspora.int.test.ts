import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { addCreator } from "./test-fixtures";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

// Migration 0081 (execution directive 2026-11-04, Stage 1 section 4): a profile living abroad is Pakistani diaspora only
// from its own words, never from a topic, a shop's flag or another stated identity.
describe("Pakistani diaspora (0081)", () => {
  it("is set from identity statements in the bio of a profile living abroad, and nothing else", async () => {
    const cases: [string, string, boolean][] = [
      ["Pakistani girl living in the UK", "foreign", true],
      ["I'm Pakistani, based in Dubai", "foreign", true],
      ["Born in Pakistan, bred in China, living in Canada.", "foreign", true],
      ["Pakistani-American mom of two", "foreign", true],
      ["Vlogs from Sydney 🇵🇰🇦🇺", "foreign", true],
      ["Best Pakistani recipes in London", "foreign", false],
      ["Made in 🇺🇸 · Delivering all over 🇵🇰", "foreign", false],
      ["An Afghan girl in search of good food in Islamabad 🇦🇫 🇵🇰", "foreign", false],
      ["Pakistani girl living in Lahore", "pakistan", false],
    ];
    for (const [i, [bio, status]] of cases.entries()) {
      const id = await addCreator(db, { displayName: `D${i}`, profiles: [{ platform: "instagram", handle: `diaspora${i}`, followers: 50_000 }] });
      await ownerQuery(`update gcp.creator_profiles set bio = $q$${bio}$q$, country_status = '${status}' where creator_id = '${id}'`);
    }
    const rows = await ownerQuery<{ bio: string; pakistani_diaspora: boolean }>(`select bio, pakistani_diaspora from gcp.creator_profiles`);
    for (const [bio, , expected] of cases) expect(rows.find((r) => r.bio === bio)?.pakistani_diaspora, bio).toBe(expected);
  });
});
