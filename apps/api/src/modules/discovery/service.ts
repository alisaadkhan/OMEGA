import { randomUUID } from "node:crypto";
import { searchFiltersSchema, validateLiveBrief, type CreateLiveEstimate, type DiscoveryJob, type DiscoveryResult, type LiveEstimate, type LiveRunSize, type LiveSearch, type StartDiscoveryJob, type StartDiscoveryJobResponse } from "@mushin/contracts";
import { AppError, sha256Hex, stableJson, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db } from "@mushin/db";
import type { BillingService } from "../billing/index";
import { findProfileByUrl, fitLabel, getEnrichmentSettings, getSearchSettings, isVisibleCreator, suppressedUrls, type SourcePolicy, normalizeProfileUrl, profileTarget, rankCards, refreshActionFor, type CreatorPlatform } from "../creators/index";
import { platformsFor } from "./live/queries";
import * as repo from "./repository";

export type DiscoveryDeps = { db: Db; billing: Pick<BillingService, "engine">; now?: () => Date; sourcePolicy?: SourcePolicy };

const isOneOpenViolation = (err: unknown) => {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (/discovery_jobs_one_open/.test(e.message)) return true;
  return false;
};

/**
 * A simultaneous request may have created the job first: it either trips the one-open-job index or, having reserved the
 * credits first, leaves too few for this one. Either way the open job is the answer (one charge for repeated clicks).
 */
const mayBeDuplicate = (err: unknown) => isOneOpenViolation(err) || (err instanceof AppError && err.code === "INSUFFICIENT_CREDITS");

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
    if (body.kind === "live") return startLive(ctx, body.estimateId);
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

  async function createEstimate(ctx: TenantContext, body: CreateLiveEstimate): Promise<LiveEstimate> {
    const validation = validateLiveBrief(body.search);
    if (!validation.ok) {
      throw new AppError("QUERY_TOO_BROAD", "Add a creator topic and a city, country or language before starting live discovery.", {
        missingRequirements: validation.missingRequirements,
        specificity: validation.specificity,
      });
    }
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      // A base fee plus one price per new qualified creator, the same on every platform (owner pricing 2026-10-14);
      // provider cost is recorded separately and never shown as the customer price.
      const c = await deps.billing.engine.costs(tx, ["find_new", "live_creator"]);
      const prices = { search: c.find_new, instagram: c.live_creator, youtube: c.live_creator, tiktok: c.live_creator };
      const perCreator = Math.max(...platformsFor(body.search).map((p) => prices[p]));
      const maxCredits = prices.search + body.maxNew * perCreator;
      const expiresAt = new Date(now().getTime() + 15 * 60_000);
      const priceVersion = sha256Hex(stableJson(prices)).slice(0, 24);
      const estimate = await repo.insertEstimate(tx, {
        workspaceId: ctx.workspaceId,
        requestedBy: ctx.userId,
        search: body.search,
        maxNew: body.maxNew,
        searchHash: searchHash(body.search, body.maxNew),
        prices,
        maxCredits,
        priceVersion,
        expiresAt,
      });
      return { estimateId: estimate.id, maxCredits, priceVersion, expiresAt: expiresAt.toISOString() };
    });
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

  /** A stored, unexpired estimate is the only authority for a live run's brief, cap and price. */
  async function startLive(ctx: TenantContext, estimateId: string): Promise<{ httpStatus: 200 | 202; body: StartDiscoveryJobResponse }> {
    try {
      return await deps.db.withTenant(tenant(ctx), async (tx) => {
        const estimate = await repo.estimateForUpdate(tx, ctx.workspaceId, estimateId);
        if (!estimate) throw new AppError("NOT_FOUND", "Estimate not found");
        if (estimate.requestedBy !== ctx.userId) throw new AppError("NOT_FOUND", "Estimate not found");
        if (estimate.consumedAt) {
          const existing = estimate.jobId ? await repo.getJob(tx, ctx.workspaceId, estimate.jobId) : null;
          if (existing) return { httpStatus: 200 as const, body: { status: "started" as const, job: repo.toApiJob(existing) } };
          throw new AppError("CONFLICT", "This estimate has already been used");
        }
        if (estimate.expiresAt <= now()) throw new AppError("CONFLICT", "This estimate expired. Request a new estimate before continuing.");
        const search: LiveSearch = { text: estimate.search.text, filters: searchFiltersSchema.parse(estimate.search.filters) };
        const validation = validateLiveBrief(search);
        if (!validation.ok) {
          throw new AppError("QUERY_TOO_BROAD", "Add a creator topic and a city, country or language before starting live discovery.", {
            missingRequirements: validation.missingRequirements,
            specificity: validation.specificity,
          });
        }
        const hash = searchHash(search, estimate.maxNew as LiveRunSize);
        if (hash !== estimate.searchHash) throw new AppError("CONFLICT", "The estimate no longer matches this brief. Request a new estimate.");
        const open = await repo.openLiveJobFor(tx, ctx.workspaceId, hash);
        if (open) {
          await repo.consumeEstimate(tx, ctx.workspaceId, estimate.id, open.id);
          return { httpStatus: 200 as const, body: { status: "started" as const, job: repo.toApiJob(open) } };
        }
        const jobId = randomUUID();
        const held = await deps.billing.engine.reserveAmount(
          tx,
          ctx.workspaceId,
          { action: "find_new", amount: estimate.maxCredits, confirmedCost: estimate.maxCredits, refType: "discovery_job", refId: jobId },
          { userId: ctx.userId, requestId: ctx.requestId },
        );
        const row = await repo.insertJob(tx, {
          id: jobId,
          workspaceId: ctx.workspaceId,
          kind: "live",
          requestedBy: ctx.userId,
          search,
          maxNew: estimate.maxNew,
          searchHash: hash,
          prices: estimate.prices,
          reservationId: held.reservationId,
          cost: held.amount,
          requestId: ctx.requestId,
        });
        await repo.consumeEstimate(tx, ctx.workspaceId, estimate.id, jobId);
        await writeOutbox(tx, { eventType: "discovery.live_requested", aggregateType: "discovery_job", aggregateId: jobId, workspaceId: ctx.workspaceId, payload: { jobId }, requestId: ctx.requestId });
        return { httpStatus: 202 as const, body: { status: "started" as const, job: repo.toApiJob(row) } };
      });
    } catch (err) {
      if (!mayBeDuplicate(err)) throw err;
      const open = await deps.db.withTenant(tenant(ctx), async (tx) => {
        const estimate = await repo.estimateForUpdate(tx, ctx.workspaceId, estimateId);
        return estimate ? repo.openLiveJobFor(tx, ctx.workspaceId, estimate.searchHash) : null;
      });
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
      const cards = new Map((await rankCards(tx, rows.map((r) => r.creatorId), filters, now(), deps.sourcePolicy)).map((c) => [c.id, c]));
      const settings = await getSearchSettings(tx);
      return {
        results: rows.flatMap((r) => {
          const card = cards.get(r.creatorId);
          const score = r.campaignFit?.score;
          return card ? [{ ...card, ...(score === null || score === undefined ? {} : { fitScore: score, fitLabel: fitLabel(score, settings.labels) }), seq: r.seq, rank: r.rank, isNew: r.isNew, reason: r.reason, campaignFit: r.campaignFit }] : [];
        }).sort((a, b) => a.rank - b.rank),
        done: job.status === "completed" || job.status === "failed",
      };
    });
  }

  /**
   * JOB-003: asks an open live run to stop. Only the request is recorded here; the worker stops at its next safe point
   * and settles as a partial run. Repeating it, or asking after the run finished, returns the job unchanged.
   */
  async function cancel(ctx: TenantContext, id: string): Promise<DiscoveryJob> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const updated = await repo.requestCancel(tx, ctx.workspaceId, id);
      if (updated) return repo.toApiJob(updated);
      const job = await repo.getJob(tx, ctx.workspaceId, id);
      if (!job || job.kind !== "live") throw new AppError("NOT_FOUND", "Job not found");
      return repo.toApiJob(job);
    });
  }

  return { createEstimate, start, get, listActive, results, cancel };
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;
