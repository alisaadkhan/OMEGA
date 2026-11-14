import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { findMergeGroups, mergeGroups } from "./identity-merge";
import { addCreator } from "./test-fixtures";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const link = (creatorId: string, url: string) => ownerQuery(`insert into gcp.creator_links (creator_id, platform, url, source) values ('${creatorId}', 'instagram', '${url}', 'bio')`);

// Addendum 3; owner directive 2026-11-04 §3 item 5 (migration 0085).
describe("cross-platform identity merge", () => {
  it("merges profiles that link to each other into one creator, moving list entries without duplicating them", async () => {
    const ig = await addCreator(db, { displayName: "Sana Cooks", primaryPlatform: "instagram", profiles: [{ platform: "instagram", handle: "sanacooks", followers: 90_000 }] });
    const yt = await addCreator(db, { displayName: "Sana Cooks", primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: "sanacookstv", followers: 40_000 }] });
    await link(ig, "https://www.youtube.com/@sanacookstv");
    await link(yt, "https://www.instagram.com/sanacooks");
    const ws = await createTestWorkspace();
    await ownerQuery(`insert into wp.lists (id, workspace_id, name, created_by) values ('00000000-0000-4000-8000-000000000001', '${ws.workspaceId}', 'Food', '${ws.userId}');
      insert into wp.list_members (list_id, workspace_id, creator_id, added_by) values ('00000000-0000-4000-8000-000000000001', '${ws.workspaceId}', '${ig}', '${ws.userId}'), ('00000000-0000-4000-8000-000000000001', '${ws.workspaceId}', '${yt}', '${ws.userId}')`);

    const groups = await findMergeGroups(db);
    expect(groups).toEqual([expect.objectContaining({ keep: ig, absorb: [yt], evidence: ["the profiles link to each other"] })]);
    expect((await mergeGroups(db, groups)).merged).toBe(1);

    expect((await ownerQuery<{ platform: string }>(`select platform from gcp.creator_profiles where creator_id = '${ig}' order by platform`)).map((p) => p.platform)).toEqual(["instagram", "youtube"]);
    expect(await ownerQuery(`select status, merged_into_id from gcp.creators where id = '${yt}'`)).toEqual([{ status: "merged", merged_into_id: ig }]);
    expect(await ownerQuery(`select creator_id from wp.list_members`)).toEqual([{ creator_id: ig }]); // one entry, not two
    expect((await ownerQuery<{ to_state: string }>(`select to_state from gcp.creator_lifecycle_events where kind = 'identity' order by to_state`)).map((e) => e.to_state)).toEqual(["merged", "merged_in"]);
    expect(await findMergeGroups(db)).toEqual([]); // idempotent
  });

  it("never merges on a one-way mention alone, nor two accounts on the same platform", async () => {
    const a = await addCreator(db, { displayName: "Ali Vlogs", profiles: [{ platform: "instagram", handle: "alivlogs", followers: 50_000 }] });
    await addCreator(db, { displayName: "Bilal Kitchen", primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: "bilalkitchen", followers: 50_000 }] });
    await link(a, "https://www.youtube.com/@bilalkitchen"); // "collab with my friend"
    expect(await findMergeGroups(db)).toEqual([]);
    const c = await addCreator(db, { displayName: "Ali Vlogs", profiles: [{ platform: "instagram", handle: "alivlogs2", followers: 10_000 }] });
    const [r] = await ownerQuery<{ v: { merged: boolean; reason: string } }>(`select platform.merge_creator('${a}', '${c}', 'test') v`);
    expect(r?.v).toEqual({ merged: false, reason: "same_platform" });
  });

  // Security review 2026-11-14: a look-alike account cannot attach itself to a real creator, and protections survive.
  it("ignores a one-way link from a small or unconfirmed profile, and never merges a possible minor or a creator with an open removal request", async () => {
    const real = await addCreator(db, { displayName: "Sana Cooks", primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: "sanacooks", followers: 400_000 }] });
    const fake = await addCreator(db, { displayName: "Sana Cooks", profiles: [{ platform: "instagram", handle: "sanacooks", followers: 300 }] });
    await link(fake, "https://www.youtube.com/@sanacooks"); // the impostor's own bio
    expect(await findMergeGroups(db)).toEqual([]);

    const tt = await addCreator(db, { displayName: "Sana Cooks", primaryPlatform: "tiktok", profiles: [{ platform: "tiktok", handle: "sanacooks", followers: 50_000 }] });
    await ownerQuery(`update gcp.creators set is_minor = true where id = '${tt}'`);
    const [m] = await ownerQuery<{ v: { reason: string } }>(`select platform.merge_creator('${real}', '${tt}', 'test') v`);
    expect(m?.v.reason).toBe("possible_minor");
    await ownerQuery(`insert into gcp.removal_requests (urls, creator_id, status) values (array['https://instagram.com/sanacooks'], '${fake}', 'received')`);
    const [rr] = await ownerQuery<{ v: { reason: string } }>(`select platform.merge_creator('${real}', '${fake}', 'test') v`);
    expect(rr?.v.reason).toBe("removal_requested");
  });
});
