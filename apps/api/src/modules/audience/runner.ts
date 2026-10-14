import { AppError, type Logger } from "@mushin/core";
import type { Db, TenantTx } from "@mushin/db";
import { ProviderError, type YouTubeAudienceSource } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { buildEstimate, METHOD, selectCommenters } from "./method";
import * as repo from "./repository";

type Deps = {
  db: Db;
  billing: Pick<BillingService, "engine">;
  /** Null when no audience source is enabled: queued jobs then fail and are refunded. */
  youtube: YouTubeAudienceSource | null;
  logger: Logger;
  now?: () => Date;
  maxAttempts?: number;
  stuckMinutes?: number;
};

const MESSAGES: Record<ProviderError["reason"] | "disabled" | "unavailable", string> = {
  spend_cap: "Audience estimates are paused right now. Your credits were returned.",
  quota: "YouTube's daily limit was reached. Please try again tomorrow. Your credits were returned.",
  not_configured: "Audience estimates aren't set up on this MUSHIN deployment. Your credits were returned.",
  provider: "We couldn't read this channel's public comments right now. Your credits were returned.",
  disabled: "Audience estimates are turned off on this MUSHIN deployment. Your credits were returned.",
  unavailable: "An audience estimate isn't available for this creator. Your credits were returned.",
};

function providerErrorOf(err: unknown): ProviderError | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e;
  return null;
}

/**
 * Worker side: collect a bounded public sample, calculate the aggregate estimate, store it and settle the credits in one
 * transaction. Charged only when a country estimate was produced; insufficient evidence and failures return the credits.
 */
export function createAudienceRunner(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const maxAttempts = deps.maxAttempts ?? 3;
  const engine = deps.billing.engine;

  async function release(tx: TenantTx, workspaceId: string, job: repo.JobRow, reason: string) {
    if (!job.reservationId) return;
    try {
      await engine.release(tx, workspaceId, job.reservationId, reason, { userId: job.requestedBy, requestId: job.requestId });
    } catch (err) {
      // Already spent (a settled earlier attempt) is left alone; anything else is a real failure.
      if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
    }
  }

  async function fail(job: repo.JobRow, workspaceId: string, code: string, message: string) {
    await deps.db.withWorkspace(workspaceId, async (tx) => {
      if (!(await repo.finishJob(tx, workspaceId, job.id, { status: "failed", errorCode: code, errorMessage: message, creditsCharged: 0 }, now()))) return;
      await release(tx, workspaceId, job, message);
    });
  }

  /** Links the job to its estimate and settles: commit the quote for an estimate, release it otherwise. */
  async function settle(tx: TenantTx, workspaceId: string, job: repo.JobRow, estimate: repo.EstimateRow) {
    let charged = 0;
    if (estimate.outcome === "estimated" && job.reservationId) {
      try {
        await engine.commit(tx, workspaceId, job.reservationId, { userId: job.requestedBy, requestId: job.requestId });
        charged = job.cost;
      } catch (err) {
        if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
        deps.logger.warn({ jobId: job.id }, "audience reservation was already released; the estimate is saved without a charge");
      }
    }
    if (!(await repo.finishJob(tx, workspaceId, job.id, { status: "completed", outcome: estimate.outcome, estimateId: estimate.id, creditsCharged: charged }, now()))) {
      throw new Error(`audience job ${job.id} closed while it was being settled`);
    }
    if (estimate.outcome !== "estimated") await release(tx, workspaceId, job, "Insufficient public evidence for an estimate");
  }

  async function run(jobId: string, workspaceId: string): Promise<void> {
    const job = await deps.db.withWorkspace(workspaceId, (tx) => repo.startAttempt(tx, workspaceId, jobId, now()));
    if (!job) return;
    const target = await deps.db.withWorkspace(workspaceId, (tx) => repo.target(tx, job.creatorId));
    if (!deps.youtube) return fail(job, workspaceId, "SOURCE_DISABLED", MESSAGES.disabled);
    if (!target || !target.active || target.minorProtected || !target.youtubeHandle) return fail(job, workspaceId, "UNAVAILABLE", MESSAGES.unavailable);
    const handle = target.youtubeHandle;

    const reused = await deps.db.withWorkspace(workspaceId, async (tx) => {
      const fresh = await repo.freshEstimate(tx, job.creatorId, "youtube", now());
      if (fresh) await settle(tx, workspaceId, job, fresh);
      return fresh !== null;
    });
    if (reused) return;

    try {
      const started = Date.now();
      const ctx = { workspaceId, jobId: job.id, requestId: job.requestId };
      const sample = await deps.youtube.sampleComments({ handle, maxVideos: METHOD.maxVideos, windowDays: METHOD.windowDays, commentsPerVideo: METHOD.commentsPerVideo, now: now(), ctx });
      // Long collections keep their credits held: the 15-minute cleanup must not release a job that is still working.
      if (job.reservationId) await deps.db.withWorkspace(workspaceId, (tx) => engine.extend(tx, workspaceId, job.reservationId ?? "")).catch(() => undefined);
      const selection = selectCommenters(sample);
      const looked = await deps.youtube.channelCountries({ channelIds: selection.commenterIds, ctx });
      // Commenter ids and texts stay in memory: only the aggregate is stored.
      const countries = selection.commenterIds.map((id) => looked.countries.get(id) ?? null);
      const body = buildEstimate(selection, countries, sample.videosConsidered);
      const collectedAt = now();
      const ttlDays = body.outcome === "estimated" ? METHOD.estimatedTtlDays : METHOD.insufficientTtlDays;
      await deps.db.withWorkspace(workspaceId, async (tx) => {
        const estimate = await repo.insertEstimate(tx, {
          creatorId: job.creatorId,
          platform: "youtube",
          methodVersion: body.methodVersion,
          outcome: body.outcome,
          result: body,
          collectedAt,
          expiresAt: new Date(collectedAt.getTime() + ttlDays * 86_400_000),
          quotaUnits: sample.quotaUnits + looked.quotaUnits,
          costUsd: "0",
          durationMs: Date.now() - started,
        });
        await settle(tx, workspaceId, job, estimate);
      });
      deps.logger.info({ jobId, outcome: body.outcome, classified: body.sample.classifiable, sampled: body.sample.uniqueCommenters, quotaUnits: sample.quotaUnits + looked.quotaUnits }, "audience estimate finished");
    } catch (err) {
      const pe = providerErrorOf(err);
      const retryable = pe ? pe.retryable : !(err instanceof AppError);
      if (retryable && job.attempts < maxAttempts) throw err; // the queue tries again with backoff
      deps.logger.warn({ err, jobId }, "audience estimate failed");
      await fail(job, workspaceId, "PROVIDER_UNAVAILABLE", MESSAGES[pe?.reason ?? "provider"]);
    }
  }

  /** Jobs still open after `stuckMinutes` (a crashed worker) are failed; their credits come back. */
  async function sweepStuck(): Promise<number> {
    const stuck = await deps.db.withSystem((tx) => repo.stuckJobs(tx, deps.stuckMinutes ?? 15));
    let n = 0;
    for (const s of stuck) {
      const job = await deps.db.withWorkspace(s.workspace_id, (tx) => repo.getJob(tx, s.workspace_id, s.id));
      if (!job) continue;
      await fail(job, s.workspace_id, "TIMED_OUT", "This took too long and was stopped. Your credits were returned.");
      n += 1;
    }
    return n;
  }

  async function purgeExpired(): Promise<number> {
    return deps.db.withSystem((tx) => repo.purgeExpiredEstimates(tx, now()));
  }

  return { run, sweepStuck, purgeExpired };
}

export type AudienceRunner = ReturnType<typeof createAudienceRunner>;
