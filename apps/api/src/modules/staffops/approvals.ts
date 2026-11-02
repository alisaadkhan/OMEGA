import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { approvalPayloadSchemas, type Approval, type ApprovalRequest } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { approvals, staffSessions, staffUsers, workspaces, type Db, type SystemTx } from "@mushin/db";
import type { BillingService } from "../billing/index";
import { APPROVAL_RULES, recordStaffAudit, type ApprovalAction, type StaffPrincipal } from "../staff/index";

const TTL_MS = 24 * 3_600_000;
type Meta = { ip: string | null; requestId: string | null };
type Row = typeof approvals.$inferSelect;

/**
 * Two-person approvals (staff spec §2): a staff member requests an exact, validated action with a reason; a different
 * staff member decides; co-sign actions need a Super Admin. Approval executes the action once (idempotent), records the
 * outcome and audits every step. Nothing in the ledger is edited: a credit correction is a new adjustment grant.
 */
export function createApprovals(deps: { db: Db; billing: Pick<BillingService, "engine">; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function names(tx: SystemTx, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await tx.select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers).where(inArray(staffUsers.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
  const toApi = (r: Row, n: Map<string, string>): Approval => ({
    id: r.id,
    action: r.actionType as Approval["action"],
    targetType: r.targetType,
    targetId: r.targetId,
    payload: r.payload,
    reason: r.reason,
    requiresSuperAdmin: r.requiresSuperAdmin,
    requestedBy: { id: r.requestedBy, name: n.get(r.requestedBy) ?? "Former staff" },
    decidedBy: r.decidedBy ? { id: r.decidedBy, name: n.get(r.decidedBy) ?? "Former staff" } : null,
    decisionNote: r.decisionNote,
    status: r.status,
    result: r.result ?? null,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    executedAt: r.executedAt?.toISOString() ?? null,
  });

  /** Preconditions checked when the request is made and again right before it executes. */
  async function precheck(tx: SystemTx, action: ApprovalAction, payload: Record<string, unknown>, actors: string[]): Promise<{ targetType: string; targetId: string }> {
    if (action === "credits.grant") {
      const p = approvalPayloadSchemas["credits.grant"].parse(payload);
      // Workspace rows are visible only inside that workspace's context (row-level security).
      const [w] = await deps.db.withWorkspace(p.workspaceId, (wtx) => wtx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, p.workspaceId)));
      if (!w) throw new AppError("NOT_FOUND", "Workspace not found");
      return { targetType: "workspace", targetId: p.workspaceId };
    }
    const p = action === "staff.role.change" ? approvalPayloadSchemas["staff.role.change"].parse(payload) : approvalPayloadSchemas["staff.suspend"].parse(payload);
    const [s] = await tx.select({ role: staffUsers.role, status: staffUsers.status }).from(staffUsers).where(eq(staffUsers.id, p.staffId));
    if (!s) throw new AppError("NOT_FOUND", "Staff member not found");
    if (actors.includes(p.staffId)) throw new AppError("FORBIDDEN", "Nobody can request or approve a change to their own access.", { reason: "self_target" });
    // Super Admins are created and recovered only by the bootstrap process; no request can change or suspend one.
    if (s.role === "super_admin") throw new AppError("FORBIDDEN", "A Super Admin's access changes only through the owner bootstrap process.", { reason: "super_admin_protected" });
    if ("role" in p && s.role === p.role) throw new AppError("CONFLICT", "This staff member already has that role.");
    if ("suspended" in p && (s.status === "suspended") === p.suspended) throw new AppError("CONFLICT", p.suspended ? "Already suspended." : "Not suspended.");
    return { targetType: "staff", targetId: p.staffId };
  }

  async function execute(row: Row): Promise<Record<string, unknown>> {
    if (row.actionType === "credits.grant") {
      const p = approvalPayloadSchemas["credits.grant"].parse(row.payload);
      const expiresAt = new Date(now().getTime() + p.expiresInDays * 86_400_000);
      const lotId = await deps.db.withWorkspace(p.workspaceId, (tx) =>
        deps.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: p.amount, expiresAt, sourceRef: `approval:${row.id}`, note: `Staff credit correction: ${row.reason}`.slice(0, 200) }),
      );
      return { lotId, amount: p.amount, expiresAt: expiresAt.toISOString() };
    }
    return deps.db.withSystem(async (tx) => {
      await precheck(tx, row.actionType as ApprovalAction, row.payload, [row.requestedBy, row.decidedBy ?? ""]);
      const target = row.targetId;
      if (row.actionType === "staff.role.change") {
        const p = approvalPayloadSchemas["staff.role.change"].parse(row.payload);
        await tx.update(staffUsers).set({ role: p.role }).where(eq(staffUsers.id, target));
      } else {
        const p = approvalPayloadSchemas["staff.suspend"].parse(row.payload);
        await tx.update(staffUsers).set({ status: p.suspended ? "suspended" : "active" }).where(eq(staffUsers.id, target));
      }
      // Existing sessions end: their access tokens also stop at once (role and status are checked per request).
      await tx.update(staffSessions).set({ revokedAt: now() }).where(and(eq(staffSessions.staffId, target), sql`${staffSessions.revokedAt} is null`));
      return { staffId: target };
    });
  }

  return {
    async request(p: StaffPrincipal, body: ApprovalRequest, meta: Meta): Promise<Approval> {
      const rule = APPROVAL_RULES[body.action];
      if (!(rule.request as readonly string[]).includes(p.role)) throw new AppError("FORBIDDEN", "You cannot request this action.");
      // The same request (same person, action and payload) on the same day is one request, not several.
      const idempotencyKey = createHash("sha256").update(JSON.stringify([p.staffId, body.action, body.payload, now().toISOString().slice(0, 10)])).digest("hex");
      return deps.db.withSystem(async (tx) => {
        const target = await precheck(tx, body.action, body.payload, [p.staffId]);
        const inserted = await tx
          .insert(approvals)
          .values({ actionType: body.action, ...target, payload: body.payload, reason: body.reason, requiresSuperAdmin: rule.superAdminCosign, requestedBy: p.staffId, idempotencyKey, expiresAt: new Date(now().getTime() + TTL_MS) })
          .onConflictDoNothing({ target: approvals.idempotencyKey })
          .returning();
        const row = inserted[0] ?? (await tx.select().from(approvals).where(eq(approvals.idempotencyKey, idempotencyKey)))[0];
        if (!row) throw new Error("approval insert returned no row");
        if (inserted[0]) await recordStaffAudit(tx, { staffId: p.staffId, action: "approvals.requested", metadata: { approvalId: row.id, type: body.action, ...target }, ip: meta.ip, requestId: meta.requestId });
        return toApi(row, await names(tx, [row.requestedBy]));
      });
    },

    async list(status: Row["status"] | null): Promise<Approval[]> {
      return deps.db.withSystem(async (tx) => {
        await tx.update(approvals).set({ status: "expired" }).where(and(eq(approvals.status, "pending"), sql`${approvals.expiresAt} <= ${now().toISOString()}::timestamptz`));
        const rows = await tx.select().from(approvals).where(status ? eq(approvals.status, status) : sql`true`).orderBy(desc(approvals.createdAt)).limit(200);
        const n = await names(tx, [...new Set(rows.flatMap((r) => [r.requestedBy, ...(r.decidedBy ? [r.decidedBy] : [])]))]);
        return rows.map((r) => toApi(r, n));
      });
    },

    async decide(p: StaffPrincipal, id: string, decision: "approve" | "reject", note: string, meta: Meta): Promise<Approval> {
      const decided = await deps.db.withSystem(async (tx) => {
        const [row] = await tx.select().from(approvals).where(eq(approvals.id, id)).for("update");
        if (!row) throw new AppError("NOT_FOUND", "Approval request not found");
        if (row.status !== "pending") throw new AppError("CONFLICT", `This request is already ${row.status}.`);
        if (row.expiresAt <= now()) {
          await tx.update(approvals).set({ status: "expired" }).where(eq(approvals.id, id));
          return { expired: true as const };
        }
        // The owner (Super Admin) may decide their own credit grant or refund in one step (owner directive 2026-11-03,
        // 0071); every other request still needs a second person.
        const selfApproved = row.requestedBy === p.staffId;
        if (selfApproved && !(row.actionType === "credits.grant" && p.role === "super_admin")) throw new AppError("FORBIDDEN", "You cannot decide your own request; another staff member must.", { reason: "self_approval" });
        if (row.requiresSuperAdmin && p.role !== "super_admin") throw new AppError("FORBIDDEN", "This request needs a Super Admin's approval.", { reason: "super_admin_cosign" });
        if (row.targetType === "staff" && row.targetId === p.staffId) throw new AppError("FORBIDDEN", "Nobody can approve a change to their own access.", { reason: "self_target" });
        const status = decision === "approve" ? ("approved" as const) : ("rejected" as const);
        const [updated] = await tx.update(approvals).set({ status, decidedBy: p.staffId, decidedAt: now(), decisionNote: note || null, selfApproved }).where(eq(approvals.id, id)).returning();
        await recordStaffAudit(tx, { staffId: p.staffId, action: `approvals.${status}`, metadata: { approvalId: id, type: row.actionType, targetType: row.targetType, targetId: row.targetId, ...(selfApproved ? { selfApproved: true } : {}) }, ip: meta.ip, requestId: meta.requestId });
        return { expired: false as const, row: updated as Row };
      });
      if (decided.expired) throw new AppError("CONFLICT", "This request expired. Ask for it again.", { reason: "expired" });
      let final = decided.row;
      if (final.status === "approved") {
        // Executed after the approval commits; failure is recorded on the request (and audited), never half-applied.
        let result: Record<string, unknown>;
        let status: "executed" | "failed";
        try {
          result = await execute(final);
          status = "executed";
        } catch (err) {
          result = { error: err instanceof AppError ? err.message : "The action could not be completed." };
          status = "failed";
        }
        final = await deps.db.withSystem(async (tx) => {
          const [r] = await tx.update(approvals).set({ status, result, executedAt: now() }).where(and(eq(approvals.id, id), eq(approvals.status, "approved"))).returning();
          await recordStaffAudit(tx, { staffId: p.staffId, action: `approvals.${status}`, metadata: { approvalId: id, type: final.actionType, result }, ip: meta.ip, requestId: meta.requestId });
          return r ?? final;
        });
      }
      return deps.db.withSystem(async (tx) => toApi(final, await names(tx, [final.requestedBy, ...(final.decidedBy ? [final.decidedBy] : [])])));
    },
  };
}

export type Approvals = ReturnType<typeof createApprovals>;
