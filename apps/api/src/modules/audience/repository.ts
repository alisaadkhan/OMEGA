import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { audienceEstimateBodySchema, type AudienceEstimate, type AudienceJob } from "@mushin/contracts";
import { audienceEstimates, audienceJobs, audienceViews, type SystemTx, type TenantTx } from "@mushin/db";

type Tx = TenantTx | SystemTx;
export type JobRow = typeof audienceJobs.$inferSelect;
export type EstimateRow = typeof audienceEstimates.$inferSelect;
const OPEN = ["queued", "running"] as const;

export type Target = { creatorId: string; active: boolean; minorProtected: boolean; youtubeHandle: string | null };

/** The creator and its YouTube channel handle (the last segment of the canonical URL, e.g. `@name`). */
export async function target(tx: Tx, creatorId: string): Promise<Target | null> {
  const rows = await tx.execute<{ id: string; active: boolean; minor: boolean; url: string | null }>(sql`
    select c.id, c.status = 'active' as active, (c.is_minor and c.minor_override_by_staff_id is null) as minor,
      (select p.canonical_url from gcp.creator_profiles p where p.creator_id = c.id and p.platform = 'youtube' order by p.followers desc nulls last limit 1) as url
    from gcp.creators c where c.id = ${creatorId}`);
  const r = rows[0];
  if (!r) return null;
  const handle = r.url?.split("/").pop() ?? null;
  return { creatorId: r.id, active: r.active, minorProtected: r.minor, youtubeHandle: handle && /^@[\w.-]{1,100}$/.test(handle) ? handle : null };
}

export function toApiJob(r: JobRow): AudienceJob {
  return {
    id: r.id,
    status: r.status,
    outcome: r.outcome,
    cost: r.cost,
    creditsCharged: r.creditsCharged,
    error: r.errorCode ? { code: r.errorCode, message: r.errorMessage ?? "Something went wrong." } : null,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

/** A stored result is re-validated on the way out: the database is not trusted to hold a well-formed estimate. */
export function toApiEstimate(r: EstimateRow): AudienceEstimate {
  return { ...audienceEstimateBodySchema.parse(r.result), id: r.id, platform: r.platform, collectedAt: r.collectedAt.toISOString(), expiresAt: r.expiresAt.toISOString() };
}

export async function latestJob(tx: Tx, workspaceId: string, creatorId: string): Promise<JobRow | null> {
  const rows = await tx.select().from(audienceJobs).where(and(eq(audienceJobs.workspaceId, workspaceId), eq(audienceJobs.creatorId, creatorId))).orderBy(desc(audienceJobs.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function openJob(tx: Tx, workspaceId: string, creatorId: string): Promise<JobRow | null> {
  const rows = await tx.select().from(audienceJobs).where(and(eq(audienceJobs.workspaceId, workspaceId), eq(audienceJobs.creatorId, creatorId), inArray(audienceJobs.status, [...OPEN]))).limit(1);
  return rows[0] ?? null;
}

export async function getJob(tx: Tx, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await tx.select().from(audienceJobs).where(and(eq(audienceJobs.workspaceId, workspaceId), eq(audienceJobs.id, id))).limit(1);
  return rows[0] ?? null;
}

/** The newest unexpired estimate this workspace obtained (paid or insufficient): shown again without new work. */
export async function workspaceEstimate(tx: Tx, workspaceId: string, creatorId: string, now: Date): Promise<EstimateRow | null> {
  const rows = await tx
    .select({ e: audienceEstimates })
    .from(audienceJobs)
    .innerJoin(audienceEstimates, eq(audienceEstimates.id, audienceJobs.estimateId))
    .where(and(eq(audienceJobs.workspaceId, workspaceId), eq(audienceJobs.creatorId, creatorId), eq(audienceJobs.status, "completed"), isNotNull(audienceJobs.estimateId), gt(audienceEstimates.expiresAt, now)))
    .orderBy(desc(audienceEstimates.collectedAt))
    .limit(1);
  return rows[0]?.e ?? null;
}

/** Any workspace's unexpired estimate of the creator on the platform (reused instead of collecting again). */
export async function freshEstimate(tx: Tx, creatorId: string, platform: EstimateRow["platform"], now: Date): Promise<EstimateRow | null> {
  const rows = await tx
    .select()
    .from(audienceEstimates)
    .where(and(eq(audienceEstimates.creatorId, creatorId), eq(audienceEstimates.platform, platform), gt(audienceEstimates.expiresAt, now)))
    .orderBy(desc(audienceEstimates.collectedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertJob(tx: TenantTx, row: typeof audienceJobs.$inferInsert): Promise<JobRow> {
  const [r] = await tx.insert(audienceJobs).values(row).returning();
  if (!r) throw new Error("audience job insert returned nothing");
  return r;
}

/** SRS D5: the first audience view of a creator per workspace and calendar month (UTC); false when already counted. */
export async function countView(tx: TenantTx, workspaceId: string, creatorId: string, userId: string, now: Date): Promise<boolean> {
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const rows = await tx.insert(audienceViews).values({ workspaceId, creatorId, month, viewedBy: userId }).onConflictDoNothing().returning({ c: audienceViews.creatorId });
  return rows.length > 0;
}

// ── worker ──────────────────────────────────────────────────────────────────
export async function startAttempt(tx: TenantTx, workspaceId: string, id: string, now: Date): Promise<JobRow | null> {
  const [r] = await tx
    .update(audienceJobs)
    .set({ status: "running", attempts: sql`${audienceJobs.attempts} + 1`, startedAt: sql`coalesce(${audienceJobs.startedAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(audienceJobs.workspaceId, workspaceId), eq(audienceJobs.id, id), inArray(audienceJobs.status, [...OPEN])))
    .returning();
  return r ?? null;
}

/** Closes an open job; false when it was already closed (a retry or the sweeper got there first). */
export async function finishJob(
  tx: TenantTx,
  workspaceId: string,
  id: string,
  patch: { status: "completed" | "failed"; outcome?: "estimated" | "insufficient"; estimateId?: string; creditsCharged?: number; errorCode?: string; errorMessage?: string },
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(audienceJobs)
    .set({ ...patch, finishedAt: now })
    .where(and(eq(audienceJobs.workspaceId, workspaceId), eq(audienceJobs.id, id), inArray(audienceJobs.status, [...OPEN])))
    .returning({ id: audienceJobs.id });
  return rows.length === 1;
}

export async function insertEstimate(tx: TenantTx, row: typeof audienceEstimates.$inferInsert): Promise<EstimateRow> {
  const [r] = await tx.insert(audienceEstimates).values(row).returning();
  if (!r) throw new Error("audience estimate insert returned nothing");
  return r;
}

export async function stuckJobs(tx: SystemTx, minutes: number): Promise<{ id: string; workspace_id: string }[]> {
  return [...(await tx.execute<{ id: string; workspace_id: string }>(sql`select id, workspace_id from platform.stuck_audience_jobs(${minutes})`))];
}
