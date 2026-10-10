import { AppError } from "@mushin/core";
import { writeOutbox, type Db, type TenantTx } from "@mushin/db";
import type { BillingService } from "../billing/index";
import * as repo from "./repository";

export type FinishDeps = { db: Db; billing: Pick<BillingService, "engine"> };

export async function notifyFinished(tx: TenantTx, job: repo.JobRow, status: "completed" | "failed"): Promise<void> {
  await writeOutbox(tx, {
    eventType: "notify.discovery_job_finished",
    aggregateType: "discovery_job",
    aggregateId: job.id,
    workspaceId: job.workspaceId,
    payload: { jobId: job.id, status },
    requestId: job.requestId,
  });
}

/** Returns the job's held credits; a reservation already committed has nothing to return. */
export async function releaseHeld(engine: BillingService["engine"], tx: TenantTx, job: repo.JobRow, reason: string): Promise<void> {
  if (!job.reservationId) return;
  try {
    await engine.release(tx, job.workspaceId, job.reservationId, reason, { userId: job.requestedBy, requestId: job.requestId });
  } catch (err) {
    if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
  }
}

export async function failJob(deps: FinishDeps, job: repo.JobRow, code: string, message: string): Promise<void> {
  await deps.db.withWorkspace(job.workspaceId, async (tx) => {
    if (!(await repo.finishJob(tx, job.workspaceId, job.id, { status: "failed", errorCode: code, errorMessage: message }))) return;
    await releaseHeld(deps.billing.engine, tx, job, `${code}: ${message}`);
    await notifyFinished(tx, job, "failed");
  });
}
