import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import * as repo from "./repository";
import { sourceHash } from "./rules";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const cache = new MemoryAccessCache();
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache, logger });
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger });

beforeEach(async () => {
  await resetTables();
  cache.entries.clear();
});
afterAll(() => db.close());

async function trialCustomer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req-profile", role: "owner" };
}
const available = async (c: TenantContext) => (await billing.summary(c)).balance.available;
const audience = { age: [{ label: "18–24", value: 52, confidence: "medium" as const }], gender: { female: 81, male: 19, confidence: "medium" as const }, cities: [], countries: [{ code: "PK", value: 88, confidence: "high" as const }], source: "modeled" };
const assessed = {
  verdict: "genuine",
  authenticityScore: 88,
  fakeFollowerPct: 4,
  evidence: [{ signal: "follower growth", detail: "Steady growth, no spikes in 12 months", weight: 0.4 }],
  audience,
  modelVersion: "test-1",
  confidence: 0.8,
};
const emails = [{ kind: "email" as const, value: "sana@example.com", trust: "verified" as const, source: "bio" }];

describe("profile", () => {
  it("shows stats with per-metric freshness, masks contacts and marks an unassessed creator as such", async () => {
    const id = await addCreator(db, { displayName: "Sana", contacts: emails });
    const p = await creators.profile(await trialCustomer(), id);
    expect(p).toMatchObject({
      displayName: "Sana",
      authenticity: { status: "not_assessed" },
      contacts: [{ kind: "email", masked: "s***@e***.com", value: null }],
      revealed: false,
      revealCost: 5,
      hasContacts: true,
      minorProtected: false,
      summary: { status: "generating" },
    });
    expect(p.profiles[0]?.freshness).toEqual({ followers: "current", engagement: "current", audience: "stale" });
  });

  it("returns the authenticity score only together with its evidence", async () => {
    const id = await addCreator(db, { snapshot: assessed });
    const p = await creators.profile(await trialCustomer(), id);
    expect(p.authenticity).toMatchObject({ status: "assessed", score: 88, fakeFollowerPct: 4, evidence: assessed.evidence });
  });

  it("presents legacy YouTube zero counts as unknown when the old source value is ambiguous", async () => {
    const id = await addCreator(db, { primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: "hidden_subscribers", followers: 0 }] });
    const profile = await creators.profile(await trialCustomer(), id);
    expect(profile.profiles[0]?.followers).toBeNull();
    const c = await trialCustomer();
    const cards = await db.withTenant(c, (tx) => repo.cardRows(tx, [id]));
    expect(cards[0]?.followers).toBeNull();
  });

  it("writes one summary request for concurrent opens, and shows a summary that matches the current data", async () => {
    const id = await addCreator(db);
    const c = await trialCustomer();
    await Promise.all(Array.from({ length: 5 }, () => creators.profile(c, id)));
    const events = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.summary_requested'`);
    expect(events[0]?.n).toBe(1);
    await db.withSystem(async (tx) => {
      const src = await repo.summarySource(tx, id);
      if (!src) throw new Error("creator missing");
      await repo.saveSummary(tx, id, "Lahore bridal creator with 50K followers. Engagement is strong at 5%. Suits wedding brands.", "mock", sourceHash(src.source));
    });
    expect((await creators.profile(c, id)).summary).toMatchObject({ status: "ready", text: expect.stringContaining("Lahore bridal"), model: "mock" });
    await ownerQuery(`update gcp.creator_profiles set followers = 99000 where creator_id = '${id}'`);
    expect((await creators.profile(c, id)).summary.status).toBe("generating");
  });

  it("hides erased creators and flags possible minors", async () => {
    const erased = await addCreator(db);
    const minor = await addCreator(db, { isMinor: true });
    await ownerQuery(`update gcp.creators set status = 'erased' where id = '${erased}'`);
    const c = await trialCustomer();
    await expect(creators.profile(c, erased)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await creators.profile(c, minor)).minorProtected).toBe(true);
  });

  it("does not ask the AI to summarise a possible minor", async () => {
    const minor = await addCreator(db, { isMinor: true });
    const p = await creators.profile(await trialCustomer(), minor);
    expect(p.summary).toMatchObject({ status: "unavailable", text: null });
    const events = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.summary_requested'`);
    expect(events[0]?.n).toBe(0);
  });

  it("shows the refresh price, linked accounts, last scrape and pending or insufficient assessments", async () => {
    const id = await addCreator(db, { primaryPlatform: "tiktok", profiles: [{ platform: "tiktok", handle: "tt_one" }] });
    await ownerQuery(`insert into gcp.creator_links (creator_id, platform, url, source) values ('${id}', 'website', 'https://tt.one', 'bio');
      update gcp.creators set assessment_status = 'pending' where id = '${id}';`);
    const p = await creators.profile(await trialCustomer(), id);
    expect(p).toMatchObject({ refreshCost: 30, linkedAccounts: [{ platform: "website", url: "https://tt.one" }], authenticity: { status: "pending" } });
    expect(p.lastScrapedAt).not.toBeNull();
    await ownerQuery(`update gcp.creators set assessment_status = 'insufficient_data' where id = '${id}'`);
    expect((await creators.profile(await trialCustomer(), id)).authenticity).toEqual({ status: "insufficient_data" });
    const minor = await addCreator(db, { isMinor: true });
    await ownerQuery(`insert into gcp.creator_links (creator_id, platform, url, source) values ('${minor}', 'website', 'https://minor.example', 'bio')`);
    expect((await creators.profile(await trialCustomer(), minor)).linkedAccounts).toEqual([]);
  });
});

describe("audience data availability", () => {
  it("does not expose legacy LLM demographic estimates or charge for unverified analytics", async () => {
    const c = await trialCustomer();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await addCreator(db, { snapshot: assessed }));
    for (const id of ids) expect(await creators.audience(c, id)).toEqual({ status: "not_assessed" });
    const views = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.audience_views`);
    expect(views[0]?.n).toBe(0);
  });

  it("keeps demographics unavailable even for Growth and expired subscriptions", async () => {
    const growth = await trialCustomer();
    await ownerQuery(`update wp.subscriptions set status = 'active', plan_id = 'growth', billing_interval = 'month' where workspace_id = '${growth.workspaceId}'`);
    for (let i = 0; i < 7; i++) expect((await creators.audience(growth, await addCreator(db, { snapshot: assessed }))).status).toBe("not_assessed");
    const expired = await trialCustomer();
    await ownerQuery(`update wp.subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = '${expired.workspaceId}'`);
    expect(await creators.audience(expired, await addCreator(db, { snapshot: assessed }))).toEqual({ status: "not_assessed" });
    expect(await creators.audience(expired, await addCreator(db))).toEqual({ status: "not_assessed" });
  });
});

describe("contact reveal (spec D4)", () => {
  it("charges 5 credits once and returns the contacts; repeats are free", async () => {
    const c = await trialCustomer();
    const id = await addCreator(db, { contacts: emails });
    expect(await creators.reveal(c, id, 5)).toEqual({ contacts: [expect.objectContaining({ kind: "email", value: "sana@example.com", trust: "verified" })], charged: true });
    expect(await creators.reveal(c, id, 5)).toMatchObject({ charged: false, contacts: [expect.objectContaining({ value: "sana@example.com" })] });
    expect(await available(c)).toBe(195);
    expect((await creators.profile(c, id)).contacts[0]?.value).toBe("sana@example.com");
    const other = await trialCustomer();
    expect((await creators.profile(other, id)).contacts[0]?.value).toBeNull();
  });

  it("charges once for 10 simultaneous reveals", async () => {
    const c = await trialCustomer();
    const id = await addCreator(db, { contacts: emails });
    const results = await Promise.all(Array.from({ length: 10 }, () => creators.reveal(c, id, 5)));
    expect(results.filter((r) => r.charged)).toHaveLength(1);
    expect(await available(c)).toBe(195);
  });

  it("refuses possible minors, creators without contacts and a changed price, charging nothing", async () => {
    const c = await trialCustomer();
    const minor = await addCreator(db, { isMinor: true, contacts: emails });
    const empty = await addCreator(db);
    const normal = await addCreator(db, { contacts: emails });
    await expect(creators.reveal(c, minor, 5)).rejects.toMatchObject({ code: "FORBIDDEN", details: { reason: "minor_protected" } });
    await expect(creators.reveal(c, empty, 5)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "no_contacts" } });
    await expect(creators.reveal(c, normal, 3)).rejects.toMatchObject({ code: "CONFLICT", details: { confirmedCost: 3, currentCost: 5 } });
    expect(await available(c)).toBe(200);
    const reveals = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.contact_reveals`);
    expect(reveals[0]?.n).toBe(0);
  });
});
