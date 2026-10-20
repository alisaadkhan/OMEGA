import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createSearchIndex, FixtureScraper, MemoryStorage, MockLlm, MockPayments, scraperFixture } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../../billing/index";
import { recordStaffAudit } from "../../staff/index";
import { createEnrichmentPipeline } from "../enrichment/pipeline";
import { createCreatorsService } from "../service";
import { suppressedUrls, urlHash } from "../suppressions";
import { addCreator, TEST_KEY } from "../test-fixtures";
import { createEraser } from "./eraser";
import { createRemovalService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const removals = createRemovalService({ db, encryptionKey: TEST_KEY, audit: recordStaffAudit });
beforeEach(resetTables);
afterAll(() => db.close());

const staff = async () => {
  const [s] = await ownerQuery<{ id: string }>(`insert into staff.staff_users (email, name, role, password_hash, totp_secret_encrypted) values ('a${randomUUID().slice(0, 6)}@mushin.pk', 'Admin', 'admin', 'x', 'x') returning id`);
  return { staffId: s?.id ?? "", role: "admin" as const, factors: ["otp" as const, "hwk" as const] };
};
const meta = { ip: "127.0.0.1", requestId: "req-1" };
const status = async (id: string) => (await ownerQuery<{ status: string }>(`select status from gcp.creators where id = '${id}'`))[0]?.status;
const request = (urls: string[], extra: Record<string, unknown> = {}) => ({ urls, email: "Me@Example.com", confirm: true as const, ...extra });

describe("removal requests", () => {
  it("hides the creator at once and stores the request with an encrypted email", async () => {
    const id = await addCreator(db, { profiles: [{ platform: "instagram", handle: "hide_me" }] });
    const changedBefore = (await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.changed'`))[0]?.n ?? 0;
    await removals.submit(request(["https://www.instagram.com/Hide_Me/"], { reason: "<b>Please</b> remove me" }));
    expect(await status(id)).toBe("removal_requested");
    const [r] = await ownerQuery<{ creator_id: string; urls: string[]; requester_email_encrypted: string; reason: string }>(`select creator_id, urls, requester_email_encrypted, reason from gcp.removal_requests`);
    expect(r).toMatchObject({ creator_id: id, urls: ["https://instagram.com/hide_me"], reason: "Please remove me" });
    expect(r?.requester_email_encrypted).not.toContain("example.com");
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.changed'`);
    expect(ev[0]?.n).toBe(changedBefore + 1);
  });

  it("answers the same for unknown links (Review Focus 4)", async () => {
    await expect(removals.submit(request(["instagram.com/nobody_here"]))).resolves.toBeUndefined();
    const [r] = await ownerQuery<{ creator_id: string | null }>(`select creator_id from gcp.removal_requests`);
    expect(r?.creator_id).toBeNull();
  });

  it("ignores requests with the bot-trap field filled (Review Focus 4)", async () => {
    await removals.submit(request(["instagram.com/someone"], { website: "http://spam.example" }));
    expect(await ownerQuery(`select 1 from gcp.removal_requests`)).toEqual([]);
  });

  it("refuses links that are not profiles", async () => {
    await expect(removals.submit(request(["https://example.com/me", "instagram.com/p/C1x2"]))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("lists pending requests for staff with a masked email", async () => {
    await addCreator(db, { displayName: "Listed One", primaryHandle: "listed_one", profiles: [{ platform: "instagram", handle: "listed_one" }] });
    await removals.submit(request(["instagram.com/listed_one"]));
    const [r] = await removals.list("received");
    expect(r).toMatchObject({ urls: ["https://instagram.com/listed_one"], creator: { displayName: "Listed One", handle: "listed_one" }, emailMasked: "m***@e***.com", status: "received" });
  });
});

describe("staff review", () => {
  it("reject restores the creator; rejecting one of two open requests keeps it hidden (Review Focus 5)", async () => {
    const s = await staff();
    const id = await addCreator(db, { profiles: [{ platform: "instagram", handle: "twice" }] });
    await removals.submit(request(["instagram.com/twice"]));
    await removals.submit(request(["instagram.com/twice"]));
    const [first, second] = await removals.list("received");
    await removals.reject(first?.id ?? "", "Could not confirm the requester owns this account.", s, meta);
    expect(await status(id)).toBe("removal_requested");
    await removals.reject(second?.id ?? "", "Could not confirm the requester owns this account.", s, meta);
    expect(await status(id)).toBe("active");
    await expect(removals.reject(second?.id ?? "", "again again", s, meta)).rejects.toMatchObject({ code: "CONFLICT" });
    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log`);
    expect(audit.map((a) => a.action)).toEqual(["creators.removal.rejected", "creators.removal.rejected"]);
  });

  it("approve queues the erasure once and is audit-logged", async () => {
    const s = await staff();
    await addCreator(db, { profiles: [{ platform: "instagram", handle: "approve_me" }] });
    await removals.submit(request(["instagram.com/approve_me"]));
    const [r] = await removals.list("received");
    await removals.approve(r?.id ?? "", s, meta);
    await expect(removals.approve(r?.id ?? "", s, meta)).rejects.toMatchObject({ code: "CONFLICT" });
    const ev = await ownerQuery<{ payload: { removalRequestId: string } }>(`select payload from platform.outbox where event_type = 'erasure.creator_requested'`);
    expect(ev).toEqual([{ payload: { removalRequestId: r?.id } }]);
    expect((await removals.list("processed")).map((x) => x.id)).toEqual([r?.id]);
  });
});

describe("owner review at the command line (console approval blocked, owner decision 2026-10-15)", () => {
  it("approves and rejects with the same audit actions, recording channel, operator and reason, and no staff account", async () => {
    await addCreator(db, { profiles: [{ platform: "instagram", handle: "owner_ok" }] });
    const kept = await addCreator(db, { profiles: [{ platform: "instagram", handle: "owner_no" }] });
    await removals.submit(request(["instagram.com/owner_ok"]));
    await removals.submit(request(["instagram.com/owner_no"]));
    const open = await removals.list("received");
    const ok = open.find((r) => r.urls[0]?.includes("owner_ok"));
    const no = open.find((r) => r.urls[0]?.includes("owner_no"));
    await removals.approve(ok?.id ?? "", { ownerCli: { operator: "Owner", reason: "Verified from the creator's own account" } }, { ip: null, requestId: "owner-cli-1" });
    await removals.reject(no?.id ?? "", "Not the requester's profile", { ownerCli: { operator: "Owner", reason: "Not the requester's profile" } }, { ip: null, requestId: "owner-cli-2" });
    const audit = await ownerQuery<{ staff_id: string | null; action: string; metadata: Record<string, unknown> }>(`select staff_id, action, metadata from staff.audit_log order by action`);
    expect(audit).toEqual([
      { staff_id: null, action: "creators.removal.approved", metadata: { removalRequestId: ok?.id, creatorId: expect.any(String), channel: "owner-cli", operator: "Owner", reason: "Verified from the creator's own account" } },
      { staff_id: null, action: "creators.removal.rejected", metadata: { removalRequestId: no?.id, creatorId: kept, channel: "owner-cli", operator: "Owner", reason: "Not the requester's profile" } },
    ]);
    expect(await status(kept)).toBe("active");
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'erasure.creator_requested'`);
    expect(ev[0]?.n).toBe(1);
  });
});

describe("eraser", () => {
  it("erasure removes every listed row and blocks re-adding (Review Focus 5)", async () => {
    const storage = new MemoryStorage();
    const raw = structuredClone(scraperFixture("instagram-profile.json")) as Record<string, unknown>[];
    (raw[0] as Record<string, unknown>)["profilePicUrlHD"] = "https://scontent-man2-1.cdninstagram.com/v/t51/coke.jpg";
    (raw[0] as Record<string, unknown>)["biography"] = "Bookings: sana@example.com 0300-1234567";
    const pipeline = createEnrichmentPipeline({
      db,
      scraper: new FixtureScraper({ instagram: { provider: "apify", raw, costUsd: 0 } }),
      storage,
      llm: new MockLlm(() => ({ nonsense: true })),
      encryptionKey: TEST_KEY,
      logger,
      fetchImage: async () => new Response("img", { headers: { "content-type": "image/jpeg" } }),
      // search-v2: attribute evidence quotes the creator's own text, so erasure must remove it too.
      attributePolicy: "v2",
    });
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    const saved = await pipeline.enrich({ jobId: randomUUID(), workspaceId: a.workspaceId, platform: "instagram", handle: "coke_studio", canonicalUrl: "https://instagram.com/coke_studio", requestId: null }, { onStep: async () => undefined, onSaved: async () => undefined });
    if (saved.kind !== "saved") throw new Error("expected saved");
    const id = saved.creatorId;
    for (const ws of [a, b]) {
      await ownerQuery(`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values ('${ws.workspaceId}', '${id}', '${ws.userId}')`);
      await ownerQuery(`insert into wp.audience_views (workspace_id, creator_id, month, viewed_by) values ('${ws.workspaceId}', '${id}', date_trunc('month', now())::date, '${ws.userId}')`);
    }
    expect(storage.objects.size).toBeGreaterThanOrEqual(2);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_attribute_evidence where creator_id = '${id}'`))[0]?.n).toBeGreaterThan(0);
    // An earlier add-by-link job and a cached Google result also name the creator (security review of 0012).
    await ownerQuery(`insert into wp.discovery_jobs (workspace_id, kind, requested_by, input_url, platform, handle, canonical_url, cost, status)
      values ('${b.workspaceId}', 'add_by_url', '${b.userId}', 'https://www.instagram.com/Coke_Studio/', 'instagram', 'coke_studio', 'https://instagram.com/coke_studio', 10, 'completed')`);
    await ownerQuery(`insert into platform.serper_cache (query_hash, query, results) values
      ('${"b".repeat(64)}', 'site:instagram.com music', '[{"title":"Coke Studio","link":"https://www.instagram.com/coke_studio/","snippet":"music"}]'),
      ('${"c".repeat(64)}', 'site:instagram.com food', '[{"title":"Other","link":"https://www.instagram.com/other_one/","snippet":"food"}]')`);
    await removals.submit(request(["instagram.com/coke_studio"]));
    const [r] = await removals.list("received");
    await removals.approve(r?.id ?? "", await staff(), meta);
    const eraser = createEraser({ db, storage, logger });
    await eraser.erase(r?.id ?? "");
    await eraser.erase(r?.id ?? ""); // safe to repeat

    const left = await ownerQuery<Record<string, number>>(`select
      (select count(*)::int from gcp.creator_contacts where creator_id = '${id}') contacts,
      (select count(*)::int from gcp.creator_links where creator_id = '${id}') links,
      (select count(*)::int from gcp.creator_profiles where creator_id = '${id}') profiles,
      (select count(*)::int from gcp.enrichment_snapshots where creator_id = '${id}') snapshots,
      (select count(*)::int from platform.raw_payloads where canonical_url = 'https://instagram.com/coke_studio') payloads,
      (select count(*)::int from wp.contact_reveals where creator_id = '${id}') reveals,
      (select count(*)::int from wp.audience_views where creator_id = '${id}') views,
      (select count(*)::int from gcp.creator_attribute_evidence where creator_id = '${id}') evidence`);
    expect(left[0]).toEqual({ contacts: 0, links: 0, profiles: 0, snapshots: 0, payloads: 0, reveals: 0, views: 0, evidence: 0 });
    expect(storage.objects.size).toBe(0);
    const job = await ownerQuery<{ handle: string; input_url: string | null }>(`select handle, input_url from wp.discovery_jobs where workspace_id = '${b.workspaceId}'`);
    expect(job).toEqual([{ handle: "erased", input_url: null }]);
    expect((await ownerQuery<{ query: string }>(`select query from platform.serper_cache`)).map((r) => r.query)).toEqual(["site:instagram.com food"]);
    const [c] = await ownerQuery<{ status: string; display_name: string; avatar_url: string | null; ai_summary: string | null }>(`select status, display_name, avatar_url, ai_summary from gcp.creators where id = '${id}'`);
    expect(c).toEqual({ status: "erased", display_name: "Erased creator", avatar_url: null, ai_summary: null });
    expect(await db.withSystem((tx) => suppressedUrls(tx, ["https://instagram.com/coke_studio"]))).toEqual(new Set(["https://instagram.com/coke_studio"]));
    const [after] = await ownerQuery<{ urls: string[] }>(`select urls from gcp.removal_requests where id = '${r?.id}'`);
    expect(after?.urls[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'notify.removal_processed'`);
    expect(ev[0]?.n).toBe(1);
  });

  it("erases a creator added after the request was made (links resolved again at erasure)", async () => {
    await removals.submit(request(["instagram.com/added_later"]));
    const late = await addCreator(db, { primaryHandle: "added_later", profiles: [{ platform: "instagram", handle: "added_later" }] });
    const [r] = await removals.list("received");
    expect(r?.creator).toBeNull();
    await removals.approve(r?.id ?? "", await staff(), meta);
    await createEraser({ db, storage: new MemoryStorage(), logger }).erase(r?.id ?? "");
    expect(await status(late)).toBe("erased");
    expect(await ownerQuery(`select 1 from gcp.creator_profiles where creator_id = '${late}'`)).toEqual([]);
  });

  it("after a restore, re-applies the erasure journal: suppressions come back and restored creators are erased again (audit OPS-04)", async () => {
    // The journal holds only link hashes, exported outside the database before the loss.
    const journal = [
      { urlHash: urlHash("https://instagram.com/restored_one"), platform: "instagram" as const },
      { urlHash: urlHash("https://youtube.com/@never_added"), platform: "youtube" as const },
      { urlHash: "not-a-hash", platform: "tiktok" as const },
    ];
    // The restored (older) database still has the creator and no suppression.
    const back = await addCreator(db, { primaryHandle: "restored_one", profiles: [{ platform: "instagram", handle: "restored_one" }] });
    const kept = await addCreator(db, { primaryHandle: "unrelated", profiles: [{ platform: "instagram", handle: "unrelated" }] });
    const eraser = createEraser({ db, storage: new MemoryStorage(), logger });
    expect(await eraser.reapplyJournal(journal)).toEqual({ suppressionsRestored: 2, creatorsErased: 1 });
    expect(await status(back)).toBe("erased");
    expect(await status(kept)).not.toBe("erased");
    expect(await db.withSystem((tx) => suppressedUrls(tx, ["https://instagram.com/restored_one", "https://youtube.com/@never_added"]))).toEqual(
      new Set(["https://instagram.com/restored_one", "https://youtube.com/@never_added"]),
    );
    expect(await eraser.reapplyJournal(journal)).toEqual({ suppressionsRestored: 0, creatorsErased: 0 }); // safe to repeat
  });

  it("clears requester emails 30 days after a request was handled", async () => {
    await removals.submit(request(["instagram.com/old_one"]));
    await ownerQuery(`update gcp.removal_requests set status = 'rejected', processed_at = now() - interval '31 days'`);
    expect(await createEraser({ db, storage: new MemoryStorage(), logger }).clearOldEmails()).toBe(1);
    expect(await ownerQuery(`select 1 from gcp.removal_requests where requester_email_encrypted is not null`)).toEqual([]);
  });
});

describe("remove revealed contacts (per workspace)", () => {
  const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const creators = createCreatorsService({ db, index: createSearchIndex(null, logger), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger });

  it("owners and admins remove only their workspace's reveal; members cannot", async () => {
    const id = await addCreator(db);
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    for (const ws of [a, b]) await ownerQuery(`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values ('${ws.workspaceId}', '${id}', '${ws.userId}')`);
    const ctx = (ws: { userId: string; workspaceId: string }, role: TenantContext["role"]): TenantContext => ({ ...ws, role, requestId: "r" });
    await expect(creators.forgetReveal(ctx(a, "member"), id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await creators.forgetReveal(ctx(a, "admin"), id);
    expect((await ownerQuery<{ workspace_id: string }>(`select workspace_id from wp.contact_reveals`)).map((r) => r.workspace_id)).toEqual([b.workspaceId]);
  });
});
