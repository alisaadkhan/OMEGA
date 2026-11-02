import { randomUUID } from "node:crypto";
import type { Db, TenantTx } from "@mushin/db";
import { AppError, type TenantContext } from "@mushin/core";
import type { VerifyEmail } from "../../auth/auth-admin";
import type { CustomerIdentity } from "../../auth/customer-token";
import * as repo from "./repository";

export function workspaceNameFor(identity: CustomerIdentity): string {
  const base = identity.fullName ?? identity.email.split("@")[0] ?? "My";
  return `${base}'s workspace`.slice(0, 120);
}

export type StartTrial = (tx: TenantTx, workspaceId: string) => Promise<void>;
/** Grants the current month of testing credits and schedules the next (0061). */
export type StartTestingAllowance = (tx: TenantTx, workspaceId: string) => Promise<unknown>;

/**
 * `autoTrial` starts the free trial when a person's first own workspace is provisioned (TRIAL_ACTIVATION=automatic).
 * With null (the default setting, "approval", 0050) a new workspace has no trial until MUSHIN staff approve one.
 */
export function createIdentityService(db: Db, autoTrial: StartTrial | null, testingAllowance: StartTestingAllowance | null = null, verifyEmail: VerifyEmail | null = null) {
  /**
   * The monthly testing allowance is granted only to a verified email (owner decision 2026-10-28), read from the Auth
   * server's own record, never from the token. Without the check, or when it fails, nothing is granted (a later visit
   * retries).
   */
  async function emailVerified(userId: string): Promise<boolean> {
    if (!verifyEmail) return false;
    try {
      return (await verifyEmail(userId))?.confirmed === true;
    } catch {
      return false;
    }
  }
  async function resolveTenant(identity: CustomerIdentity, requestId: string, requested?: string): Promise<TenantContext> {
    const { existing, status } = await db.withUser(identity.userId, async (tx) => ({ existing: await repo.findMembership(tx, identity.userId, requested), status: await repo.userStatus(tx, identity.userId) }));
    // A deleted account stays deleted: signing in again does not bring it (or a fresh workspace) back.
    if (status === "deleted") throw new AppError("FORBIDDEN", "This account was deleted.", { reason: "account_deleted" });
    if (existing) return { requestId, userId: identity.userId, ...existing };
    // A workspace was asked for and this person is not (or no longer) a member: refuse, never switch silently to
    // another workspace (audit SEC-04). The client drops its stale selection and asks again without one.
    if (requested !== undefined) {
      throw new AppError("FORBIDDEN", "You don't have access to that workspace (any more). Choose another workspace.", { reason: "workspace_access_denied", workspaceId: requested });
    }

    const workspaceId = randomUUID();
    // Checked before the transaction, so no lock is held during the call to the Auth server.
    const verified = testingAllowance ? await emailVerified(identity.userId) : false;
    const membership = await db.withTenant({ userId: identity.userId, workspaceId }, async (tx) => {
      await repo.lockUser(tx, identity.userId);
      const raced = await repo.findMembership(tx, identity.userId);
      if (raced) return raced;
      await repo.upsertUser(tx, { id: identity.userId, email: identity.email, displayName: identity.fullName });
      await repo.insertWorkspace(tx, { id: workspaceId, name: workspaceNameFor(identity), ownerUserId: identity.userId });
      await repo.insertMember(tx, { workspaceId, userId: identity.userId, role: "owner" });
      // One free trial per person: a workspace provisioned after deleting or leaving an earlier one starts without it.
      if (autoTrial && (await repo.claimTrial(tx, identity.userId))) await autoTrial(tx, workspaceId);
      // One monthly testing allowance per person (0061), on the workspace provisioned for them; invited members and
      // workspaces created later never get another. Same transaction: a failed provisioning grants nothing.
      if (testingAllowance && verified && (await repo.claimTestingAllowance(tx, identity.userId, workspaceId))) await testingAllowance(tx, workspaceId);
      return { workspaceId, role: "owner" as const };
    });
    return { requestId, userId: identity.userId, ...membership };
  }

  async function getMe(ctx: TenantContext) {
    // A person who verifies their email after the first workspace was provisioned gets the allowance on their next visit.
    // The claim is one conditional update under the person's lock, so retries and concurrent visits grant it once.
    if (testingAllowance && (await db.withTenant(ctx, (tx) => repo.allowancePending(tx, ctx.userId, ctx.workspaceId))) && (await emailVerified(ctx.userId))) {
      await db.withTenant(ctx, async (tx) => {
        await repo.lockUser(tx, ctx.userId);
        if ((await repo.allowancePending(tx, ctx.userId, ctx.workspaceId)) && (await repo.claimTestingAllowance(tx, ctx.userId, ctx.workspaceId))) await testingAllowance(tx, ctx.workspaceId);
      });
    }
    return db.withTenant(ctx, (tx) => repo.getMe(tx, ctx));
  }

  return { resolveTenant, getMe };
}
