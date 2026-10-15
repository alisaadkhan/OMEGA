import { and, eq, isNull, sql } from "drizzle-orm";
import { auditLog, staffSessions, staffUsers, type SystemTx } from "@mushin/db";
import type { StaffRole } from "./tokens";

export type StaffRow = typeof staffUsers.$inferSelect;

export async function findStaffByEmail(tx: SystemTx, email: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(sql`lower(${staffUsers.email}) = ${email.toLowerCase()}`).limit(1);
  return rows[0] ?? null;
}

export async function findStaffById(tx: SystemTx, id: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findStaffByIdForUpdate(tx: SystemTx, id: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(eq(staffUsers.id, id)).for("update").limit(1);
  return rows[0] ?? null;
}

export async function insertStaff(
  tx: SystemTx,
  s: { email: string; name: string; passwordHash: string; totpSecretEncrypted: string; role: StaffRole },
): Promise<string> {
  const rows = await tx.insert(staffUsers).values(s).returning({ id: staffUsers.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("insert returned no id");
  return id;
}

// The failure count after one more failure; a lock that has already expired starts a fresh count
// instead of re-locking on the next typo. SET expressions read the row's pre-update values, and
// Postgres re-evaluates them on the newest row version when concurrent updates race, so no failure is lost.
const nextFailureCount = sql.raw(`case when locked_until is not null and locked_until <= now() then 1 else failed_login_count + 1 end`);

export async function registerFailure(tx: SystemTx, id: string, maxFailures: number, lockMinutes: number): Promise<void> {
  await tx.execute(sql`
    update staff.staff_users set
      failed_login_count = ${nextFailureCount},
      locked_until = case when ${nextFailureCount} >= ${maxFailures} then now() + make_interval(mins => ${lockMinutes}) else null end
    where id = ${id}`);
}

/**
 * Charges a sign-in attempt as a failure before the (slow) password check, in one short statement.
 * Returns the account only when it exists, is active and is not locked. Concurrent attempts each re-check
 * the lock, so a burst cannot exceed the lockout, and no lock or connection is held while hashing.
 */
export async function chargeLoginAttempt(
  tx: SystemTx,
  email: string,
  maxFailures: number,
  lockMinutes: number,
): Promise<{ id: string; passwordHash: string } | null> {
  const rows = await tx.execute<{ id: string; password_hash: string }>(sql`
    update staff.staff_users set
      failed_login_count = ${nextFailureCount},
      locked_until = case when ${nextFailureCount} >= ${maxFailures} then now() + make_interval(mins => ${lockMinutes}) else null end
    where lower(email) = ${email.toLowerCase()} and status = 'active' and (locked_until is null or locked_until <= now())
    returning id, password_hash`);
  const row = rows[0];
  return row ? { id: row.id, passwordHash: row.password_hash } : null;
}

/** Undoes the charge of a sign-in attempt whose password was correct (and lifts a lock that charge caused). */
export async function refundLoginAttempt(tx: SystemTx, id: string, maxFailures: number): Promise<void> {
  await tx.execute(sql`
    update staff.staff_users set
      failed_login_count = greatest(failed_login_count - 1, 0),
      locked_until = case when greatest(failed_login_count - 1, 0) >= ${maxFailures} then locked_until else null end
    where id = ${id}`);
}

/** Atomically records the TOTP step as used; false when that step (or a later one) was already used. */
export async function claimTotpStep(tx: SystemTx, id: string, step: number): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    update staff.staff_users set last_totp_step = ${step}
    where id = ${id} and (last_totp_step is null or last_totp_step < ${step})
    returning id`);
  return rows.length === 1;
}

export async function recordSuccessfulLogin(tx: SystemTx, id: string): Promise<void> {
  await tx.update(staffUsers).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` }).where(eq(staffUsers.id, id));
}

export async function insertSession(
  tx: SystemTx,
  s: { staffId: string; familyId: string; refreshTokenHash: string; expiresAt: Date; ip: string | null; userAgent: string | null },
): Promise<void> {
  await tx.insert(staffSessions).values(s);
}

export async function findSessionByHashForUpdate(tx: SystemTx, hash: string) {
  const rows = await tx.select().from(staffSessions).where(eq(staffSessions.refreshTokenHash, hash)).for("update").limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(tx: SystemTx, id: string): Promise<void> {
  await tx.update(staffSessions).set({ revokedAt: sql`now()` }).where(and(eq(staffSessions.id, id), isNull(staffSessions.revokedAt)));
}

export async function revokeFamily(tx: SystemTx, familyId: string): Promise<void> {
  await tx.update(staffSessions).set({ revokedAt: sql`now()` }).where(and(eq(staffSessions.familyId, familyId), isNull(staffSessions.revokedAt)));
}

export async function audit(
  tx: SystemTx,
  e: { staffId: string | null; action: string; metadata?: Record<string, unknown>; workspaceId?: string | null; targetType?: string; targetId?: string; ip: string | null; requestId: string | null },
): Promise<void> {
  await tx.insert(auditLog).values({ staffId: e.staffId, action: e.action, metadata: e.metadata ?? {}, workspaceId: e.workspaceId ?? null, targetType: e.targetType ?? null, targetId: e.targetId ?? null, ip: e.ip, requestId: e.requestId });
}

export async function countActiveSuperAdmins(tx: SystemTx): Promise<number> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(staffUsers).where(and(eq(staffUsers.role, "super_admin"), eq(staffUsers.status, "active")));
  return Number(rows[0]?.n ?? 0);
}
