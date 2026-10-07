import { randomUUID } from "node:crypto";
import type { Db } from "@mushin/db";
import type { TenantContext } from "@mushin/core";
import type { CustomerIdentity } from "../../auth/customer-token";
import * as repo from "./repository";

export function workspaceNameFor(identity: CustomerIdentity): string {
  const base = identity.fullName ?? identity.email.split("@")[0] ?? "My";
  return `${base}'s workspace`.slice(0, 120);
}

export function createIdentityService(db: Db) {
  async function resolveTenant(identity: CustomerIdentity, requestId: string): Promise<TenantContext> {
    const existing = await db.withUser(identity.userId, (tx) => repo.findMembership(tx, identity.userId));
    if (existing) return { requestId, userId: identity.userId, ...existing };

    const workspaceId = randomUUID();
    const membership = await db.withTenant({ userId: identity.userId, workspaceId }, async (tx) => {
      await repo.lockUser(tx, identity.userId);
      const raced = await repo.findMembership(tx, identity.userId);
      if (raced) return raced;
      await repo.upsertUser(tx, { id: identity.userId, email: identity.email, displayName: identity.fullName });
      await repo.insertWorkspace(tx, { id: workspaceId, name: workspaceNameFor(identity), ownerUserId: identity.userId });
      await repo.insertMember(tx, { workspaceId, userId: identity.userId, role: "owner" });
      return { workspaceId, role: "owner" as const };
    });
    return { requestId, userId: identity.userId, ...membership };
  }

  function getMe(ctx: TenantContext) {
    return db.withTenant(ctx, (tx) => repo.getMe(tx, ctx));
  }

  return { resolveTenant, getMe };
}
