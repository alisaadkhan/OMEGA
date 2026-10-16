import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, pinActionCosts, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createCreatorIndexer } from "./indexer";
import { createPostgresCatalogSearch } from "./postgres-search";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";
import { createCampaignsService } from "../campaigns/index";
import { createListsService } from "../lists/index";

// Creator eligibility elig-1 through the real catalogue search (PostgreSQL backend): synthetic fixtures prove the rule,
// not search quality.
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
let clock = new Date();
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger, now: () => clock });
const indexer = createCreatorIndexer({ db, index: null, logger });
const lists = createListsService({ db, now: () => clock });
const campaigns = createCampaignsService({ db, now: () => clock, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });
const campaignBase = { status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } as const;

let restorePrices: () => Promise<void> = async () => {};
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0 });
});
afterAll(async () => {
  await restorePrices();
  await db.close();
});
beforeEach(async () => {
  await resetTables();
  clock = new Date();
});

async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: "req-elig", role: "owner" };
}
const names = async (text: string) => (await creators.search(await customer(), searchRequestSchema.parse({ text, filters: {}, confirmedCost: 0 }))).results.map((r) => r.displayName).sort();
const add = async (displayName: string, followers: number | null, extra: Record<string, unknown> = {}) => addCreator(db, { displayName, niches: ["Food"], profiles: [{ followers, bio: "Lahore food", ...extra }] });
const doc = async (id: string) => (await ownerQuery<{ eligible: boolean; eligibility_reasons: string[]; eligibility_version: string; qualifying_platforms: string[] }>(`select eligible, eligibility_reasons, eligibility_version, qualifying_platforms from gcp.creator_search_documents where creator_id = '${id}'`))[0];

describe("creator eligibility in catalogue search (elig-1)", () => {
  it("shows creators at 10,000 and above only, and records why the others are hidden", async () => {
    const below = await add("Below Nine Nine", 9_999);
    const at = await add("At Ten K", 10_000);
    await add("Above Ten K", 10_001);
    const unknown = await add("Unknown Count", null);
    await indexer.reconcile();
    expect(await names("food")).toEqual(["Above Ten K", "At Ten K"]);
    expect(await doc(below)).toMatchObject({ eligible: false, eligibility_reasons: ["below_follower_minimum"], eligibility_version: "elig-1" });
    expect(await doc(unknown)).toMatchObject({ eligible: false, eligibility_reasons: ["followers_unknown"] });
    expect(await doc(at)).toMatchObject({ eligible: true, qualifying_platforms: ["instagram"] });
  });

  it("qualifies through one large profile and names only that platform", async () => {
    const id = await addCreator(db, {
      displayName: "Two Profiles",
      niches: ["Food"],
      profiles: [{ platform: "instagram", followers: 2_000, bio: "food" }, { platform: "youtube", followers: 40_000, bio: "food" }],
    });
    await indexer.reconcile();
    expect(await names("food")).toEqual(["Two Profiles"]);
    expect(await doc(id)).toMatchObject({ eligible: true, qualifying_platforms: ["youtube"] });
  });

  it("hides a creator once the count is older than 90 days, without re-indexing", async () => {
    await add("Fresh Count", 50_000);
    await indexer.reconcile();
    expect(await names("food")).toEqual(["Fresh Count"]);
    clock = new Date(Date.now() + 91 * 86_400_000);
    expect(await names("food")).toEqual([]);
  });

  it("hides a creator known to be inactive, and flags unknown activity instead of inventing it", async () => {
    const inactive = await add("Quiet Creator", 50_000);
    const unknownActivity = await add("No Post Dates", 50_000);
    await ownerQuery(`update gcp.creator_profiles set last_post_at = now() - interval '120 days' where creator_id = '${inactive}'`);
    await indexer.reconcile();
    expect(await names("food")).toEqual(["No Post Dates"]);
    expect(await doc(inactive)).toMatchObject({ eligible: false, eligibility_reasons: ["inactive"] });
    expect((await ownerQuery<{ eligibility_flags: string[] }>(`select eligibility_flags from gcp.creator_search_documents where creator_id = '${unknownActivity}'`))[0]?.eligibility_flags).toEqual(["activity_unverified"]);
  });

  it("keeps ineligible records stored (nothing deleted)", async () => {
    const id = await add("Small Creator", 500);
    await indexer.reconcile();
    expect(await names("food")).toEqual([]);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int as n from gcp.creators where id = '${id}'`))[0]?.n).toBe(1);
  });

  it("rebuilds documents made under another policy version (fail closed until then)", async () => {
    const id = await add("Policy Change", 50_000);
    await indexer.reconcile();
    await ownerQuery(`update gcp.creator_search_documents set eligibility_version = 'elig-0', eligible = false where creator_id = '${id}'`);
    expect(await names("food")).toEqual([]);
    expect((await indexer.reconcile()).upserted).toBe(1);
    expect(await names("food")).toEqual(["Policy Change"]);
  });

  it("refuses to add an ineligible creator to a list or campaign through the API, with a stable reason", async () => {
    const small = await add("Small Bakes", 9_999);
    const big = await add("Big Bakes", 10_000);
    await indexer.reconcile();
    const c = await customer();
    const list = await lists.create(c, { name: "Bakers", description: "" });
    await expect(lists.addMembers(c, list.id, [big, small])).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "creator_ineligible", creatorIds: [small], policy: "elig-1" } });
    expect(await lists.addMembers(c, list.id, [big])).toEqual({ added: 1, alreadyOnList: 0 });
    const k = await campaigns.create(c, { ...campaignBase, name: "Bake sale" });
    await expect(campaigns.addCreators(c, k.id, [small])).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "creator_ineligible" } });
    expect(await campaigns.addCreators(c, k.id, [big])).toEqual({ added: 1, alreadyInCampaign: 0 });
  });

  it("keeps a saved creator who later falls below the minimum, labelled, and refuses adding them again elsewhere", async () => {
    const id = await add("Shrinking Creator", 12_000);
    await indexer.reconcile();
    const c = await customer();
    const list = await lists.create(c, { name: "Saved", description: "" });
    const k = await campaigns.create(c, { ...campaignBase, name: "Running" });
    await lists.addMembers(c, list.id, [id]);
    await campaigns.addCreators(c, k.id, [id]);
    await ownerQuery(`update gcp.creator_profiles set followers = 8000 where creator_id = '${id}'`);
    await indexer.sync([id]);
    const member = (await lists.detail(c, list.id)).members[0];
    expect(member?.creator).toMatchObject({ id, eligibility: { eligible: false, reasons: ["below_follower_minimum"] } });
    const inCampaign = (await campaigns.detail(c, k.id)).creators.find((m) => m.creator.id === id);
    expect(inCampaign?.creator.eligibility).toMatchObject({ eligible: false });
    const other = await lists.create(c, { name: "Other", description: "" });
    await expect(lists.addMembers(c, other.id, [id])).rejects.toMatchObject({ details: { reason: "creator_ineligible" } });
  });

  it("reports coverage for operations as counts only: totals, reasons and qualifying platforms", async () => {
    await add("Big One", 50_000);
    await add("Small One", 9_000);
    await add("Unknown One", null);
    await addCreator(db, { displayName: "YT Big", profiles: [{ platform: "youtube", followers: 20_000, bio: "x" }] });
    await indexer.reconcile();
    const r = await creators.eligibilityCoverage();
    expect(r).toMatchObject({ policy: "elig-1", total: 4, eligible: 2, activityUnverified: 2 });
    expect(r.byReason).toEqual(expect.arrayContaining([{ reason: "below_follower_minimum", creators: 1 }, { reason: "followers_unknown", creators: 1 }]));
    expect(r.byPlatform).toEqual([{ platform: "instagram", eligibleCreators: 1 }, { platform: "youtube", eligibleCreators: 1 }]);
    expect(JSON.stringify(r)).not.toMatch(/Big One|Small One|creator_/);
  });
});
