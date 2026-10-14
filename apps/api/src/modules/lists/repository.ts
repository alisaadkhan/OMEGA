import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { listMembers, lists, type TenantTx } from "@mushin/db";

export type ListRow = typeof lists.$inferSelect;
export type SummaryRow = ListRow & { count: number; preview: { id: string; displayName: string; avatarUrl: string | null }[]; containsCreator: boolean | null };

/** Customers only ever see active creators that are not protected possible minors (same rule as search). */
const VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;

export const MAX_LISTS = 200;
export const MAX_MEMBERS = 1000;

export async function summaries(tx: TenantTx, workspaceId: string, o: { listId?: string; creatorId?: string } = {}): Promise<SummaryRow[]> {
  const rows = await tx.execute<Omit<SummaryRow, "createdAt" | "updatedAt"> & { createdAt: string | Date; updatedAt: string | Date }>(sql`
    select l.id, l.workspace_id as "workspaceId", l.name, l.description, l.favorite, l.created_by as "createdBy",
      l.created_at as "createdAt", l.updated_at as "updatedAt",
      (select count(*)::int from wp.list_members m join gcp.creators c on c.id = m.creator_id where m.list_id = l.id and ${VISIBLE}) as count,
      coalesce((select json_agg(json_build_object('id', p.id, 'displayName', p.display_name, 'avatarUrl', p.avatar_url))
        from (select c.id, c.display_name, c.avatar_url from wp.list_members m join gcp.creators c on c.id = m.creator_id
              where m.list_id = l.id and ${VISIBLE} order by m.added_at desc limit 3) p), '[]'::json) as preview,
      ${o.creatorId ? sql`exists (select 1 from wp.list_members m where m.list_id = l.id and m.creator_id = ${o.creatorId})` : sql`null`} as "containsCreator"
    from wp.lists l
    where l.workspace_id = ${workspaceId} ${o.listId ? sql`and l.id = ${o.listId}` : sql``}
    order by l.favorite desc, l.updated_at desc
    limit ${MAX_LISTS}`);
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) }));
}

export async function countLists(tx: TenantTx, workspaceId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(lists).where(eq(lists.workspaceId, workspaceId));
  return r?.n ?? 0;
}

export async function insertList(tx: TenantTx, row: typeof lists.$inferInsert): Promise<ListRow> {
  const [r] = await tx.insert(lists).values(row).returning();
  if (!r) throw new Error("list insert returned no row");
  return r;
}

export async function updateList(tx: TenantTx, workspaceId: string, id: string, patch: Partial<Pick<ListRow, "name" | "description" | "favorite">>): Promise<boolean> {
  const rows = await tx.update(lists).set(patch).where(and(eq(lists.workspaceId, workspaceId), eq(lists.id, id))).returning({ id: lists.id });
  return rows.length === 1;
}

/** Bumps the list's updated time when its members change (the index orders by it). */
export async function touchList(tx: TenantTx, workspaceId: string, id: string): Promise<void> {
  await tx.update(lists).set({ updatedAt: sql`now()` }).where(and(eq(lists.workspaceId, workspaceId), eq(lists.id, id)));
}

export async function deleteList(tx: TenantTx, workspaceId: string, id: string): Promise<boolean> {
  const rows = await tx.delete(lists).where(and(eq(lists.workspaceId, workspaceId), eq(lists.id, id))).returning({ id: lists.id });
  return rows.length === 1;
}

export async function listExists(tx: TenantTx, workspaceId: string, id: string): Promise<boolean> {
  const rows = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.workspaceId, workspaceId), eq(lists.id, id))).for("update").limit(1);
  return rows.length === 1;
}

export async function members(tx: TenantTx, workspaceId: string, listId: string): Promise<{ creatorId: string; note: string; addedAt: Date }[]> {
  return tx
    .select({ creatorId: listMembers.creatorId, note: listMembers.note, addedAt: listMembers.addedAt })
    .from(listMembers)
    .where(and(eq(listMembers.workspaceId, workspaceId), eq(listMembers.listId, listId)))
    .orderBy(desc(listMembers.addedAt))
    .limit(MAX_MEMBERS);
}

export async function countMembers(tx: TenantTx, workspaceId: string, listId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(listMembers).where(and(eq(listMembers.workspaceId, workspaceId), eq(listMembers.listId, listId)));
  return r?.n ?? 0;
}

/** Of the given ids, the creators customers can see (a hidden or unknown id cannot be saved). */
export async function visibleCreatorIds(tx: TenantTx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`select c.id from gcp.creators c where c.id in ${ids} and ${VISIBLE}`);
  return rows.map((r) => r.id);
}

/** Adds members; ones already on the list are left as they are. Returns how many were new. */
export async function addMembers(tx: TenantTx, workspaceId: string, listId: string, creatorIds: string[], addedBy: string): Promise<number> {
  if (creatorIds.length === 0) return 0;
  const rows = await tx
    .insert(listMembers)
    .values(creatorIds.map((creatorId) => ({ listId, workspaceId, creatorId, addedBy })))
    .onConflictDoNothing({ target: [listMembers.listId, listMembers.creatorId] })
    .returning({ creatorId: listMembers.creatorId });
  return rows.length;
}

export async function removeMembers(tx: TenantTx, workspaceId: string, listId: string, creatorIds: string[]): Promise<number> {
  const rows = await tx
    .delete(listMembers)
    .where(and(eq(listMembers.workspaceId, workspaceId), eq(listMembers.listId, listId), inArray(listMembers.creatorId, creatorIds)))
    .returning({ creatorId: listMembers.creatorId });
  return rows.length;
}

export async function setNote(tx: TenantTx, workspaceId: string, listId: string, creatorId: string, note: string): Promise<boolean> {
  const rows = await tx
    .update(listMembers)
    .set({ note })
    .where(and(eq(listMembers.workspaceId, workspaceId), eq(listMembers.listId, listId), eq(listMembers.creatorId, creatorId)))
    .returning({ creatorId: listMembers.creatorId });
  return rows.length === 1;
}
