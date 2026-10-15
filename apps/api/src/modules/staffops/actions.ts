import { asc, eq, inArray, sql } from "drizzle-orm";
import { staffAlertsSchema, type pausableProviderSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { discoveryJobs, providerControls, staffUsers, webauthnCredentials, writeOutbox, type Db, type SystemTx, type TenantTx } from "@mushin/db";
import type { z } from "zod";
import { recordStaffAudit, type StaffPrincipal } from "../staff/index";

type Meta = { ip: string | null; requestId: string | null };
type Pausable = z.output<typeof pausableProviderSchema>;
const PAUSABLE: readonly string[] = ["apify", "serper", "llm"];
/** A queued or running job older than this is stuck enough to re-dispatch (the sweeper fails and refunds at 2 hours). */
const RETRY_AFTER_MS = 10 * 60_000;

/** Alert thresholds (explicit, so the console shows why something is flagged; proposed values pending owner review). */
export const ALERT_THRESHOLDS = {
  outboxOldestSeconds: { warning: 300, critical: 1800 },
  stuckJobs: { warning: 1, critical: 5 },
  failedJobs1h: { warning: 3, critical: 10 },
  providerErrorShare: { warning: 0.2, critical: 0.5, minCalls: 5 },
  oldestRemovalDays: { warning: 7, critical: 21 },
} as const;

/** Operations actions (staff spec §4): each checks its preconditions, needs a reason, is idempotent and audited. */
export function createStaffActions(deps: { db: Db; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  /** withWorkspace runs as the worker role (as withSystem does), which may write the staff audit in the same transaction. */
  const asWorker = (tx: TenantTx) => tx as unknown as SystemTx;
  /** Runs `fn` inside the job's workspace context (job rows are visible only there). */
  async function inJobWorkspace<T>(jobId: string, fn: (tx: TenantTx, workspaceId: string) => Promise<T>): Promise<T> {
    const [r] = await deps.db.withSystem((tx) => tx.execute<{ ws: string | null }>(sql`select platform.staff_job_workspace(${jobId}) ws`));
    if (!r?.ws) throw new AppError("NOT_FOUND", "Job not found");
    const ws = r.ws;
    return deps.db.withWorkspace(ws, (tx) => fn(tx, ws));
  }

  return {
    async providers() {
      const rows = await deps.db.withSystem((tx) => tx.select().from(providerControls).orderBy(asc(providerControls.provider)));
      const n = await deps.db.withSystem((tx) => (rows.some((r) => r.changedBy) ? tx.select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers).where(inArray(staffUsers.id, rows.flatMap((r) => (r.changedBy ? [r.changedBy] : [])))) : Promise.resolve([])));
      const names = new Map(n.map((x) => [x.id, x.name]));
      return rows.map((r) => ({ provider: r.provider, paused: r.paused, reason: r.reason, changedBy: r.changedBy ? (names.get(r.changedBy) ?? "Former staff") : null, changedAt: r.changedAt.toISOString(), controllable: PAUSABLE.includes(r.provider) }));
    },

    /** Pauses or resumes a provider family; setting the state it already has changes nothing and is not audited again. */
    async setProvider(p: StaffPrincipal, provider: Pausable, paused: boolean, reason: string, meta: Meta) {
      return deps.db.withSystem(async (tx) => {
        // The migration seeds a row per family; one that is missing is created (never a silent no-op).
        await tx.insert(providerControls).values({ provider }).onConflictDoNothing();
        const [cur] = await tx.select().from(providerControls).where(eq(providerControls.provider, provider)).for("update");
        if (cur?.paused === paused) return { changed: false };
        await tx.update(providerControls).set({ paused, reason, changedBy: p.staffId, changedAt: now() }).where(eq(providerControls.provider, provider));
        await recordStaffAudit(tx, { staffId: p.staffId, action: paused ? "ops.provider.paused" : "ops.provider.resumed", metadata: { provider, reason }, ip: meta.ip, requestId: meta.requestId });
        return { changed: true };
      });
    },

    /** Asks an open live run to stop at its next safe point (the customer's own cancel path); add-by-link jobs are short and not cancellable. */
    async cancelJob(p: StaffPrincipal, jobId: string, reason: string, meta: Meta) {
      return inJobWorkspace(jobId, async (tx) => {
        const [j] = await tx.select().from(discoveryJobs).where(eq(discoveryJobs.id, jobId)).for("update");
        if (!j) throw new AppError("NOT_FOUND", "Job not found");
        if (j.kind !== "live") throw new AppError("CONFLICT", "Only Find New Creators runs can be cancelled.");
        if (j.status !== "queued" && j.status !== "running") throw new AppError("CONFLICT", `This job is already ${j.status}.`);
        if (j.cancelRequestedAt) return { status: "already_requested" as const };
        await tx.update(discoveryJobs).set({ cancelRequestedAt: now() }).where(eq(discoveryJobs.id, jobId));
        await recordStaffAudit(asWorker(tx), { staffId: p.staffId, action: "ops.job.cancel_requested", metadata: { jobId, reason }, workspaceId: j.workspaceId, ip: meta.ip, requestId: meta.requestId });
        return { status: "cancel_requested" as const };
      });
    },

    /**
     * Re-dispatches a stuck job's work item. The runner claims attempts atomically, so a duplicate delivery does
     * nothing; credits are untouched (the job keeps its original reservation, and the sweeper still refunds at its limit).
     */
    async retryJob(p: StaffPrincipal, jobId: string, reason: string, meta: Meta) {
      return inJobWorkspace(jobId, async (tx) => {
        const [j] = await tx.select().from(discoveryJobs).where(eq(discoveryJobs.id, jobId)).for("update");
        if (!j) throw new AppError("NOT_FOUND", "Job not found");
        if (j.status !== "queued" && j.status !== "running") throw new AppError("CONFLICT", "Only a queued or running job can be retried; a finished job was already settled.");
        if (j.cancelRequestedAt) throw new AppError("CONFLICT", "This job is being cancelled.");
        if (now().getTime() - j.createdAt.getTime() < RETRY_AFTER_MS) throw new AppError("CONFLICT", "This job is not stuck yet; wait 10 minutes before retrying.", { reason: "not_stuck" });
        const eventType = j.kind === "live" ? "discovery.live_requested" : j.kind === "add_by_url" ? "discovery.requested" : "refresh.requested";
        await writeOutbox(tx, { eventType, aggregateType: "discovery_job", aggregateId: jobId, workspaceId: j.workspaceId, payload: { jobId }, requestId: meta.requestId });
        await recordStaffAudit(asWorker(tx), { staffId: p.staffId, action: "ops.job.retried", metadata: { jobId, reason }, workspaceId: j.workspaceId, ip: meta.ip, requestId: meta.requestId });
        return { status: "requeued" as const };
      });
    },

    /** Support may take a ticket themselves; assigning to someone else (or unassigning another's) is an Admin action. */
    async assignTicket(p: StaffPrincipal, ticketId: string, assigneeId: string | null, canAssignOthers: boolean, meta: Meta) {
      if (!canAssignOthers && assigneeId !== p.staffId) throw new AppError("FORBIDDEN", "You can assign tickets only to yourself.");
      return deps.db.withSystem(async (tx) => {
        let ok: boolean;
        try {
          const [r] = await tx.execute<{ ok: boolean }>(sql`select platform.staff_ticket_assign(${ticketId}, ${assigneeId}) ok`);
          ok = r?.ok === true;
        } catch {
          throw new AppError("VALIDATION_FAILED", "Choose an active staff member.", { field: "assigneeId" });
        }
        if (!ok) throw new AppError("NOT_FOUND", "Ticket not found");
        await recordStaffAudit(tx, { staffId: p.staffId, action: "support.ticket.assigned", metadata: { ticketId, assigneeId }, ip: meta.ip, requestId: meta.requestId });
      });
    },

    async noteTicket(p: StaffPrincipal, ticketId: string, body: string, meta: Meta) {
      return deps.db.withSystem(async (tx) => {
        const [r] = await tx.execute<{ ok: boolean }>(sql`select platform.staff_ticket_note(${ticketId}, ${p.staffId}, ${body}) ok`);
        if (!r?.ok) throw new AppError("NOT_FOUND", "Ticket not found");
        // The note text stays in the ticket; the audit records only that a note was added.
        await recordStaffAudit(tx, { staffId: p.staffId, action: "support.ticket.noted", metadata: { ticketId }, ip: meta.ip, requestId: meta.requestId });
      });
    },

    async directory() {
      return deps.db.withSystem(async (tx) => {
        const rows = await tx
          .select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email, role: staffUsers.role, status: staffUsers.status, lastLoginAt: staffUsers.lastLoginAt, createdAt: staffUsers.createdAt, keys: sql<number>`(select count(*)::int from ${webauthnCredentials} k where k.staff_id = ${staffUsers.id} and k.revoked_at is null)` })
          .from(staffUsers)
          .orderBy(asc(staffUsers.name));
        return rows.map((r) => ({ ...r, keys: Number(r.keys), lastLoginAt: r.lastLoginAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));
      });
    },

    async auditSearch(q: { action?: string | undefined; staffId?: string | undefined; workspaceId?: string | undefined; since?: string | undefined; until?: string | undefined; before?: string | undefined; limit: number }) {
      const [r] = await deps.db.withSystem((tx) =>
        tx.execute<{ v: unknown }>(sql`select platform.staff_audit_search(${q.action ?? null}, ${q.staffId ?? null}, ${q.workspaceId ?? null}, ${q.since ?? null}, ${q.until ?? null}, ${q.before ?? null}, ${q.limit}) v`),
      );
      return r?.v ?? [];
    },

    /** Raw measurements plus the thresholds they cross. Missing data stays missing; nothing is reported as healthy. */
    async alerts() {
      const [r] = await deps.db.withSystem((tx) => tx.execute<{ v: Record<string, unknown> }>(sql`select platform.staff_alerts() v`));
      const m = staffAlertsSchema.omit({ alerts: true }).parse({ ...r?.v, monthSpendUsd: Object.fromEntries(Object.entries((r?.v?.["monthSpendUsd"] as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)])) });
      const alerts: { key: string; severity: "warning" | "critical"; message: string }[] = [];
      const level = (v: number | null, t: { warning: number; critical: number }) => (v === null ? null : v >= t.critical ? "critical" : v >= t.warning ? "warning" : null);
      const push = (key: string, sev: "warning" | "critical" | null, message: string) => sev && alerts.push({ key, severity: sev, message });
      push("outbox", level(m.outboxOldestSeconds, ALERT_THRESHOLDS.outboxOldestSeconds), `Background work is waiting: the oldest item is ${m.outboxOldestSeconds ?? 0} s old (${m.outboxPending} pending).`);
      push("stuck_jobs", level(m.stuckJobs, ALERT_THRESHOLDS.stuckJobs), `${m.stuckJobs} job(s) queued or running for more than 30 minutes.`);
      push("failed_jobs", level(m.failedJobs1h, ALERT_THRESHOLDS.failedJobs1h), `${m.failedJobs1h} job(s) failed in the last hour.`);
      for (const [provider, calls] of Object.entries(m.providerCalls1h)) {
        const errors = m.providerErrors1h[provider] ?? 0;
        if (calls >= ALERT_THRESHOLDS.providerErrorShare.minCalls) push(`provider_${provider}`, level(errors / calls, ALERT_THRESHOLDS.providerErrorShare), `${provider}: ${errors} of ${calls} calls failed in the last hour.`);
      }
      push("removals", level(m.oldestRemovalDays, ALERT_THRESHOLDS.oldestRemovalDays), `The oldest open creator removal request is ${m.oldestRemovalDays ?? 0} day(s) old.`);
      for (const p of m.pausedProviders) alerts.push({ key: `paused_${p}`, severity: "warning", message: `${p} is paused by operations.` });
      return { ...m, alerts };
    },

    /** Active staff who can take tickets (for the assignment picker). */
    async assignable() {
      return deps.db.withSystem((tx) => tx.select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers).where(eq(staffUsers.status, "active")).orderBy(asc(staffUsers.name)));
    },
  };
}

export type StaffActions = ReturnType<typeof createStaffActions>;
