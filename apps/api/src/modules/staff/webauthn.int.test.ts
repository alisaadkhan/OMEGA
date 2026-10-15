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

/** Signs a staff member in with password + TOTP, exactly as the console does. */
async function signIn(role: StaffRole) {
  const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
  const acct = await staff.createStaffAccount({ email, name: `${role} person`, role });
  const { challengeToken } = (await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password: acct.password } })).json();
  const res = await app.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
  return { id: acct.id, auth: { authorization: `Bearer ${(res.json() as { accessToken: string }).accessToken}` } };
}
const call = (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string>, payload?: object) =>
  app.inject(payload === undefined ? { method, url, headers } : { method, url, headers, payload });

async function enrol(auth: Record<string, string>, key: ReturnType<typeof softwareKey>, nickname = "YubiKey") {
  const { options } = (await call("POST", "/admin/v1/security/keys/options", auth)).json() as { options: { challenge: string } };
  return call("POST", "/admin/v1/security/keys", auth, { response: key.register(options), nickname });
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
    expect((await call("DELETE", `/admin/v1/security/keys/${keys[0]?.id}`, admin.auth)).statusCode).toBe(403); // TOTP-only session
    expect((await call("DELETE", `/admin/v1/security/keys/${keys[0]?.id}`, strong)).statusCode).toBe(204);
    const last = (await call("GET", "/admin/v1/security", strong)).json().keys[0].id as string;
    expect((await call("DELETE", `/admin/v1/security/keys/${last}`, strong)).json().error.details).toMatchObject({ reason: "last_key" });

    const other = await signIn("admin");
    const phish = softwareKey({ origin: "https://mushin-login.example" });
    const { options } = (await call("POST", "/admin/v1/security/keys/options", other.auth)).json() as { options: { challenge: string } };
    expect((await call("POST", "/admin/v1/security/keys", other.auth, { response: phish.register(options), nickname: "x" })).statusCode).toBe(400);
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
