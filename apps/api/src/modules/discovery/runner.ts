import { sql } from "drizzle-orm";
import { AppError, type Logger } from "@mushin/core";
import { writeOutbox, type Db, type TenantTx } from "@mushin/db";
import { ProviderError } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { getEnrichmentSettings, type EnrichmentPipeline } from "../creators/index";
import * as repo from "./repository";

type Deps = { db: Db; billing: Pick<BillingService, "engine">; pipeline: Pick<EnrichmentPipeline, "enrich">; logger: Logger; maxAttempts?: number };

const MESSAGES: Record<ProviderError["reason"], string> = {
  spend_cap: "Fetching new data is paused right now. Please try again later.",
  quota: "YouTube's daily limit was reached. Please try again tomorrow.",
  not_configured: "Fetching creator data isn't set up yet.",
  provider: "We couldn't fetch this profile right now. Please try again later.",
};

const stuckJobsQuery = (minutes: number) => sql`select id, workspace_id from platform.stuck_discovery_jobs(${minutes})`;

function providerErrorOf(err: unknown): ProviderError | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e;
  return null;
}

/** Worker side of spec §5: runs the pipeline, then commits (in the save transaction) or refunds. */
export function createDiscoveryRunner(deps: Deps) {
  const maxAttempts = deps.maxAttempts ?? 3;
  const engine = deps.billing.engine;

  async function notify(tx: TenantTx, job: repo.JobRow, status: "completed" | "failed") {
    await writeOutbox(tx, {
      eventType: "notify.discovery_job_finished",
      aggregateType: "discovery_job",
      aggregateId: job.id,
      workspaceId: job.workspaceId,
      payload: { jobId: job.id, status },
      requestId: job.requestId,
    });
  }

  async function refund(tx: TenantTx, job: repo.JobRow, reason: string) {
    if (!job.reservationId) return;
    try {
      await engine.release(tx, job.workspaceId, job.reservationId, reason, { userId: job.requestedBy, requestId: job.requestId });
    } catch (err) {
      // Already committed (the data was saved and charged): nothing to return.
      if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
    }
  }

  async function fail(job: repo.JobRow, code: string, message: string) {
    await deps.db.withWorkspace(job.workspaceId, async (tx) => {
      if (!(await repo.finishJob(tx, job.workspaceId, job.id, { status: "failed", errorCode: code, errorMessage: message }))) return;
      await refund(tx, job, `${code}: ${message}`);
      await notify(tx, job, "failed");
    });
  }

  async function run(jobId: string, workspaceId: string): Promise<void> {
    const job = await deps.db.withWorkspace(workspaceId, (tx) => repo.startAttempt(tx, workspaceId, jobId));
    if (!job) return;
    const actor = { userId: job.requestedBy, requestId: job.requestId };
    try {
      const result = await deps.pipeline.enrich(
        { jobId: job.id, workspaceId, platform: job.platform, handle: job.handle, canonicalUrl: job.canonicalUrl, requestId: job.requestId },
        {
          onStep: (step) =>
            deps.db.withWorkspace(workspaceId, async (tx) => {
              await repo.setStep(tx, workspaceId, job.id, step);
              // Long jobs keep their credits held: the 15-minute cleanup must not refund a job that is still working.
              if (job.reservationId) await engine.extend(tx, workspaceId, job.reservationId).catch(() => undefined);
            }),
          onSaved: async (tx, saved) => {
            let charged = 0;
            if (job.reservationId) {
              try {
                await engine.commit(tx, workspaceId, job.reservationId, actor);
                charged = job.cost;
              } catch (err) {
                if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
                deps.logger.warn({ jobId }, "reservation was already released; the data is saved without a charge");
              }
            }
            await repo.finishJob(tx, workspaceId, job.id, { status: "completed", outcome: saved.outcome, creatorId: saved.creatorId, creditsCharged: charged });
            await notify(tx, job, "completed");
          },
        },
      );
      if (result.kind === "reused") {
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          if (!(await repo.finishJob(tx, workspaceId, job.id, { status: "completed", outcome: "reused", creatorId: result.creatorId }))) return;
          await refund(tx, job, "Fresh data was already available");
          await notify(tx, job, "completed");
        });
      } else if (result.kind === "unavailable") {
        await fail(job, result.code, result.message);
      }
    } catch (err) {
      const pe = providerErrorOf(err);
      // Provider errors say for themselves; storage outages (PROVIDER_UNAVAILABLE) and unknown failures are worth retrying,
      // other application errors are not.
      const retryable = pe ? pe.retryable : !(err instanceof AppError) || err.code === "PROVIDER_UNAVAILABLE";
      if (retryable && job.attempts < maxAttempts) throw err; // the queue tries again with backoff
      deps.logger.warn({ err, jobId }, "creator data job failed");
      await fail(job, "PROVIDER_UNAVAILABLE", MESSAGES[pe?.reason ?? "provider"]);
    }
  }

  /** Jobs still open after `stuck_job_minutes` (a crashed worker) are failed; their credits come back. */
  async function sweepStuck(): Promise<number> {
    const settings = await deps.db.withSystem((tx) => getEnrichmentSettings(tx));
    const stuck = await deps.db.withSystem((tx) => tx.execute<{ id: string; workspace_id: string }>(stuckJobsQuery(settings.stuckJobMinutes)));
    let n = 0;
    for (const s of stuck) {
      const job = await deps.db.withWorkspace(s.workspace_id, (tx) => repo.getJob(tx, s.workspace_id, s.id));
      if (!job) continue;
      await fail(job, "TIMED_OUT", "This took too long and was stopped. Your credits were returned.");
      n += 1;
    }
    return n;
  }

  return { run, sweepStuck };
}

export type DiscoveryRunner = ReturnType<typeof createDiscoveryRunner>;
