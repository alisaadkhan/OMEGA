import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCampaignsService } from "../campaigns/index";
import { addIndexedCreator } from "../creators/test-fixtures";
import { createExportsService, csvCell, EXPORT_TTL_MS } from "./service";

/** Data export (owner plan model 2026-10-16): Scale only, owner/admin only, 24 hours, no contact values. */
const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

let entitled = true;
let clock = new Date("2026-10-16T10:00:00Z");
const billing = { getAccess: async () => ({ status: "active" as const, planId: "scale" as const, entitlements: { audienceViewsPerMonth: null, outreachEmailsPerMonth: 2000, campaignLimit: null, export: entitled }, spend: "all" as const }) };
const exportsFor = (enabled = true) => createExportsService({ db, billing, enabled, now: () => clock });
const campaigns = createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });
beforeEach(() => {
  entitled = true;
  clock = new Date("2026-10-16T10:00:00Z");
});

async function workspace(role: TenantContext["role"] = "owner"): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: "req", role };
}
const base = { status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } as const;

describe("data export", () => {
  it("is refused without the Scale entitlement, for members, and when the server switch is off", async () => {
    const c = await workspace();
    entitled = false;
    await expect(exportsFor().create(c, { kind: "lists" })).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED", details: { reason: "plan_feature", key: "export" } });
    entitled = true;
    await expect(exportsFor().create({ ...c, role: "member" }, { kind: "lists" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportsFor(false).create(c, { kind: "lists" })).rejects.toMatchObject({ details: { reason: "export_unavailable" } });
  });

  it("exports campaigns as CSV without contact values, neutralising spreadsheet formulas", async () => {
    const c = await workspace();
    const creator = await addIndexedCreator(db, { displayName: "Sana Bakes", contacts: [{ kind: "email", value: "sana@example.com", trust: "verified", source: "bio" }] });
    const k = await campaigns.create(c, { ...base, name: "=HYPERLINK(\"http://evil\")", client: "Heritage" });
    await campaigns.addCreators(c, k.id, [creator]);
    const made = await exportsFor().create(c, { kind: "campaigns" });
    expect(made).toMatchObject({ kind: "campaigns", rowCount: 1, available: true, downloads: 0 });
    const file = await exportsFor().download(c, made.id);
    expect(file.filename).toMatch(/^mushin-campaigns-2026-10-16\.csv$/);
    expect(file.content).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(file.content).toContain("Sana Bakes");
    expect(file.content).not.toContain("sana@example.com");
    expect((await exportsFor().list(c))[0]).toMatchObject({ id: made.id, downloads: 1 });
  });

  it("expires after 24 hours; the purge drops the file and keeps the audit row", async () => {
    const c = await workspace();
    const made = await exportsFor().create(c, { kind: "lists" });
    clock = new Date(clock.getTime() + EXPORT_TTL_MS + 1000);
    await expect(exportsFor().download(c, made.id)).rejects.toMatchObject({ details: { reason: "export_expired" } });
    await ownerQuery(`update wp.data_exports set expires_at = now() - interval '1 minute'`);
    expect((await ownerQuery<{ n: number }>(`select platform.purge_expired_exports() as n`))[0]?.n).toBe(1);
    expect(await ownerQuery(`select content, requested_by is not null as audited from wp.data_exports`)).toEqual([{ content: null, audited: true }]);
  });

  it("never gives one workspace another's export, and a downgrade stops downloads", async () => {
    const c = await workspace();
    const made = await exportsFor().create(c, { kind: "lists" });
    const other = await workspace();
    await expect(exportsFor().download(other, made.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await exportsFor().list(other)).toEqual([]);
    entitled = false;
    await expect(exportsFor().download(c, made.id)).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
  });

  it("lets a member export only a campaign they created, sees only their own exports, and records every download", async () => {
    const owner = await workspace();
    const ws = await ownerQuery<{ id: string }>(`insert into wp.users (id, email, display_name) values (gen_random_uuid(), 'm' || floor(random() * 1e9) || '@example.com', 'Mo') returning id`);
    const memberId = ws[0]?.id as string;
    await ownerQuery(`insert into wp.workspace_members (workspace_id, user_id, role) values ('${owner.workspaceId}', '${memberId}', 'member')`);
    const member: TenantContext = { ...owner, userId: memberId, role: "member" };
    const theirs = await campaigns.create(member, { ...base, name: "Mo's launch" });
    const ownersOwn = await campaigns.create(owner, { ...base, name: "Owner plan" });

    await expect(exportsFor().create(member, { kind: "campaigns" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportsFor().create(member, { kind: "campaigns", scopeId: ownersOwn.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const made = await exportsFor().create(member, { kind: "campaigns", scopeId: theirs.id });
    expect(made.scope).toEqual({ id: theirs.id, name: "Mo's launch" });
    const ownerExport = await exportsFor().create(owner, { kind: "campaigns" });

    expect((await exportsFor().list(member)).map((e) => e.id)).toEqual([made.id]);
    expect((await exportsFor().list(owner)).map((e) => e.id).sort()).toEqual([made.id, ownerExport.id].sort());
    await expect(exportsFor().download(member, ownerExport.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await exportsFor().download(member, made.id)).filename).toBe("mushin-campaigns-mo-s-launch-2026-10-16.csv");
    await exportsFor().download(owner, made.id);
    expect(await ownerQuery(`select user_id from wp.data_export_downloads where export_id = '${made.id}' order by downloaded_at`)).toEqual([{ user_id: memberId }, { user_id: owner.userId }]);
  });

  it("quotes every cell", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("+92 300")).toBe(`"'+92 300"`);
    expect(csvCell(null)).toBe('""');
  });
});
