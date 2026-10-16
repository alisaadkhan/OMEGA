import type { Logger, ProviderCallSink } from "@mushin/core";
import type { createApifyClient } from "./apify";
import type { ProviderRunStore } from "./types";

/**
 * Settles paid Apify runs left open by a crash, deploy or lost connection (audit SRCH-04). For each run still open after
 * `graceMs`: an ended run gets its cost recorded once and is closed; a run still going after `abortAfterMs` is aborted,
 * then recorded and closed; a run that never got an Apify id cannot be inspected and is marked unknown after the deadline.
 */
export async function reconcileApifyRuns(o: {
  runs: ProviderRunStore;
  apify: Pick<ReturnType<typeof createApifyClient>, "inspectRun">;
  sink: ProviderCallSink;
  logger: Logger;
  graceMs?: number;
  abortAfterMs?: number;
  now?: () => Date;
}): Promise<{ settled: number; aborted: number; unknown: number; open: number }> {
  const now = (o.now ?? (() => new Date()))();
  const grace = o.graceMs ?? 10 * 60_000;
  const abortAfter = o.abortAfterMs ?? 30 * 60_000;
  const tally = { settled: 0, aborted: 0, unknown: 0, open: 0 };
  for (const run of await o.runs.open(new Date(now.getTime() - grace))) {
    const age = now.getTime() - run.startedAt.getTime();
    if (!run.externalRunId) {
      if (age >= abortAfter) {
        await o.runs.finish(run.runKey, "unknown", null);
        o.logger.warn({ runKey: run.runKey }, "an Apify run was claimed but never started or its id was lost; check the Apify console");
        tally.unknown += 1;
      } else tally.open += 1;
      continue;
    }
    const inspected = await o.apify.inspectRun(run.externalRunId, { abort: age >= abortAfter });
    if (!inspected.terminal) {
      tally.open += 1;
      continue;
    }
    const ok = inspected.status === "SUCCEEDED";
    const cost = inspected.costUsd ?? 0;
    await o.sink.record({
      provider: "apify",
      operation: "reconciled_run",
      model: run.actor,
      tokensIn: null,
      tokensOut: null,
      units: null,
      costUsd: cost,
      latencyMs: 0,
      status: ok ? "ok" : "error",
      errorCode: ok ? null : `reconciled_${inspected.status.toLowerCase()}`,
      workspaceId: run.workspaceId,
      jobId: run.jobId,
      requestId: null,
    });
    const aborted = inspected.status === "ABORTED" && age >= abortAfter;
    await o.runs.finish(run.runKey, ok ? "succeeded" : aborted ? "aborted" : "failed", cost);
    if (aborted) tally.aborted += 1;
    else tally.settled += 1;
  }
  return tally;
}
