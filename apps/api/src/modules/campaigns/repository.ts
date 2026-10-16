import { and, desc, eq, ne, sql } from "drizzle-orm";
import { campaignCreators, campaigns, outreachEvents, type TenantTx } from "@mushin/db";

export type CampaignRow = typeof campaigns.$inferSelect;
export type MemberRow = typeof campaignCreators.$inferSelect;
export type OutreachRow = typeof outreachEvents.$inferSelect & { loggedByName: string };
export type SummaryRow = CampaignRow & {
  creatorCount: number;
  identified: number;
  contacted: number;
  negotiating: number;
  confirmed: number;
  declinedCount: number;
  agreedFeesMinor: number;
  containsCreator: boolean | null;
};

/** Same visibility rule as search: hidden creators are not counted or shown (they come back if unhidden). */
const VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;
export const MAX_CAMPAIGNS = 500;
export const MAX_CREATORS = 500;

export async function summaries(tx: TenantTx, workspaceId: string, o: { campaignId?: string; creatorId?: string } = {}): Promise<SummaryRow[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select k.*, coalesce(s.creator_count, 0)::int as "creatorCount",
      coalesce(s.identified, 0)::int as identified, coalesce(s.contacted, 0)::int as contacted,
      coalesce(s.negotiating, 0)::int as negotiating, coalesce(s.confirmed, 0)::int as confirmed,
      coalesce(s.declined, 0)::int as "declinedCount", coalesce(s.agreed_fees, 0)::bigint as "agreedFeesMinor",
      ${o.creatorId ? sql`exists (select 1 from wp.campaign_creators x where x.campaign_id = k.id and x.creator_id = ${o.creatorId})` : sql`null`} as "containsCreator"
    from wp.campaigns k
    left join lateral (
      select count(*) as creator_count,
        count(*) filter (where m.outcome = 'open' and m.stage = 'identified') as identified,
        count(*) filter (where m.outcome = 'open' and m.stage = 'contacted') as contacted,
        count(*) filter (where m.outcome = 'open' and m.stage = 'negotiating') as negotiating,
        count(*) filter (where m.outcome = 'open' and m.stage = 'confirmed') as confirmed,
        count(*) filter (where m.outcome = 'declined') as declined,
        sum(m.fee_minor) filter (where m.outcome = 'open' and m.fee_kind = 'agreed') as agreed_fees
      from wp.campaign_creators m join gcp.creators c on c.id = m.creator_id
      where m.campaign_id = k.id and ${VISIBLE}
    ) s on true
    where k.workspace_id = ${workspaceId} ${o.campaignId ? sql`and k.id = ${o.campaignId}` : sql``}
    order by k.updated_at desc
    limit ${MAX_CAMPAIGNS}`);
  return rows.map((r) => ({
    id: r["id"] as string,
    workspaceId: r["workspace_id"] as string,
    name: r["name"] as string,
    status: r["status"] as CampaignRow["status"],
    platform: r["platform"] as CampaignRow["platform"],
    client: r["client"] as string,
    objective: r["objective"] as string,
    notes: r["notes"] as string,
    budgetMinor: r["budget_minor"] === null ? null : Number(r["budget_minor"]),
    currency: r["currency"] as string,
    startDate: (r["start_date"] as string | null) ?? null,
    endDate: (r["end_date"] as string | null) ?? null,
    createdBy: r["created_by"] as string,
    archivedAt: r["archived_at"] ? new Date(r["archived_at"] as string) : null,
    createdAt: new Date(r["created_at"] as string),
    updatedAt: new Date(r["updated_at"] as string),
    creatorCount: Number(r["creatorCount"]),
    identified: Number(r["identified"]),
    contacted: Number(r["contacted"]),
    negotiating: Number(r["negotiating"]),
    confirmed: Number(r["confirmed"]),
    declinedCount: Number(r["declinedCount"]),
    agreedFeesMinor: Number(r["agreedFeesMinor"]),
    containsCreator: (r["containsCreator"] as boolean | null) ?? null,
  }));
}

/** Campaigns that count towards the plan limit: every campaign that is not archived (owner rule 2026-10-16). */
export async function countCampaignsForLimit(tx: TenantTx, workspaceId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), ne(campaigns.status, "archived")));
  return r?.n ?? 0;
}

/** Serialises campaign creation and un-archiving per workspace, so concurrent requests cannot pass the limit together. */
export async function lockCampaignLimit(tx: TenantTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"campaign-limit:" + workspaceId}, 0))`);
}

export async function countCampaigns(tx: TenantTx, workspaceId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.workspaceId, workspaceId));
  return r?.n ?? 0;
}

export async function insertCampaign(tx: TenantTx, row: typeof campaigns.$inferInsert): Promise<CampaignRow> {
  const [r] = await tx.insert(campaigns).values(row).returning();
  if (!r) throw new Error("campaign insert returned no row");
  return r;
}

export async function updateCampaign(tx: TenantTx, workspaceId: string, id: string, patch: Partial<typeof campaigns.$inferInsert>): Promise<CampaignRow | null> {
  const [r] = await tx.update(campaigns).set(patch).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, id))).returning();
  return r ?? null;
}

export async function deleteCampaign(tx: TenantTx, workspaceId: string, id: string): Promise<boolean> {
  return (await tx.delete(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, id))).returning({ id: campaigns.id })).length === 1;
}

export async function lockCampaign(tx: TenantTx, workspaceId: string, id: string): Promise<CampaignRow | null> {
  const [r] = await tx.select().from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, id))).for("update").limit(1);
  return r ?? null;
}

export async function touchCampaign(tx: TenantTx, workspaceId: string, id: string): Promise<void> {
  await tx.update(campaigns).set({ updatedAt: sql`now()` }).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, id)));
}

export function members(tx: TenantTx, workspaceId: string, campaignId: string): Promise<MemberRow[]> {
  return tx.select().from(campaignCreators).where(and(eq(campaignCreators.workspaceId, workspaceId), eq(campaignCreators.campaignId, campaignId))).orderBy(desc(campaignCreators.addedAt)).limit(MAX_CREATORS);
}

export async function member(tx: TenantTx, workspaceId: string, campaignId: string, creatorId: string, lock = false): Promise<MemberRow | null> {
  const q = tx.select().from(campaignCreators).where(and(eq(campaignCreators.workspaceId, workspaceId), eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)));
  const [r] = await (lock ? q.for("update") : q).limit(1);
  return r ?? null;
}

export async function countMembers(tx: TenantTx, workspaceId: string, campaignId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(campaignCreators).where(and(eq(campaignCreators.workspaceId, workspaceId), eq(campaignCreators.campaignId, campaignId)));
  return r?.n ?? 0;
}

export async function visibleCreatorIds(tx: TenantTx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  return (await tx.execute<{ id: string }>(sql`select c.id from gcp.creators c where c.id in ${ids} and ${VISIBLE}`)).map((r) => r.id);
}

export async function addMembers(tx: TenantTx, workspaceId: string, campaignId: string, creatorIds: string[], addedBy: string): Promise<number> {
  if (creatorIds.length === 0) return 0;
  const rows = await tx
    .insert(campaignCreators)
    .values(creatorIds.map((creatorId) => ({ campaignId, workspaceId, creatorId, addedBy })))
    .onConflictDoNothing({ target: [campaignCreators.campaignId, campaignCreators.creatorId] })
    .returning({ creatorId: campaignCreators.creatorId });
  return rows.length;
}

export async function removeMember(tx: TenantTx, workspaceId: string, campaignId: string, creatorId: string): Promise<boolean> {
  const rows = await tx
    .delete(campaignCreators)
    .where(and(eq(campaignCreators.workspaceId, workspaceId), eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)))
    .returning({ creatorId: campaignCreators.creatorId });
  return rows.length === 1;
}

/** Applies the change and bumps the version; the caller has locked the row and checked the expected version. */
export async function updateMember(tx: TenantTx, workspaceId: string, campaignId: string, creatorId: string, patch: Partial<typeof campaignCreators.$inferInsert>): Promise<MemberRow> {
  const [r] = await tx
    .update(campaignCreators)
    .set({ ...patch, version: sql`${campaignCreators.version} + 1` })
    .where(and(eq(campaignCreators.workspaceId, workspaceId), eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)))
    .returning();
  if (!r) throw new Error("campaign creator vanished while locked");
  return r;
}

const peopleNames = sql`(select p.display_name from platform.workspace_people() p where p.id = e.logged_by)`;

export async function insertOutreach(tx: TenantTx, row: typeof outreachEvents.$inferInsert): Promise<OutreachRow> {
  const [r] = await tx.insert(outreachEvents).values(row).returning();
  if (!r) throw new Error("outreach insert returned no row");
  const [name] = await tx.execute<{ n: string | null }>(sql`select display_name as n from platform.workspace_people() where id = ${r.loggedBy}`);
  return { ...r, loggedByName: name?.n ?? "Former member" };
}

export async function outreachFor(tx: TenantTx, workspaceId: string, campaignId: string, creatorId: string): Promise<OutreachRow[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select e.*, coalesce(${peopleNames}, 'Former member') as logged_by_name from wp.outreach_events e
    where e.workspace_id = ${workspaceId} and e.campaign_id = ${campaignId} and e.creator_id = ${creatorId}
    order by e.occurred_at desc, e.created_at desc limit 200`);
  return rows.map(toOutreach);
}

/** The latest logged outreach for each creator in a campaign. */
export async function latestOutreach(tx: TenantTx, workspaceId: string, campaignId: string): Promise<Map<string, OutreachRow>> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select distinct on (e.creator_id) e.*, coalesce(${peopleNames}, 'Former member') as logged_by_name from wp.outreach_events e
    where e.workspace_id = ${workspaceId} and e.campaign_id = ${campaignId}
    order by e.creator_id, e.occurred_at desc, e.created_at desc`);
  return new Map(rows.map((r) => [r["creator_id"] as string, toOutreach(r)]));
}

function toOutreach(r: Record<string, unknown>): OutreachRow {
  return {
    id: r["id"] as string,
    workspaceId: r["workspace_id"] as string,
    campaignId: r["campaign_id"] as string,
    creatorId: r["creator_id"] as string,
    channel: r["channel"] as OutreachRow["channel"],
    outcome: r["outcome"] as OutreachRow["outcome"],
    note: r["note"] as string,
    occurredAt: new Date(r["occurred_at"] as string),
    loggedBy: r["logged_by"] as string,
    createdAt: new Date(r["created_at"] as string),
    loggedByName: r["logged_by_name"] as string,
  };
}
