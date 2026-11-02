import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createImportsService, parseCsv } from "./service";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());
const service = createImportsService({ db, encryptionKey: TEST_KEY });
const person = async (): Promise<TenantContext> => ({ ...(await createTestWorkspace()), requestId: "req-import", role: "member" });

const csv = (lines: string[]) => ["profile_url,platform,niche,country,email", ...lines].join("\n");

describe("CSV parsing", () => {
  it("reads quoted fields, doubled quotes, CRLF and a BOM; formula-like cells stay plain text", () => {
    const p = parseCsv('﻿Profile URL,Notes\r\n"https://instagram.com/a","said ""hi"", twice"\r\n=HYPERLINK("x"),+1\r\n\r\n');
    expect(p.header).toEqual(["profile_url", "notes"]);
    expect(p.rows).toEqual([["https://instagram.com/a", 'said "hi", twice'], ['=HYPERLINK("x")', "+1"]]);
  });
});

describe("creator list imports", () => {
  it("matches, flags and deduplicates rows, keeps declarations and emails for the workspace only, and never changes the catalogue", async () => {
    const ctx = await person();
    const known = await addCreator(db, { niches: ["Bridal"], country: "PK", profiles: [{ platform: "instagram", handle: "known_one" }] });
    const before = await ownerQuery(`select niches, country from gcp.creators where id = '${known}'`);
    const out = await service.create(
      ctx,
      {
        source: "Agency roster",
        reviewedOn: "2026-10-01",
        csv: csv([
          "https://www.instagram.com/known_one/,instagram,cooking,United Arab Emirates,booking@knownone.pk",
          "instagram.com/known_one,,,,",
          "https://tiktok.com/@not_here,tiktok,Gaming,PK,hello@nothere.pk",
          "https://instagram.com/known_one_x,youtube,,,",
          "https://facebook.com/someone,,,,",
          '=HYPERLINK("https://evil.example"),,,,',
        ]),
      },
      `imp-${randomUUID()}`,
    );
    expect(out.counts).toEqual({ total: 6, matched: 1, notInCatalogue: 1, invalid: 3, duplicate: 1 });
    expect(out.rows.map((r) => r.status)).toEqual(["matched", "duplicate", "not_in_catalogue", "invalid", "invalid", "invalid"]);
    expect(out.rows[0]).toMatchObject({ creatorId: known, declaredNiche: "Food", declaredCountry: "AE", emailStored: true });
    expect(out.rows[2]).toMatchObject({ declaredNiche: "Gaming", emailStored: false, problem: expect.stringContaining("email kept only for profiles in MUSHIN") });
    expect(out.rows[3]?.problem).toContain("not youtube");
    expect(out.rows[5]).toMatchObject({ inputUrl: '=HYPERLINK("https://evil.example")', status: "invalid" });
    // The shared catalogue is untouched; the email is a workspace contact, labelled imported and unverified.
    expect(await ownerQuery(`select niches, country from gcp.creators where id = '${known}'`)).toEqual(before);
    expect(await ownerQuery(`select count(*)::int n from gcp.creator_contacts where creator_id = '${known}'`)).toEqual([{ n: 0 }]);
    expect(await ownerQuery(`select workspace_id, source, status from wp.workspace_contacts where creator_id = '${known}'`)).toEqual([{ workspace_id: ctx.workspaceId, source: "imported", status: "unverified" }]);
  });

  it("returns the first import for a retried upload, and keeps imports private to their workspace", async () => {
    const ctx = await person();
    await addCreator(db, { profiles: [{ platform: "instagram", handle: "known_two" }] });
    const key = `imp-${randomUUID()}`;
    const body = { source: "List", csv: csv(["https://instagram.com/known_two,,,,"]) };
    const first = await service.create(ctx, body, key);
    const again = await service.create(ctx, body, key);
    expect(again.id).toBe(first.id);
    expect(await ownerQuery(`select count(*)::int n from wp.creator_import_rows where import_id = '${first.id}'`)).toEqual([{ n: 1 }]);
    const other = await person();
    await expect(service.detail(other, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.list(other)).toEqual([]);
    expect((await service.list(ctx)).map((i) => i.id)).toEqual([first.id]);
  });

  it("refuses files without a link column, without rows, or too large", async () => {
    const ctx = await person();
    await expect(service.create(ctx, { source: "x", csv: "name,email\nA,a@b.pk" }, `imp-${randomUUID()}`)).rejects.toMatchObject({ details: { reason: "missing_url_column" } });
    await expect(service.create(ctx, { source: "x", csv: "profile_url\n" }, `imp-${randomUUID()}`)).rejects.toMatchObject({ details: { reason: "no_rows" } });
    const many = csv(Array.from({ length: 2001 }, (_, i) => `https://instagram.com/c${i},,,,`));
    await expect(service.create(ctx, { source: "x", csv: many }, `imp-${randomUUID()}`)).rejects.toMatchObject({ details: { reason: "too_many_rows" } });
  });
});

// BUG-36: an import row matched to a creator counts as the workspace holding it, which unlocks a creator locked by the
// Pakistan-only rule (profile, reveal, Update info). Importing a locked creator's link must answer like an unknown link.
describe("BUG-36 imports and the Pakistan-only lock", () => {
  const abroad = (handle: string) => addCreator(db, { confirmedCountry: null, country: null, profiles: [{ platform: "instagram", handle, bio: "Food vlogger based in Dubai, UAE" }] });
  const unknownProblem = "Not in MUSHIN yet: add it by link to fetch it (uses credits)";

  it("a locked creator's link is answered like an unknown link: no match, no stored email, nothing that unlocks it", async () => {
    const ctx = await person();
    const id = await abroad("dubai_locked");
    const out = await service.create(ctx, { source: "Agency roster", csv: csv(["https://www.instagram.com/dubai_locked/,instagram,,,team@dubailocked.ae", "https://instagram.com/never_seen,,,,"]) }, `imp-${randomUUID()}`);
    expect(out.counts).toMatchObject({ matched: 0, notInCatalogue: 2 });
    const [locked, unknown] = out.rows;
    expect(locked).toMatchObject({ status: "not_in_catalogue", creatorId: null });
    expect(locked?.problem).toBe(`${unknownProblem}; email kept only for profiles in MUSHIN`);
    expect(unknown?.problem).toBe(unknownProblem);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.creator_import_rows where creator_id = '${id}'`))[0]?.n).toBe(0);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.workspace_contacts where creator_id = '${id}'`))[0]?.n).toBe(0);
  });

  it("a workspace that already holds the creator (saved before the lock) still gets the match", async () => {
    const ctx = await person();
    const id = await abroad("dubai_saved");
    const [list] = await ownerQuery<{ id: string }>(`insert into wp.lists (workspace_id, name, created_by) values ('${ctx.workspaceId}', 'Saved', '${ctx.userId}') returning id`);
    await ownerQuery(`insert into wp.list_members (workspace_id, list_id, creator_id, added_by) values ('${ctx.workspaceId}', '${list?.id}', '${id}', '${ctx.userId}')`);
    const out = await service.create(ctx, { source: "Agency roster", csv: csv(["https://www.instagram.com/dubai_saved/,instagram,,,"]) }, `imp-${randomUUID()}`);
    expect(out.rows[0]).toMatchObject({ status: "matched", creatorId: id });
  });
});
