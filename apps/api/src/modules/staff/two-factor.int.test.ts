import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../../test-support/app";
import { createStaffModule } from "./index";
import { TEST_WEBAUTHN } from "./test-fixtures";
import { createStaffTokens } from "./tokens";

const db = createTestDatabase();
const tokens = createStaffTokens("t".repeat(48));
const staff = createStaffModule({ db, tokens, encryptionKey: Buffer.alloc(32, 9), webauthn: TEST_WEBAUTHN });
beforeEach(resetTables);
afterAll(() => db.close());

// A code is accepted once per 30-second step; waiting for the next step keeps the test independent of timing.
const nextStep = () => new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 200));

describe("two-factor sign-in as a personal setting (owner, 22 Nov)", () => {
  it("signs in with the password alone while off; set up and turned on in Settings, the code is then required; turned off with a code", async () => {
    const acct = await staff.createStaffAccount({ email: "ops@mushin.pk", name: "Ops", role: "support", twoFactor: false });
    const a = await buildTestApp({ modules: [staff.module] });
    const login = () => a.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email: "ops@mushin.pk", password: acct.password } });

    const first = await login();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ accessToken: expect.any(String), staff: { email: "ops@mushin.pk" } });
    expect(String(first.headers["set-cookie"])).toMatch(/mushin_staff_rt=/);
    const auth = { authorization: `Bearer ${first.json().accessToken as string}` };
    expect((await a.inject({ method: "GET", url: "/admin/v1/security/two-factor", headers: auth })).json()).toEqual({ enabled: false, pending: false });

    const setup = (await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/setup", headers: auth })).json() as { secret: string; uri: string };
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    expect((await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/enable", headers: auth, payload: { code: "000000" } })).statusCode).toBe(400);
    const on = await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/enable", headers: auth, payload: { code: await generate({ secret: setup.secret }) } });
    expect(on.json()).toEqual({ enabled: true, pending: false });

    await nextStep();
    const second = await login();
    expect(second.json()).toEqual({ challengeToken: expect.any(String) });
    const totp = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken: second.json().challengeToken, code: await generate({ secret: setup.secret }) } });
    expect(totp.statusCode).toBe(200);
    const auth2 = { authorization: `Bearer ${totp.json().accessToken as string}` };

    // Replacing the authenticator needs a code from the current one; the old session signed in without it is ended.
    const next = (await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/setup", headers: auth2 })).json() as { secret: string };
    expect((await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/enable", headers: auth2, payload: { code: await generate({ secret: next.secret }) } })).statusCode).toBe(400);
    expect((await a.inject({ method: "POST", url: "/admin/v1/auth/refresh", headers: { cookie: String(first.headers["set-cookie"]).split(";")[0] } })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/disable", headers: auth2, payload: { code: "123456" } })).statusCode).toBe(401);
    await nextStep();
    const off = await a.inject({ method: "POST", url: "/admin/v1/security/two-factor/disable", headers: auth2, payload: { code: await generate({ secret: setup.secret }) } });
    expect(off.json()).toEqual({ enabled: false, pending: false });
    expect((await login()).json()).toMatchObject({ accessToken: expect.any(String) });

    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["staff.two_factor.setup_started", "staff.two_factor.enabled", "staff.two_factor.disabled"]));
  }, 120_000);

  it("existing accounts keep two-factor on", async () => {
    const acct = await staff.createStaffAccount({ email: "old@mushin.pk", name: "Old", role: "admin" });
    const a = await buildTestApp({ modules: [staff.module] });
    const r = await a.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email: "old@mushin.pk", password: acct.password } });
    expect(r.json()).toEqual({ challengeToken: expect.any(String) });
  });
});
