import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCreatorIndexer } from "./indexer";
import { lifecycleSweep, MISSING_CONFIRM_MS, recordAvailability } from "./lifecycle";
import { expireYoutubeApiData } from "./retention";
import { addCreator } from "./test-fixtures";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());
const indexer = createCreatorIndexer({ db, index: null, logger: createLogger({ level: "silent" }) });

const observe = (url: string, observed: "found" | "not_found" | "private" | "provider_error", now = new Date()) =>
  db.withSystem((tx) => recordAvailability(tx, { canonicalUrl: url, observed, source: "refresh_job", reason: `test ${observed}`, now }));
const doc = async (id: string) => (await ownerQuery<{ eligible: boolean; qualifying_platforms: string[] }>(`select eligible, qualifying_platforms from gcp.creator_search_documents where creator_id = '${id}'`))[0];
// Availability and retention events; a profile's country decisions ("location", 0060) are covered by profile-country.int.
const events = (id: string) => ownerQuery<{ kind: string; from_state: string | null; to_state: string; source: string; action: string }>(`select kind, from_state, to_state, source, action from gcp.creator_lifecycle_events where creator_id = '${id}' and kind <> 'location' order by created_at`);

async function twoPlatforms() {
  const id = await addCreator(db, { niches: [], profiles: [{ platform: "instagram", handle: "sana_ig", followers: 50_000 }, { platform: "youtube", handle: "sanayt", followers: 40_000 }] });
  await indexer.sync([id]);
  return id;
}

describe("creator lifecycle (0057)", () => {
  it("treats a provider failure as temporary: still eligible, logged, records untouched", async () => {
    const id = await twoPlatforms();
    expect(await observe("https://instagram.com/sana_ig", "provider_error")).toEqual({ from: "available", to: "temporarily_unavailable" });
    await indexer.sync([id]);
    expect(await doc(id)).toMatchObject({ eligible: true });
    expect((await doc(id))?.qualifying_platforms.sort()).toEqual(["instagram", "youtube"]);
    expect(await events(id)).toEqual([expect.objectContaining({ kind: "availability", from_state: "available", to_state: "temporarily_unavailable", source: "refresh_job" })]);
    expect((await ownerQuery(`select 1 from gcp.creator_profiles where creator_id = '${id}'`)).length).toBe(2);
  });

  it("confirms a removal only after two 'not found' answers a day apart, and only for that platform; retries add no events", async () => {
    const id = await twoPlatforms();
    const t0 = new Date();
    await observe("https://instagram.com/sana_ig", "not_found", t0);
    await observe("https://instagram.com/sana_ig", "not_found", new Date(t0.getTime() + 3_600_000)); // a retry an hour later
    await indexer.sync([id]);
    expect((await doc(id))?.qualifying_platforms.sort()).toEqual(["instagram", "youtube"]);
    await observe("https://instagram.com/sana_ig", "not_found", new Date(t0.getTime() + MISSING_CONFIRM_MS + 1));
    await indexer.sync([id]);
    expect(await doc(id)).toMatchObject({ eligible: true, qualifying_platforms: ["youtube"] });
    expect((await events(id)).map((e) => e.to_state)).toEqual(["missing_unconfirmed", "not_found"]);
    // Hidden from Instagram results, never deleted.
    expect((await ownerQuery(`select availability from gcp.creator_profiles where canonical_url = 'https://instagram.com/sana_ig'`))[0]).toEqual({ availability: "not_found" });
    // The account comes back: it counts again.
    await observe("https://instagram.com/sana_ig", "found");
    await indexer.sync([id]);
    expect((await doc(id))?.qualifying_platforms.sort()).toEqual(["instagram", "youtube"]);
  });

  it("the sweep reports in a dry run and only re-projects with apply", async () => {
    const id = await addCreator(db, { profiles: [{ platform: "instagram", handle: "solo", followers: 50_000 }] });
    await indexer.sync([id]);
    await ownerQuery(`update gcp.creator_profiles set availability = 'not_found' where creator_id = '${id}'`);
    const dry = await lifecycleSweep({ db, apply: false, reproject: (ids) => indexer.sync(ids) });
    expect(dry).toMatchObject({ dryRun: true, eligibilityChanges: 1, unavailable: [{ availability: "not_found", n: 1 }] });
    expect(await doc(id)).toMatchObject({ eligible: true });
    const applied = await lifecycleSweep({ db, apply: true, reproject: (ids) => indexer.sync(ids) });
    expect(applied.eligibilityChanges).toBe(1);
    expect(await doc(id)).toMatchObject({ eligible: false });
    expect((await lifecycleSweep({ db, apply: true, reproject: (ids) => indexer.sync(ids) })).eligibilityChanges).toBe(0);
  });

  it("expires YouTube-derived niche, country and evidence after 30 days but keeps a creator-confirmed country", async () => {
    const id = await addCreator(db, { primaryPlatform: "youtube", niches: ["Food"], country: "PK", profiles: [{ platform: "youtube", handle: "oldchannel", followers: 50_000 }] });
    await ownerQuery(`update gcp.creators set niche_main = 'Food', niche_status = 'classified', niche_confidence = 'high', platform_country = 'PK', stated_country = 'PK', confirmed_country = 'AE', country_source = 'creator_confirmed', country_confidence = 'high' where id = '${id}'`);
    await ownerQuery(`insert into gcp.creator_attribute_evidence (creator_id, attribute, value, source, status, evidence) values ('${id}', 'niche', 'Food', 'profile_text', 'supported', 'quote from a channel description')`);
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '40 days', created_at = now() - interval '40 days' where creator_id = '${id}'`);
    expect(await expireYoutubeApiData(db)).toEqual([id]);
    const [c] = await ownerQuery<Record<string, unknown>>(`select niches, niche_main, niche_status, platform_country, stated_country, country, country_source from gcp.creators where id = '${id}'`);
    expect(c).toEqual({ niches: [], niche_main: null, niche_status: null, platform_country: null, stated_country: null, country: "AE", country_source: "creator_confirmed" });
    expect(await ownerQuery(`select 1 from gcp.creator_attribute_evidence where creator_id = '${id}'`)).toEqual([]);
    expect(await events(id)).toEqual([expect.objectContaining({ kind: "retention", to_state: "youtube_data_expired", source: "retention_job" })]);
    // Running again changes nothing and logs nothing new.
    await expireYoutubeApiData(db);
    expect(await events(id)).toHaveLength(1);
  });

  // 0063 (retention review 2026-10-29): description contacts, channel links and video hashtags were left behind.
  it("YT-RET-02 also clears contacts read from the channel description, links read from the channel and video hashtags; keeps staff contacts and fresh channels", async () => {
    const add = (handle: string) => addCreator(db, { primaryPlatform: "youtube", niches: ["Food"], profiles: [{ platform: "youtube", handle, followers: 50_000 }] });
    const [old, fresh] = [await add("oldtagged"), await add("freshtagged")];
    for (const id of [old, fresh]) {
      await ownerQuery(`update gcp.creators set tags = '{#streetfood,#lahore}' where id = '${id}'`);
      await ownerQuery(`insert into gcp.creator_contacts (creator_id, kind, value_encrypted, value_hash, masked, trust, source) values
        ('${id}', 'email', 'x', md5('${id}bio'), 'b***@x.pk', 'unverified', 'bio'), ('${id}', 'email', 'y', md5('${id}staff'), 's***@x.pk', 'verified', 'staff')`);
      await ownerQuery(`insert into gcp.creator_links (creator_id, platform, url, source) values ('${id}', 'instagram', 'https://www.instagram.com/${id.slice(0, 8)}/', 'profile_link')`);
    }
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '31 days', created_at = now() - interval '31 days' where creator_id = '${old}'`);
    expect(await expireYoutubeApiData(db)).toEqual([old]);
    const state = async (id: string) => ({
      tags: (await ownerQuery<{ tags: string[] }>(`select tags from gcp.creators where id = '${id}'`))[0]?.tags,
      contacts: (await ownerQuery<{ source: string }>(`select source from gcp.creator_contacts where creator_id = '${id}' order by source`)).map((r) => r.source),
      links: (await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_links where creator_id = '${id}'`))[0]?.n,
    });
    expect(await state(old)).toEqual({ tags: [], contacts: ["staff"], links: 0 });
    expect(await state(fresh)).toEqual({ tags: ["#streetfood", "#lahore"], contacts: ["bio", "staff"], links: 1 });
  });

  it("YT-RET-03 the retention job ignores eligibility: an ineligible or locked YouTube creator is cleared on the same deadline", async () => {
    const id = await addCreator(db, { primaryPlatform: "youtube", niches: ["Food"], confirmedCountry: null, country: null, platformCountry: "AE", profiles: [{ platform: "youtube", handle: "abroadold", followers: 2_000, bio: "Based in Dubai, UAE" }] });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '31 days', created_at = now() - interval '31 days' where creator_id = '${id}'`);
    expect(await expireYoutubeApiData(db)).toEqual([id]);
    const [p] = await ownerQuery<{ followers: number | null; bio: string | null }>(`select followers, bio from gcp.creator_profiles where creator_id = '${id}'`);
    expect(p).toEqual({ followers: null, bio: null });
  });
});
