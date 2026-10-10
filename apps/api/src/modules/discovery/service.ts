import { randomUUID } from "node:crypto";
import { searchFiltersSchema, type DiscoveryJob, type DiscoveryResult, type LiveRunSize, type LiveSearch, type StartDiscoveryJob, type StartDiscoveryJobResponse } from "@mushin/contracts";
import { AppError, sha256Hex, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db } from "@mushin/db";
import type { BillingService } from "../billing/index";
import { findProfileByUrl, getEnrichmentSettings, isVisibleCreator, suppressedUrls, normalizeProfileUrl, profileTarget, rankCards, refreshActionFor, type CreatorPlatform } from "../creators/index";
import { platformsFor } from "./live/queries";
import * as repo from "./repository";

export type DiscoveryDeps = { db: Db; billing: Pick<BillingService, "engine">; now?: () => Date };

const isOneOpenViolation = (err: unknown) => {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (/discovery_jobs_one_open/.test(e.message)) return true;
  return false;
};

/**
 * A simultaneous request may have created the job first: it either trips the one-open-job index or, having reserved the
 * credits first, leaves too few for this one. Either way the open job is the answer (one charge for repeated clicks).
 */
const mayBeDuplicate = (err: unknown) => isOneOpenViolation(err) || (err instanceof AppError && err.code === "INSUFFICIENT_CREDITS");

/** Sorted-key JSON, so the same search always hashes the same way. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function searchHash(search: LiveSearch, maxNew: LiveRunSize): string {
  return sha256Hex(stableJson({ text: search.text.trim().toLowerCase(), filters: search.filters, maxNew }));
}

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
    if (body.kind === "live") return startLive(ctx, body);
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
      if (!mayBeDuplicate(err)) throw err;
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

  /** Spec §4.1: quote from current prices, reserve the maximum, create the run and announce it, in one transaction. */
  async function startLive(ctx: TenantContext, body: Extract<StartDiscoveryJob, { kind: "live" }>): Promise<{ httpStatus: 200 | 202; body: StartDiscoveryJobResponse }> {
    const search: LiveSearch = { text: body.search.text, filters: body.search.filters };
    const hash = searchHash(search, body.maxNew);
    try {
      return await deps.db.withTenant(tenant(ctx), async (tx) => {
        const open = await repo.openLiveJobFor(tx, ctx.workspaceId, hash);
        if (open) return { httpStatus: 200 as const, body: { status: "started" as const, job: repo.toApiJob(open) } };
        const c = await deps.billing.engine.costs(tx, ["find_new", "refresh_data", "refresh_tiktok"]);
        const prices = { search: c.find_new, instagram: c.refresh_data, youtube: c.refresh_data, tiktok: c.refresh_tiktok };
        const perCreator = Math.max(...platformsFor(search).map((p) => prices[p]));
        const jobId = randomUUID();
        const held = await deps.billing.engine.reserveAmount(
          tx,
          ctx.workspaceId,
          { action: "find_new", amount: prices.search + body.maxNew * perCreator, confirmedCost: body.confirmedCost, refType: "discovery_job", refId: jobId },
          { userId: ctx.userId, requestId: ctx.requestId },
        );
        const row = await repo.insertJob(tx, {
          id: jobId,
          workspaceId: ctx.workspaceId,
          kind: "live",
          requestedBy: ctx.userId,
          search,
          maxNew: body.maxNew,
          searchHash: hash,
          prices,
          reservationId: held.reservationId,
          cost: held.amount,
          requestId: ctx.requestId,
        });
        await writeOutbox(tx, { eventType: "discovery.live_requested", aggregateType: "discovery_job", aggregateId: jobId, workspaceId: ctx.workspaceId, payload: { jobId }, requestId: ctx.requestId });
        return { httpStatus: 202 as const, body: { status: "started" as const, job: repo.toApiJob(row) } };
      });
    } catch (err) {
      if (!mayBeDuplicate(err)) throw err;
      const open = await deps.db.withTenant(tenant(ctx), (tx) => repo.openLiveJobFor(tx, ctx.workspaceId, hash));
      if (!open) throw err;
      return { httpStatus: 200, body: { status: "started", job: repo.toApiJob(open) } };
    }
  }

  /** Spec §6: results after the polling cursor, as Brain 1 cards; hidden creators are left out. */
  async function results(ctx: TenantContext, id: string, after: number): Promise<{ results: DiscoveryResult[]; done: boolean }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const job = await repo.getJob(tx, ctx.workspaceId, id);
      if (!job || job.kind !== "live" || !job.search) throw new AppError("NOT_FOUND", "Job not found");
      const rows = await repo.resultsAfter(tx, ctx.workspaceId, id, after);
      const filters = searchFiltersSchema.parse(job.search.filters);
      const cards = new Map((await rankCards(tx, rows.map((r) => r.creatorId), filters, now())).map((c) => [c.id, c]));
      return {
        results: rows.flatMap((r) => {
          const card = cards.get(r.creatorId);
          return card ? [{ ...card, seq: r.seq, rank: r.rank, isNew: r.isNew, reason: r.reason }] : [];
        }),
        done: job.status === "completed" || job.status === "failed",
      };
    });
  }

  return { start, get, listActive, results };
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;
