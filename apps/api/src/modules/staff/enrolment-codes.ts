import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sha256Hex } from "@mushin/core";
import { enrolmentCodes, type SystemTx } from "@mushin/db";
import { audit } from "./repository";

/**
 * One-time codes for a staff member's first security key (audit SEC-07). Issued only out of band: printed by the
 * account-creation CLI or by issue-enrolment-code.ts to the operator, who hands it over in person or by another channel.
 * The app never sends or shows one. 100 random bits, written as five groups of four (Crockford base32).
 */
export const ENROLMENT_CODE_TTL_HOURS = 72;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Upper-cases and removes separators, so "abcd-efgh …" and "ABCDEFGH…" are the same code. */
export const normaliseEnrolmentCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "");

function newCode(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join(""); // 256 is a multiple of 32: uniform
  return chars.match(/.{4}/g)?.join("-") ?? chars;
}

/** Issues a new code (any earlier unused code of this staff member is revoked) and returns it once. */
export async function issueEnrolmentCode(tx: SystemTx, staffId: string, o: { issuedBy: string; reason: string; now: Date }): Promise<{ code: string; expiresAt: Date }> {
  const code = newCode();
  const expiresAt = new Date(o.now.getTime() + ENROLMENT_CODE_TTL_HOURS * 3_600_000);
  await tx.update(enrolmentCodes).set({ revokedAt: o.now }).where(and(eq(enrolmentCodes.staffId, staffId), isNull(enrolmentCodes.usedAt), isNull(enrolmentCodes.revokedAt)));
  await tx.insert(enrolmentCodes).values({ staffId, codeHash: sha256Hex(normaliseEnrolmentCode(code)), issuedBy: o.issuedBy, reason: o.reason, expiresAt });
  await audit(tx, { staffId: null, action: "staff.webauthn.enrolment_code_issued", targetType: "staff", targetId: staffId, metadata: { issuedBy: o.issuedBy, reason: o.reason, expiresAt: expiresAt.toISOString() }, ip: null, requestId: null });
  return { code, expiresAt };
}

/** The open code matching `code` for this staff member, locked for the enrolment transaction; null when none. */
export async function openEnrolmentCode(tx: SystemTx, staffId: string, code: string, now: Date): Promise<{ id: string } | null> {
  const [row] = await tx
    .select({ id: enrolmentCodes.id })
    .from(enrolmentCodes)
    .where(
      and(
        eq(enrolmentCodes.staffId, staffId),
        eq(enrolmentCodes.codeHash, sha256Hex(normaliseEnrolmentCode(code))),
        isNull(enrolmentCodes.usedAt),
        isNull(enrolmentCodes.revokedAt),
        gt(enrolmentCodes.expiresAt, now),
      ),
    )
    .for("update");
  return row ?? null;
}

export async function useEnrolmentCode(tx: SystemTx, id: string, now: Date): Promise<void> {
  await tx.update(enrolmentCodes).set({ usedAt: now }).where(eq(enrolmentCodes.id, id));
}
