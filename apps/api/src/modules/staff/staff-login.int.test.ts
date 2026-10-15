import { sql } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, dbError, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../../test-support/app";
import { createStaffModule } from "./index";
import { TEST_WEBAUTHN } from "./test-fixtures";
import { createStaffTokens } from "./tokens";

const db = createTestDatabase();
const key = Buffer.alloc(32, 9);
const tokens = createStaffTokens("t".repeat(48));
const staff = createStaffModule({ db, tokens, encryptionKey: key, webauthn: TEST_WEBAUTHN });

beforeEach(resetTables);
afterAll(() => db.close());

async function app() {
  return buildTestApp({ modules: [staff.module] });
}

async function login(a: Awaited<ReturnType<typeof app>>, email: string, password: string) {
  return a.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password } });
}

describe("staff login + TOTP", () => {
  it("completes the two-step login and returns an access token and refresh cookie", async () => {
    const acct = await staff.createStaffAccount({ email: "Admin@Mushin.pk", name: "Admin", role: "admin" });
    const a = await app();
    const step1 = await login(a, "admin@mushin.pk", acct.password);
    expect(step1.statusCode).toBe(200);
    const { challengeToken } = step1.json();

    const step2 = await a.inject({
      method: "POST",
      url: "/admin/v1/auth/totp",
      payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) },
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.json()).toMatchObject({ expiresInSeconds: 900, staff: { email: "admin@mushin.pk", role: "admin" } });
    const cookie = String(step2.headers["set-cookie"]);
    expect(cookie).toMatch(/mushin_staff_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/admin\/v1\/auth/);

    const me = await a.inject({ method: "GET", url: "/admin/v1/me", headers: { authorization: `Bearer ${step2.json().accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().staff.email).toBe("admin@mushin.pk");

    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((r) => r.action)).toContain("staff.login.succeeded");
  });

  it("gives the same error for unknown email and wrong password", async () => {
    await staff.createStaffAccount({ email: "s@mushin.pk", name: "Support", role: "support" });
    const a = await app();
    const unknown = await login(a, "nobody@mushin.pk", "x");
    const wrong = await login(a, "s@mushin.pk", "wrong");
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it("locks the account after 5 failures for 15 minutes", async () => {
    const acct = await staff.createStaffAccount({ email: "l@mushin.pk", name: "L", role: "support" });
    const a = await app();
    for (let i = 0; i < 5; i++) await login(a, "l@mushin.pk", "wrong");
    const locked = await login(a, "l@mushin.pk", acct.password);
    expect(locked.statusCode).toBe(401);
    // A locked account answers exactly like an unknown email, so lockouts do not reveal which accounts exist.
    expect(locked.json().error.message).toBe((await login(a, "nobody@mushin.pk", "x")).json().error.message);
    expect(locked.json().error.message).toMatch(/paused for 15 minutes/);
    const rows = await ownerQuery<{ locked: boolean }>(`select locked_until > now() + interval '14 minutes' as locked from staff.staff_users`);
    expect(rows[0]?.locked).toBe(true);
  });

  it("counts concurrent wrong passwords one at a time, so a burst cannot exceed the lockout", async () => {
    const acct = await staff.createStaffAccount({ email: "b@mushin.pk", name: "B", role: "support" });
    const a = await app();
    await Promise.all(Array.from({ length: 10 }, () => login(a, "b@mushin.pk", "wrong")));
    const rows = await ownerQuery<{ n: number; locked: boolean }>(`select failed_login_count n, locked_until > now() locked from staff.staff_users`);
    expect(rows[0]).toEqual({ n: 5, locked: true });
    expect((await login(a, "b@mushin.pk", acct.password)).statusCode).toBe(401);
  });

  it("starts a fresh failure count once a lock has expired", async () => {
    const acct = await staff.createStaffAccount({ email: "x@mushin.pk", name: "X", role: "support" });
    const a = await app();
    for (let i = 0; i < 5; i++) await login(a, "x@mushin.pk", "wrong");
    await ownerQuery(`update staff.staff_users set locked_until = now() - interval '1 minute'`);
    await login(a, "x@mushin.pk", "one typo");
    const rows = await ownerQuery<{ n: number; locked: boolean }>(
      `select failed_login_count n, coalesce(locked_until > now(), false) locked from staff.staff_users`,
    );
    expect(rows[0]).toEqual({ n: 1, locked: false });
    expect((await login(a, "x@mushin.pk", acct.password)).statusCode).toBe(200);
  });

  it("accepts a TOTP code only once, even for concurrent requests (replay)", async () => {
    const acct = await staff.createStaffAccount({ email: "r@mushin.pk", name: "R", role: "admin" });
    const a = await app();
    const code = await generate({ secret: acct.totpSecret });
    const challenges = await Promise.all([1, 2, 3].map(async () => (await login(a, "r@mushin.pk", acct.password)).json().challengeToken as string));
    const results = await Promise.all(
      challenges.map((challengeToken) => a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code } })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401, 401]);
    const later = (await login(a, "r@mushin.pk", acct.password)).json().challengeToken as string;
    const replay = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken: later, code } });
    expect(replay.statusCode).toBe(401);
  });

  it("rejects a wrong TOTP code and an access token used as a challenge", async () => {
    const acct = await staff.createStaffAccount({ email: "t@mushin.pk", name: "T", role: "admin" });
    const a = await app();
    const { challengeToken } = (await login(a, "t@mushin.pk", acct.password)).json();
    const bad = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: "000000" } });
    expect(bad.statusCode).toBe(401);
    const access = await tokens.signAccess({ staffId: acct.id, role: "admin" });
    const misuse = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken: access, code: "123456" } });
    expect(misuse.statusCode).toBe(401);
  });

  it("stores the TOTP secret encrypted and the audit log is append-only", async () => {
    const acct = await staff.createStaffAccount({ email: "e@mushin.pk", name: "E", role: "admin" });
    const rows = await ownerQuery<{ s: string }>(`select totp_secret_encrypted s from staff.staff_users`);
    expect(rows[0]?.s.startsWith("v1.")).toBe(true);
    expect(rows[0]?.s).not.toContain(acct.totpSecret);
    await expect(db.withSystem((tx) => tx.execute(sql`update staff.audit_log set action = 'x'`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(db.withSystem((tx) => tx.execute(sql`delete from staff.audit_log`))).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("denies the customer API role any access to staff tables", async () => {
    const rows = await ownerQuery<{ p: boolean }>(`select has_table_privilege('mushin_app', 'staff.staff_users', 'select') as p`);
    expect(rows[0]?.p).toBe(false);
  });

  it("bootstraps the first Super Admin once, then only as an audited recovery; operator and reason are required", async () => {
    await expect(staff.bootstrapSuperAdmin({ email: "owner@mushin.pk", name: "Owner", operator: "", reason: "Initial platform owner", recovery: false })).rejects.toThrow(/operator/);
    const first = await staff.bootstrapSuperAdmin({ email: "owner@mushin.pk", name: "Owner", operator: "Owner", reason: "Initial platform owner", recovery: false });
    await expect(staff.bootstrapSuperAdmin({ email: "second@mushin.pk", name: "Second", operator: "Owner", reason: "Second owner without recovery", recovery: false })).rejects.toThrow(/already exist/);
    const rescue = await staff.bootstrapSuperAdmin({ email: "rescue@mushin.pk", name: "Rescue", operator: "Owner", reason: "Lost hardware key; restoring access", recovery: true });
    const rows = await ownerQuery<{ id: string; role: string }>(`select id, role from staff.staff_users where role = 'super_admin' order by created_at`);
    expect(rows.map((r) => r.id)).toEqual([first.id, rescue.id]);
    const audit = await ownerQuery<{ staff_id: string | null; target_id: string; metadata: Record<string, unknown> }>(`select staff_id, target_id, metadata from staff.audit_log where action = 'staff.super_admin.bootstrapped' order by created_at`);
    expect(audit).toEqual([
      { staff_id: null, target_id: first.id, metadata: { operator: "Owner", reason: "Initial platform owner", recovery: false, existingActive: 0 } },
      { staff_id: null, target_id: rescue.id, metadata: { operator: "Owner", reason: "Lost hardware key; restoring access", recovery: true, existingActive: 1 } },
    ]);
  });
});
