import { asc, eq, sql } from "drizzle-orm";
import { users, workspaceMembers, workspaces, type TenantTx, type UserTx } from "@mushin/db";
import type { WorkspaceRole } from "@mushin/core";

export type Membership = { workspaceId: string; role: WorkspaceRole };

/**
 * The requested workspace if the user is a member of it, or null; without a request, their oldest membership (deleted
 * workspaces have none). Never another workspace than the one requested (audit SEC-04).
 */
export async function findMembership(tx: UserTx | TenantTx, userId: string, requested?: string): Promise<Membership | null> {
  const rows = await tx
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt));
  return requested === undefined ? (rows[0] ?? null) : (rows.find((r) => r.workspaceId === requested) ?? null);
}

export async function userStatus(tx: UserTx, userId: string): Promise<string | null> {
  const [r] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
  return r?.status ?? null;
}

/** Serializes provisioning per user inside the current transaction. */
export async function lockUser(tx: TenantTx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
}

export async function upsertUser(tx: TenantTx, u: { id: string; email: string; displayName: string | null }): Promise<void> {
  await tx
    .insert(users)
    .values({ id: u.id, email: u.email, displayName: u.displayName })
    .onConflictDoUpdate({ target: users.id, set: { email: u.email } });
}

/** Marks the person's one free trial as used; false when it already was (they get no second trial). */
export async function claimTrial(tx: TenantTx, userId: string): Promise<boolean> {
  const rows = await tx
    .update(users)
    .set({ trialGrantedAt: sql`now()` })
    .where(sql`${users.id} = ${userId} and ${users.trialGrantedAt} is null`)
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function insertWorkspace(tx: TenantTx, w: { id: string; name: string; ownerUserId: string }): Promise<void> {
  await tx.insert(workspaces).values(w);
}

export async function insertMember(tx: TenantTx, m: { workspaceId: string; userId: string; role: WorkspaceRole }): Promise<void> {
  await tx.insert(workspaceMembers).values(m);
}

export async function getMe(tx: TenantTx, ids: { userId: string; workspaceId: string }) {
  const rows = await tx
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      legalVersion: users.legalVersion,
      legalAcceptedAt: users.legalAcceptedAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(sql`${workspaceMembers.userId} = ${ids.userId} and ${workspaceMembers.workspaceId} = ${ids.workspaceId}`)
    .limit(1);
  return rows[0] ?? null;
}
