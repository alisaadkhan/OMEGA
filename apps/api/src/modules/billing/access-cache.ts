import type { Entitlements, PlanId, SubscriptionStatus } from "@mushin/contracts";
import type { Logger } from "@mushin/core";
import type { SpendScope } from "./rules";

/** What a workspace may do right now (spec D15: cached in Redis, never the spendable balance). */
export type Access = { status: SubscriptionStatus | null; planId: PlanId | null; entitlements: Entitlements; spend: SpendScope };

export interface AccessCache {
  get(workspaceId: string): Promise<Access | null>;
  set(workspaceId: string, access: Access): Promise<void>;
  invalidate(workspaceId: string): Promise<void>;
}

/** The subset of @upstash/redis used here. */
export type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export const ACCESS_TTL_SECONDS = 60;
const keyFor = (workspaceId: string) => `mushin:access:${workspaceId}`;

/** Fails open: if Redis is down, callers read the database and nothing breaks. */
export function createRedisAccessCache(redis: RedisLike, logger: Logger, ttlSeconds = ACCESS_TTL_SECONDS): AccessCache {
  return {
    async get(workspaceId) {
      try {
        return await redis.get<Access>(keyFor(workspaceId));
      } catch (err) {
        logger.warn({ err }, "access cache unavailable; reading the database");
        return null;
      }
    },
    async set(workspaceId, access) {
      try {
        await redis.set(keyFor(workspaceId), access, { ex: ttlSeconds });
      } catch (err) {
        logger.warn({ err }, "could not write the access cache");
      }
    },
    async invalidate(workspaceId) {
      try {
        await redis.del(keyFor(workspaceId));
      } catch (err) {
        logger.warn({ err, workspaceId }, `could not invalidate the access cache; the entry expires within ${ttlSeconds} s`);
      }
    },
  };
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
