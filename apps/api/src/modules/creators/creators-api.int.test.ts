import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, testSearchIndex, UnavailableSearchIndex, type SearchIndex } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createCreatorIndexer, createCreatorsModule, createCreatorsService } from "./index";
import { addCreator, TEST_KEY } from "./test-fixtures";

const db = createTestDatabase();
const index = testSearchIndex();
const logger = createLogger({ level: "silent" });
beforeAll(() => index.ensureSettings());
afterAll(async () => {
  await index.drop();
  await db.close();
});
beforeEach(async () => {
  await resetTables();
  await index.remove([...(await index.listIds()).keys()]);
});

async function setup(o: { index?: SearchIndex; aiLimit?: number } = {}) {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: { limit: o.aiLimit ?? 1000, windowSeconds: 60 } });
  const llm = new MockLlm(() => ({ niches: ["Bridal"], creatorCity: "Lahore" }));
  const service = createCreatorsService({ db, index: o.index ?? index, llm, billing, encryptionKey: TEST_KEY, logger });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: {
      customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }),
      idempotent: platform.requireIdempotencyKey,
    },
    modules: [platform.module, identity.module, createCreatorsModule({ service, limiter })],
  });
  const token = await iss.sign({ sub: randomUUID(), email: "owner@mushin.pk", fullName: "Owner" });
  return { app, auth: { authorization: `Bearer ${token}` } };
}

describe("creators API", () => {
  it("requires sign-in", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/v1/search", payload: { filters: {} } })).statusCode).toBe(401);
  });

  it("searches, opens a profile and reveals contacts once per Idempotency-Key", async () => {
    const id = await addCreator(db, { displayName: "Sana Bridal", contacts: [{ kind: "email", value: "sana@example.com", trust: "verified", source: "bio" }] });
    await createCreatorIndexer({ db, index, logger }).sync([id]);
    const { app, auth } = await setup();
    const search = await app.inject({ method: "POST", url: "/v1/search", headers: auth, payload: { text: "Sana", filters: { niches: ["Bridal"] } } });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({ results: [{ id, displayName: "Sana Bridal" }], fewResults: true });
    expect((await app.inject({ method: "GET", url: `/v1/creators/${id}`, headers: auth })).json()).toMatchObject({ revealed: false, revealCost: 5 });
    expect((await app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: auth, payload: { confirmedCost: 5 } })).statusCode).toBe(400);
    const key = { ...auth, "idempotency-key": "reveal-1" };
    const first = await app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: key, payload: { confirmedCost: 5 } });
    const replay = await app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: key, payload: { confirmedCost: 5 } });
    expect(first.json()).toEqual({ contacts: [expect.objectContaining({ value: "sana@example.com" })], charged: true });
    expect(replay.json()).toEqual(first.json());
  });

  it("validates filters, rate-limits interpretation and reports search outages as 503", async () => {
    const { app, auth } = await setup({ aiLimit: 2 });
    expect((await app.inject({ method: "POST", url: "/v1/search", headers: auth, payload: { filters: { followersMin: 10, followersMax: 1 } } })).statusCode).toBe(400);
    for (let i = 0; i < 2; i++) {
      const ok = await app.inject({ method: "POST", url: "/v1/search/interpret", headers: auth, payload: { text: "bridal Lahore" } });
      expect(ok.json()).toMatchObject({ chips: { niches: ["Bridal"], creatorCity: "Lahore" } });
    }
    const limited = await app.inject({ method: "POST", url: "/v1/search/interpret", headers: auth, payload: { text: "bridal Lahore" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    const down = await setup({ index: new UnavailableSearchIndex() });
    const r = await down.app.inject({ method: "POST", url: "/v1/search", headers: down.auth, payload: { filters: {} } });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ error: { code: "PROVIDER_UNAVAILABLE" } });
  });

  it("saves and deletes searches, and rejects a malformed id", async () => {
    const { app, auth } = await setup();
    const saved = await app.inject({ method: "POST", url: "/v1/search/saved", headers: auth, payload: { name: "Bridal", filters: { niches: ["Bridal"] } } });
    expect(saved.statusCode).toBe(201);
    const id = (saved.json() as { id: string }).id;
    expect((await app.inject({ method: "GET", url: "/v1/search/saved", headers: auth })).json()).toMatchObject({ searches: [{ id, name: "Bridal" }] });
    expect((await app.inject({ method: "DELETE", url: `/v1/search/saved/${id}`, headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/creators/not-a-uuid", headers: auth })).statusCode).toBe(400);
  });
});
