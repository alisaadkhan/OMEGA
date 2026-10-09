import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { DiscoveryJob, DiscoveryJobStep } from "@mushin/contracts";
import { discoveryJobs, type TenantTx } from "@mushin/db";

export type JobRow = typeof discoveryJobs.$inferSelect;
const OPEN = ["queued", "running"] as const;

export function toApiJob(r: JobRow): DiscoveryJob {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    step: r.step,
    outcome: r.outcome,
    creatorId: r.creatorId,
    platform: r.platform,
    handle: r.handle,
    error: r.errorCode ? { code: r.errorCode, message: r.errorMessage ?? "Something went wrong." } : null,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

export async function insertJob(tx: TenantTx, row: typeof discoveryJobs.$inferInsert): Promise<JobRow> {
  const [r] = await tx.insert(discoveryJobs).values(row).returning();
  if (!r) throw new Error("job insert returned no row");
  return r;
}

export async function getJob(tx: TenantTx, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await tx.select().from(discoveryJobs).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function openJobFor(tx: TenantTx, workspaceId: string, canonicalUrl: string): Promise<JobRow | null> {
  const rows = await tx
    .select()
    .from(discoveryJobs)
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.canonicalUrl, canonicalUrl), inArray(discoveryJobs.status, [...OPEN])))
    .limit(1);
  return rows[0] ?? null;
}

/** Open jobs plus those that finished since `since` (the job card shows results for a few minutes). */
export function recentJobs(tx: TenantTx, workspaceId: string, since: Date): Promise<JobRow[]> {
  return tx
    .select()
    .from(discoveryJobs)
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), or(inArray(discoveryJobs.status, [...OPEN]), gte(discoveryJobs.finishedAt, since))))
    .orderBy(desc(discoveryJobs.createdAt))
    .limit(20);
}

/** Claims one attempt; null when the job already finished (duplicate delivery or swept) — the handler then does nothing. */
export async function startAttempt(tx: TenantTx, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await tx
    .update(discoveryJobs)
    .set({ status: "running", attempts: sql`${discoveryJobs.attempts} + 1`, startedAt: sql`coalesce(${discoveryJobs.startedAt}, now())` })
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), inArray(discoveryJobs.status, [...OPEN])))
    .returning();
  return rows[0] ?? null;
}

export async function setStep(tx: TenantTx, workspaceId: string, id: string, step: DiscoveryJobStep): Promise<void> {
  await tx.update(discoveryJobs).set({ step }).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), inArray(discoveryJobs.status, [...OPEN])));
}

/** Finishes an open job; false if it had already finished (e.g. swept). */
export async function finishJob(
  tx: TenantTx,
  workspaceId: string,
  id: string,
  patch: { status: "completed" | "failed"; outcome?: JobRow["outcome"]; creatorId?: string | null; creditsCharged?: number; errorCode?: string | null; errorMessage?: string | null },
): Promise<boolean> {
  const rows = await tx
    .update(discoveryJobs)
    .set({ ...patch, finishedAt: sql`now()` })
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), inArray(discoveryJobs.status, [...OPEN])))
    .returning({ id: discoveryJobs.id });
  return rows.length === 1;
}
