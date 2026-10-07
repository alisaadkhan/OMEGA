import { and, eq, sql } from "drizzle-orm";
import { idempotencyKeys, type SystemTx } from "@mushin/db";

export type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "mismatch" }
  | { kind: "in_progress" }
  | { kind: "replay"; status: number; body: unknown };

export async function claimKey(
  tx: SystemTx,
  k: { workspaceId: string; key: string; hash: string; ttlHours: number },
): Promise<ClaimOutcome> {
  const inserted = await tx.execute<{ key: string }>(sql`
    insert into platform.idempotency_keys (workspace_id, key, request_hash, expires_at)
    values (${k.workspaceId}, ${k.key}, ${k.hash}, now() + make_interval(hours => ${k.ttlHours}))
    on conflict (workspace_id, key) do update
      set request_hash = excluded.request_hash, response_status = null, response_body = null,
          expires_at = excluded.expires_at, created_at = now()
      where platform.idempotency_keys.expires_at < now()
    returning key`);
  if (inserted.length > 0) return { kind: "claimed" };

  const rows = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, k.workspaceId), eq(idempotencyKeys.key, k.key)))
    .limit(1);
  const row = rows[0];
  if (!row || row.requestHash !== k.hash) return { kind: "mismatch" };
  if (row.responseStatus === null) return { kind: "in_progress" };
  return { kind: "replay", status: row.responseStatus, body: row.responseBody };
}

export async function storeResponse(tx: SystemTx, k: { workspaceId: string; key: string; status: number; body: unknown }): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus: k.status, responseBody: k.body })
    .where(and(eq(idempotencyKeys.workspaceId, k.workspaceId), eq(idempotencyKeys.key, k.key)));
}

export async function releaseKey(tx: SystemTx, k: { workspaceId: string; key: string }): Promise<void> {
  await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.workspaceId, k.workspaceId), eq(idempotencyKeys.key, k.key)));
}
