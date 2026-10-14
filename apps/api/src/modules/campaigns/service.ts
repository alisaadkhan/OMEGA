import {
  searchFiltersSchema,
  type CampaignCreator,
  type CampaignDetail,
  type CampaignSummary,
  type CreateCampaign,
  type LogOutreach,
  type OutreachEvent,
  type PipelineStage,
  type UpdateCampaign,
  type UpdateCampaignCreator,
} from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { rankCards, type SourcePolicy } from "../creators/index";
import * as repo from "./repository";

export type CampaignsDeps = { db: Db; now?: () => Date; sourcePolicy?: SourcePolicy };

const FEE_KIND_FOR: Record<PipelineStage, "estimated" | "quoted" | "agreed"> = { identified: "estimated", contacted: "estimated", negotiating: "quoted", confirmed: "agreed" };
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function toSummary(r: repo.SummaryRow): CampaignSummary {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    platform: r.platform,
    client: r.client,
    objective: r.objective,
    notes: r.notes,
    budgetMinor: r.budgetMinor,
    currency: "PKR",
    startDate: r.startDate,
    endDate: r.endDate,
    creatorCount: r.creatorCount,
    stageCounts: { identified: r.identified, contacted: r.contacted, negotiating: r.negotiating, confirmed: r.confirmed },
    declinedCount: r.declinedCount,
    agreedFeesMinor: r.agreedFeesMinor,
    ...(r.containsCreator === null ? {} : { containsCreator: r.containsCreator }),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const toEvent = (e: repo.OutreachRow): OutreachEvent => ({
  id: e.id,
  channel: e.channel,
  outcome: e.outcome,
  note: e.note,
  occurredAt: e.occurredAt.toISOString(),
  loggedBy: { id: e.loggedBy, name: e.loggedByName },
});

/** Minimal campaign pipeline and manual outreach log (CRM-001). Every query runs under the tenant's RLS context. */
export function createCampaignsService(deps: CampaignsDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const notFound = () => new AppError("NOT_FOUND", "Campaign not found");

  async function summaryOf(tx: Parameters<Parameters<Db["withTenant"]>[1]>[0], ctx: TenantContext, id: string) {
    const [s] = await repo.summaries(tx, ctx.workspaceId, { campaignId: id });
    if (!s) throw notFound();
    return toSummary(s);
  }

  async function index(ctx: TenantContext, creatorId?: string): Promise<{ campaigns: CampaignSummary[] }> {
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.summaries(tx, ctx.workspaceId, creatorId ? { creatorId } : {}));
    return { campaigns: rows.map(toSummary) };
  }

  async function detail(ctx: TenantContext, id: string): Promise<CampaignDetail> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const summary = await summaryOf(tx, ctx, id);
      const rows = await repo.members(tx, ctx.workspaceId, id);
      const cards = new Map((await rankCards(tx, rows.map((r) => r.creatorId), searchFiltersSchema.parse({}), now(), deps.sourcePolicy)).map((c) => [c.id, c]));
      const latest = await repo.latestOutreach(tx, ctx.workspaceId, id);
      const creators: CampaignCreator[] = rows.flatMap((r) => {
        const card = cards.get(r.creatorId);
        if (!card) return []; // hidden since being added
        const last = latest.get(r.creatorId);
        return [{
          creator: card,
          stage: r.stage,
          outcome: r.outcome,
          contentStatus: r.contentStatus,
          priority: r.priority,
          feeMinor: r.feeMinor,
          feeKind: r.feeKind,
          dueDate: r.dueDate,
          note: r.note,
          version: r.version,
          addedAt: r.addedAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          lastOutreach: last ? toEvent(last) : null,
        }];
      });
      return { ...summary, creators };
    });
  }

  async function create(ctx: TenantContext, body: Required<CreateCampaign>): Promise<CampaignSummary> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if ((await repo.countCampaigns(tx, ctx.workspaceId)) >= repo.MAX_CAMPAIGNS) throw new AppError("CONFLICT", `A workspace can keep up to ${repo.MAX_CAMPAIGNS} campaigns.`);
      const row = await repo.insertCampaign(tx, { ...body, workspaceId: ctx.workspaceId, createdBy: ctx.userId });
      return summaryOf(tx, ctx, row.id);
    });
  }

  async function update(ctx: TenantContext, id: string, patch: UpdateCampaign): Promise<CampaignSummary> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const current = await repo.lockCampaign(tx, ctx.workspaceId, id);
      if (!current) throw notFound();
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<repo.CampaignRow>;
      const start = clean.startDate !== undefined ? clean.startDate : current.startDate;
      const end = clean.endDate !== undefined ? clean.endDate : current.endDate;
      if (start && end && end < start) throw new AppError("VALIDATION_FAILED", "The end date must be on or after the start date", { field: "endDate" });
      await repo.updateCampaign(tx, ctx.workspaceId, id, clean);
      return summaryOf(tx, ctx, id);
    });
  }

  async function remove(ctx: TenantContext, id: string): Promise<void> {
    if (!(await deps.db.withTenant(tenant(ctx), (tx) => repo.deleteCampaign(tx, ctx.workspaceId, id)))) throw notFound();
  }

  /** Idempotent; only creators customers can see can be added. */
  async function addCreators(ctx: TenantContext, id: string, creatorIds: string[]): Promise<{ added: number; alreadyInCampaign: number }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if (!(await repo.lockCampaign(tx, ctx.workspaceId, id))) throw notFound();
      const unique = [...new Set(creatorIds)];
      if ((await repo.visibleCreatorIds(tx, unique)).length !== unique.length) {
        throw new AppError("VALIDATION_FAILED", "Some of these creators can't be added (not found or no longer available).", { field: "creatorIds" });
      }
      if ((await repo.countMembers(tx, ctx.workspaceId, id)) + unique.length > repo.MAX_CREATORS) throw new AppError("CONFLICT", `A campaign can hold up to ${repo.MAX_CREATORS} creators.`);
      const added = await repo.addMembers(tx, ctx.workspaceId, id, unique, ctx.userId);
      if (added > 0) await repo.touchCampaign(tx, ctx.workspaceId, id);
      return { added, alreadyInCampaign: unique.length - added };
    });
  }

  async function removeCreator(ctx: TenantContext, id: string, creatorId: string): Promise<void> {
    await deps.db.withTenant(tenant(ctx), async (tx) => {
      if (!(await repo.removeMember(tx, ctx.workspaceId, id, creatorId))) throw new AppError("NOT_FOUND", "This creator is not in the campaign");
      await repo.touchCampaign(tx, ctx.workspaceId, id);
    });
  }

  /** Stage, outcome, content, fee and notes. A stale `expectedVersion` (someone else saved first) answers 409. */
  async function updateCreator(ctx: TenantContext, id: string, creatorId: string, body: UpdateCampaignCreator): Promise<{ version: number }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const current = await repo.member(tx, ctx.workspaceId, id, creatorId, true);
      if (!current) throw new AppError("NOT_FOUND", "This creator is not in the campaign");
      if (current.version !== body.expectedVersion) {
        throw new AppError("CONFLICT", "Someone else updated this creator a moment ago. Reload to see their change, then try again.", { currentVersion: current.version });
      }
      const patch = Object.fromEntries(Object.entries(body).filter(([k, v]) => k !== "expectedVersion" && v !== undefined)) as Partial<repo.MemberRow>;
      // Moving stage relabels the fee (estimated → quoted → agreed) unless the change says otherwise.
      if (patch.stage && patch.stage !== current.stage && patch.feeKind === undefined) patch.feeKind = FEE_KIND_FOR[patch.stage];
      const row = await repo.updateMember(tx, ctx.workspaceId, id, creatorId, patch);
      await repo.touchCampaign(tx, ctx.workspaceId, id);
      return { version: row.version };
    });
  }

  async function logOutreach(ctx: TenantContext, id: string, creatorId: string, body: Required<Omit<LogOutreach, "occurredAt">> & { occurredAt?: string }): Promise<OutreachEvent> {
    const at = body.occurredAt ? new Date(body.occurredAt) : now();
    if (at.getTime() > now().getTime() + MAX_CLOCK_SKEW_MS) throw new AppError("VALIDATION_FAILED", "Outreach can't be logged in the future", { field: "occurredAt" });
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if (!(await repo.member(tx, ctx.workspaceId, id, creatorId))) throw new AppError("NOT_FOUND", "This creator is not in the campaign");
      const row = await repo.insertOutreach(tx, { workspaceId: ctx.workspaceId, campaignId: id, creatorId, channel: body.channel, outcome: body.outcome, note: body.note, occurredAt: at, loggedBy: ctx.userId });
      await repo.touchCampaign(tx, ctx.workspaceId, id);
      return toEvent(row);
    });
  }

  async function outreach(ctx: TenantContext, id: string, creatorId: string): Promise<{ events: OutreachEvent[] }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if (!(await repo.member(tx, ctx.workspaceId, id, creatorId))) throw new AppError("NOT_FOUND", "This creator is not in the campaign");
      return { events: (await repo.outreachFor(tx, ctx.workspaceId, id, creatorId)).map(toEvent) };
    });
  }

  return { index, detail, create, update, remove, addCreators, removeCreator, updateCreator, logOutreach, outreach };
}

export type CampaignsService = ReturnType<typeof createCampaignsService>;
