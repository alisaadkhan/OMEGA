import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AppError } from "@mushin/core";
import { recordAlertEvent, stepUps, webauthnChallenges, webauthnCredentials, staffUsers, type Db, type SystemTx } from "@mushin/db";
import { openEnrolmentCode, useEnrolmentCode } from "./enrolment-codes";
import { audit } from "./repository";
import type { StaffPrincipal } from "./tokens";

/**
 * A step-up proves the hardware key for five minutes (mandate v3 §3.2 SEC-02; the database allows at most 15). The access
 * token issued with it lives longer, but its hardware-key factor counts only while this server-side row is live.
 */
export const STEP_UP_TTL_MS = 5 * 60_000;

const CHALLENGE_TTL_MS = 5 * 60_000;
const b64url = {
  encode: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
  decode: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};

export type WebAuthnConfig = { rpId: string; rpName: string; origins: string[] };
type Meta = { ip: string | null; requestId: string | null };

/**
 * WebAuthn hardware keys for Admin and Super Admin staff (master pack DOC-029: hardware key mandatory for Admin, TOTP
 * only as backup). A key is enrolled from a signed-in session; a step-up assertion then proves possession of the key for
 * this session. Challenges are single use and expire after five minutes; a user-verifying key is required; a key whose
 * signature counter goes backwards is refused (possible clone). The identity it is tied to is the staff id, which maps
 * to the Supabase Auth user when staff identity moves there.
 */
export function createWebAuthn(deps: { db: Db; config: WebAuthnConfig; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  const activeKeys = (tx: SystemTx, staffId: string) =>
    tx.select().from(webauthnCredentials).where(and(eq(webauthnCredentials.staffId, staffId), isNull(webauthnCredentials.revokedAt)));

  async function newChallenge(tx: SystemTx, staffId: string, kind: "registration" | "authentication", challenge: string) {
    await tx.insert(webauthnChallenges).values({ staffId, kind, challenge, expiresAt: new Date(now().getTime() + CHALLENGE_TTL_MS) });
  }

  /** Marks the newest unused, unexpired challenge of this kind as used and returns it; a challenge works once. */
  async function takeChallenge(tx: SystemTx, staffId: string, kind: "registration" | "authentication"): Promise<string> {
    const [c] = await tx
      .select()
      .from(webauthnChallenges)
      .where(and(eq(webauthnChallenges.staffId, staffId), eq(webauthnChallenges.kind, kind), isNull(webauthnChallenges.usedAt), gt(webauthnChallenges.expiresAt, now())))
      .orderBy(desc(webauthnChallenges.createdAt))
      .limit(1)
      .for("update");
    if (!c) throw new AppError("UNAUTHENTICATED", "The security key request expired. Please try again.", { reason: "webauthn_challenge" });
    await tx.update(webauthnChallenges).set({ usedAt: now() }).where(eq(webauthnChallenges.id, c.id));
    return c.challenge;
  }

  async function staffRow(tx: SystemTx, staffId: string) {
    const [s] = await tx.select({ email: staffUsers.email, name: staffUsers.name, status: staffUsers.status }).from(staffUsers).where(eq(staffUsers.id, staffId));
    if (!s || s.status !== "active") throw new AppError("UNAUTHENTICATED", "Your staff account is not active");
    return s;
  }

  return {
    async keys(staffId: string) {
      const rows = await deps.db.withSystem((tx) => activeKeys(tx, staffId));
      return rows.map((k) => ({ id: k.id, nickname: k.nickname, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null }));
    },

    /**
     * Enrolment options. The first key is enrolled from a TOTP session with a one-time enrolment code issued out of band
     * (audit SEC-07, checked in `register`); every further key needs a session that already proved a key. A stolen
     * password + TOTP therefore cannot add an attacker's key, whether or not the account has one.
     */
    async registrationOptions(p: StaffPrincipal) {
      return deps.db.withSystem(async (tx) => {
        const s = await staffRow(tx, p.staffId);
        const existing = await activeKeys(tx, p.staffId);
        if (existing.length > 0 && !p.factors.includes("hwk")) {
          throw new AppError("FORBIDDEN", "Use one of your security keys first to add another.", { reason: "hardware_key_required" });
        }
        const options = await generateRegistrationOptions({
          rpName: deps.config.rpName,
          rpID: deps.config.rpId,
          userID: new TextEncoder().encode(p.staffId),
          userName: s.email,
          userDisplayName: s.name,
          attestationType: "none",
          excludeCredentials: existing.map((k) => ({ id: k.credentialId, transports: k.transports as AuthenticatorTransport[] })),
          authenticatorSelection: { residentKey: "discouraged", userVerification: "required" },
        });
        await newChallenge(tx, p.staffId, "registration", options.challenge);
        return options;
      });
    },

    async register(p: StaffPrincipal, response: RegistrationResponseJSON, nickname: string, meta: Meta, enrolmentCode?: string) {
      // The challenge is consumed in its own transaction, so a failed attempt cannot be retried with it.
      const { expectedChallenge, firstKey } = await deps.db.withSystem(async (tx) => {
        await staffRow(tx, p.staffId);
        const hasKeys = (await activeKeys(tx, p.staffId)).length > 0;
        if (hasKeys && !p.factors.includes("hwk")) throw new AppError("FORBIDDEN", "Use one of your security keys first to add another.", { reason: "hardware_key_required" });
        if (!hasKeys && !(enrolmentCode && (await openEnrolmentCode(tx, p.staffId, enrolmentCode, now())))) {
          await audit(tx, { staffId: p.staffId, action: "staff.webauthn.failed", metadata: { ceremony: "registration", reason: enrolmentCode ? "enrolment_code_invalid" : "enrolment_code_missing" }, ip: meta.ip, requestId: meta.requestId });
          return { expectedChallenge: null, firstKey: true };
        }
        return { expectedChallenge: await takeChallenge(tx, p.staffId, "registration"), firstKey: !hasKeys };
      });
      // Thrown after the transaction so the failed attempt stays in the audit log.
      if (expectedChallenge === null) {
        throw new AppError("FORBIDDEN", "Enter the one-time enrolment code you were given with your account. Ask a Super Admin for a new one if it expired.", { reason: "enrolment_code_required" });
      }
      let v: Awaited<ReturnType<typeof verifyRegistrationResponse>> | null;
      try {
        v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: deps.config.origins, expectedRPID: deps.config.rpId, requireUserVerification: true });
      } catch {
        v = null;
      }
      if (!v?.verified || !v.registrationInfo) {
        await deps.db.withSystem((tx) => audit(tx, { staffId: p.staffId, action: "staff.webauthn.failed", metadata: { ceremony: "registration" }, ip: meta.ip, requestId: meta.requestId }));
        throw new AppError("VALIDATION_FAILED", "The security key response could not be verified.", { reason: "webauthn_invalid" });
      }
      const info = v.registrationInfo;
      return deps.db.withSystem(async (tx) => {
        // The code is spent with the key, in one transaction: a code enrols exactly one first key.
        if (firstKey) {
          const code = enrolmentCode ? await openEnrolmentCode(tx, p.staffId, enrolmentCode, now()) : null;
          if (!code || (await activeKeys(tx, p.staffId)).length > 0) throw new AppError("FORBIDDEN", "The enrolment code was already used.", { reason: "enrolment_code_required" });
          await useEnrolmentCode(tx, code.id, now());
        }
        const c = info.credential;
        const [row] = await tx
          .insert(webauthnCredentials)
          .values({ staffId: p.staffId, credentialId: c.id, publicKey: b64url.encode(c.publicKey), signCount: c.counter, transports: c.transports ?? [], aaguid: info.aaguid, nickname: nickname.trim().slice(0, 60) || "Security key" })
          .returning({ id: webauthnCredentials.id });
        await audit(tx, { staffId: p.staffId, action: "staff.webauthn.registered", metadata: { credentialRef: row?.id, nickname, firstKey }, ip: meta.ip, requestId: meta.requestId });
        // Every enrolment reaches the operations channel (audit SEC-07); who and which key stay in the audit log.
        await recordAlertEvent(tx, { key: "staff_key_enrolled", severity: "warning", message: `A staff security key was enrolled (${firstKey ? "first key, with an enrolment code" : "additional key"}). Check the staff audit log (staff.webauthn.registered).` });
        return { id: row?.id ?? "" };
      });
    },

    async authenticationOptions(staffId: string) {
      return deps.db.withSystem(async (tx) => {
        await staffRow(tx, staffId);
        const keys = await activeKeys(tx, staffId);
        if (keys.length === 0) throw new AppError("CONFLICT", "Register a security key first.", { reason: "no_hardware_key" });
        const options = await generateAuthenticationOptions({
          rpID: deps.config.rpId,
          allowCredentials: keys.map((k) => ({ id: k.credentialId, transports: k.transports as AuthenticatorTransport[] })),
          userVerification: "required",
        });
        await newChallenge(tx, staffId, "authentication", options.challenge);
        return options;
      });
    },

    /** Verifies a step-up assertion for this staff member; success means the session may carry the "hwk" factor. */
    async authenticate(staffId: string, response: AuthenticationResponseJSON, meta: Meta): Promise<{ credentialRef: string; stepUpId: string }> {
      const { expectedChallenge, key } = await deps.db.withSystem(async (tx) => {
        await staffRow(tx, staffId);
        const challenge = await takeChallenge(tx, staffId, "authentication");
        const [k] = await tx
          .select()
          .from(webauthnCredentials)
          .where(and(eq(webauthnCredentials.staffId, staffId), eq(webauthnCredentials.credentialId, response.id), isNull(webauthnCredentials.revokedAt)));
        return { expectedChallenge: challenge, key: k };
      });
      const refuse = async (why: string) => {
        await deps.db.withSystem((tx) => audit(tx, { staffId, action: "staff.webauthn.failed", metadata: { ceremony: "authentication", reason: why }, ip: meta.ip, requestId: meta.requestId }));
        return new AppError("UNAUTHENTICATED", "The security key could not be verified.", { reason: "webauthn_invalid" });
      };
      if (!key) throw await refuse("unknown_key");
      let v: Awaited<ReturnType<typeof verifyAuthenticationResponse>> | null;
      try {
        v = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: deps.config.origins,
          expectedRPID: deps.config.rpId,
          requireUserVerification: true,
          credential: { id: key.credentialId, publicKey: b64url.decode(key.publicKey), counter: key.signCount, transports: key.transports as AuthenticatorTransport[] },
        });
      } catch {
        v = null;
      }
      if (!v?.verified) throw await refuse("signature_or_counter");
      const newCounter = v.authenticationInfo.newCounter;
      return deps.db.withSystem(async (tx) => {
        // Compare-and-set on the counter: two assertions racing with the same counter cannot both succeed.
        const updated = await tx
          .update(webauthnCredentials)
          .set({ signCount: newCounter, lastUsedAt: now() })
          .where(and(eq(webauthnCredentials.id, key.id), eq(webauthnCredentials.signCount, key.signCount), isNull(webauthnCredentials.revokedAt)))
          .returning({ id: webauthnCredentials.id });
        if (updated.length === 0) throw new AppError("UNAUTHENTICATED", "The security key could not be verified.", { reason: "webauthn_invalid" });
        // The server-side proof that this session used its key (audit SEC-02); it expires with the access token.
        const at = now();
        const [step] = await tx.insert(stepUps).values({ staffId, credentialId: key.id, createdAt: at, expiresAt: new Date(at.getTime() + STEP_UP_TTL_MS) }).returning({ id: stepUps.id });
        if (!step) throw new Error("step-up insert returned no row");
        await audit(tx, { staffId, action: "staff.webauthn.step_up", metadata: { credentialRef: key.id, stepUpId: step.id }, ip: meta.ip, requestId: meta.requestId });
        return { credentialRef: key.id, stepUpId: step.id };
      });
    },

    /** Revoking a key needs a key-proven session; the last key cannot be revoked by its owner (lock-out protection). */
    async revoke(p: StaffPrincipal, keyId: string, meta: Meta) {
      if (!p.factors.includes("hwk")) throw new AppError("FORBIDDEN", "Use a security key first.", { reason: "hardware_key_required" });
      return deps.db.withSystem(async (tx) => {
        const keys = await activeKeys(tx, p.staffId);
        if (!keys.some((k) => k.id === keyId)) throw new AppError("NOT_FOUND", "Security key not found");
        if (keys.length === 1) throw new AppError("CONFLICT", "Add another security key before removing your last one.", { reason: "last_key" });
        await tx.update(webauthnCredentials).set({ revokedAt: now() }).where(eq(webauthnCredentials.id, keyId));
        await audit(tx, { staffId: p.staffId, action: "staff.webauthn.revoked", metadata: { credentialRef: keyId }, ip: meta.ip, requestId: meta.requestId });
      });
    },

    /** Removes expired challenges (housekeeping; used ones are kept only until they expire). */
    purgeChallenges: () => deps.db.withSystem((tx) => tx.execute(sql`delete from staff.webauthn_challenges where expires_at < now() - interval '1 day'`)),
  };
}

export type WebAuthn = ReturnType<typeof createWebAuthn>;
