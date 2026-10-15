import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";
import { addCreator } from "./test-fixtures";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

describe("creators repository", () => {
  it("stores a creator with encrypted, masked contacts and announces it for indexing", async () => {
    const id = await addCreator(db, { contacts: [{ kind: "email", value: "ayesha@example.com", trust: "verified", source: "bio" }] });
    const contacts = await ownerQuery<{ value_encrypted: string; masked: string }>(`select value_encrypted, masked from gcp.creator_contacts where creator_id = '${id}'`);
    expect(contacts[0]?.value_encrypted.startsWith("v1.")).toBe(true);
    expect(contacts[0]?.value_encrypted).not.toContain("ayesha");
    expect(contacts[0]?.masked).toBe("a***@e***.com");
    const events = await ownerQuery<{ event_type: string; aggregate_id: string }>(`select event_type, aggregate_id from platform.outbox`);
    expect(events).toEqual([{ event_type: "creator.changed", aggregate_id: id }]);
  });

  it("hides possible minors and non-active creators from search rows, and never puts contacts in index documents", async () => {
    const visible = await addCreator(db, { contacts: [{ kind: "email", value: "x@example.com", trust: "likely", source: "bio" }] });
    const minor = await addCreator(db, { isMinor: true });
    const erased = await addCreator(db);
    await ownerQuery(`update gcp.creators set status = 'erased' where id = '${erased}'`);
    const a = await createTestWorkspace();
    const rows = await db.withTenant(a, (tx) => repo.cardRows(tx, [visible, minor, erased]));
    expect(rows.map((r) => r.id)).toEqual([visible]);
    expect(rows[0]?.contactStates).toEqual([{ kind: "email", status: "unverified" }]);
    const index = await db.withSystem((tx) => repo.indexRows(tx, [visible, minor, erased]));
    expect(index.filter(isIndexable).map((r) => r.id)).toEqual([visible]);
    const row = index.find((r) => r.id === visible);
    if (!row) throw new Error("the visible creator is missing from the index rows");
    const doc = toDocument(row);
    expect(JSON.stringify(doc)).not.toContain("x@example.com");
    expect(doc).toMatchObject({ id: visible, has_contact: true, platforms: ["instagram"] });
  });

  it("records one summary request per creator and data version", async () => {
    const id = await addCreator(db);
    const a = await createTestWorkspace();
    const results = await Promise.all(Array.from({ length: 5 }, () => db.withTenant(a, (tx) => repo.requestSummary(tx, id, "hash-1"))));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.withTenant(a, (tx) => repo.requestSummary(tx, id, "hash-2"))).toBe(true);
  });

  it("finds a creator by canonical profile URL", async () => {
    const id = await addCreator(db, { profiles: [{ platform: "tiktok", handle: "bilal_eats", followers: 900_000, engagementRate: 6 }] });
    const a = await createTestWorkspace();
    expect(await db.withTenant(a, (tx) => repo.findIdByCanonicalUrl(tx, "https://tiktok.com/@bilal_eats"))).toBe(id);
  });
});
