import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp, noGuards } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createIdentityModule } from "./index";
import { imageTypeOf } from "./routes";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const limiter = () =>
  new MemoryRateLimiter({
    ip: { limit: 100, windowSeconds: 60 }, user: { limit: 100, windowSeconds: 60 }, auth: { limit: 100, windowSeconds: 60 },
    ai: { limit: 100, windowSeconds: 60 }, lookup: { limit: 100, windowSeconds: 60 },
    jobs: { limit: 100, windowSeconds: 3600 }, workspaceJobs: { limit: 100_000, windowSeconds: 3600 }, callback: { limit: 1000, windowSeconds: 3600 },
  });

async function setup(factors: Map<string, boolean> | null) {
  const iss = await createTestIssuer();
  const identity = createIdentityModule({
    db,
    autoTrial: null,
    twoStepStatus: factors ? async (userId) => factors.get(userId) ?? false : null,
  });
  const guard = createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter: limiter() });
  const app = await buildTestApp({ guards: { ...noGuards(), customer: guard }, modules: [identity.module] });
  const sub = randomUUID();
  const as = async (aal?: "aal1" | "aal2") => ({ authorization: `Bearer ${await iss.sign({ sub, email: "zara@mushin.pk", fullName: "Zara", ...(aal ? { aal } : {}) })}` });
  return { app, sub, as };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);

describe("profile photo (owner, 17 Nov)", () => {
  it("stores a real image on the person's own record and removes it again", async () => {
    const { app, sub, as } = await setup(null);
    const h = await as();
    const image = `data:image/jpeg;base64,${JPEG.toString("base64")}`;
    const saved = await app.inject({ method: "PUT", url: "/v1/me/avatar", headers: h, payload: { image } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().user.avatarUrl).toBe(image);
    expect((await ownerQuery<{ a: string }>(`select avatar_url a from wp.users where id = '${sub}'`))[0]?.a).toBe(image);
    const removed = await app.inject({ method: "DELETE", url: "/v1/me/avatar", headers: h });
    expect(removed.json().user.avatarUrl).toBeNull();
  });

  it("refuses bytes that are not the image type claimed, other types, and oversized photos", async () => {
    const { app, as } = await setup(null);
    const h = await as();
    const put = (image: string) => app.inject({ method: "PUT", url: "/v1/me/avatar", headers: h, payload: { image } });
    expect((await put(`data:image/png;base64,${JPEG.toString("base64")}`)).statusCode).toBe(400);
    expect((await put(`data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`)).statusCode).toBe(400);
    expect((await put(`data:image/png;base64,${Buffer.from("not an image").toString("base64")}`)).statusCode).toBe(400);
    expect((await put(`data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(160_000)]).toString("base64")}`)).statusCode).toBe(400);
    expect((await put(`data:image/png;base64,${PNG.toString("base64")}`)).statusCode).toBe(200);
  });

  it("reads the image type from the bytes", () => {
    expect([imageTypeOf(PNG), imageTypeOf(JPEG), imageTypeOf(Buffer.from("RIFF0000WEBPVP8 ")), imageTypeOf(Buffer.from("GIF89a"))]).toEqual(["png", "jpeg", "webp", null]);
  });
});

describe("two-step sign-in (0091)", () => {
  it("is turned on only from the sign-in service's own record, then refuses sessions that skipped the code", async () => {
    const factors = new Map<string, boolean>();
    const { app, sub, as } = await setup(factors);
    // Without a verified authenticator at the sign-in service, syncing changes nothing.
    const none = await app.inject({ method: "POST", url: "/v1/me/two-step/sync", headers: await as("aal1") });
    expect(none.json().user.twoStepEnabled).toBe(false);

    factors.set(sub, true);
    const on = await app.inject({ method: "POST", url: "/v1/me/two-step/sync", headers: await as("aal2") });
    expect(on.json().user.twoStepEnabled).toBe(true);

    const firstStepOnly = await app.inject({ method: "GET", url: "/v1/me", headers: await as("aal1") });
    expect(firstStepOnly.statusCode).toBe(403);
    expect(firstStepOnly.json().error.details).toMatchObject({ reason: "two_step_required" });
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: await as() })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: await as("aal2") })).statusCode).toBe(200);

    // Removing the authenticator at the sign-in service and syncing (allowed before the code step) turns it off again.
    factors.set(sub, false);
    const off = await app.inject({ method: "POST", url: "/v1/me/two-step/sync", headers: await as("aal1") });
    expect(off.json().user.twoStepEnabled).toBe(false);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: await as("aal1") })).statusCode).toBe(200);
  });

  it("a first-step session cannot switch two-step off while the authenticator still exists", async () => {
    const factors = new Map<string, boolean>();
    const { app, sub, as } = await setup(factors);
    factors.set(sub, true);
    await app.inject({ method: "POST", url: "/v1/me/two-step/sync", headers: await as("aal2") });
    const again = await app.inject({ method: "POST", url: "/v1/me/two-step/sync", headers: await as("aal1") });
    expect(again.json().user.twoStepEnabled).toBe(true);
    expect((await app.inject({ method: "PATCH", url: "/v1/me", headers: await as("aal1"), payload: { displayName: "x" } })).statusCode).toBe(403);
  });

  it("says plainly when the sign-in service can't be asked", async () => {
    const { app, as } = await setup(null);
    const res = await app.inject({ method: "POST", url: "/v1/me/two-step/sync", headers: await as() });
    expect(res.statusCode).toBe(503);
  });
});
