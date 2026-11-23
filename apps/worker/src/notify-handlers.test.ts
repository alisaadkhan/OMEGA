import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createDispatcher, type JobData } from "./dispatcher";
import { NOTIFY_EVENTS, notifyHandlers } from "./notify-handlers";

const logger = createLogger({ level: "silent", name: "t" });
const job = (eventType: string): JobData => ({ eventId: `ev-${eventType}`, eventType, aggregateType: "workspace", aggregateId: "w", workspaceId: "w", payload: {}, requestId: null });

describe("notification events (0100)", () => {
  it("nudge the one notification sender for every customer event", async () => {
    let drained = 0;
    const dispatch = createDispatcher(notifyHandlers({ drain: async () => ((drained += 1), { sent: 1, failed: 0 }) }), logger);
    for (const t of NOTIFY_EVENTS) await dispatch([{ id: t, data: job(t) }]);
    expect(drained).toBe(NOTIFY_EVENTS.length);
  });
});
