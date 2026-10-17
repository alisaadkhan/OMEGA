import { and, desc, eq, sql } from "drizzle-orm";
import type { DataExport } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { dataExports, type Db, type TenantTx } from "@mushin/db";
import type { BillingService } from "../billing/index";

export type ExportsDeps = { db: Db; billing: Pick<BillingService, "getAccess">; enabled: boolean; now?: () => Date };

/** Rows one export may hold; a larger workspace is refused rather than given a silently cut file. */
export const MAX_EXPORT_ROWS = 20_000;
export const EXPORT_TTL_MS = 24 * 3_600_000;

/** One CSV cell: quoted, and a leading = + - @ (spreadsheet formula) neutralised with an apostrophe. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Creators the workspace may still see (removed and protected creators are left out, as everywhere else). */
const VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;

async function listRows(tx: TenantTx, workspaceId: string) {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select l.name as list, l.description, l.favorite, c.display_name, c.primary_handle, c.primary_platform, m.note, m.added_at
    from wp.lists l join wp.list_members m on m.list_id = l.id and m.workspace_id = l.workspace_id join gcp.creators c on c.id = m.creator_id
    where l.workspace_id = ${workspaceId} and ${VISIBLE}
    order by l.name, m.added_at limit ${MAX_EXPORT_ROWS + 1}`);
  return {
    header: ["List", "List description", "Favourite list", "Creator", "Handle", "Platform", "Note", "Added at"],
    rows: rows.map((r) => [r["list"], r["description"], r["favorite"] ? "yes" : "no", r["display_name"], r["primary_handle"], r["primary_platform"], r["note"], r["added_at"]]),
  };
}

async function campaignRows(tx: TenantTx, workspaceId: string) {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select k.name as campaign, k.status, k.client, c.display_name, c.primary_handle, c.primary_platform, m.stage, m.outcome,
      m.fee_kind, m.fee_minor, m.content_status, m.due_date, m.note, m.added_at
    from wp.campaigns k join wp.campaign_creators m on m.campaign_id = k.id and m.workspace_id = k.workspace_id join gcp.creators c on c.id = m.creator_id
    where k.workspace_id = ${workspaceId} and ${VISIBLE}
    order by k.name, m.added_at limit ${MAX_EXPORT_ROWS + 1}`);
  return {
    header: ["Campaign", "Campaign status", "Client", "Creator", "Handle", "Platform", "Stage", "Outcome", "Fee kind", "Fee (PKR)", "Content", "Due date", "Note", "Added at"],
    rows: rows.map((r) => [
      r["campaign"], r["status"], r["client"], r["display_name"], r["primary_handle"], r["primary_platform"], r["stage"], r["outcome"], r["fee_kind"],
      r["fee_minor"] === null ? "" : (Number(r["fee_minor"]) / 100).toFixed(2), r["content_status"], r["due_date"], r["note"], r["added_at"],
    ]),
  };
}

/**
 * Data export (owner plan model 2026-10-16: Scale only). Every request is checked against the role (owner or admin),
 * the plan entitlement and the server switch, on creation and again on download, so a downgrade stops downloads too.
 */
export function createExportsService(deps: ExportsDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  async function authorise(ctx: TenantContext) {
    if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can export data.");
    if (!deps.enabled) throw new AppError("CONFLICT", "Data export is not available on this MUSHIN deployment.", { reason: "export_unavailable" });
    if (!(await deps.billing.getAccess(ctx)).entitlements.export) {
      throw new AppError("ENTITLEMENT_REQUIRED", "Data export is included in the Scale plan. Upgrade to export your lists and campaigns.", { reason: "plan_feature", key: "export" });
    }
  }

  const name = sql<string>`coalesce((select p.display_name from platform.workspace_people() p where p.id = ${dataExports.requestedBy}), 'Former member')`;
  const toApi = (r: typeof dataExports.$inferSelect & { name: string }): DataExport => ({
    id: r.id,
    kind: r.kind,
    rowCount: r.rowCount,
    byteSize: r.byteSize,
    downloads: r.downloads,
    available: r.content !== null && r.expiresAt.getTime() > now().getTime(),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    requestedBy: { id: r.requestedBy, name: r.name },
  });

  async function create(ctx: TenantContext, kind: DataExport["kind"]): Promise<DataExport> {
    await authorise(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const data = kind === "lists" ? await listRows(tx, ctx.workspaceId) : await campaignRows(tx, ctx.workspaceId);
      if (data.rows.length > MAX_EXPORT_ROWS) {
        throw new AppError("CONFLICT", `This export would have more than ${MAX_EXPORT_ROWS.toLocaleString("en-US")} rows. Contact Support for a larger export.`, { reason: "export_too_large" });
      }
      const content = csv(data.header, data.rows);
      const [row] = await tx
        .insert(dataExports)
        .values({ workspaceId: ctx.workspaceId, requestedBy: ctx.userId, kind, rowCount: data.rows.length, content, byteSize: Buffer.byteLength(content), createdAt: now(), expiresAt: new Date(now().getTime() + EXPORT_TTL_MS) })
        .returning();
      if (!row) throw new Error("export insert returned no row");
      const [n] = await tx.execute<{ n: string | null }>(sql`select display_name n from platform.workspace_people() where id = ${ctx.userId}`);
      return toApi({ ...row, name: n?.n ?? "Former member" });
    });
  }

  async function list(ctx: TenantContext): Promise<DataExport[]> {
    if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can see exports.");
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const rows = await tx.select({ e: dataExports, name }).from(dataExports).where(eq(dataExports.workspaceId, ctx.workspaceId)).orderBy(desc(dataExports.createdAt)).limit(20);
      return rows.map((r) => toApi({ ...r.e, name: r.name }));
    });
  }

  async function download(ctx: TenantContext, id: string): Promise<{ filename: string; content: string }> {
    await authorise(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const [row] = await tx.select().from(dataExports).where(and(eq(dataExports.workspaceId, ctx.workspaceId), eq(dataExports.id, id))).for("update");
      if (!row) throw new AppError("NOT_FOUND", "Export not found");
      if (row.content === null || row.expiresAt.getTime() <= now().getTime()) throw new AppError("CONFLICT", "This export has expired. Create a new one.", { reason: "export_expired" });
      await tx.update(dataExports).set({ downloads: row.downloads + 1 }).where(eq(dataExports.id, id));
      return { filename: `mushin-${row.kind}-${row.createdAt.toISOString().slice(0, 10)}.csv`, content: row.content };
    });
  }

  return { create, list, download };
}

export type ExportsService = ReturnType<typeof createExportsService>;
