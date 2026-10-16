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
import { addCreator } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createAudienceModule, createAudienceService } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup() {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: big, workspaceJobs: big });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: {
      customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }),
      idempotent: platform.requireIdempotencyKey,
    },
    modules: [platform.module, identity.module, createAudienceModule({ service: createAudienceService({ db, billing, sources: ["youtube"] }), limiter })],
  });
  // Each user's workspace is put on Growth (audience details are a Growth/Scale entitlement since 2026-10-16).
  const user = async () => {
    const h = { authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email: `${randomUUID().slice(0, 6)}@mushin.pk`, fullName: "Owner" })}` };
    const ws = (await app.inject({ method: "GET", url: "/v1/me", headers: h })).json().workspace.id as string;
    await ownerQuery(`update wp.subscriptions set status = 'active', plan_id = 'growth', billing_interval = 'month', current_period_start = now(), current_period_end = now() + interval '1 month' where workspace_id = '${ws}'`);
    return h;
  };
  return { app, user };
}

describe("audience API", () => {
  it("reads the state for free and requires sign-in", async () => {
    const { app, user } = await setup();
    const id = await addCreator(db, { primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: "chan_api" }] });
    expect((await app.inject({ method: "GET", url: `/v1/creators/${id}/audience` })).statusCode).toBe(401);
    const auth = await user();
    const res = await app.inject({ method: "GET", url: `/v1/creators/${id}/audience`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ availability: "available", cost: 5, job: null, estimate: null });
    expect((await app.inject({ method: "GET", url: "/v1/creators/not-a-uuid/audience", headers: auth })).statusCode).toBe(400);
  });

  it("needs an Idempotency-Key and a confirmed cost; replays the same answer; another workspace sees nothing", async () => {
    const { app, user } = await setup();
    const id = await addCreator(db, { primaryPlatform: "youtube", profiles: [{ platform: "youtube", handle: "chan_api2" }] });
    const auth = await user();
    const url = `/v1/creators/${id}/audience/estimate`;
    expect((await app.inject({ method: "POST", url, headers: auth, payload: { confirmedCost: 5 } })).statusCode).toBe(400);
    const key = { ...auth, "idempotency-key": "audience-0001" };
    expect((await app.inject({ method: "POST", url, headers: { ...auth, "idempotency-key": "audience-bad" }, payload: {} })).statusCode).toBe(400);
    const first = await app.inject({ method: "POST", url, headers: key, payload: { confirmedCost: 5 } });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ job: { status: "queued", cost: 5 } });
    const replay = await app.inject({ method: "POST", url, headers: key, payload: { confirmedCost: 5 } });
    expect(replay.json()).toEqual(first.json());
    const other = await user();
    expect((await app.inject({ method: "GET", url: `/v1/creators/${id}/audience`, headers: other })).json()).toMatchObject({ job: null, estimate: null });
  });
});
