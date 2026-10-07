import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { describe, expect, it } from "vitest";
import { createTestIssuer } from "../../test-support/keys";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
import { can } from "./permissions";
import { createStaffTokens } from "./tokens";
import { matchTotp, newTotpSecret, totpUri, verifyTotp } from "./totp";

describe("staff passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect((await dummyHash()).startsWith("$argon2id$")).toBe(true);
  });
});

describe("staff TOTP", () => {
  it("verifies current codes and rejects others", async () => {
    const secret = newTotpSecret();
    expect(await verifyTotp(secret, await generate({ secret }))).toBe(true);
    expect(await verifyTotp(secret, "000000")).toBe(false);
    expect(await verifyTotp(secret, "12ab56")).toBe(false);
    expect(totpUri("admin@mushin.pk", secret)).toMatch(/^otpauth:\/\/totp\//);
  });

  it("reports the matched time step and refuses codes at or before a used step (replay)", async () => {
    const secret = newTotpSecret();
    const code = await generate({ secret });
    const step = await matchTotp(secret, code, null);
    expect(step).toEqual(expect.any(Number));
    expect(await matchTotp(secret, code, step)).toBeNull();
    expect(await matchTotp(secret, code, (step ?? 0) - 1)).toBe(step);
    expect(await matchTotp(secret, "12ab56", null)).toBeNull();
  });
});

describe("staff tokens", () => {
  const secret = "z".repeat(48);

  it("round-trips access and challenge tokens and keeps their types apart", async () => {
    const t = createStaffTokens(secret);
    const staffId = randomUUID();
    const access = await t.signAccess({ staffId, role: "support" });
    expect(await t.verifyAccess(access)).toEqual({ staffId, role: "support" });
    const challenge = await t.signChallenge(staffId);
    expect(await t.verifyChallenge(challenge)).toBe(staffId);
    await expect(t.verifyAccess(challenge)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(t.verifyChallenge(access)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("expires access tokens after 15 minutes", async () => {
    let now = new Date("2026-10-06T10:00:00Z");
    const t = createStaffTokens(secret, () => now);
    const access = await t.signAccess({ staffId: randomUUID(), role: "admin" });
    now = new Date("2026-10-06T10:16:00Z");
    await expect(t.verifyAccess(access)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects customer tokens and tokens signed with another secret", async () => {
    const t = createStaffTokens(secret);
    const customer = await (await createTestIssuer()).sign();
    await expect(t.verifyAccess(customer)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const foreign = await createStaffTokens("y".repeat(48)).signAccess({ staffId: randomUUID(), role: "admin" });
    await expect(t.verifyAccess(foreign)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("staff permissions", () => {
  it("is deny-by-default", () => {
    expect(can("admin", "staff.me.read")).toBe(true);
    expect(can("support", "staff.me.read")).toBe(true);
    expect(can("admin", "users.delete")).toBe(false);
    expect(can("support", "")).toBe(false);
    for (const inherited of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(can("admin", inherited)).toBe(false);
    }
  });
});
