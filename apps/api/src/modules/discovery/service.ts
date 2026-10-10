import { randomUUID } from "node:crypto";
import type { DiscoveryJob, StartDiscoveryJob, StartDiscoveryJobResponse } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db } from "@mushin/db";
import type { BillingService } from "../billing/index";
import { findProfileByUrl, getEnrichmentSettings, isVisibleCreator, suppressedUrls, normalizeProfileUrl, profileTarget, refreshActionFor, type CreatorPlatform } from "../creators/index";
import * as repo from "./repository";

export type DiscoveryDeps = { db: Db; billing: Pick<BillingService, "engine">; now?: () => Date };

const isOneOpenViolation = (err: unknown) => {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (/discovery_jobs_one_open/.test(e.message)) return true;
  return false;
};

export function createDiscoveryService(deps: DiscoveryDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  type Target = { platform: CreatorPlatform; handle: string; canonicalUrl: string; creatorId: string | null; inputUrl: string | null };

  async function resolve(ctx: TenantContext, body: Exclude<StartDiscoveryJob, { kind: "live" }>): Promise<Target | { answer: StartDiscoveryJobResponse }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if (body.kind === "add_by_url") {
        const n = normalizeProfileUrl(body.url);
        if (!n) throw new AppError("VALIDATION_FAILED", "Paste a public Instagram, TikTok or YouTube profile link.", { field: "url" });
        if ((await suppressedUrls(tx, [n.canonicalUrl])).size > 0) throw new AppError("NOT_FOUND", "This creator can't be added.");
        const known = await findProfileByUrl(tx, n.canonicalUrl);
        if (known) {
          // Creators hidden from customers (possible minors, removal requested) are not found here either, as in search.
          if (!(await isVisibleCreator(tx, known.creatorId))) throw new AppError("NOT_FOUND", "This creator can't be added.");
          return { answer: { status: "known", creatorId: known.creatorId } };
        }
        const segment = n.canonicalUrl.split("/").pop() ?? "";
        return { platform: n.platform, handle: segment.replace(/^@/, ""), canonicalUrl: n.canonicalUrl, creatorId: null, inputUrl: body.url };
      }
      const t = await profileTarget(tx, body.creatorId);
      if (!t || !(await isVisibleCreator(tx, body.creatorId))) throw new AppError("NOT_FOUND", "Creator not found");
      const settings = await getEnrichmentSettings(tx);
      if (t.lastScrapedAt && now().getTime() - t.lastScrapedAt.getTime() < settings.refreshMinAgeHours * 3_600_000) {
        return { answer: { status: "up_to_date", creatorId: body.creatorId, updatedAt: t.lastScrapedAt.toISOString() } };
      }
      return { platform: t.platform, handle: t.handle.replace(/^@/, ""), canonicalUrl: t.canonicalUrl, creatorId: body.creatorId, inputUrl: null };
    });
  }

  /** Spec §6: reserve, create the job and announce it in one transaction; free answers never reserve. */
  async function start(ctx: TenantContext, body: StartDiscoveryJob): Promise<{ httpStatus: 200 | 202; body: StartDiscoveryJobResponse }> {
    // Live runs start in Task 7 of sub-project 4B.
    if (body.kind === "live") throw new AppError("VALIDATION_FAILED", "Finding new creators is not available yet.");
    const target = await resolve(ctx, body);
    if ("answer" in target) return { httpStatus: 200, body: target.answer };
    try {
      return await deps.db.withTenant(tenant(ctx), async (tx) => {
        const open = await repo.openJobFor(tx, ctx.workspaceId, target.canonicalUrl);
        if (open) return { httpStatus: 200 as const, body: { status: "started" as const, job: repo.toApiJob(open) } };
        const jobId = randomUUID();
        const held = await deps.billing.engine.reserve(
          tx,
          ctx.workspaceId,
          { action: refreshActionFor(target.platform), confirmedCost: body.confirmedCost, refType: "discovery_job", refId: jobId },
          { userId: ctx.userId, requestId: ctx.requestId },
        );
        const row = await repo.insertJob(tx, {
          id: jobId,
          workspaceId: ctx.workspaceId,
          kind: body.kind,
          requestedBy: ctx.userId,
          inputUrl: target.inputUrl,
          platform: target.platform,
          handle: target.handle,
          canonicalUrl: target.canonicalUrl,
          creatorId: target.creatorId,
          reservationId: held.reservationId,
          cost: held.amount,
          requestId: ctx.requestId,
        });
        await writeOutbox(tx, {
          eventType: body.kind === "add_by_url" ? "discovery.requested" : "refresh.requested",
          aggregateType: "discovery_job",
          aggregateId: jobId,
          workspaceId: ctx.workspaceId,
          payload: { jobId },
          requestId: ctx.requestId,
        });
        return { httpStatus: 202 as const, body: { status: "started" as const, job: repo.toApiJob(row) } };
      });
    } catch (err) {
      // A simultaneous request created the job first; its transaction (and this one's reservation) rolled back.
      if (!isOneOpenViolation(err)) throw err;
      const open = await deps.db.withTenant(tenant(ctx), (tx) => repo.openJobFor(tx, ctx.workspaceId, target.canonicalUrl));
      if (!open) throw err;
      return { httpStatus: 200, body: { status: "started", job: repo.toApiJob(open) } };
    }
  }

  async function get(ctx: TenantContext, id: string): Promise<DiscoveryJob> {
    const row = await deps.db.withTenant(tenant(ctx), (tx) => repo.getJob(tx, ctx.workspaceId, id));
    if (!row) throw new AppError("NOT_FOUND", "Job not found");
    return repo.toApiJob(row);
  }

  async function listActive(ctx: TenantContext): Promise<{ jobs: DiscoveryJob[] }> {
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.recentJobs(tx, ctx.workspaceId, new Date(now().getTime() - 10 * 60_000)));
    return { jobs: rows.map(repo.toApiJob) };
  }

  return { start, get, listActive };
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;
