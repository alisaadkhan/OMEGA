import { randomUUID } from "node:crypto";
import { AppError, decryptSecret, encryptSecret, randomToken, sha256Hex } from "@mushin/core";
import type { Db, SystemTx } from "@mushin/db";
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

// One message for every sign-in failure (unknown email, wrong password, locked account) so it reveals nothing.
const invalidCredentials = () =>
  new AppError("UNAUTHENTICATED", "Invalid email or password. After 5 failed attempts, sign-in is paused for 15 minutes.");
const tooManyAttempts = () => new AppError("UNAUTHENTICATED", "Too many attempts. Try again in 15 minutes.");
const invalidSession = () => new AppError("UNAUTHENTICATED", "Your admin session has ended. Please sign in again.");
const invalidCode = () => new AppError("UNAUTHENTICATED", "Invalid verification code");

const profileOf = (s: repo.StaffRow): StaffProfile => ({ id: s.id, email: s.email, name: s.name, role: s.role });

export function createStaffService(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; now?: () => Date }) {
  const now = o.now ?? (() => new Date());

  async function recordFailure(tx: SystemTx, staffId: string, reason: string, meta: RequestMeta) {
    await repo.registerFailure(tx, staffId, MAX_FAILURES, LOCK_MINUTES);
    await repo.audit(tx, { staffId, action: "staff.login.failed", metadata: { reason }, ip: meta.ip, requestId: meta.requestId });
  }

  /**
   * Inserts the new session row inside the caller's transaction and returns the raw refresh token.
   * Callers revoke/verify and insert in that same transaction, so a concurrent reuse detection
   * (which revokes the whole family) can never miss a session that is still being created.
   */
  async function insertNewSession(tx: SystemTx, staffId: string, familyId: string, meta: RequestMeta): Promise<string> {
    const refreshToken = randomToken(32);
    await repo.insertSession(tx, {
      staffId,
      familyId,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(now().getTime() + SESSION_DAYS * 86_400_000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return refreshToken;
  }

  async function toSession(staff: repo.StaffRow, refreshToken: string): Promise<StaffSession> {
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
      // Charge the attempt in one short statement first; hash with no lock or connection held (no pool exhaustion).
      const charged = await o.db.withSystem((tx) => repo.chargeLoginAttempt(tx, input.email, MAX_FAILURES, LOCK_MINUTES));
      if (!charged) {
        // Unknown, disabled or locked: same work and same answer as a wrong password, so nothing is revealed.
        await verifyPassword(await dummyHash(), input.password);
        await o.db.withSystem(async (tx) => {
          const staff = await repo.findStaffByEmail(tx, input.email);
          const reason = !staff ? "unknown_email" : staff.status !== "active" ? "disabled" : "locked";
          await repo.audit(tx, { staffId: staff?.id ?? null, action: "staff.login.failed", metadata: { reason }, ip: meta.ip, requestId: meta.requestId });
        });
        throw invalidCredentials();
      }
      if (!(await verifyPassword(charged.passwordHash, input.password))) {
        await o.db.withSystem((tx) =>
          repo.audit(tx, { staffId: charged.id, action: "staff.login.failed", metadata: { reason: "bad_password" }, ip: meta.ip, requestId: meta.requestId }),
        );
        throw invalidCredentials();
      }
      await o.db.withSystem((tx) => repo.refundLoginAttempt(tx, charged.id, MAX_FAILURES));
      return { challengeToken: await o.tokens.signChallenge(charged.id) };
    },

    async completeTotp(input: { challengeToken: string; code: string }, meta: RequestMeta): Promise<StaffSession> {
      const staffId = await o.tokens.verifyChallenge(input.challengeToken);
      // One row lock covers the lockout check, the code check and claiming its time step, so codes cannot be
      // guessed in parallel past the lockout and a code is accepted at most once (replay), even concurrently.
      const outcome = await o.db.withSystem(async (tx) => {
        const staff = await repo.findStaffByIdForUpdate(tx, staffId);
        if (!staff || staff.status !== "active") return { kind: "invalid" as const };
        if (staff.lockedUntil && staff.lockedUntil > now()) return { kind: "locked" as const };
        const step = await matchTotp(decryptSecret(staff.totpSecretEncrypted, o.encryptionKey), input.code, staff.lastTotpStep);
        if (step === null || !(await repo.claimTotpStep(tx, staff.id, step))) {
          await recordFailure(tx, staff.id, "bad_totp", meta);
          return { kind: "bad_code" as const };
        }
        await repo.recordSuccessfulLogin(tx, staff.id);
        await repo.audit(tx, { staffId: staff.id, action: "staff.login.succeeded", ip: meta.ip, requestId: meta.requestId });
        return { kind: "ok" as const, staff, refreshToken: await insertNewSession(tx, staff.id, randomUUID(), meta) };
      });
      if (outcome.kind === "invalid") throw invalidCredentials();
      if (outcome.kind === "locked") throw tooManyAttempts();
      if (outcome.kind === "bad_code") throw invalidCode();
      return toSession(outcome.staff, outcome.refreshToken);
    },

    /**
     * Out-of-band Super Admin bootstrap (staff spec §2): run only from the owner's command line with database
     * credentials, never reachable from the API. The first Super Admin can be created once; while an active Super Admin
     * exists, another is created only with `recovery` (a lost-access recovery), and every run is audited with the
     * operator and reason.
     */
    async bootstrapSuperAdmin(input: { email: string; name: string; operator: string; reason: string; recovery: boolean }) {
      if (input.operator.trim().length < 2 || input.reason.trim().length < 12) throw new Error("operator (2+ characters) and reason (12+ characters) are required");
      const active = await o.db.withSystem((tx) => repo.countActiveSuperAdmins(tx));
      if (active > 0 && !input.recovery) throw new Error(`${active} active Super Admin(s) already exist; use --recovery only to restore lost access`);
      const acct = await this.createStaffAccount({ email: input.email, name: input.name, role: "super_admin" });
      await o.db.withSystem((tx) =>
        repo.audit(tx, { staffId: null, action: "staff.super_admin.bootstrapped", targetType: "staff", targetId: acct.id, metadata: { operator: input.operator.trim(), reason: input.reason.trim(), recovery: input.recovery, existingActive: active }, ip: null, requestId: null }),
      );
      return acct;
    },

    /** The staff account still exists, is active and still has this role (tokens carry the role they were issued with). */
    /** A live step-up: this staff member's, unexpired, not revoked, and made with a key that is still active. */
    async hasStepUp(staffId: string, stepUpId: string): Promise<boolean> {
      return o.db.withSystem((tx) => repo.liveStepUp(tx, staffId, stepUpId, now()));
    },

    async isActive(staffId: string, role: StaffRole): Promise<boolean> {
      const staff = await o.db.withSystem((tx) => repo.findStaffById(tx, staffId));
      return staff?.status === "active" && staff.role === role;
    },

    async getProfile(staffId: string): Promise<StaffProfile> {
      const staff = await o.db.withSystem((tx) => repo.findStaffById(tx, staffId));
      if (!staff || staff.status !== "active") throw invalidSession();
      return profileOf(staff);
    },

    async refresh(refreshToken: string, meta: RequestMeta): Promise<StaffSession> {
      const hash = sha256Hex(refreshToken);
      // Decide inside the transaction, throw after it commits, so reuse revocation is persisted.
      const outcome = await o.db.withSystem(async (tx) => {
        const session = await repo.findSessionByHashForUpdate(tx, hash);
        if (!session) return { kind: "invalid" as const };
        if (session.revokedAt) {
          await repo.revokeFamily(tx, session.familyId);
          await repo.audit(tx, { staffId: session.staffId, action: "staff.session.reuse_detected", ip: meta.ip, requestId: meta.requestId });
          return { kind: "invalid" as const };
        }
        if (session.expiresAt <= now()) return { kind: "invalid" as const };
        const staff = await repo.findStaffById(tx, session.staffId);
        if (!staff || staff.status !== "active") return { kind: "invalid" as const };
        await repo.revokeSession(tx, session.id);
        const next = await insertNewSession(tx, staff.id, session.familyId, meta);
        return { kind: "ok" as const, staff, refreshToken: next };
      });
      if (outcome.kind === "invalid") throw invalidSession();
      return toSession(outcome.staff, outcome.refreshToken);
    },

    async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
      if (!refreshToken) return;
      await o.db.withSystem(async (tx) => {
        const session = await repo.findSessionByHashForUpdate(tx, sha256Hex(refreshToken));
        if (!session) return;
        await repo.revokeSession(tx, session.id);
        await repo.audit(tx, { staffId: session.staffId, action: "staff.logout", ip: meta.ip, requestId: meta.requestId });
      });
    },

    invalidSession,
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
