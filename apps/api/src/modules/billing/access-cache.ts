import type { Entitlements, PlanId, SubscriptionStatus } from "@mushin/contracts";
import type { SpendScope } from "./rules";

/** What a workspace may do right now (spec D15: never the spendable balance; no shared cache since audit ARCH-03). */
export type Access = { status: SubscriptionStatus | null; planId: PlanId | null; entitlements: Entitlements; spend: SpendScope };

export interface AccessCache {
  get(workspaceId: string): Promise<Access | null>;
  set(workspaceId: string, access: Access): Promise<void>;
  invalidate(workspaceId: string): Promise<void>;
}

export class MemoryAccessCache implements AccessCache {
  readonly entries = new Map<string, Access>();
  async get(workspaceId: string) {
    return this.entries.get(workspaceId) ?? null;
  }
  async set(workspaceId: string, access: Access) {
    this.entries.set(workspaceId, access);
  }
  async invalidate(workspaceId: string) {
    this.entries.delete(workspaceId);
  }
}

export const noAccessCache: AccessCache = {
  get: async () => null,
  set: async () => undefined,
  invalidate: async () => undefined,
};
