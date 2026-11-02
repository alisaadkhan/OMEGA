import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, pinActionCosts, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createCampaignsService } from "../campaigns/index";
import { createListsService } from "../lists/index";
import { createCreatorIndexer } from "./indexer";
import { createPostgresCatalogSearch } from "./postgres-search";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

// Pakistan-only catalogue (elig-2, 0060, owner instruction 2026-10-27) through the real API services and PostgreSQL:
// every customer path (search, filters, lookup by link, profile by id, lists, campaigns) refuses profiles that are not
// Pakistani on their own evidence, and nothing is deleted.
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger });
const indexer = createCreatorIndexer({ db, index: null, logger });
const lists = createListsService({ db });
const campaigns = createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });
const campaignBase = { status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } as const;

let restorePrices: () => Promise<void> = async () => {};
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0 });
});
afterAll(async () => {
  await restorePrices();
  await db.close();
});
beforeEach(resetTables);

const customer = async (): Promise<TenantContext> => ({ ...(await createTestWorkspace()), requestId: "req-cty", role: "owner" });
const search = async (c: TenantContext, text: string, filters: Record<string, unknown> = {}) =>
  (await creators.search(c, searchRequestSchema.parse({ text, filters, confirmedCost: 0 }))).results.map((r) => r.displayName).sort();
/** A food creator whose only evidence is the given bio (no confirmed country), indexed like the worker indexes it. */
async function bioCreator(displayName: string, bio: string, over: Record<string, unknown> = {}) {
  const id = await addCreator(db, { displayName, niches: ["Food"], country: null, confirmedCountry: null, profiles: [{ followers: 50_000, bio }], ...over });
  await indexer.sync([id]);
  return id;
}
const profileCountry = (id: string) => ownerQuery<{ platform: string; country: string | null; country_source: string | null; country_status: string }>(`select platform, country, country_source, country_status from gcp.creator_profiles where creator_id = '${id}' order by platform`);

describe("Pakistan-only catalogue (CTY)", () => {
  it("CTY-I01 stores each profile's country from its own evidence, and only Pakistani profiles are searchable", async () => {
    const pk = await bioCreator("Lahore Food Stated", "Pakistani food blogger, recipes and street food");
    const abroad = await bioCreator("Dubai Food Abroad", "Food vlogger based in Dubai, UAE");
    const unknown = await bioCreator("Lahore Food Unknown", "Food vlogger in Lahore");
    const conflict = await bioCreator("Food Conflicting", "Food vlogger based in Pakistan, also based in the UK");
    expect(await profileCountry(pk)).toEqual([{ platform: "instagram", country: "PK", country_source: "creator_stated", country_status: "pakistan" }]);
    expect((await profileCountry(abroad))[0]).toMatchObject({ country: "AE", country_status: "foreign" });
    expect((await profileCountry(unknown))[0]).toMatchObject({ country: null, country_status: "unknown" });
    expect((await profileCountry(conflict))[0]).toMatchObject({ country: null, country_status: "conflicting" });
    expect(await search(await customer(), "food")).toEqual(["Lahore Food Stated"]);
    const reasons = await ownerQuery<{ creator_id: string; eligibility_reasons: string[] }>(`select creator_id, eligibility_reasons from gcp.creator_search_documents where creator_id in ('${abroad}', '${unknown}', '${conflict}')`);
    expect(Object.fromEntries(reasons.map((r) => [r.creator_id, r.eligibility_reasons]))).toEqual({ [abroad]: ["country_not_pakistan"], [unknown]: ["country_unknown"], [conflict]: ["country_conflicting"] });
  });

  it("CTY-I02 a city, flag or hashtag never makes a profile Pakistani", async () => {
    for (const [name, bio] of [["City Only", "Karachi food vlogger"], ["Flag Only", "Food vlogger 🇵🇰"], ["Hashtag Only", "Food vlogs #pakistan #lahorefood"]] as const) {
      const id = await bioCreator(name, bio);
      expect((await profileCountry(id))[0]?.country_status).toBe("unknown");
    }
    expect(await search(await customer(), "food")).toEqual([]);
  });

  it("CTY-I03 filters and text cannot bring an excluded profile back (country, platform, niche, follower range, its own name)", async () => {
    await bioCreator("Dubai Food Abroad", "Food vlogger based in Dubai, UAE");
    const c = await customer();
    for (const filters of [{}, { creatorCountry: "AE" }, { creatorCountry: "PK" }, { platform: "instagram" }, { niches: ["Food"] }, { followersMin: 10_000 }])
      expect(await search(c, "Dubai Food Abroad", filters)).toEqual([]);
  });

  it("CTY-I04 judges every platform profile on its own: a Pakistani YouTube channel never qualifies a foreign Instagram profile", async () => {
    const id = await addCreator(db, {
      displayName: "Two Platforms",
      niches: ["Food"],
      country: null,
      confirmedCountry: null,
      primaryPlatform: "youtube",
      platformCountry: "PK",
      profiles: [
        { platform: "youtube", handle: "twoplatforms", followers: 80_000, bio: "Recipes" },
        { platform: "instagram", handle: "twoplatforms", followers: 30_000, bio: "Food vlogger based in London, UK" },
      ],
    });
    await indexer.sync([id]);
    const states = await profileCountry(id);
    expect(states).toEqual([
      { platform: "instagram", country: "GB", country_source: "creator_stated", country_status: "foreign" },
      { platform: "youtube", country: "PK", country_source: "platform_declared", country_status: "pakistan" },
    ]);
    const [d] = await ownerQuery<{ eligible: boolean; qualifying_platforms: string[] }>(`select eligible, qualifying_platforms from gcp.creator_search_documents where creator_id = '${id}'`);
    expect(d).toEqual({ eligible: true, qualifying_platforms: ["youtube"] });
    const c = await customer();
    expect(await search(c, "Two Platforms", { platform: "youtube" })).toEqual(["Two Platforms"]);
    expect(await search(c, "Two Platforms", { platform: "instagram" })).toEqual([]);
  });

  it("CTY-I05 a locked creator cannot be opened by id, looked up by link, or added to a list or campaign", async () => {
    const abroad = await bioCreator("Dubai Food Abroad", "Food vlogger based in Dubai, UAE");
    const handle = (await ownerQuery<{ handle: string }>(`select handle from gcp.creator_profiles where creator_id = '${abroad}'`))[0]?.handle as string;
    const c = await customer();
    await expect(creators.profile(c, abroad)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const found = await creators.lookup(c, `https://www.instagram.com/${handle}/`);
    expect(found).toEqual({ matches: [], addable: null });
    const list = await lists.create(c, { name: "Picks", description: "" });
    await expect(lists.addMembers(c, list.id, [abroad])).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "creator_ineligible", policy: "elig-2" } });
    const k = await campaigns.create(c, { ...campaignBase, name: "Eid" });
    await expect(campaigns.addCreators(c, k.id, [abroad])).rejects.toMatchObject({ details: { reason: "creator_ineligible" } });
  });

  it("CTY-I06 a creator saved before it was locked stays on the list, labelled, and its owner can still open it; nothing is deleted", async () => {
    const id = await bioCreator("Was Pakistani", "Pakistani food blogger");
    const c = await customer();
    const list = await lists.create(c, { name: "Saved", description: "" });
    await lists.addMembers(c, list.id, [id]);
    // The creator later states another country (as a refresh would store it).
    await ownerQuery(`update gcp.creator_profiles set bio = 'Food vlogger based in Toronto, Canada' where creator_id = '${id}'`);
    await db.withSystem(async (tx) => (await import("./enrichment/repository")).refreshProfileCountries(tx, id, { source: "staff" }));
    await indexer.sync([id]);
    const p = await creators.profile(c, id);
    expect(p.eligibility).toMatchObject({ eligible: false, reasons: ["country_not_pakistan"] });
    const other = await customer();
    await expect(creators.profile(other, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another workspace holding it does not open it to this one by link or list either.
    const handle = (await ownerQuery<{ handle: string }>(`select handle from gcp.creator_profiles where creator_id = '${id}'`))[0]?.handle as string;
    expect(await creators.lookup(other, `https://www.instagram.com/${handle}/`)).toEqual({ matches: [], addable: null });
    const otherList = await lists.create(other, { name: "Theirs", description: "" });
    await expect(lists.addMembers(other, otherList.id, [id])).rejects.toMatchObject({ details: { reason: "creator_ineligible" } });
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.list_members where creator_id = '${id}'`))[0]?.n).toBe(1);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creators where id = '${id}'`))[0]?.n).toBe(1);
    const events = await ownerQuery<{ kind: string; from_state: string; to_state: string }>(`select kind, from_state, to_state from gcp.creator_lifecycle_events where creator_id = '${id}' and kind = 'location' order by created_at`);
    expect(events.map((e) => `${e.from_state} -> ${e.to_state}`)).toEqual(["unknown -> pakistan:PK", "pakistan:PK -> foreign:CA"]);
  });

  it("CTY-I08 a city residence statement resolves the profile's country, and a changed source is stored even when the country stays the same (BUG-27)", async () => {
    const id = await addCreator(db, { displayName: "Channel PK", niches: ["Food"], country: null, confirmedCountry: null, primaryPlatform: "youtube", platformCountry: "PK", profiles: [{ platform: "youtube", handle: "channelpk", followers: 40_000, bio: "Recipes" }] });
    expect((await profileCountry(id))[0]).toMatchObject({ country: "PK", country_source: "platform_declared" });
    // The creator adds "Lives in Lahore" to the description: same country, now creator-stated with the city as evidence.
    await ownerQuery(`update gcp.creator_profiles set bio = 'Recipes. Lives in Lahore' where creator_id = '${id}'`);
    const { refreshProfileCountries } = await import("./enrichment/repository");
    await db.withSystem((tx) => refreshProfileCountries(tx, id, { source: "backfill" }));
    const [row] = await ownerQuery<{ country_source: string; country_confidence: string; country_reason: string }>(`select country_source, country_confidence, country_reason from gcp.creator_profiles where creator_id = '${id}'`);
    expect(row).toMatchObject({ country_source: "creator_stated", country_confidence: "medium" });
    expect(row?.country_reason).toContain("Lives in Lahore");
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_lifecycle_events where creator_id = '${id}' and kind = 'location'`))[0]?.n).toBe(1);
  });

  it("CTY-I07 recomputing countries is idempotent: a second run changes and logs nothing", async () => {
    const id = await bioCreator("Pakistani Again", "Pakistani food blogger");
    const { refreshProfileCountries } = await import("./enrichment/repository");
    expect(await db.withSystem((tx) => refreshProfileCountries(tx, id, { source: "backfill" }))).toEqual([]);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_lifecycle_events where creator_id = '${id}' and kind = 'location'`))[0]?.n).toBe(1);
  });
});
