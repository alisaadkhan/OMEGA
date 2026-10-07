import { eq, sql } from "drizzle-orm";
import type { SystemTx, TenantTx } from "./database";
import { outbox } from "./schema";

export type OutboxEvent = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  workspaceId: string | null;
  payload: Record<string, unknown>;
  requestId: string | null;
};
export type OutboxRow = OutboxEvent & { id: string; attempts: number };

export async function writeOutbox(tx: TenantTx | SystemTx, e: OutboxEvent): Promise<string> {
  const rows = await tx.insert(outbox).values(e).returning({ id: outbox.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("outbox insert returned no id");
  return id;
}

export async function claimUnpublished(tx: SystemTx, limit: number): Promise<OutboxRow[]> {
  return tx
    .select({
      id: outbox.id,
      eventType: outbox.eventType,
      aggregateType: outbox.aggregateType,
      aggregateId: outbox.aggregateId,
      workspaceId: outbox.workspaceId,
      payload: outbox.payload,
      requestId: outbox.requestId,
      attempts: outbox.attempts,
    })
    .from(outbox)
    .where(sql`${outbox.publishedAt} is null and ${outbox.attempts} < 10`)
    .orderBy(outbox.createdAt)
    .limit(limit)
    .for("update", { skipLocked: true });
}

export async function markPublished(tx: SystemTx, id: string): Promise<void> {
  await tx.update(outbox).set({ publishedAt: sql`now()` }).where(eq(outbox.id, id));
}

export async function markFailed(tx: SystemTx, id: string, error: string): Promise<void> {
  await tx
    .update(outbox)
    .set({ attempts: sql`${outbox.attempts} + 1`, lastError: error.slice(0, 1000) })
    .where(eq(outbox.id, id));
}
