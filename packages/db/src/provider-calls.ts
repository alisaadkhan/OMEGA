import { and, eq, gte, sql } from "drizzle-orm";
import type { ProviderCallSink } from "@mushin/core";
import type { Db } from "./database";
import { providerCalls } from "./schema";

export function createDbProviderCallSink(db: Db): ProviderCallSink {
  return {
    async record(call) {
      await db.withSystem((tx) =>
        tx.insert(providerCalls).values({
          ...call,
          units: call.units === null ? null : String(call.units),
          costUsd: String(call.costUsd),
        }),
      );
    },
  };
}

/** Recorded spend for one provider since a moment (the Apify monthly spend cap, spec §4). Worker role only. */
export async function providerSpendSince(db: Db, provider: string, since: Date): Promise<number> {
  const rows = await db.withSystem((tx) =>
    tx
      .select({ total: sql<string>`coalesce(sum(${providerCalls.costUsd}), 0)` })
      .from(providerCalls)
      .where(and(eq(providerCalls.provider, provider), gte(providerCalls.createdAt, since))),
  );
  return Number(rows[0]?.total ?? 0);
}

/** Successful calls to one provider since a moment (the Serper monthly search limit, spec §4.4). Worker role only. */
export async function providerCallsSince(db: Db, provider: string, since: Date): Promise<number> {
  const rows = await db.withSystem((tx) =>
    tx
      .select({ n: sql<string>`count(*)` })
      .from(providerCalls)
      .where(and(eq(providerCalls.provider, provider), eq(providerCalls.status, "ok"), gte(providerCalls.createdAt, since))),
  );
  return Number(rows[0]?.n ?? 0);
}
