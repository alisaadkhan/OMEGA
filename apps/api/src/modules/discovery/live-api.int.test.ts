import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, resetTables } from "@mushin/db/testing";
import { createSearchIndex, MockLlm, MockPayments } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createCreatorsModule, createCreatorsService, createRemovalService } from "../creators/index";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createStaffModule, createStaffTokens, recordStaffAudit } from "../staff/index";
import { steppedUpToken, TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createDiscoveryModule, createDiscoveryService } from "./index";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup(o: { removalLimit?: number } = {}) {
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const big = { limit: 1000, windowSeconds: 60 };
  const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: { limit: o.removalLimit ?? 1000, windowSeconds: 60 }, ai: big, jobs: { limit: 1000, windowSeconds: 3600 }, workspaceJobs: { limit: 100_000, windowSeconds: 3600 } });
  const tokens = createStaffTokens("r".repeat(48));
  const staff = createStaffModule({ db, tokens, encryptionKey: TEST_KEY, webauthn: TEST_WEBAUTHN });
  const creators = createCreatorsService({ db, index: createSearchIndex(null, logger), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger });
  const removals = createRemovalService({ db, encryptionKey: TEST_KEY, audit: recordStaffAudit });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [
      platform.module,
      identity.module,
      staff.module,
      createCreatorsModule({ service: creators, limiter, removals, requireStaff: staff.requireStaff }),
      createDiscoveryModule({ service: createDiscoveryService({ db, billing }), limiter }),
    ],
  });
  const token = await iss.sign({ sub: randomUUID(), email: "owner@mushin.pk", fullName: "Owner" });
  return { app, staff, tokens, auth: { authorization: `Bearer ${token}` } };
}

async function staffToken(s: Awaited<ReturnType<typeof setup>>, role: "admin" | "support") {
  const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
  const acct = await s.staff.createStaffAccount({ email, name: role, role });
  const { challengeToken } = (await s.app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password: acct.password } })).json();
  const res = await s.app.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
  return { authorization: `Bearer ${(res.json() as { accessToken: string }).accessToken}` };
}

describe("live discovery API", () => {
  it("starts a live run (202) and reads its results", async () => {
    const { app, auth } = await setup();
    const estimateResponse = await app.inject({
      method: "POST",
      url: "/v1/discovery/estimates",
      headers: { ...auth, "idempotency-key": "live-estimate-0001" },
      payload: { search: { text: "bridal", filters: { platform: "instagram", creatorCity: "Lahore" } }, maxNew: 5 },
    });
    expect(estimateResponse.statusCode).toBe(201);
    const estimateId = (estimateResponse.json() as { estimateId: string }).estimateId;
    const payload = { kind: "live", estimateId };
    const res = await app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...auth, "idempotency-key": "live-run-0001" }, payload });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { job: { id: string } }).job.id;
    expect((await app.inject({ method: "GET", url: `/v1/discovery/jobs/${id}/results?after=0`, headers: auth })).json()).toEqual({ results: [], done: false });
    expect((await app.inject({ method: "GET", url: `/v1/discovery/jobs/${id}/results?after=-1`, headers: auth })).statusCode).toBe(400);
    // JOB-003: stopping needs sign-in, records the request and is idempotent.
    expect((await app.inject({ method: "POST", url: `/v1/discovery/jobs/${id}/cancel` })).statusCode).toBe(401);
    const stop = await app.inject({ method: "POST", url: `/v1/discovery/jobs/${id}/cancel`, headers: auth });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toMatchObject({ id, status: "queued", cancelRequested: true });
    expect((await app.inject({ method: "POST", url: `/v1/discovery/jobs/${id}/cancel`, headers: auth })).json()).toMatchObject({ cancelRequested: true });
    expect((await app.inject({ method: "POST", url: `/v1/discovery/jobs/00000000-0000-4000-8000-000000000000/cancel`, headers: auth })).statusCode).toBe(404);
  });
});

describe("public removal form", () => {
  it("answers 202 for any valid request without sign-in, and limits repeats per IP", async () => {
    const { app } = await setup({ removalLimit: 2 });
    const body = { urls: ["instagram.com/someone"], email: "me@example.com", confirm: true };
    expect((await app.inject({ method: "POST", url: "/v1/public/removal-requests", payload: body })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/v1/public/removal-requests", payload: { ...body, confirm: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/public/removal-requests", payload: body })).statusCode).toBe(429);
  });
});

describe("staff review API", () => {
  it("needs a staff admin; support staff are refused", async () => {
    const s = await setup();
    await addCreator(db, { profiles: [{ platform: "instagram", handle: "review_me" }] });
    await s.app.inject({ method: "POST", url: "/v1/public/removal-requests", payload: { urls: ["instagram.com/review_me"], email: "me@example.com", confirm: true } });
    expect((await s.app.inject({ method: "GET", url: "/admin/v1/removal-requests" })).statusCode).toBe(401);
    expect((await s.app.inject({ method: "GET", url: "/admin/v1/removal-requests", headers: await staffToken(s, "support") })).statusCode).toBe(403);
    // Approving a removal is an admin action: TOTP alone is refused until a hardware-key sign-in exists (DOC-029).
    const totpAdmin = await staffToken(s, "admin");
    const refused = await s.app.inject({ method: "GET", url: "/admin/v1/removal-requests?status=received", headers: totpAdmin });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { details: { reason: "hardware_key_required" } } });
    const keyAdmin = await s.staff.createStaffAccount({ email: `hwk-${randomUUID().slice(0, 6)}@mushin.pk`, name: "Key admin", role: "admin" });
    const admin = { authorization: `Bearer ${await steppedUpToken(db, s.tokens, keyAdmin.id, "admin")}` };
    const list = (await s.app.inject({ method: "GET", url: "/admin/v1/removal-requests?status=received", headers: admin })).json() as { requests: { id: string }[] };
    expect(list.requests).toHaveLength(1);
    const id = list.requests[0]?.id ?? "";
    expect((await s.app.inject({ method: "POST", url: `/admin/v1/removal-requests/${id}/reject`, headers: admin, payload: { note: "no" } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "POST", url: `/admin/v1/removal-requests/${id}/approve`, headers: admin })).statusCode).toBe(200);
    expect((await s.app.inject({ method: "POST", url: `/admin/v1/removal-requests/${id}/approve`, headers: admin })).statusCode).toBe(409);
  });
});

describe("remove revealed contacts", () => {
  it("removes the workspace's reveal", async () => {
    const { app, auth } = await setup();
    const id = await addCreator(db);
    expect((await app.inject({ method: "DELETE", url: `/v1/creators/${id}/reveal`, headers: auth })).json()).toEqual({ status: "removed" });
  });
});
