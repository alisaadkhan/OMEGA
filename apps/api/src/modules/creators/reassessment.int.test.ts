import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { reassessNextBatch } from "./reassessment";
import { addCreator } from "./test-fixtures";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());
const none = async () => null;

// Owner master directive 2026-11-03, Phase 5: continuous, versioned, resumable reassessment.
describe("versioned catalogue reassessment", () => {
  it("works through the catalogue in batches, resumes from its cursor, finishes once per version and keeps staff decisions", async () => {
    const memes = await addCreator(db, { displayName: "Memes", profiles: [{ platform: "instagram", handle: "pakistani.memes", followers: 40_000 }] });
    const kept = await addCreator(db, { displayName: "Kept", profiles: [{ platform: "instagram", handle: "kept.creator", followers: 40_000 }] });
    const third = await addCreator(db, { displayName: "Third", profiles: [{ platform: "instagram", handle: "third.one", followers: 40_000 }] });
    await ownerQuery(`update gcp.creator_profiles set bio = 'Daily laughs. Credits to owners' where creator_id = '${memes}';
      update gcp.creators set account_type = 'INDIVIDUAL_CREATOR', account_type_source = 'staff', account_type_confidence = 'high' where id = '${kept}';`);

    const seen = new Set<string>();
    const a = await reassessNextBatch({ db, readPayload: none, version: "t1", batch: 2 });
    expect(a).toMatchObject({ processed: 2, finished: false });
    a.creatorIds.forEach((id) => seen.add(id));
    const b = await reassessNextBatch({ db, readPayload: none, version: "t1", batch: 2 });
    expect(b).toMatchObject({ processed: 3, finished: true });
    b.creatorIds.forEach((id) => seen.add(id));
    expect([...seen].sort()).toEqual([memes, kept, third].sort()); // each creator once, none skipped
    expect(await reassessNextBatch({ db, readPayload: none, version: "t1", batch: 2 })).toMatchObject({ finished: true, creatorIds: [] });

    const types = await ownerQuery<{ id: string; account_type: string | null; account_type_source: string | null }>(`select id, account_type, account_type_source from gcp.creators`);
    expect(types.find((t) => t.id === memes)?.account_type).toBe("FAN_PAGE_AGGREGATOR");
    expect(types.find((t) => t.id === kept)).toMatchObject({ account_type: "INDIVIDUAL_CREATOR", account_type_source: "staff" });

    // A new rules version starts over; a payload that cannot be read leaves the profile as it was.
    const c = await reassessNextBatch({ db, readPayload: async () => { throw new Error("gone"); }, version: "t2", batch: 10 });
    expect(c).toMatchObject({ processed: 3, finished: true, changed: 0 });
  });
});
