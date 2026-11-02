import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { addCreator } from "../test-fixtures";
import { backfillAttributes, restoreBeforeImages } from "./backfill";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const run = (o: Partial<Parameters<typeof backfillAttributes>[0]> = {}) =>
  backfillAttributes({ db, apply: false, readPayload: async () => null, usePostText: () => true, maxPosts: () => 12, ...o });
const creator = (id: string) =>
  ownerQuery<{ niches: string[]; niche_main: string | null; niche_status: string | null; country: string | null; country_source: string | null; stated_country: string | null }>(
    `select niches, niche_main, niche_status, country, country_source, stated_country from gcp.creators where id = '${id}'`,
  ).then((r) => r[0]);

describe("attribute backfill from stored data", () => {
  it("reports a dry run without writing, then applies from the stored bio, and a second run changes nothing", async () => {
    // Stored before the evidence model: an AI niche and a country no evidence supports.
    const cooking = await addCreator(db, { niches: ["Lifestyle"], country: "PK", confirmedCountry: null, city: null, profiles: [{ bio: "Home cooking recipes and baking. Based in Toronto, Canada" }] });
    const vague = await addCreator(db, { niches: [], country: null, confirmedCountry: null, city: null, profiles: [{ bio: "Subscribe for more" }] });

    const dry = await run();
    expect(dry).toMatchObject({ applied: false, processed: 2, changed: 2, failed: [], fromStoredFields: 2 });
    expect(dry.before["instagram"]).toMatchObject({ total: 2, nicheKnown: 1, countryKnown: 1 });
    expect(dry.after["instagram"]).toMatchObject({ total: 2, nicheKnown: 1, nicheUnknown: 1, countryKnown: 1, countryBySource: { creator_stated: 1 } });
    expect(await creator(cooking)).toMatchObject({ niches: ["Lifestyle"], niche_status: null, country: "PK" });

    const eventsBefore = (await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.changed'`))[0]?.n ?? 0;
    const applied = await run({ apply: true });
    expect(applied).toMatchObject({ applied: true, changed: 2, failed: [] });
    expect(applied.beforeImages).toHaveLength(2);
    expect(await creator(cooking)).toMatchObject({ niches: ["Food"], niche_main: "Food", niche_status: "classified", country: "CA", country_source: "creator_stated", stated_country: "CA" });
    expect(await creator(vague)).toMatchObject({ niches: [], niche_status: "unknown", country: null });
    const events = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.changed'`);
    expect((events[0]?.n ?? 0) - eventsBefore).toBe(2);

    const again = await run({ apply: true });
    expect(again).toMatchObject({ changed: 0, unchanged: 2 });
    const evidence = await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_attribute_evidence where creator_id = '${cooking}'`);
    const evidenceAgain = await run({ apply: true }).then(() => ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_attribute_evidence where creator_id = '${cooking}'`));
    expect(evidenceAgain[0]?.n).toBe(evidence[0]?.n);

    // Rollback restores the values the run replaced.
    await restoreBeforeImages(db, JSON.parse(JSON.stringify(applied.beforeImages)));
    expect(await creator(cooking)).toMatchObject({ niches: ["Lifestyle"], niche_status: null, country: "PK", country_source: null });
  });

  it("resumes after a checkpoint, processes in batches, and lists creators that need fresh data", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await addCreator(db, { niches: [], profiles: [{ bio: i === 4 ? "" : "PUBG gameplay and Free Fire" }] }));
    const batches: number[] = [];
    const first = await run({ apply: true, batchSize: 2, limit: 3, onBatch: ({ processed }) => void batches.push(processed) });
    expect(first.processed).toBe(3);
    expect(batches).toEqual([2, 3]);
    const rest = await run({ apply: true, batchSize: 2, after: first.lastId });
    expect(rest.processed).toBe(2);
    const missing = [...first.needsFreshData, ...rest.needsFreshData];
    expect(missing).toEqual([expect.objectContaining({ reason: expect.stringContaining("no bio") })]);
    const classified = await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creators where niche_main = 'Gaming'`);
    expect(classified[0]?.n).toBe(4);
  });

  it("keeps niches earlier text evidence supported when today's evidence is insufficient", async () => {
    const id = await addCreator(db, { niches: ["Travel"], profiles: [{ bio: "Subscribe for more" }] });
    await ownerQuery(`insert into gcp.creator_attribute_evidence (creator_id, attribute, value, source, status, evidence) values ('${id}', 'niche', 'Travel', 'post_text', 'supported', '9 of 12 recent posts use its terms')`);
    const r = await run({ apply: true });
    expect(r.keptEarlierNiches).toBe(1);
    expect(await creator(id)).toMatchObject({ niches: ["Travel"] });
    const rows = await ownerQuery<{ source: string }>(`select source from gcp.creator_attribute_evidence where creator_id = '${id}' and attribute = 'niche'`);
    expect(rows).toEqual([{ source: "post_text" }]);
  });

  it("never overwrites a country the creator confirmed", async () => {
    const id = await addCreator(db, { niches: [], country: "AE", profiles: [{ bio: "Food reviews. Based in Lahore, Pakistan" }] });
    await ownerQuery(`update gcp.creators set confirmed_country = 'AE' where id = '${id}'`);
    await run({ apply: true });
    expect(await creator(id)).toMatchObject({ country: "AE", country_source: "creator_confirmed", stated_country: "PK" });
  });
});
