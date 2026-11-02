import { sql } from "drizzle-orm";
import { AppError, type Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import { ProviderError } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { getEnrichmentSettings, recordAvailability, type EnrichmentPipeline } from "../creators/index";
import { failJob, notifyFinished, releaseHeld } from "./finish";
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

  async function run(jobId: string, workspaceId: string): Promise<void> {
    const job = await deps.db.withWorkspace(workspaceId, (tx) => repo.startAttempt(tx, workspaceId, jobId));
    if (!job) return;
    // Profile jobs always carry their profile (CHECK discovery_jobs_shape); live runs have their own runner.
    const { platform, handle, canonicalUrl } = job;
    if (!platform || !handle || !canonicalUrl) throw new Error(`discovery job ${jobId} is not a profile job`);
    const actor = { userId: job.requestedBy, requestId: job.requestId };
    try {
      const result = await deps.pipeline.enrich(
        { jobId: job.id, workspaceId, platform, handle, canonicalUrl, requestId: job.requestId },
        {
          onStep: (step) =>
            deps.db.withWorkspace(workspaceId, async (tx) => {
              await repo.setStep(tx, workspaceId, job.id, step);
              // Long jobs keep their credits held: the 15-minute cleanup must not refund a job that is still working.
              if (job.reservationId) await engine.extend(tx, workspaceId, job.reservationId).catch(() => undefined);
            }),
          onSaved: async (tx, saved) => {
            let charged = 0;
            // Owner rule 2026-10-14: add-by-link charges only a new creator import. A link that turned out to be a creator
            // MUSHIN already had (found while the job ran) is a duplicate: saved, but its credits come back.
            if (job.kind === "add_by_url" && saved.outcome !== "created") {
              await releaseHeld(engine, tx, job, "The creator was already in MUSHIN");
            } else if (job.reservationId) {
              try {
                await engine.commit(tx, workspaceId, job.reservationId, actor);
                charged = job.cost;
              } catch (err) {
                if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
                deps.logger.warn({ jobId }, "reservation was already released; the data is saved without a charge");
              }
            }
            await repo.finishJob(tx, workspaceId, job.id, { status: "completed", outcome: saved.outcome, creatorId: saved.creatorId, creditsCharged: charged });
            await notifyFinished(tx, job, "completed");
          },
        },
      );
      if (result.kind === "reused") {
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          if (!(await repo.finishJob(tx, workspaceId, job.id, { status: "completed", outcome: "reused", creatorId: result.creatorId }))) return;
          await releaseHeld(engine, tx, job, "Fresh data was already available");
          await notifyFinished(tx, job, "completed");
        });
      } else if (result.kind === "unavailable") {
        await failJob(deps, job, result.code, result.message);
      }
    } catch (err) {
      const pe = providerErrorOf(err);
      // Provider errors say for themselves; storage outages (PROVIDER_UNAVAILABLE) and unknown failures are worth retrying,
      // other application errors are not.
      const retryable = pe ? pe.retryable : !(err instanceof AppError) || err.code === "PROVIDER_UNAVAILABLE";
      if (retryable && job.attempts < maxAttempts) throw err; // the queue tries again with backoff
      deps.logger.warn({ err, jobId }, "creator data job failed");
      // A provider failure concludes nothing about the account: a stored profile is only marked temporarily unavailable.
      if (job.canonicalUrl) {
        const url = job.canonicalUrl;
        await deps.db.withSystem((tx) => recordAvailability(tx, { canonicalUrl: url, observed: "provider_error", source: "refresh_job", reason: `Refresh failed: ${pe?.reason ?? "provider error"}`.slice(0, 300), now: new Date() }));
      }
      await failJob(deps, job, "PROVIDER_UNAVAILABLE", MESSAGES[pe?.reason ?? "provider"]);
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
      await failJob(deps, job, "TIMED_OUT", "This took too long and was stopped. Your credits were returned.");
      n += 1;
    }
    return n;
  }

  return { run, sweepStuck };
}

export type DiscoveryRunner = ReturnType<typeof createDiscoveryRunner>;
