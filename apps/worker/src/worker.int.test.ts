import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { writeOutbox } from "@mushin/db";
import { createTestDatabase, ownerQuery, resetTables, testCaPem, testDatabaseUrl } from "@mushin/db/testing";
import { startBoss } from "./boss";
import type { JobData } from "./dispatcher";
import { createOutboxRelay } from "./relay";
import { startWorker } from "./worker";

const logger = createLogger({ level: "silent" });
const db = createTestDatabase();
let boss: PgBoss;

beforeAll(async () => {
  boss = await startBoss(testDatabaseUrl(), logger, testCaPem());
});
beforeEach(resetTables);
afterAll(async () => {
  await boss.stop({ graceful: false, close: true });
  await db.close();
});

const ping = (requestId: string) => ({
  eventType: "system.ping",
  aggregateType: "test",
  aggregateId: randomUUID(),
  workspaceId: null,
  payload: { n: 1 },
  requestId,
});

async function waitFor(check: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("outbox relay", () => {
  it("publishes each event once, using the event id as the job id", async () => {
    const published: { queue: string; id: string }[] = [];
    const relay = createOutboxRelay({
      db,
      logger,
      publish: async (queue, _data, id) => {
        published.push({ queue, id });
      },
    });
    const id = await db.withSystem((tx) => writeOutbox(tx, ping("r1")));
    expect(await relay.drainOnce()).toBe(1);
    expect(await relay.drainOnce()).toBe(0);
    expect(published).toEqual([{ queue: "system", id }]);
    const rows = await ownerQuery<{ published: boolean }>(`select published_at is not null as published from platform.outbox`);
    expect(rows[0]?.published).toBe(true);
  });

  it("records a routing failure instead of publishing", async () => {
    const relay = createOutboxRelay({ db, logger, publish: async () => {} });
    await db.withSystem((tx) => writeOutbox(tx, { ...ping("r2"), eventType: "mystery.event" }));
    await relay.drainOnce();
    const rows = await ownerQuery<{ attempts: number; published: boolean }>(
      `select attempts, published_at is not null as published from platform.outbox`,
    );
    expect(rows[0]).toEqual({ attempts: 1, published: false });
  });
});

describe("worker end to end", () => {
  it("delivers an outbox event to its handler with the request id", async () => {
    const handled: JobData[] = [];
    const worker = await startWorker({
      db,
      boss,
      logger,
      handlers: { "system.ping": async (data) => void handled.push(data) },
    });
    try {
      const eventId = await db.withSystem((tx) => writeOutbox(tx, ping("req-e2e")));
      await waitFor(() => handled.length === 1);
      expect(handled[0]).toMatchObject({ eventId, eventType: "system.ping", requestId: "req-e2e", payload: { n: 1 } });
    } finally {
      await worker.stop();
    }
  });
});
