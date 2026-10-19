import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../../test-support/app";
import { createOpsModule } from "../ops/index";
import { createStaffModule } from "./index";
import { softwareKey, TEST_WEBAUTHN } from "./test-fixtures";
import { createStaffTokens, type StaffRole } from "./tokens";

const db = createTestDatabase();
const tokens = createStaffTokens("w".repeat(48));
const staff = createStaffModule({ db, tokens, encryptionKey: Buffer.alloc(32, 7), webauthn: TEST_WEBAUTHN });
const app = await buildTestApp({ modules: [staff.module, createOpsModule({ db, requireStaff: staff.requireStaff })] });
beforeEach(resetTables);
afterAll(async () => {
  await app.close();
  await db.close();
});

/** One-time first-key codes (audit SEC-07) by session, as the operator would hand them over. */
const codes = new Map<string, string>();
/** Signs a staff member in with password + TOTP, exactly as the console does. */
async function signIn(role: StaffRole) {
  const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
  const acct = await staff.createStaffAccount({ email, name: `${role} person`, role });
  const { challengeToken } = (await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password: acct.password } })).json();
  const res = await app.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
  const auth = { authorization: `Bearer ${(res.json() as { accessToken: string }).accessToken}` };
  if (acct.enrolmentCode) codes.set(auth.authorization, acct.enrolmentCode);
  return { id: acct.id, auth, code: acct.enrolmentCode, email };
}
const call = (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string>, payload?: object) =>
  app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });

async function enrol(auth: Record<string, string>, key: ReturnType<typeof softwareKey>, nickname = "YubiKey") {
  const { options } = (await call("POST", "/admin/v1/security/keys/options", auth)).json() as { options: { challenge: string } };
  const enrolmentCode = codes.get(auth["authorization"] ?? "");
  return call("POST", "/admin/v1/security/keys", auth, { response: key.register(options), nickname, ...(enrolmentCode ? { enrolmentCode } : {}) });
}
async function stepUp(auth: Record<string, string>, key: ReturnType<typeof softwareKey>, over: Parameters<ReturnType<typeof softwareKey>["assert"]>[1] = {}) {
  const { options } = (await call("POST", "/admin/v1/security/step-up/options", auth)).json() as { options: { challenge: string } };
  return call("POST", "/admin/v1/security/step-up", auth, { response: key.assert(options, over) });
}
const bearer = (res: { json(): unknown }) => ({ authorization: `Bearer ${(res.json() as { accessToken: string }).accessToken}` });
const auditActions = async (staffId: string) => (await ownerQuery<{ action: string }>(`select action from staff.audit_log where staff_id = '${staffId}' order by created_at`)).map((r) => r.action);

describe("hardware-key (WebAuthn) step-up for privileged staff actions", () => {
  it("an Admin on TOTP alone is refused; after enrolling a key and stepping up, the admin action works", async () => {
    const admin = await signIn("admin");
    const refused = await call("GET", "/admin/v1/audit", admin.auth);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: "hardware_key_required" });

    const key = softwareKey();
    expect((await enrol(admin.auth, key)).statusCode).toBe(201);
    expect((await call("GET", "/admin/v1/security", admin.auth)).json()).toMatchObject({ factors: ["otp"], hardwareKeyRequired: true, keys: [{ nickname: "YubiKey" }] });

    const up = await stepUp(admin.auth, key);
    expect(up.statusCode).toBe(200);
    const strong = bearer(up);
    expect((await call("GET", "/admin/v1/security", strong)).json()).toMatchObject({ factors: ["otp", "hwk"] });
    expect((await call("GET", "/admin/v1/audit", strong)).statusCode).toBe(200);
    expect(await auditActions(admin.id)).toEqual(expect.arrayContaining(["staff.login.succeeded", "staff.webauthn.registered", "staff.webauthn.step_up"]));
  });

  it("refuses replayed, wrong-origin, unverified-user and wrongly signed assertions, and audits each failure", async () => {
    const admin = await signIn("admin");
    const key = softwareKey();
    await enrol(admin.auth, key);
    // Replay: the same assertion against a fresh challenge carries the wrong challenge; reusing a challenge is impossible.
    const { options } = (await call("POST", "/admin/v1/security/step-up/options", admin.auth)).json() as { options: { challenge: string } };
    const once = key.assert(options);
    expect((await call("POST", "/admin/v1/security/step-up", admin.auth, { response: once })).statusCode).toBe(200);
    expect((await call("POST", "/admin/v1/security/step-up", admin.auth, { response: once })).statusCode).toBe(401);
    // Same counter as the last accepted assertion: a cloned key; refused.
    expect((await stepUp(admin.auth, key, { counterStep: 0 })).statusCode).toBe(401);
    expect((await stepUp(admin.auth, key, { origin: "https://evil.example" })).statusCode).toBe(401);
    expect((await stepUp(admin.auth, key, { uv: false })).statusCode).toBe(401);
    expect((await stepUp(admin.auth, key, { key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey })).statusCode).toBe(401);
    expect((await auditActions(admin.id)).filter((a) => a === "staff.webauthn.failed")).toHaveLength(4);
    expect((await stepUp(admin.auth, key)).statusCode).toBe(200); // the real key still works
  });

  it("a second key needs a key-proven session; the last key cannot be removed; a key from another origin is refused", async () => {
    const admin = await signIn("admin");
    const first = softwareKey();
    await enrol(admin.auth, first);
    expect((await call("POST", "/admin/v1/security/keys/options", admin.auth)).json().error.details).toMatchObject({ reason: "hardware_key_required" });
    const strong = bearer(await stepUp(admin.auth, first));
    const second = softwareKey();
    expect((await enrol(strong, second, "Backup key")).statusCode).toBe(201);
    const keys = (await call("GET", "/admin/v1/security", strong)).json().keys as { id: string; nickname: string }[];
    const backup = keys.find((k) => k.nickname === "Backup key")?.id;
    expect((await call("DELETE", `/admin/v1/security/keys/${backup}`, admin.auth)).statusCode).toBe(403); // TOTP-only session
    // Removing the backup key keeps the step-up (made with the first key); removing the step-up's own key would end it.
    expect((await call("DELETE", `/admin/v1/security/keys/${backup}`, strong)).statusCode).toBe(204);
    const last = (await call("GET", "/admin/v1/security", strong)).json().keys[0].id as string;
    expect((await call("DELETE", `/admin/v1/security/keys/${last}`, strong)).json().error.details).toMatchObject({ reason: "last_key" });

    const other = await signIn("admin");
    const phish = softwareKey({ origin: "https://mushin-login.example" });
    const { options } = (await call("POST", "/admin/v1/security/keys/options", other.auth)).json() as { options: { challenge: string } };
    expect((await call("POST", "/admin/v1/security/keys", other.auth, { response: phish.register(options), nickname: "x", enrolmentCode: other.code })).statusCode).toBe(400);
  });

  it("Support keeps TOTP-only access to support actions and cannot enrol keys or reach admin actions", async () => {
    const support = await signIn("support");
    expect((await call("GET", "/admin/v1/security", support.auth)).json()).toMatchObject({ hardwareKeyRequired: false });
    expect((await call("POST", "/admin/v1/security/keys/options", support.auth)).statusCode).toBe(403);
    expect((await call("GET", "/admin/v1/audit", support.auth)).statusCode).toBe(403);
    // A forged token claiming a hardware key does not lift a Support role's limits.
    const forged = { authorization: `Bearer ${await tokens.signAccess({ staffId: support.id, role: "support", factors: ["otp", "hwk"] })}` };
    expect((await call("GET", "/admin/v1/audit", forged)).statusCode).toBe(403);
  });

  it("a suspended account or a changed role stops working at once, even with an unexpired token", async () => {
    const admin = await signIn("admin");
    const key = softwareKey();
    await enrol(admin.auth, key);
    const strong = bearer(await stepUp(admin.auth, key));
    expect((await call("GET", "/admin/v1/audit", strong)).statusCode).toBe(200);
    await ownerQuery(`update staff.staff_users set role = 'support' where id = '${admin.id}'`);
    expect((await call("GET", "/admin/v1/audit", strong)).statusCode).toBe(401);
    await ownerQuery(`update staff.staff_users set role = 'admin', status = 'suspended' where id = '${admin.id}'`);
    expect((await call("GET", "/admin/v1/me", strong)).statusCode).toBe(401);
  });
});

describe("first-key enrolment needs a one-time code issued out of band (audit SEC-07)", () => {
  const register = async (auth: Record<string, string>, key: ReturnType<typeof softwareKey>, enrolmentCode?: string) => {
    const { options } = (await call("POST", "/admin/v1/security/keys/options", auth)).json() as { options: { challenge: string } };
    return call("POST", "/admin/v1/security/keys", auth, { response: key.register(options), nickname: "Attacker key", ...(enrolmentCode ? { enrolmentCode } : {}) });
  };

  it("a password + TOTP session alone cannot enrol a first key; the right code works once, for that person only", async () => {
    const admin = await signIn("admin");
    const other = await signIn("admin");
    expect(admin.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
    const missing = await register(admin.auth, softwareKey());
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.details).toMatchObject({ reason: "enrolment_code_required" });
    expect((await register(admin.auth, softwareKey(), "AAAA-BBBB-CCCC-DDDD-EEEE")).statusCode).toBe(403);
    expect((await register(admin.auth, softwareKey(), other.code ?? "")).statusCode).toBe(403); // someone else's code
    const audits = await ownerQuery<{ reason: string }>(`select metadata->>'reason' reason from staff.audit_log where staff_id = '${admin.id}' and action = 'staff.webauthn.failed' order by created_at`);
    expect(audits.map((a) => a.reason)).toEqual(["enrolment_code_missing", "enrolment_code_invalid", "enrolment_code_invalid"]);
    expect(await ownerQuery(`select 1 from staff.webauthn_credentials where staff_id = '${admin.id}'`)).toEqual([]);

    // Typed in lower case with spaces, the code still matches; it enrols one key and is then spent.
    const typed = (admin.code ?? "").toLowerCase().replaceAll("-", " ");
    expect((await register(admin.auth, softwareKey(), typed)).statusCode).toBe(201);
    expect(await ownerQuery(`select key, severity from platform.alert_events where key = 'staff_key_enrolled'`)).toEqual([{ key: "staff_key_enrolled", severity: "warning" }]);
    await ownerQuery(`update staff.webauthn_credentials set revoked_at = now() where staff_id = '${admin.id}'`);
    expect((await register(admin.auth, softwareKey(), admin.code ?? undefined)).statusCode).toBe(403); // used
  });

  it("expired codes are refused; a new code from the command line replaces the old one and is audited", async () => {
    const admin = await signIn("admin");
    await ownerQuery(`update staff.enrolment_codes set expires_at = now() - interval '1 minute' where staff_id = '${admin.id}'`);
    expect((await register(admin.auth, softwareKey(), admin.code ?? undefined)).statusCode).toBe(403);
    await expect(staff.issueEnrolmentCode({ email: admin.email, operator: "O", reason: "lost key" })).rejects.toThrow(/operator/);
    const fresh = await staff.issueEnrolmentCode({ email: admin.email, operator: "Owner", reason: "Expired before first sign-in" });
    const replaced = await staff.issueEnrolmentCode({ email: admin.email, operator: "Owner", reason: "Code sent to the wrong person" });
    expect((await register(admin.auth, softwareKey(), fresh.code)).statusCode).toBe(403); // revoked by the newer code
    expect((await register(admin.auth, softwareKey(), replaced.code)).statusCode).toBe(201);
    const issued = await ownerQuery<{ n: number }>(`select count(*)::int n from staff.audit_log where action = 'staff.webauthn.enrolment_code_issued' and target_id = '${admin.id}'`);
    expect(issued[0]?.n).toBe(3); // with the account, and twice from the command line
    expect(JSON.stringify(await ownerQuery(`select * from staff.enrolment_codes`))).not.toContain(replaced.code);
    const support = await signIn("support");
    expect(support.code).toBeNull();
  });
});

describe("step-up is proven on the server, not by the token (audit SEC-02)", () => {
  it("a token forged with the signing secret and an hwk claim is refused on every hardware-key action", async () => {
    const admin = await signIn("admin");
    const forged = { authorization: `Bearer ${await tokens.signAccess({ staffId: admin.id, role: "admin", factors: ["otp", "hwk"] })}` };
    const res = await call("GET", "/admin/v1/audit", forged);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details).toMatchObject({ reason: "hardware_key_required" });
    expect((await call("GET", "/admin/v1/security", forged)).json()).toMatchObject({ factors: ["otp"] });
    // A made-up step-up id, or another staff member's real one, does not help either.
    const randomId = { authorization: `Bearer ${await tokens.signAccess({ staffId: admin.id, role: "admin", factors: ["otp", "hwk"], stepUpId: randomUUID() })}` };
    expect((await call("GET", "/admin/v1/audit", randomId)).statusCode).toBe(403);
    const other = await signIn("admin");
    const key = softwareKey();
    await enrol(other.auth, key);
    await stepUp(other.auth, key);
    const [row] = await ownerQuery<{ id: string }>(`select id from staff.step_ups where staff_id = '${other.id}'`);
    const borrowed = { authorization: `Bearer ${await tokens.signAccess({ staffId: admin.id, role: "admin", factors: ["otp", "hwk"], stepUpId: row?.id ?? "" })}` };
    expect((await call("GET", "/admin/v1/audit", borrowed)).statusCode).toBe(403);
  });

  it("a step-up proves the key for five minutes, then admin actions ask again (mandate v3 SEC-02)", async () => {
    const admin = await signIn("admin");
    const key = softwareKey();
    await enrol(admin.auth, key);
    const strong = bearer(await stepUp(admin.auth, key));
    const [row] = await ownerQuery<{ s: number }>(`select extract(epoch from expires_at - created_at)::int s from staff.step_ups where staff_id = '${admin.id}'`);
    expect(row?.s).toBe(300);
    // Shift the step-up back in time, keeping its 5-minute length: 4 minutes old still works, 6 minutes old does not.
    await ownerQuery(`update staff.step_ups set created_at = now() - interval '4 minutes', expires_at = now() + interval '1 minute' where staff_id = '${admin.id}'`);
    expect((await call("GET", "/admin/v1/audit", strong)).statusCode).toBe(200);
    await ownerQuery(`update staff.step_ups set created_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' where staff_id = '${admin.id}'`);
    const refused = await call("GET", "/admin/v1/audit", strong);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: "hardware_key_required" });
    expect((await call("GET", "/admin/v1/security", strong)).json().factors).not.toContain("hwk");
  });

  it("an expired step-up, a revoked key or a revoke-all stops the step-up at once", async () => {
    const admin = await signIn("admin");
    const key = softwareKey();
    await enrol(admin.auth, key);
    const strong = bearer(await stepUp(admin.auth, key));
    expect((await call("GET", "/admin/v1/audit", strong)).statusCode).toBe(200);
    await ownerQuery(`update staff.step_ups set created_at = now() - interval '1 minute', expires_at = now() - interval '1 second' where staff_id = '${admin.id}'`);
    expect((await call("GET", "/admin/v1/audit", strong)).statusCode).toBe(403);

    const again = bearer(await stepUp(admin.auth, key));
    expect((await call("GET", "/admin/v1/audit", again)).statusCode).toBe(200);
    await ownerQuery(`update staff.webauthn_credentials set revoked_at = now() where staff_id = '${admin.id}'`);
    expect((await call("GET", "/admin/v1/audit", again)).statusCode).toBe(403);

    await ownerQuery(`update staff.webauthn_credentials set revoked_at = null where staff_id = '${admin.id}'`);
    const third = bearer(await stepUp(admin.auth, key));
    expect((await call("GET", "/admin/v1/audit", third)).statusCode).toBe(200);
    const [r] = await ownerQuery<{ v: { sessions: number; stepUps: number } }>(`select staff.revoke_all_sessions('credential rotation 2026-10-16') v`);
    expect(r?.v.sessions).toBeGreaterThan(0);
    expect((await call("GET", "/admin/v1/audit", third)).statusCode).toBe(403);
    expect(await ownerQuery(`select action from staff.audit_log where action = 'staff.sessions.revoked_all'`)).toHaveLength(1);
    await expect(ownerQuery(`select staff.revoke_all_sessions('short')`)).rejects.toThrow(/reason/);
  });
});
