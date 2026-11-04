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

  it("recovers an email, a mobile number and links the stored answer holds but the database missed (encrypted, masked)", async () => {
    const id = await addCreator(db, { displayName: "Sana", profiles: [{ platform: "instagram", handle: "sana.cooks", followers: 40_000 }] });
    await ownerQuery(`insert into platform.raw_payloads (provider, platform, canonical_url, job_id, storage_key, bytes, sha256, delete_after, creator_id)
      values ('apify', 'instagram', 'https://instagram.com/sana.cooks', gen_random_uuid(), 'k/sana', 1, 'x', now() + interval '30 days', '${id}')`);
    const raw = [{ username: "sana.cooks", fullName: "Sana", biography: "Lahore recipes | Email for paid collab: sana.cooks@gmail.com | WhatsApp 0300 1234567", externalUrl: "https://www.youtube.com/@sanacooks", followersCount: 40_000, followsCount: 10, postsCount: 20, latestPosts: [] }];
    const key = Buffer.alloc(32, 7);
    await reassessNextBatch({ db, readPayload: async () => raw, version: "t3", batch: 10, contacts: { encryptionKey: key, youtubeDescriptionContacts: true } });
    const contacts = await ownerQuery<{ kind: string; masked: string; value_encrypted: string }>(`select kind, masked, value_encrypted from gcp.creator_contacts where creator_id = '${id}' order by kind`);
    expect(contacts.map((x) => x.kind)).toEqual(["email", "phone"]);
    expect(contacts.every((x) => !x.value_encrypted.includes("sana.cooks@gmail.com") && !x.masked.includes("1234567"))).toBe(true);
    expect((await ownerQuery<{ url: string }>(`select url from gcp.creator_links where creator_id = '${id}'`)).map((l) => l.url).join()).toContain("youtube.com");
    // A suppressed (do-not-re-add) creator gets nothing back, and an expired answer is never read.
    const gone = await addCreator(db, { displayName: "Gone", profiles: [{ platform: "instagram", handle: "gone.one", followers: 40_000 }] });
    await ownerQuery(`insert into platform.raw_payloads (provider, platform, canonical_url, job_id, storage_key, bytes, sha256, delete_after, creator_id)
      values ('apify', 'instagram', 'https://instagram.com/gone.one', gen_random_uuid(), 'k/gone', 1, 'x', now() + interval '30 days', '${gone}');
      insert into gcp.creator_suppressions (url_hash, platform) select encode(sha256(convert_to(lower(trim(canonical_url)), 'UTF8')), 'hex'), 'instagram' from gcp.creator_profiles where creator_id = '${gone}'`);
    const old = await addCreator(db, { displayName: "Old", profiles: [{ platform: "instagram", handle: "old.one", followers: 40_000 }] });
    await ownerQuery(`insert into platform.raw_payloads (provider, platform, canonical_url, job_id, storage_key, bytes, sha256, delete_after, creator_id)
      values ('apify', 'instagram', 'https://instagram.com/old.one', gen_random_uuid(), 'k/old', 1, 'x', now() - interval '1 day', '${old}')`);
    await reassessNextBatch({ db, readPayload: async () => raw, version: "t3b", batch: 10, contacts: { encryptionKey: key, youtubeDescriptionContacts: true } });
    expect(await ownerQuery(`select 1 from gcp.creator_contacts where creator_id in ('${gone}', '${old}')`)).toHaveLength(0);
    // Running again adds nothing.
    await reassessNextBatch({ db, readPayload: async () => raw, version: "t4", batch: 10, contacts: { encryptionKey: key, youtubeDescriptionContacts: true } });
    expect(await ownerQuery(`select 1 from gcp.creator_contacts where creator_id = '${id}'`)).toHaveLength(2);
  });
});
