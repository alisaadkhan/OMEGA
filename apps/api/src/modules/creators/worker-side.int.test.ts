import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, testSearchIndex, type SearchIndex } from "@mushin/integrations";
import { createCreatorIndexer } from "./indexer";
import { createSummaryWriter } from "./summaries";
import { addCreator } from "./test-fixtures";

const db = createTestDatabase();
const index = testSearchIndex();
const logger = createLogger({ level: "silent" });
const indexer = createCreatorIndexer({ db, index, logger });
let reply: unknown = {};
const llm = new MockLlm(() => reply);
const summaries = createSummaryWriter({ db, llm, logger });

beforeAll(() => indexer.ensureSettings());
afterAll(async () => {
  await index.drop();
  await db.close();
});
beforeEach(async () => {
  await resetTables();
  await index.remove([...(await index.listIds()).keys()]);
  llm.calls.length = 0;
});

describe("index sync", () => {
  it("adds visible creators and removes ones that became hidden", async () => {
    const a = await addCreator(db);
    const b = await addCreator(db);
    await indexer.sync([a, b]);
    expect([...(await index.listIds()).keys()].sort()).toEqual([a, b].sort());
    await ownerQuery(`update gcp.creators set is_minor = true where id = '${b}'`);
    await indexer.sync([b]);
    expect([...(await index.listIds()).keys()]).toEqual([a]);
  });

  it("does not leave a creator in the index who was hidden while the sync was writing", async () => {
    const id = await addCreator(db);
    // The hide commits between reading the rows and the upsert landing; its own sync may already have run.
    const racing: SearchIndex = {
      ensureSettings: () => index.ensureSettings(),
      upsert: async (docs) => {
        await ownerQuery(`update gcp.creators set is_minor = true where id = '${id}'`);
        await index.upsert(docs);
      },
      remove: (ids) => index.remove(ids),
      search: (q) => index.search(q),
      listIds: () => index.listIds(),
      ping: () => index.ping(),
      drop: () => index.drop(),
    };
    await createCreatorIndexer({ db, index: racing, logger }).sync([id]);
    expect([...(await index.listIds()).keys()]).toEqual([]);
  });

  it("repairs drift: missing, outdated and leftover documents", async () => {
    const kept = await addCreator(db);
    const missing = await addCreator(db);
    await indexer.sync([kept]);
    await index.upsert([leftoverDoc("99999999-9999-4999-8999-999999999999")]);
    // A newer assessment changes what the index document is built from (snapshots have no updated_at trigger).
    await ownerQuery(`insert into gcp.enrichment_snapshots (creator_id, verdict, model_version, created_at) values ('${kept}', 'genuine', 'm1', now() + interval '1 minute')`);
    expect(await indexer.reconcile()).toEqual({ upserted: 2, removed: 1 });
    expect([...(await index.listIds()).keys()].sort()).toEqual([kept, missing].sort());
    expect(await indexer.reconcile()).toEqual({ upserted: 0, removed: 0 });
  });
});

function leftoverDoc(id: string) {
  return {
    id,
    display_name: "x",
    name_variants: [],
    primary_handle: "x",
    handles: [],
    platforms: [],
    primary_platform: "instagram",
    city: null,
    country: null,
    niches: [],
    tags: [],
    bio: "",
    followers: 0,
    engagement_rate: null,
    verified: false,
    authenticity_score: null,
    has_contact: false,
    audience_countries: [],
    followers_updated_epoch: null,
    updated_epoch: 1,
    eligible: false,
    eligible_until: null,
    eligibility_version: "elig-2",
    eligibility_reasons: ["below_follower_minimum"],
    eligibility_flags: [],
    qualifying_platforms: [],
  };
}

describe("summary writer", () => {
  it("writes a summary from public data once per data version", async () => {
    const id = await addCreator(db, { contacts: [{ kind: "email", value: "hidden@example.com", trust: "verified", source: "bio" }] });
    reply = { summary: "Lahore bridal creator with 50K followers. Engagement holds near 5%. A natural fit for wedding and beauty brands." };
    expect(await summaries.generate(id)).toBe("written");
    expect(await summaries.generate(id)).toBe("up_to_date");
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.input).not.toContain("hidden@example.com");
    expect(llm.calls[0]).toMatchObject({ feature: "creator_summary" });
    const rows = await ownerQuery<{ ai_summary: string; ai_summary_model: string }>(`select ai_summary, ai_summary_model from gcp.creators where id = '${id}'`);
    expect(rows[0]).toEqual({ ai_summary: expect.stringContaining("Lahore bridal"), ai_summary_model: "mock" });
  });

  it("refuses a summary that leaks a contact, records the failure and lets the job retry", async () => {
    const id = await addCreator(db);
    reply = { summary: "Great creator for weddings. Book her at sana@example.com today. She replies fast to brands." };
    await expect(summaries.generate(id)).rejects.toThrow(/safety check/);
    const rows = await ownerQuery<{ ai_summary: string | null; failed: boolean }>(`select ai_summary, ai_summary_failed_at is not null as failed from gcp.creators where id = '${id}'`);
    expect(rows[0]).toEqual({ ai_summary: null, failed: true });
  });

  it("never sends a hidden creator's data to the AI (erased, removal requested, possible minor)", async () => {
    const erased = await addCreator(db);
    const removal = await addCreator(db);
    const minor = await addCreator(db, { isMinor: true });
    await ownerQuery(`update gcp.creators set status = 'erased' where id = '${erased}'; update gcp.creators set status = 'removal_requested' where id = '${removal}';`);
    reply = { summary: "Lahore bridal creator with 50K followers. Engagement holds near 5%. A natural fit for wedding and beauty brands." };
    for (const id of [erased, removal, minor]) expect(await summaries.generate(id)).toBe("missing");
    expect(llm.calls).toHaveLength(0);
  });

  it("does nothing for a creator that no longer exists", async () => {
    expect(await summaries.generate("00000000-0000-4000-8000-000000000000")).toBe("missing");
  });
});
