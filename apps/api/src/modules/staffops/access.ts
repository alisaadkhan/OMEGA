import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { supportAccessViewSchema, type SupportAccess } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { staffUsers, supportAccessRequests, workspaces, type Db } from "@mushin/db";
import { recordStaffAudit, type StaffPrincipal } from "../staff/index";

type Meta = { ip: string | null; requestId: string | null };
type Row = typeof supportAccessRequests.$inferSelect;
const MAX_MINUTES = 60;

/**
 * Consented, read-only, time-boxed support access (master pack DOC-029; SRS REQ-10.01): a staff member asks with a
 * purpose; an owner or admin of the workspace grants it for at most 60 minutes or declines; either side can end it.
 * The access is a curated read-only view (no ledger amounts, contact values or notes) and cannot spend, bill, export,
 * send mail or change anything. Every view is audited with the workspace.
 */
export function createSupportAccess(deps: { db: Db; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  /** A grant past its expiry reads as expired, whether or not a sweep has written it yet. */
  const effective = (r: Row): Row => (r.status === "granted" && r.expiresAt && r.expiresAt <= now() ? { ...r, status: "expired" } : r);
  const toApi = (row: Row): SupportAccess => {
    const r = effective(row);
    return { id: r.id, workspaceId: r.workspaceId, staffName: r.staffName, purpose: r.purpose, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null, endedAt: r.endedAt?.toISOString() ?? null };
  };
  const ownerOrAdmin = (ctx: TenantContext) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can manage support access.");
  };

  return {
    // ── Staff side ──
    async request(p: StaffPrincipal, workspaceId: string, purpose: string, meta: Meta): Promise<SupportAccess> {
      return deps.db.withSystem(async (tx) => {
        const [w] = await deps.db.withWorkspace(workspaceId, (wtx) => wtx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)));
        if (!w) throw new AppError("NOT_FOUND", "Workspace not found");
        const open = (await tx.select().from(supportAccessRequests).where(and(eq(supportAccessRequests.workspaceId, workspaceId), eq(supportAccessRequests.staffId, p.staffId), inArray(supportAccessRequests.status, ["requested", "granted"])))).map(effective).find((r) => r.status === "requested" || r.status === "granted");
        if (open) return toApi(open);
        const [s] = await tx.select({ name: staffUsers.name }).from(staffUsers).where(eq(staffUsers.id, p.staffId));
        const [row] = await tx.insert(supportAccessRequests).values({ workspaceId, staffId: p.staffId, staffName: s?.name ?? "MUSHIN support", purpose }).returning();
        if (!row) throw new Error("support access insert returned no row");
        await recordStaffAudit(tx, { staffId: p.staffId, action: "support.access.requested", workspaceId, metadata: { requestId: row.id, purpose }, ip: meta.ip, requestId: meta.requestId });
        return toApi(row);
      });
    },

    async mine(p: StaffPrincipal): Promise<SupportAccess[]> {
      const rows = await deps.db.withSystem((tx) => tx.select().from(supportAccessRequests).where(eq(supportAccessRequests.staffId, p.staffId)).orderBy(desc(supportAccessRequests.createdAt)).limit(50));
      return rows.map(toApi);
    },

    async staffEnd(p: StaffPrincipal, id: string, meta: Meta): Promise<SupportAccess> {
      return deps.db.withSystem(async (tx) => {
        const [r] = await tx.select().from(supportAccessRequests).where(and(eq(supportAccessRequests.id, id), eq(supportAccessRequests.staffId, p.staffId))).for("update");
        if (!r) throw new AppError("NOT_FOUND", "Access request not found");
        const cur = effective(r);
        if (cur.status !== "requested" && cur.status !== "granted") return toApi(r);
        const [u] = await tx.update(supportAccessRequests).set({ status: "ended", endedAt: now() }).where(eq(supportAccessRequests.id, id)).returning();
        await recordStaffAudit(tx, { staffId: p.staffId, action: "support.access.ended", workspaceId: r.workspaceId, metadata: { requestId: id }, ip: meta.ip, requestId: meta.requestId });
        return toApi(u ?? r);
      });
    },

    /** The read-only view, only for the staff member it was granted to, only until it expires; each view is audited. */
    async view(p: StaffPrincipal, id: string, meta: Meta) {
      return deps.db.withSystem(async (tx) => {
        const [r] = await tx.select().from(supportAccessRequests).where(and(eq(supportAccessRequests.id, id), eq(supportAccessRequests.staffId, p.staffId)));
        if (!r) throw new AppError("NOT_FOUND", "Access request not found");
        const cur = effective(r);
        if (cur.status !== "granted") throw new AppError("FORBIDDEN", cur.status === "requested" ? "The customer has not granted access yet." : "This access is no longer active.", { reason: `access_${cur.status}` });
        const [v] = await tx.execute<{ v: Record<string, unknown> }>(sql`select platform.support_access_view(${r.workspaceId}) v`);
        await recordStaffAudit(tx, { staffId: p.staffId, action: "support.access.viewed", workspaceId: r.workspaceId, metadata: { requestId: id }, ip: meta.ip, requestId: meta.requestId });
        return supportAccessViewSchema.parse({ ...v?.v, access: toApi(r) });
      });
    },

    // ── Customer side (tenant RLS: a workspace sees only its own requests) ──
    async list(ctx: TenantContext): Promise<SupportAccess[]> {
      ownerOrAdmin(ctx);
      const rows = await deps.db.withTenant(ctx, (tx) => tx.select().from(supportAccessRequests).orderBy(desc(supportAccessRequests.createdAt)).limit(50));
      return rows.map(toApi);
    },

    async decide(ctx: TenantContext, id: string, decision: "grant" | "decline" | "end", minutes = MAX_MINUTES): Promise<SupportAccess> {
      ownerOrAdmin(ctx);
      return deps.db.withTenant(ctx, async (tx) => {
        const [r] = await tx.select().from(supportAccessRequests).where(eq(supportAccessRequests.id, id)).for("update");
        if (!r) throw new AppError("NOT_FOUND", "Access request not found");
        const cur = effective(r);
        const t = now();
        let set: Partial<Row>;
        if (decision === "end") {
          if (cur.status !== "granted" && cur.status !== "requested") throw new AppError("CONFLICT", "This access is not active.");
          set = { status: "ended", endedAt: t };
        } else {
          if (cur.status !== "requested") throw new AppError("CONFLICT", `This request is already ${cur.status}.`);
          set = decision === "grant"
            ? { status: "granted", decidedBy: ctx.userId, decidedAt: t, expiresAt: new Date(t.getTime() + Math.min(Math.max(minutes, 5), MAX_MINUTES) * 60_000) }
            : { status: "declined", decidedBy: ctx.userId, decidedAt: t };
        }
        const [u] = await tx.update(supportAccessRequests).set(set).where(eq(supportAccessRequests.id, id)).returning();
        return toApi(u ?? r);
      });
    },

    /** Requests waiting for this workspace's answer, for the in-app banner. */
    async pendingCount(ctx: TenantContext): Promise<number> {
      if (ctx.role !== "owner" && ctx.role !== "admin") return 0;
      const rows = await deps.db.withTenant(ctx, (tx) => tx.select({ id: supportAccessRequests.id }).from(supportAccessRequests).where(eq(supportAccessRequests.status, "requested")));
      return rows.length;
    },
  };
}

export type SupportAccessService = ReturnType<typeof createSupportAccess>;
