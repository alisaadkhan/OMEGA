import type { Db } from "@mushin/db";
import type { AppModule, PreHandler } from "../../http/types";
import { createIdempotency } from "./idempotency";

export function createPlatformModule(o: { db: Db; ttlHours: number }): { module: AppModule; requireIdempotencyKey: PreHandler } {
  const idem = createIdempotency(o.db, o.ttlHours);
  return {
    module: { name: "platform", register: (app) => idem.register(app) },
    requireIdempotencyKey: idem.requireIdempotencyKey,
  };
}
