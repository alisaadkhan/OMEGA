import type { Logger } from "@mushin/core";

export type JobData = {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  workspaceId: string | null;
  requestId: string | null;
  payload: Record<string, unknown>;
};

export type Handler = (data: JobData, ctx: { logger: Logger; jobId: string }) => Promise<void>;
export type HandlerRegistry = Record<string, Handler>;

export function createDispatcher(handlers: HandlerRegistry, logger: Logger) {
  return async (jobs: { id: string; data: JobData }[]): Promise<void> => {
    for (const job of jobs) {
      const handler = handlers[job.data.eventType];
      if (!handler) throw new Error(`No handler for event type "${job.data.eventType}"`);
      const child = logger.child({ requestId: job.data.requestId, eventId: job.data.eventId, eventType: job.data.eventType, jobId: job.id });
      await handler(job.data, { logger: child, jobId: job.id });
    }
  };
}
