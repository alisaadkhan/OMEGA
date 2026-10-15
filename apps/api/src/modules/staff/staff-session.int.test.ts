import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../../test-support/app";
import { createStaffModule } from "./index";
import { TEST_WEBAUTHN } from "./test-fixtures";
import { createStaffTokens } from "./tokens";

const db = createTestDatabase();
const staff = createStaffModule({ db, tokens: createStaffTokens("r".repeat(48)), encryptionKey: Buffer.alloc(32, 3), webauthn: TEST_WEBAUTHN });

beforeEach(resetTables);
afterAll(() => db.close());

function cookieValue(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
  const m = /mushin_staff_rt=([^;]*)/.exec(raw);
  if (!m?.[1]) throw new Error("no refresh cookie");
  return m[1];
}

async function signedIn() {
  const acct = await staff.createStaffAccount({ email: "admin@mushin.pk", name: "Admin", role: "admin" });
  const a = await buildTestApp({ modules: [staff.module] });
  const { challengeToken } = (await a.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email: "admin@mushin.pk", password: acct.password } })).json();
  const res = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
  return { a, refresh: cookieValue(res.headers["set-cookie"]) };
}

const refreshWith = (a: Awaited<ReturnType<typeof signedIn>>["a"], token: string) =>
  a.inject({ method: "POST", url: "/admin/v1/auth/refresh", cookies: { mushin_staff_rt: token } });

describe("staff sessions", () => {
  it("rotates the refresh token", async () => {
    const { a, refresh } = await signedIn();
    const res = await refreshWith(a, refresh);
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toEqual(expect.any(String));
    expect(cookieValue(res.headers["set-cookie"])).not.toBe(refresh);
  });

  it("revokes the whole family when an old refresh token is reused", async () => {
    const { a, refresh } = await signedIn();
    const rotated = cookieValue((await refreshWith(a, refresh)).headers["set-cookie"]);
    expect((await refreshWith(a, refresh)).statusCode).toBe(401);
    expect((await refreshWith(a, rotated)).statusCode).toBe(401);
    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log`);
    expect(audit.map((r) => r.action)).toContain("staff.session.reuse_detected");
  });

  it("concurrent reuse of one refresh token leaves no live session in the family", async () => {
    const { a, refresh } = await signedIn();
    const [r1, r2] = await Promise.all([refreshWith(a, refresh), refreshWith(a, refresh)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 401]);
    const winner = r1.statusCode === 200 ? r1 : r2;
    expect((await refreshWith(a, cookieValue(winner.headers["set-cookie"]))).statusCode).toBe(401);
    const live = await ownerQuery<{ n: number }>(`select count(*)::int n from staff.staff_sessions where revoked_at is null`);
    expect(live[0]?.n).toBe(0);
  });

  it("logs out: clears the cookie and the token stops working", async () => {
    const { a, refresh } = await signedIn();
    const out = await a.inject({ method: "POST", url: "/admin/v1/auth/logout", cookies: { mushin_staff_rt: refresh } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/mushin_staff_rt=;/);
    expect((await refreshWith(a, refresh)).statusCode).toBe(401);
  });

  it("rejects refresh without a cookie or with an unknown token", async () => {
    const a = await buildTestApp({ modules: [staff.module] });
    expect((await a.inject({ method: "POST", url: "/admin/v1/auth/refresh" })).statusCode).toBe(401);
    expect((await refreshWith(a, "nope")).statusCode).toBe(401);
  });
});
