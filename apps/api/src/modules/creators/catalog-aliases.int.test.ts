import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, pinActionCosts, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createPostgresCatalogSearch } from "./postgres-search";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

// Deterministic behaviour of the reviewed aliases on PostgreSQL search (the default backend). The four creators are
// synthetic test fixtures: they prove matching rules, not search quality (that needs the human-labelled panel).
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger });

let restorePrices: () => Promise<void> = async () => {};
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0 });
});
afterAll(async () => {
  await restorePrices();
  await db.close();
});

const ids: Record<string, string> = {};
beforeEach(async () => {
  await resetTables();
  const add = async (key: string, o: Parameters<typeof addCreator>[1]) => {
    ids[key] = await addCreator(db, o);
  };
  await add("aliEats", { displayName: "Ali Eats", niches: ["Food"], city: "Lahore", profiles: [{ bio: "Street eats every weekend" }] });
  await add("urduBio", { displayName: "Kashif Bites", niches: ["Food"], city: null, profiles: [{ bio: "Lahore based home cook" }] });
  await add("saraStyle", { displayName: "Sara Styles", niches: ["Fashion"], city: "Karachi", profiles: [{ bio: "Outfits and style" }] });
  await add("techTariq", { displayName: "Tariq Reviews", niches: ["Technology"], city: "Islamabad", profiles: [{ bio: "Gadgets and phones" }] });
  await add("sanaMullick", { displayName: "Sana Mullick | Blogger", niches: [], city: null, profiles: [{ bio: "Daily life" }] });
  const docs = (await db.withSystem((tx) => repo.indexRows(tx, Object.values(ids)))).filter(isIndexable).map(toDocument);
  await db.withSystem((tx) => repo.upsertPostgresSearchDocuments(tx, docs));
});

async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: "req-aliases", role: "owner" };
}
const names = async (text: string, filters: Record<string, unknown> = {}) => {
  const out = await creators.search(await customer(), searchRequestSchema.parse({ text, filters, confirmedCost: 0 }));
  expect(out.total).toBe(out.results.length);
  return out.results.map((r) => r.displayName).sort();
};

describe("catalogue search aliases (PostgreSQL)", () => {
  it("finds the same food creators in English, Roman Urdu and Urdu script, and nothing else", async () => {
    for (const q of ["food", "khana", "کھانا"]) expect(await names(q), q).toEqual(["Ali Eats", "Kashif Bites"]);
  });

  it("matches a city by short form through the creator's declared city or their own bio", async () => {
    expect(await names("lhr")).toEqual(["Ali Eats", "Kashif Bites"]);
    expect(await names("khana lhr")).toEqual(["Ali Eats", "Kashif Bites"]);
    expect(await names("tech isb")).toEqual(["Tariq Reviews"]);
  });

  it("requires every concept: a food search in Karachi does not return Lahore food or Karachi fashion", async () => {
    expect(await names("food karachi")).toEqual([]);
    expect(await names("travel")).toEqual([]);
  });

  it("accepts any alias in the city filter and matches only the declared city field there", async () => {
    expect(await names("", { creatorCity: "LHR" })).toEqual(["Ali Eats"]);
    expect(await names("", { creatorCity: "lahore" })).toEqual(["Ali Eats"]);
    expect(await names("", { creatorCity: "Sialkot" })).toEqual([]);
  });

  it("leaves queries without a recognised word unchanged (whole words, then typo and partial matching)", async () => {
    expect(await names("gadgets")).toEqual(["Tariq Reviews"]);
    expect(await names("Tariq Revews")).toEqual(["Tariq Reviews"]);
  });

  it("finds a name through its spelling variants once whole words find nothing (panel Q012, Q013)", async () => {
    expect(await names("Find creator named Sana Malik")).toEqual(["Sana Mullick | Blogger"]);
    expect(await names("Sana Malek creator Pakistan")).toEqual(["Sana Mullick | Blogger"]);
    expect(await names("Sana Khan")).toEqual([]); // every word must meet the name
  });

  it("finds a creator whose only mention of the topic and city is a joined-up handle (panel Q004)", async () => {
    const id = await addCreator(db, { displayName: "Zulekha", niches: [], city: null, profiles: [{ handle: "karachifoodadventure", bio: "Personal account" }] });
    const docs = (await db.withSystem((tx) => repo.indexRows(tx, [id]))).filter(isIndexable).map(toDocument);
    await db.withSystem((tx) => repo.upsertPostgresSearchDocuments(tx, docs));
    expect(await names("Karachi ke food vloggers")).toEqual(["Zulekha"]);
  });

  it("finds a misspelt city and leaves out exclusion clauses (panel Q007, Q023)", async () => {
    expect(await names("Islamabadd tech")).toEqual(["Tariq Reviews"]);
    expect(await names("Creators in Lahore only; do not show creators outside Lahore")).toEqual(["Ali Eats", "Kashif Bites"]);
  });

  it("answers sentence-style queries: filler dropped, stated platform and ranges become filters, conflicts refused", async () => {
    expect(await names("Lahore ke food vloggers on Instagram")).toEqual(["Ali Eats", "Kashif Bites"]);
    expect(await names("لاہور کے فوڈ بلاگرز")).toEqual(["Ali Eats", "Kashif Bites"]);
    expect(await names("Lahore food creators on TikTok")).toEqual([]); // the fixtures are Instagram creators
    expect(await names("food creators in Lahore with 10k-100k followers")).toEqual(["Ali Eats", "Kashif Bites"]); // fixtures have 50k
    expect(await names("food creators with over 100k followers")).toEqual([]);
    const out = await creators.search(await customer(), searchRequestSchema.parse({ text: "Lahore ke food vloggers on Instagram", filters: {}, confirmedCost: 0 }));
    expect(out.understood).toEqual({ text: "lahore food", filters: { platform: "instagram" } });
    // An explicit filter wins over the text, and an impossible range is refused rather than silently ignored.
    expect((await creators.search(await customer(), searchRequestSchema.parse({ text: "food on TikTok", filters: { platform: "instagram" }, confirmedCost: 0 }))).results).toHaveLength(2);
    await expect(creators.search(await customer(), searchRequestSchema.parse({ text: "creators with 100k minimum followers and 10k maximum followers", filters: {}, confirmedCost: 0 }))).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "conflicting_range" } });
  });
});
