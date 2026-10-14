import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, pinActionCosts, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createCreatorIndexer } from "./indexer";
import { createPostgresCatalogSearch } from "./postgres-search";
import { createCreatorsService } from "./service";
import { expireYoutubeApiData } from "./retention";
import { applyDocumentPolicy, restrictsDerived } from "./source-policy";
import { addCreator, TEST_KEY } from "./test-fixtures";

// DATA-004: MUSHIN-derived metrics from YouTube API data stay off until the owner confirms policy eligibility.
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const billing = createBillingService({ db, payments: new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} }), cache: new MemoryAccessCache(), logger });
const build = (youtubeDerivedMetrics: boolean) =>
  createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger, sourcePolicy: { youtubeDerivedMetrics } });
const restricted = build(false);
const allowed = build(true);

let restorePrices: () => Promise<void> = async () => {};
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0 });
});
afterAll(async () => {
  await restorePrices();
  await db.close();
});

const snapshot = { verdict: "genuine", authenticityScore: 81, fakeFollowerPct: 5, evidence: [{ signal: "engagement", detail: "Steady comments", weight: 0.5 }], audience: null, modelVersion: "t", confidence: 0.8 };
let yt = "";
let ig = "";
beforeEach(async () => {
  await resetTables();
  yt = await addCreator(db, { displayName: "Tube Chef", niches: ["Food"], primaryPlatform: "youtube", snapshot, profiles: [{ platform: "youtube", handle: "tubechef", followers: 120_000, engagementRate: 6.5 }] });
  ig = await addCreator(db, { displayName: "Gram Chef", niches: ["Food"], snapshot, profiles: [{ platform: "instagram", handle: "gramchef", followers: 90_000, engagementRate: 4.2 }] });
  await createCreatorIndexer({ db, index: null, logger }).sync([yt, ig]); // default policy: restrictive
});
const customer = async (): Promise<TenantContext> => {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req-policy", role: "owner" };
};
const search = (svc: typeof restricted, c: TenantContext, filters: Record<string, unknown> = {}) => svc.search(c, searchRequestSchema.parse({ text: "food", filters, confirmedCost: 0 }));

describe("YouTube derived-metrics policy", () => {
  it("is a pure rule: only YouTube, only while switched off", () => {
    expect([restrictsDerived("youtube", { youtubeDerivedMetrics: false }), restrictsDerived("instagram", { youtubeDerivedMetrics: false }), restrictsDerived("youtube", { youtubeDerivedMetrics: true })]).toEqual([true, false, false]);
    expect(applyDocumentPolicy({ primary_platform: "youtube", engagement_rate: 6, authenticity_score: 80 }, { youtubeDerivedMetrics: false })).toEqual({ primary_platform: "youtube", engagement_rate: null, authenticity_score: null });
  });

  it("search cards show YouTube's observed counts but no engagement, authenticity or fake-follower figures", async () => {
    const out = await search(restricted, await customer());
    const tube = out.results.find((r) => r.id === yt);
    const gram = out.results.find((r) => r.id === ig);
    expect(tube).toMatchObject({ followers: 120_000, engagementRate: null, authenticityScore: null, fakeFollowerPct: null });
    expect(gram).toMatchObject({ engagementRate: 4.2, authenticityScore: 81 });
  });

  it("derived metrics cannot be used through filters either (search projection holds none for YouTube)", async () => {
    const docs = await ownerQuery<{ creator_id: string; engagement_rate: number | null; authenticity_score: number | null }>(`select creator_id, engagement_rate, authenticity_score from gcp.creator_search_documents`);
    expect(docs.find((d) => d.creator_id === yt)).toMatchObject({ engagement_rate: null, authenticity_score: null });
    const filtered = await search(restricted, await customer(), { engagementMin: 3, minAuthenticity: 50 });
    expect(filtered.results.map((r) => r.id)).toEqual([ig]);
  });

  it("the profile marks authenticity as restricted and hides averages and rates for the YouTube profile", async () => {
    const p = await restricted.profile(await customer(), yt);
    expect(p.authenticity).toEqual({ status: "restricted", reason: "youtube_api_policy" });
    expect(p.profiles[0]).toMatchObject({ followers: 120_000, engagementRate: null, avgLikes: null, avgComments: null, avgViews: null });
    expect((await restricted.profile(await customer(), ig)).authenticity).toMatchObject({ status: "assessed", score: 81 });
  });

  it("switched on (owner-confirmed eligibility), the values come back", async () => {
    const p = await allowed.profile(await customer(), yt);
    expect(p.authenticity).toMatchObject({ status: "assessed", score: 81 });
    expect((await search(allowed, await customer())).results.find((r) => r.id === yt)).toMatchObject({ engagementRate: 6.5, authenticityScore: 81 });
  });

  it("clears YouTube API data not refreshed within 30 days, and leaves recent YouTube and other platforms alone", async () => {
    const fresh = await addCreator(db, { displayName: "Fresh Tube", primaryPlatform: "youtube", snapshot, profiles: [{ platform: "youtube", handle: "freshtube", followers: 5_000, engagementRate: 3 }] });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '31 days' where creator_id in ('${yt}', '${ig}');
      insert into gcp.profile_metric_snapshots (profile_id, followers, captured_at) select id, 1, now() - interval '31 days' from gcp.creator_profiles where creator_id in ('${yt}', '${ig}', '${fresh}');`);
    expect(await expireYoutubeApiData(db)).toEqual([yt]);
    const profiles = await ownerQuery<{ creator_id: string; followers: number | null; engagement_rate: number | null; bio: string | null }>(`select creator_id, followers, engagement_rate, bio from gcp.creator_profiles`);
    expect(profiles.find((p) => p.creator_id === yt)).toEqual({ creator_id: yt, followers: null, engagement_rate: null, bio: null });
    expect(profiles.find((p) => p.creator_id === ig)?.followers).toBe(90_000); // other platforms follow their own rules
    expect(profiles.find((p) => p.creator_id === fresh)?.followers).toBe(5_000); // refreshed within 30 days
    const snaps = await ownerQuery<{ creator_id: string }>(`select p.creator_id from gcp.profile_metric_snapshots s join gcp.creator_profiles p on p.id = s.profile_id where s.captured_at < now() - interval '30 days'`);
    expect(snaps.map((x) => x.creator_id)).toEqual([ig]);
    const [c] = await ownerQuery<{ authenticity_score: number | null; display_name: string }>(`select authenticity_score, display_name from gcp.creators where id = '${yt}'`);
    expect(c).toEqual({ authenticity_score: null, display_name: "Tube Chef" }); // identity kept pending the owner decision
    expect(await expireYoutubeApiData(db)).toEqual([]); // idempotent
  });
});
