import { randomUUID } from "node:crypto";
import { AppError, decryptSecret, encryptSecret, randomToken, sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
import * as repo from "./repository";
import { ACCESS_TTL_SECONDS, type StaffRole, type StaffTokens } from "./tokens";
import { matchTotp, newTotpSecret, totpUri } from "./totp";

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const SESSION_DAYS = 7;

export type RequestMeta = { ip: string | null; userAgent: string | null; requestId: string };
export type StaffProfile = { id: string; email: string; name: string; role: StaffRole };
export type StaffSession = { accessToken: string; expiresInSeconds: number; refreshToken: string; staff: StaffProfile };

const invalidCredentials = () => new AppError("UNAUTHENTICATED", "Invalid email or password");
const tooManyAttempts = () => new AppError("UNAUTHENTICATED", "Too many attempts. Try again in 15 minutes.");
const invalidSession = () => new AppError("UNAUTHENTICATED", "Your admin session has ended. Please sign in again.");
const invalidCode = () => new AppError("UNAUTHENTICATED", "Invalid verification code");

const profileOf = (s: repo.StaffRow): StaffProfile => ({ id: s.id, email: s.email, name: s.name, role: s.role });

export function createStaffService(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; now?: () => Date }) {
  const now = o.now ?? (() => new Date());

  async function failure(staffId: string, reason: string, meta: RequestMeta) {
    await o.db.withSystem(async (tx) => {
      await repo.registerFailure(tx, staffId, MAX_FAILURES, LOCK_MINUTES);
      await repo.audit(tx, { staffId, action: "staff.login.failed", metadata: { reason }, ip: meta.ip, requestId: meta.requestId });
    });
  }

  async function issueSession(staff: repo.StaffRow, familyId: string, meta: RequestMeta): Promise<StaffSession> {
    const refreshToken = randomToken(32);
    await o.db.withSystem((tx) =>
      repo.insertSession(tx, {
        staffId: staff.id,
        familyId,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(now().getTime() + SESSION_DAYS * 86_400_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    return {
      accessToken: await o.tokens.signAccess({ staffId: staff.id, role: staff.role }),
      expiresInSeconds: ACCESS_TTL_SECONDS,
      refreshToken,
      staff: profileOf(staff),
    };
  }

  return {
    async createStaffAccount(input: { email: string; name: string; role: StaffRole }) {
      const password = randomToken(18);
      const totpSecret = newTotpSecret();
      const email = input.email.trim().toLowerCase();
      const id = await o.db.withSystem((tx) =>
        hashPassword(password).then((passwordHash) =>
          repo.insertStaff(tx, {
            email,
            name: input.name.trim(),
            role: input.role,
            passwordHash,
            totpSecretEncrypted: encryptSecret(totpSecret, o.encryptionKey),
          }),
        ),
      );
      return { id, password, totpSecret, totpUri: totpUri(email, totpSecret) };
    },

    async login(input: { email: string; password: string }, meta: RequestMeta): Promise<{ challengeToken: string }> {
      const staff = await o.db.withSystem((tx) => repo.findStaffByEmail(tx, input.email));
      if (!staff || staff.status !== "active") {
        await verifyPassword(await dummyHash(), input.password);
        await o.db.withSystem((tx) =>
          repo.audit(tx, { staffId: null, action: "staff.login.failed", metadata: { reason: "unknown_or_disabled" }, ip: meta.ip, requestId: meta.requestId }),
        );
        throw invalidCredentials();
      }
      if (staff.lockedUntil && staff.lockedUntil > now()) throw tooManyAttempts();
      if (!(await verifyPassword(staff.passwordHash, input.password))) {
        await failure(staff.id, "bad_password", meta);
        throw invalidCredentials();
      }
      return { challengeToken: await o.tokens.signChallenge(staff.id) };
    },

    async completeTotp(input: { challengeToken: string; code: string }, meta: RequestMeta): Promise<StaffSession> {
      const staffId = await o.tokens.verifyChallenge(input.challengeToken);
      const staff = await o.db.withSystem((tx) => repo.findStaffById(tx, staffId));
      if (!staff || staff.status !== "active") throw invalidCredentials();
      if (staff.lockedUntil && staff.lockedUntil > now()) throw tooManyAttempts();
      const step = await matchTotp(decryptSecret(staff.totpSecretEncrypted, o.encryptionKey), input.code, staff.lastTotpStep);
      if (step === null) {
        await failure(staff.id, "bad_totp", meta);
        throw invalidCode();
      }
      // Claiming the step in the same transaction as the login means a code is accepted at most once, even concurrently.
      const claimed = await o.db.withSystem(async (tx) => {
        if (!(await repo.claimTotpStep(tx, staff.id, step))) return false;
        await repo.recordSuccessfulLogin(tx, staff.id);
        await repo.audit(tx, { staffId: staff.id, action: "staff.login.succeeded", ip: meta.ip, requestId: meta.requestId });
        return true;
      });
      if (!claimed) {
        await failure(staff.id, "totp_replayed", meta);
        throw invalidCode();
      }
      return issueSession(staff, randomUUID(), meta);
    },

    async getProfile(staffId: string): Promise<StaffProfile> {
      const staff = await o.db.withSystem((tx) => repo.findStaffById(tx, staffId));
      if (!staff || staff.status !== "active") throw invalidSession();
      return profileOf(staff);
    },

    issueSession,
    invalidSession,
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
