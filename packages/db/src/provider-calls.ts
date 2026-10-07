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
