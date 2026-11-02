import { randomUUID } from "node:crypto";
import type { AudienceState } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db, type TenantTx } from "@mushin/db";
import type { BillingService } from "../billing/index";
import { lockedForWorkspace } from "../creators/index";
import * as repo from "./repository";

export type AudienceDeps = {
  db: Db;
  billing: Pick<BillingService, "engine" | "getAccess">;
  /** Platforms whose audience source the operator has enabled (config AUDIENCE_SOURCES); empty turns the feature off. */
  sources: readonly "youtube"[];
  now?: () => Date;
};

const MESSAGES = {
  source_disabled: "Audience estimates are turned off on this MUSHIN deployment until their data source is approved.",
  platform_unsupported: "Audience estimates are available for YouTube channels only. Instagram and TikTok need an approved data source first.",
  creator_protected: "Audience estimates are not available for creators who may be under 18.",
  plan_required: "Audience details are included in the Growth and Scale plans.",
} as const;

const isOneOpenViolation = (err: unknown) => {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (/audience_jobs_one_open/.test(e.message)) return true;
  return false;
};

export function createAudienceService(deps: AudienceDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  /** `included`: the plan has audience details (the server-wide source switch is checked separately, first). */
  async function stateIn(tx: TenantTx, ctx: TenantContext, creatorId: string, included: boolean): Promise<AudienceState> {
    const t = await repo.target(tx, creatorId);
    if (!t || !t.active) throw new AppError("NOT_FOUND", "Creator not found");
    // Pakistan-only lock (BUG-32, BUG-35): an id from a workspace that does not hold the creator is answered like an
    // unknown id, before anything is quoted, reserved or queued.
    if (await lockedForWorkspace(tx, creatorId, now())) throw new AppError("NOT_FOUND", "Creator not found");
    const availability = t.minorProtected
      ? ("creator_protected" as const)
      : !t.youtubeHandle
        ? ("platform_unsupported" as const)
        : !deps.sources.includes("youtube")
          ? ("source_disabled" as const)
          : !included
            ? ("plan_required" as const)
            : ("available" as const);
    const [cost] = Object.values(await deps.billing.engine.costs(tx, ["audience_estimate"]));
    const job = await repo.latestJob(tx, ctx.workspaceId, creatorId);
    // A protected creator's earlier estimate is not shown either.
    const estimate = t.minorProtected ? null : await repo.workspaceEstimate(tx, ctx.workspaceId, creatorId, now());
    return {
      creatorId,
      platform: t.youtubeHandle ? "youtube" : null,
      availability,
      availabilityMessage: availability === "available" ? null : MESSAGES[availability],
      cost: cost ?? 0,
      job: job ? repo.toApiJob(job) : null,
      estimate: estimate ? repo.toApiEstimate(estimate) : null,
    };
  }

  /** Reading never computes or charges anything. */
  const included = async (ctx: TenantContext) => (await deps.billing.getAccess(ctx)).entitlements.audienceViewsPerMonth !== 0;

  async function state(ctx: TenantContext, creatorId: string): Promise<AudienceState> {
    const plan = await included(ctx);
    return deps.db.withTenant(tenant(ctx), (tx) => stateIn(tx, ctx, creatorId, plan));
  }

  /**
   * The user confirmed the quote: reserve it, create the job and announce it in one transaction. An open job or an
   * unexpired estimate this workspace already has is returned instead, without a new charge.
   */
  async function request(ctx: TenantContext, creatorId: string, confirmedCost: number): Promise<{ httpStatus: 200 | 202; body: AudienceState }> {
    const access = await deps.billing.getAccess(ctx);
    try {
      return await deps.db.withTenant(tenant(ctx), async (tx) => {
        const current = await stateIn(tx, ctx, creatorId, access.entitlements.audienceViewsPerMonth !== 0);
        if (current.availability !== "available") throw new AppError("CONFLICT", current.availabilityMessage ?? "Audience estimates are not available.", { reason: current.availability });
        if (current.estimate || (current.job && (current.job.status === "queued" || current.job.status === "running"))) return { httpStatus: 200 as const, body: current };
        // D5: requesting an audience estimate opens the creator's audience section; the first time each month counts.
        if (await repo.countView(tx, ctx.workspaceId, creatorId, ctx.userId, now())) {
          const ok = await deps.billing.engine.useEntitlement(tx, ctx.workspaceId, "audience_views", access.entitlements.audienceViewsPerMonth);
          if (!ok) throw new AppError("ENTITLEMENT_REQUIRED", "Your plan's monthly limit for audience details is used up.", { reason: "plan_limit", key: "audience_views" });
        }
        const jobId = randomUUID();
        const held = await deps.billing.engine.reserve(
          tx,
          ctx.workspaceId,
          { action: "audience_estimate", confirmedCost, refType: "audience_job", refId: jobId },
          { userId: ctx.userId, requestId: ctx.requestId },
        );
        await repo.insertJob(tx, {
          id: jobId,
          workspaceId: ctx.workspaceId,
          creatorId,
          platform: "youtube",
          requestedBy: ctx.userId,
          reservationId: held.reservationId,
          cost: held.amount,
          requestId: ctx.requestId,
        });
        await writeOutbox(tx, { eventType: "audience.estimate_requested", aggregateType: "audience_job", aggregateId: jobId, workspaceId: ctx.workspaceId, payload: { jobId }, requestId: ctx.requestId });
        return { httpStatus: 202 as const, body: await stateIn(tx, ctx, creatorId, true) };
      });
    } catch (err) {
      // A simultaneous request created the job first; this transaction (and its reservation) rolled back.
      if (!isOneOpenViolation(err)) throw err;
      return { httpStatus: 200, body: await state(ctx, creatorId) };
    }
  }

  return { state, request };
}

export type AudienceService = ReturnType<typeof createAudienceService>;
