import { and, eq, isNull, sql } from "drizzle-orm";
import { auditLog, staffSessions, staffUsers, type SystemTx } from "@mushin/db";

export type StaffRow = typeof staffUsers.$inferSelect;

export async function findStaffByEmail(tx: SystemTx, email: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(sql`lower(${staffUsers.email}) = ${email.toLowerCase()}`).limit(1);
  return rows[0] ?? null;
}

export async function findStaffById(tx: SystemTx, id: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertStaff(
  tx: SystemTx,
  s: { email: string; name: string; passwordHash: string; totpSecretEncrypted: string; role: "admin" | "support" },
): Promise<string> {
  const rows = await tx.insert(staffUsers).values(s).returning({ id: staffUsers.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("insert returned no id");
  return id;
}

/** Counts a failure; a lock that has already expired starts a fresh count instead of re-locking on the next typo. */
export async function registerFailure(tx: SystemTx, id: string, maxFailures: number, lockMinutes: number): Promise<void> {
  await tx.execute(sql`
    update staff.staff_users s set
      failed_login_count = v.count,
      locked_until = case when v.count >= ${maxFailures} then now() + make_interval(mins => ${lockMinutes}) else null end
    from (
      select case when locked_until is not null and locked_until <= now() then 1 else failed_login_count + 1 end as count
      from staff.staff_users where id = ${id}
    ) v
    where s.id = ${id}`);
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
  e: { staffId: string | null; action: string; metadata?: Record<string, unknown>; ip: string | null; requestId: string | null },
): Promise<void> {
  await tx.insert(auditLog).values({ staffId: e.staffId, action: e.action, metadata: e.metadata ?? {}, ip: e.ip, requestId: e.requestId });
}
