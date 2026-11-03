import { searchFiltersSchema, type CreateList, type ListDetail, type ListSummary, type UpdateList } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { ineligibleCreatorIds, ineligibleError, rankCards, type SourcePolicy } from "../creators/index";
import * as repo from "./repository";

export type ListsDeps = { db: Db; now?: () => Date; sourcePolicy?: SourcePolicy };

const isDuplicateName = (err: unknown) => {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (/lists_workspace_name_idx/.test(e.message)) return true;
  return false;
};
const duplicateName = () => new AppError("CONFLICT", "A list with this name already exists in your team.", { field: "name" });

function toSummary(r: repo.SummaryRow): ListSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    favorite: r.favorite,
    count: r.count,
    preview: r.preview,
    ...(r.containsCreator === null ? {} : { containsCreator: r.containsCreator }),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Workspace lists of saved creators (CRM-001). Every query runs under the tenant's RLS context. */
export function createListsService(deps: ListsDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  async function index(ctx: TenantContext, creatorId?: string): Promise<{ lists: ListSummary[] }> {
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.summaries(tx, ctx.workspaceId, creatorId ? { creatorId } : {}));
    return { lists: rows.map(toSummary) };
  }

  async function detail(ctx: TenantContext, id: string): Promise<ListDetail> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const [summary] = await repo.summaries(tx, ctx.workspaceId, { listId: id });
      if (!summary) throw new AppError("NOT_FOUND", "List not found");
      const rows = await repo.members(tx, ctx.workspaceId, id);
      // Hidden creators (erasure pending, possible minors) are left out by the card query itself.
      const cards = new Map((await rankCards(tx, rows.map((r) => r.creatorId), searchFiltersSchema.parse({}), now(), deps.sourcePolicy)).map((c) => [c.id, c]));
      return {
        ...toSummary(summary),
        members: rows.flatMap((r) => {
          const card = cards.get(r.creatorId);
          return card ? [{ creator: card, note: r.note, addedAt: r.addedAt.toISOString() }] : [];
        }),
      };
    });
  }

  async function create(ctx: TenantContext, body: Required<CreateList>): Promise<ListSummary> {
    try {
      return await deps.db.withTenant(tenant(ctx), async (tx) => {
        if ((await repo.countLists(tx, ctx.workspaceId)) >= repo.MAX_LISTS) throw new AppError("CONFLICT", `A team can keep up to ${repo.MAX_LISTS} lists. Delete one first.`);
        const row = await repo.insertList(tx, { workspaceId: ctx.workspaceId, name: body.name, description: body.description, createdBy: ctx.userId });
        const [summary] = await repo.summaries(tx, ctx.workspaceId, { listId: row.id });
        if (!summary) throw new Error("created list not readable");
        return toSummary(summary);
      });
    } catch (err) {
      if (isDuplicateName(err)) throw duplicateName();
      throw err;
    }
  }

  async function update(ctx: TenantContext, id: string, patch: UpdateList): Promise<ListSummary> {
    try {
      return await deps.db.withTenant(tenant(ctx), async (tx) => {
        const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        if (!(await repo.updateList(tx, ctx.workspaceId, id, clean))) throw new AppError("NOT_FOUND", "List not found");
        const [summary] = await repo.summaries(tx, ctx.workspaceId, { listId: id });
        if (!summary) throw new AppError("NOT_FOUND", "List not found");
        return toSummary(summary);
      });
    } catch (err) {
      if (isDuplicateName(err)) throw duplicateName();
      throw err;
    }
  }

  async function remove(ctx: TenantContext, id: string): Promise<void> {
    const deleted = await deps.db.withTenant(tenant(ctx), (tx) => repo.deleteList(tx, ctx.workspaceId, id));
    if (!deleted) throw new AppError("NOT_FOUND", "List not found");
  }

  /** Idempotent: creators already on the list are reported, not duplicated. Only visible creators can be saved. */
  async function addMembers(ctx: TenantContext, id: string, creatorIds: string[]): Promise<{ added: number; alreadyOnList: number }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if (!(await repo.listExists(tx, ctx.workspaceId, id))) throw new AppError("NOT_FOUND", "List not found");
      const unique = [...new Set(creatorIds)];
      const visible = await repo.visibleCreatorIds(tx, unique);
      if (visible.length !== unique.length) throw new AppError("VALIDATION_FAILED", "Some of these creators can't be saved (not found or no longer available).", { field: "creatorIds" });
      // Creator eligibility (elig-1) is enforced here too, so a direct API call cannot save a creator search would hide.
      const ineligible = await ineligibleCreatorIds(tx, unique, now());
      if (ineligible.length > 0) throw ineligibleError(ineligible);
      if ((await repo.countMembers(tx, ctx.workspaceId, id)) + unique.length > repo.MAX_MEMBERS) {
        throw new AppError("CONFLICT", `A list can hold up to ${repo.MAX_MEMBERS} creators.`);
      }
      const added = await repo.addMembers(tx, ctx.workspaceId, id, unique, ctx.userId);
      if (added > 0) await repo.touchList(tx, ctx.workspaceId, id);
      return { added, alreadyOnList: unique.length - added };
    });
  }

  async function removeMembers(ctx: TenantContext, id: string, creatorIds: string[]): Promise<{ removed: number }> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if (!(await repo.listExists(tx, ctx.workspaceId, id))) throw new AppError("NOT_FOUND", "List not found");
      const removed = await repo.removeMembers(tx, ctx.workspaceId, id, [...new Set(creatorIds)]);
      if (removed > 0) await repo.touchList(tx, ctx.workspaceId, id);
      return { removed };
    });
  }

  async function setNote(ctx: TenantContext, id: string, creatorId: string, note: string): Promise<void> {
    const ok = await deps.db.withTenant(tenant(ctx), (tx) => repo.setNote(tx, ctx.workspaceId, id, creatorId, note));
    if (!ok) throw new AppError("NOT_FOUND", "This creator is not on the list");
  }

  return { index, detail, create, update, remove, addMembers, removeMembers, setNote };
}

export type ListsService = ReturnType<typeof createListsService>;
