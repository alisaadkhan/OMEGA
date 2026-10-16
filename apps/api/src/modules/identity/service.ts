import { randomUUID } from "node:crypto";
import type { Db, TenantTx } from "@mushin/db";
import { AppError, type TenantContext } from "@mushin/core";
import type { CustomerIdentity } from "../../auth/customer-token";
import * as repo from "./repository";

export function workspaceNameFor(identity: CustomerIdentity): string {
  const base = identity.fullName ?? identity.email.split("@")[0] ?? "My";
  return `${base}'s workspace`.slice(0, 120);
}

export type StartTrial = (tx: TenantTx, workspaceId: string) => Promise<void>;

export function createIdentityService(db: Db, startTrial: StartTrial) {
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
    const membership = await db.withTenant({ userId: identity.userId, workspaceId }, async (tx) => {
      await repo.lockUser(tx, identity.userId);
      const raced = await repo.findMembership(tx, identity.userId);
      if (raced) return raced;
      await repo.upsertUser(tx, { id: identity.userId, email: identity.email, displayName: identity.fullName });
      await repo.insertWorkspace(tx, { id: workspaceId, name: workspaceNameFor(identity), ownerUserId: identity.userId });
      await repo.insertMember(tx, { workspaceId, userId: identity.userId, role: "owner" });
      // One free trial per person: a workspace provisioned after deleting or leaving an earlier one starts without it.
      if (await repo.claimTrial(tx, identity.userId)) await startTrial(tx, workspaceId);
      return { workspaceId, role: "owner" as const };
    });
    return { requestId, userId: identity.userId, ...membership };
  }

  function getMe(ctx: TenantContext) {
    return db.withTenant(ctx, (tx) => repo.getMe(tx, ctx));
  }

  return { resolveTenant, getMe };
}
