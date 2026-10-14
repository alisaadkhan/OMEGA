import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createDiscoveryModule, createDiscoveryService } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup(o: { jobsLimit?: number } = {}) {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, jobs: { limit: o.jobsLimit ?? 1000, windowSeconds: 3600 }, workspaceJobs: { limit: 100_000, windowSeconds: 3600 } });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: {
      customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }),
      idempotent: platform.requireIdempotencyKey,
    },
    modules: [platform.module, identity.module, createDiscoveryModule({ service: createDiscoveryService({ db, billing }), limiter })],
  });
  const token = await iss.sign({ sub: randomUUID(), email: "owner@mushin.pk", fullName: "Owner" });
  return { app, auth: { authorization: `Bearer ${token}` } };
}

const body = { kind: "add_by_url", url: "https://instagram.com/coke_studio", confirmedCost: 10 };

describe("discovery API", () => {
  it("requires sign-in and an Idempotency-Key", async () => {
    const { app, auth } = await setup();
    expect((await app.inject({ method: "POST", url: "/v1/discovery/jobs", payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: auth, payload: body })).statusCode).toBe(400);
  });

  it("starts a job (202), replays the same answer for the same key, and reads it back", async () => {
    const { app, auth } = await setup();
    const key = { ...auth, "idempotency-key": "add-job-0001" };
    const first = await app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: key, payload: body });
    expect(first.statusCode).toBe(202);
    const replay = await app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: key, payload: body });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());
    const id = (first.json() as { job: { id: string } }).job.id;
    expect((await app.inject({ method: "GET", url: `/v1/discovery/jobs/${id}`, headers: auth })).json()).toMatchObject({ id, status: "queued" });
    expect((await app.inject({ method: "GET", url: "/v1/discovery/jobs?active=true", headers: auth })).json()).toMatchObject({ jobs: [{ id }] });
    expect((await app.inject({ method: "GET", url: "/v1/discovery/jobs/not-a-uuid", headers: auth })).statusCode).toBe(400);
  });

  it("rejects unsupported links and limits job starts per user", async () => {
    const { app, auth } = await setup({ jobsLimit: 1 });
    const bad = await app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...auth, "idempotency-key": "bad-link-0001" }, payload: { ...body, url: "https://example.com" } });
    expect(bad.statusCode).toBe(400);
    const limited = await app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...auth, "idempotency-key": "limited-0001" }, payload: body });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });
});
