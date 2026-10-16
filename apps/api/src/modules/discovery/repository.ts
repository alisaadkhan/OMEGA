import { and, count, desc, eq, gt, gte, inArray, lt, max, or, sql, sum } from "drizzle-orm";
import type { DiscoveryJob, DiscoveryJobStep, LiveSearch } from "@mushin/contracts";
import { discoveryCandidates, discoveryEstimates, discoveryJobs, discoveryResults, serperCache, type CampaignFitEvidence, type LiveProgress, type SystemTx, type TenantTx } from "@mushin/db";
import type { WebResult } from "@mushin/integrations";

export type JobRow = typeof discoveryJobs.$inferSelect;
export type EstimateRow = typeof discoveryEstimates.$inferSelect;
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
    cancelRequested: r.cancelRequestedAt !== null,
    live:
      r.kind === "live" && r.search && r.maxNew !== null
        ? {
            search: r.search as LiveSearch,
            maxNew: r.maxNew,
            found: r.foundCount,
            new: r.newCount,
            known: r.knownCount,
            maxCost: r.cost,
            creditsCharged: r.creditsCharged,
            progress: r.progress,
          }
        : null,
  };
}

export async function insertJob(tx: TenantTx, row: typeof discoveryJobs.$inferInsert): Promise<JobRow> {
  const [r] = await tx.insert(discoveryJobs).values(row).returning();
  if (!r) throw new Error("job insert returned no row");
  return r;
}

export async function insertEstimate(tx: TenantTx, row: typeof discoveryEstimates.$inferInsert): Promise<EstimateRow> {
  const [estimate] = await tx.insert(discoveryEstimates).values(row).returning();
  if (!estimate) throw new Error("discovery estimate insert returned no row");
  return estimate;
}

export async function estimateForUpdate(tx: TenantTx, workspaceId: string, id: string): Promise<EstimateRow | null> {
  const rows = await tx
    .select()
    .from(discoveryEstimates)
    .where(and(eq(discoveryEstimates.workspaceId, workspaceId), eq(discoveryEstimates.id, id)))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

export async function consumeEstimate(tx: TenantTx, workspaceId: string, id: string, jobId: string): Promise<void> {
  await tx.update(discoveryEstimates).set({ consumedAt: sql`now()`, jobId }).where(and(eq(discoveryEstimates.workspaceId, workspaceId), eq(discoveryEstimates.id, id)));
}

export async function getJob(tx: TenantTx, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await tx.select().from(discoveryJobs).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id))).limit(1);
  return rows[0] ?? null;
}

/** Serialize terminal settlement with any other delivery for this job. */
export async function lockOpenJob(tx: TenantTx, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await tx.select().from(discoveryJobs)
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), inArray(discoveryJobs.status, [...OPEN])))
    .for("update").limit(1);
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

/** Records a stop request on an open live run (idempotent); null when there is no such open run. */
export async function requestCancel(tx: TenantTx, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await tx
    .update(discoveryJobs)
    .set({ cancelRequestedAt: sql`coalesce(${discoveryJobs.cancelRequestedAt}, now())` })
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), eq(discoveryJobs.kind, "live"), inArray(discoveryJobs.status, [...OPEN])))
    .returning();
  return rows[0] ?? null;
}

export async function cancelRequested(tx: TenantTx, workspaceId: string, id: string): Promise<boolean> {
  const rows = await tx.select({ at: discoveryJobs.cancelRequestedAt }).from(discoveryJobs).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id))).limit(1);
  return rows[0]?.at != null;
}

export async function setStep(tx: TenantTx, workspaceId: string, id: string, step: DiscoveryJobStep): Promise<void> {
  await tx.update(discoveryJobs).set({ step }).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), inArray(discoveryJobs.status, [...OPEN])));
}

/** Persist monotonic funnel counters. A retry may observe more work, never less. */
export async function advanceProgress(tx: TenantTx, workspaceId: string, id: string, patch: Partial<LiveProgress>): Promise<LiveProgress> {
  const current = await getJob(tx, workspaceId, id);
  if (!current) throw new Error(`discovery job ${id} disappeared while updating progress`);
  const progress = { ...current.progress };
  for (const [key, value] of Object.entries(patch) as [keyof LiveProgress, number][]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid live discovery progress counter: ${key}`);
    progress[key] = Math.max(progress[key], value);
  }
  await tx.update(discoveryJobs).set({ progress }).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, id), inArray(discoveryJobs.status, [...OPEN])));
  return progress;
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

export async function openLiveJobFor(tx: TenantTx, workspaceId: string, searchHash: string): Promise<JobRow | null> {
  const rows = await tx
    .select()
    .from(discoveryJobs)
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.kind, "live"), eq(discoveryJobs.searchHash, searchHash), inArray(discoveryJobs.status, [...OPEN])))
    .limit(1);
  return rows[0] ?? null;
}

/** Any open live run in the workspace: only one runs at a time (audit BIL-06, migration 0045). */
export async function openLiveJobIn(tx: TenantTx, workspaceId: string): Promise<JobRow | null> {
  const rows = await tx
    .select()
    .from(discoveryJobs)
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.kind, "live"), inArray(discoveryJobs.status, [...OPEN])))
    .limit(1);
  return rows[0] ?? null;
}

export type ResultRow = typeof discoveryResults.$inferSelect;

/** One result per creator per run, numbered in arrival order for polling (spec §3.1). Runs are processed one at a time. */
export async function insertResult(tx: TenantTx, workspaceId: string, jobId: string, r: { creatorId: string; isNew: boolean; credits: number; reason: string | null; campaignFit?: CampaignFitEvidence | null }): Promise<boolean> {
  // Concurrent profile saves for one job: the job row lock orders them, so "max(seq) + 1" never collides.
  await tx.select({ id: discoveryJobs.id }).from(discoveryJobs).where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, jobId))).for("update");
  const [last] = await tx.select({ seq: max(discoveryResults.seq) }).from(discoveryResults).where(eq(discoveryResults.jobId, jobId));
  const inserted = await tx
    .insert(discoveryResults)
    .values({ workspaceId, jobId, creatorId: r.creatorId, seq: (last?.seq ?? 0) + 1, isNew: r.isNew, credits: r.credits, reason: r.reason, campaignFit: r.campaignFit ?? null })
    .onConflictDoNothing({ target: [discoveryResults.jobId, discoveryResults.creatorId] })
    .returning({ id: discoveryResults.id });
  if (inserted.length === 0) return false;
  await tx
    .update(discoveryJobs)
    .set(
      r.isNew
        ? { foundCount: sql`${discoveryJobs.foundCount} + 1`, newCount: sql`${discoveryJobs.newCount} + 1` }
        : { foundCount: sql`${discoveryJobs.foundCount} + 1`, knownCount: sql`${discoveryJobs.knownCount} + 1` },
    )
    .where(and(eq(discoveryJobs.workspaceId, workspaceId), eq(discoveryJobs.id, jobId)));
  return true;
}

export type CandidateRow = typeof discoveryCandidates.$inferInsert;

/** Writes the decision trail; a retry or later stage updates the same (job, candidate) row. */
export async function upsertCandidates(tx: TenantTx, rows: CandidateRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    await tx
      .insert(discoveryCandidates)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [discoveryCandidates.jobId, discoveryCandidates.candidateKey],
        set: {
          canonicalUrl: sql`excluded.canonical_url`, handle: sql`excluded.handle`, query: sql`excluded.query`, round: sql`excluded.round`,
          position: sql`excluded.position`, occurrences: sql`excluded.occurrences`, stage: sql`excluded.stage`, decision: sql`excluded.decision`,
          reason: sql`excluded.reason`, detail: sql`excluded.detail`, creatorId: sql`excluded.creator_id`, updatedAt: sql`now()`,
        },
      });
  }
}

export function candidatesFor(tx: TenantTx, workspaceId: string, jobId: string): Promise<(typeof discoveryCandidates.$inferSelect)[]> {
  return tx.select().from(discoveryCandidates).where(and(eq(discoveryCandidates.workspaceId, workspaceId), eq(discoveryCandidates.jobId, jobId)));
}

export function resultsAfter(tx: TenantTx, workspaceId: string, jobId: string, after: number): Promise<ResultRow[]> {
  return tx
    .select()
    .from(discoveryResults)
    .where(and(eq(discoveryResults.workspaceId, workspaceId), eq(discoveryResults.jobId, jobId), gt(discoveryResults.seq, after)))
    .orderBy(discoveryResults.seq)
    .limit(200);
}

export async function resultCreatorIds(tx: TenantTx, workspaceId: string, jobId: string): Promise<string[]> {
  const rows = await tx.select({ id: discoveryResults.creatorId }).from(discoveryResults).where(and(eq(discoveryResults.workspaceId, workspaceId), eq(discoveryResults.jobId, jobId)));
  return rows.map((r) => r.id);
}

export async function countNew(tx: TenantTx, workspaceId: string, jobId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(discoveryResults).where(and(eq(discoveryResults.workspaceId, workspaceId), eq(discoveryResults.jobId, jobId), eq(discoveryResults.isNew, true)));
  return Number(r?.n ?? 0);
}

export async function countBillable(tx: TenantTx, workspaceId: string, jobId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(discoveryResults).where(and(eq(discoveryResults.workspaceId, workspaceId), eq(discoveryResults.jobId, jobId), gt(discoveryResults.credits, 0)));
  return Number(r?.n ?? 0);
}

export async function resultCredits(tx: TenantTx, workspaceId: string, jobId: string): Promise<number> {
  const [r] = await tx.select({ total: sum(discoveryResults.credits) }).from(discoveryResults).where(and(eq(discoveryResults.workspaceId, workspaceId), eq(discoveryResults.jobId, jobId)));
  return Number(r?.total ?? 0);
}

export async function setRanks(tx: TenantTx, workspaceId: string, jobId: string, ranked: { creatorId: string; rank: number; fitScore: number; fitLabel: ResultRow["fitLabel"] }[]): Promise<void> {
  for (const r of ranked) {
    await tx
      .update(discoveryResults)
      .set({ rank: r.rank, fitScore: r.fitScore, fitLabel: r.fitLabel })
      .where(and(eq(discoveryResults.workspaceId, workspaceId), eq(discoveryResults.jobId, jobId), eq(discoveryResults.creatorId, r.creatorId)));
  }
}

// ── Serper cache (platform.serper_cache, shared by every workspace; SRS §3.4) ──
export async function cachedSearch(tx: SystemTx, queryHash: string, since: Date): Promise<WebResult[] | null> {
  const rows = await tx.select({ results: serperCache.results }).from(serperCache).where(and(eq(serperCache.queryHash, queryHash), gt(serperCache.fetchedAt, since))).limit(1);
  return rows[0]?.results ?? null;
}

export async function storeSearch(tx: SystemTx, queryHash: string, query: string, results: WebResult[]): Promise<void> {
  await tx
    .insert(serperCache)
    .values({ queryHash, query: query.slice(0, 400), results })
    .onConflictDoUpdate({ target: serperCache.queryHash, set: { query: query.slice(0, 400), results, fetchedAt: sql`now()` } });
}

export async function purgeSearches(tx: SystemTx, before: Date): Promise<number> {
  const rows = await tx.delete(serperCache).where(lt(serperCache.fetchedAt, before)).returning({ h: serperCache.queryHash });
  return rows.length;
}
