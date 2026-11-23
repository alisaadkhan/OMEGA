import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEraser } from "../creators/erasure/eraser";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens, type StaffRole } from "../staff/index";
import { steppedUpToken, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createStaffOpsModule } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup() {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, autoTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, lookup: big, jobs: big, workspaceJobs: big, callback: big });
  const tokens = createStaffTokens("s".repeat(48));
  const staff = createStaffModule({ db, tokens, encryptionKey: TEST_KEY, webauthn: TEST_WEBAUTHN });
  const iss = await createTestIssuer();
  const reindexed: string[] = [];
  const removed: string[] = [];
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [
      platform.module,
      identity.module,
      staff.module,
      createStaffOpsModule({
        db,
        billing,
        requireStaff: staff.requireStaff,
        createStaffAccount: staff.createStaffAccount,
        creators: { reindex: async (ids) => void reindexed.push(...ids), remove: async (id) => void removed.push(id) },
      }),
    ],
  });
  const as = async (role: StaffRole) => {
    const acct = await staff.createStaffAccount({ email: `${role}-${randomUUID().slice(0, 6)}@mushin.pk`, name: role, role });
    return { authorization: `Bearer ${await steppedUpToken(db, tokens, acct.id, role)}` };
  };
  const customer = async () => {
    const h = { authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email: `c-${randomUUID().slice(0, 6)}@brand.pk`, fullName: "Brand" })}` };
    return (await app.inject({ method: "GET", url: "/v1/me", headers: h })).json() as { workspace: { id: string }; user: { id: string } };
  };
  return { app, as, customer, reindexed, removed };
}

describe("staff creator editor (owner, 22 Nov)", () => {
  it("lists every creator with open customer reports first, edits, hides and unhides with reasons, re-projects search and audits each change", async () => {
    const { app, as, customer, reindexed } = await setup();
    const reported = await addCreator(db, { displayName: "Reported Shop", profiles: [{ followers: 20_000, bio: "Shop" }] });
    const big = await addCreator(db, { displayName: "Big Creator", profiles: [{ followers: 900_000, bio: "Food in Lahore" }] });
    const me = await customer();
    await ownerQuery(`insert into wp.creator_profile_reviews (workspace_id, submitted_by, creator_id, source_mode, verdict, reason) values ('${me.workspace.id}', '${me.user.id}', '${reported}', 'db_search', 'invalid', 'not_individual_creator')`);
    const [admin, support] = [await as("admin"), await as("support")];

    const list = (await app.inject({ method: "GET", url: "/admin/v1/catalogue/all", headers: support })).json() as { items: { id: string; reports: number; reportReasons: string[] }[]; counts: { all: number; reported: number } };
    expect(list.items.map((i) => i.id)).toEqual([reported, big]);
    expect(list.items[0]).toMatchObject({ reports: 1, reportReasons: ["not_individual_creator"] });
    expect(list.counts).toMatchObject({ all: 2, reported: 1 });

    const edit = { displayName: "Big Creator Official", city: "Lahore", nicheMain: "Food", accountType: "INDIVIDUAL_CREATOR", reason: "Checked the profile and bio by hand" };
    expect((await app.inject({ method: "PATCH", url: `/admin/v1/catalogue/creators/${big}`, headers: support, payload: edit })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/admin/v1/catalogue/creators/${big}`, headers: admin, payload: { ...edit, reason: "short" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/admin/v1/catalogue/creators/${big}`, headers: admin, payload: edit })).statusCode).toBe(200);
    const [row] = await ownerQuery<{ display_name: string; city: string; niche_main: string; niches: string[]; account_type: string }>(`select display_name, city, niche_main, niches, account_type from gcp.creators where id = '${big}'`);
    expect(row).toMatchObject({ display_name: "Big Creator Official", city: "Lahore", niche_main: "Food", niches: ["Food"], account_type: "INDIVIDUAL_CREATOR" });

    const why = { reason: "A shop account, not a creator" };
    expect((await app.inject({ method: "POST", url: `/admin/v1/catalogue/creators/${reported}/hide`, headers: admin, payload: why })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/admin/v1/catalogue/creators/${reported}/hide`, headers: admin, payload: why })).statusCode).toBe(409);
    const hidden = (await app.inject({ method: "GET", url: "/admin/v1/catalogue/all?filter=hidden", headers: admin })).json() as { items: { id: string; status: string; hiddenReason: string }[] };
    expect(hidden.items).toEqual([expect.objectContaining({ id: reported, status: "hidden", hiddenReason: why.reason })]);
    expect((await app.inject({ method: "POST", url: `/admin/v1/catalogue/creators/${reported}/unhide`, headers: admin, payload: { reason: "Owner asked to show it again" } })).statusCode).toBe(200);

    expect(reindexed).toEqual([big, reported, reported]);
    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["catalogue.creator_edited", "catalogue.creator_hidden", "catalogue.creator_unhidden"]));
    expect((await app.inject({ method: "PATCH", url: `/admin/v1/catalogue/creators/${randomUUID()}`, headers: admin, payload: edit })).statusCode).toBe(404);
  });

  it("removal is an Admin decision with a reason; Support cannot remove", async () => {
    const { app, as, removed } = await setup();
    const id = await addCreator(db, { displayName: "To Remove", profiles: [{ followers: 30_000, bio: "x" }] });
    const why = { reason: "Creator asked us by email to be removed" };
    expect((await app.inject({ method: "POST", url: `/admin/v1/catalogue/creators/${id}/remove`, headers: await as("support"), payload: why })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/admin/v1/catalogue/creators/${id}/remove`, headers: await as("admin"), payload: why })).statusCode).toBe(200);
    expect(removed).toEqual([id]);
  });

  it("Trash hides a creator, Restore brings it back, Ban blocks its links, and the daily purge erases only what is older than 45 days", async () => {
    const { app, as } = await setup();
    const admin = await as("admin");
    const kept = await addCreator(db, { displayName: "Trash Then Restore" });
    const trashed = await addCreator(db, { displayName: "Old Trash" });
    const banned = await addCreator(db, { displayName: "Banned Page" });
    const why = { reason: "Under 10k followers, does not qualify" };
    const post = (id: string, path: string, payload: object, headers = admin) => app.inject({ method: "POST", url: `/admin/v1/catalogue/creators/${id}/${path}`, headers, payload });

    expect((await post(kept, "trash", why, await as("support"))).statusCode).toBe(403);
    for (const id of [kept, trashed]) expect((await post(id, "trash", why)).statusCode).toBe(200);
    expect((await post(banned, "trash", { ...why, ban: true })).statusCode).toBe(200);
    expect((await post(kept, "trash", why)).statusCode).toBe(404);

    const list = (await app.inject({ method: "GET", url: "/admin/v1/catalogue/all?filter=trash", headers: admin })).json() as { items: { displayName: string; trashBanned: boolean; trashedAt: string | null }[]; counts: { all: number; trash: number } };
    expect(list.counts).toMatchObject({ trash: 3, all: 0 });
    expect(list.items.find((c) => c.displayName === "Banned Page")).toMatchObject({ trashBanned: true, trashedAt: expect.any(String) });

    const hashes = async (id: string) => (await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_suppressions s join gcp.creator_profiles p on s.url_hash = encode(sha256(convert_to(lower(trim(p.canonical_url)), 'UTF8')), 'hex') where p.creator_id = '${id}'`))[0]?.n;
    expect(await hashes(banned)).toBe(1);
    expect(await hashes(kept)).toBe(0);

    expect((await post(kept, "restore", why)).statusCode).toBe(200);
    expect((await ownerQuery<{ status: string }>(`select status from gcp.creators where id = '${kept}'`))[0]?.status).toBe("active");

    // 46 days later: the purge erases both trashed creators; only the banned one stays on the do-not-re-add list.
    await ownerQuery(`update gcp.creators set trashed_at = now() - interval '46 days' where id = '${trashed}'`);
    await ownerQuery(`update gcp.creators set trashed_at = now() - interval '46 days' where id = '${banned}'`);
    const bannedUrl = (await ownerQuery<{ u: string }>(`select canonical_url u from gcp.creator_profiles where creator_id = '${banned}'`))[0]?.u;
    const trashedUrl = (await ownerQuery<{ u: string }>(`select canonical_url u from gcp.creator_profiles where creator_id = '${trashed}'`))[0]?.u;
    const erased = await createEraser({ db, storage: null, logger }).purgeTrashed();
    expect(erased.sort()).toEqual([trashed, banned].sort());
    expect((await ownerQuery<{ status: string }>(`select status from gcp.creators where id in ('${trashed}', '${banned}')`)).map((r) => r.status)).toEqual(["erased", "erased"]);
    const sup = async (u: string | undefined) => (await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_suppressions where url_hash = encode(sha256(convert_to(lower(trim('${u}')), 'UTF8')), 'hex')`))[0]?.n;
    expect(await sup(bannedUrl)).toBe(1);
    expect(await sup(trashedUrl)).toBe(0);
    expect(await createEraser({ db, storage: null, logger }).purgeTrashed()).toEqual([]);

    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["catalogue.creator_trashed", "catalogue.creator_banned", "catalogue.creator_restored"]));
  });
});
