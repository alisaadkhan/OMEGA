import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  TRIAL_CONSENT_TEXT,
  trialCandidateSchema,
  trialFeedbackListSchema,
  type TrialCandidate,
  type TrialRequest,
  type trialFeedbackCreateSchema,
  type trialRequestCreateSchema,
} from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { billingSettings, staffUsers, subscriptions, trialFeedback, trialRequests, users, type Db, type SystemTx, type TenantTx } from "@mushin/db";
import type { z } from "zod";
import { recordStaffAudit, type StaffPrincipal } from "../staff/index";

type Meta = { ip: string | null; requestId: string | null };
type Row = typeof trialRequests.$inferSelect;
/** A repeated request from the same email or phone within this window is acknowledged but not stored again. */
const DUPLICATE_WINDOW_MS = 24 * 3_600_000;

/**
 * Founder-assisted trial (mandate v4 Phase 3). Visitors ask for a call back; a Super Admin approves a trial for the
 * account the caller signed up with. The trial itself is the billing engine's existing one (subscription row, trial
 * lots on the one ledger, end-of-trial and reminder jobs). Duplicates are prevented three times over: the person's
 * once-only trial mark (0036), the workspace's single subscription row, and one approved request per workspace (0050).
 */
export function createTrialService(deps: {
  db: Db;
  startTrial: (tx: TenantTx, workspaceId: string) => Promise<void>;
  onTrialStarted?: (workspaceId: string) => Promise<void>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function decidedByNames(tx: SystemTx, rows: Row[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.decidedBy).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const found = await tx.select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers).where(inArray(staffUsers.id, ids));
    return new Map(found.map((r) => [r.id, r.name]));
  }
  const toApi = (r: Row, names: Map<string, string>): TrialRequest => ({
    id: r.id,
    contactName: r.contactName,
    businessName: r.businessName,
    email: r.email,
    phone: r.phone,
    callbackWindow: r.callbackWindow,
    useCase: r.useCase,
    consentAt: r.consentAt.toISOString(),
    status: r.status,
    contactedAt: r.contactedAt?.toISOString() ?? null,
    workspaceId: r.workspaceId,
    decidedBy: r.decidedBy ? (names.get(r.decidedBy) ?? "Former staff") : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  });
  const one = async (tx: SystemTx, id: string): Promise<Row> => {
    const [r] = await tx.select().from(trialRequests).where(eq(trialRequests.id, id)).limit(1);
    if (!r) throw new AppError("NOT_FOUND", "Trial request not found");
    return r;
  };

  /** Who owns the account with this email, and its own workspaces (staff lookup before approving). */
  async function candidate(email: string): Promise<TrialCandidate | null> {
    const [row] = await deps.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.staff_trial_candidate(${email}) v`));
    if (!row?.v) return null;
    const v = row.v as { userId: string; status: string; trialGrantedAt: string | null; workspaces: { id: string; name: string; subscriptionCreatedAt: string | null }[] };
    if (v.status !== "active") throw new AppError("CONFLICT", "This account is suspended; a trial cannot be started for it.", { reason: "account_not_active" });
    const iso = (d: string | null) => (d ? new Date(d).toISOString() : null);
    return trialCandidateSchema.parse({ userId: v.userId, trialGrantedAt: iso(v.trialGrantedAt), workspaces: v.workspaces.map((w) => ({ ...w, subscriptionCreatedAt: iso(w.subscriptionCreatedAt) })) });
  }

  return {
    /** Public. Returns nothing about the request (or whether it was a duplicate) to the visitor. */
    async submit(input: z.output<typeof trialRequestCreateSchema>): Promise<void> {
      if (input.website) return; // honeypot filled: a bot; accepted silently, nothing stored
      const email = input.email?.toLowerCase() ?? null;
      const phone = input.phone ?? null;
      await deps.db.withSystem(async (tx) => {
        // Serialise submissions for the same contact so two quick clicks cannot both pass the duplicate check.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial-request:${email ?? ""}:${phone ?? ""}`}))`);
        const since = new Date(now().getTime() - DUPLICATE_WINDOW_MS);
        const same = [email ? eq(trialRequests.email, email) : undefined, phone ? eq(trialRequests.phone, phone) : undefined].filter((c) => c !== undefined);
        const [dup] = await tx
          .select({ id: trialRequests.id })
          .from(trialRequests)
          .where(and(or(...same), inArray(trialRequests.status, ["new", "contacted"]), sql`${trialRequests.createdAt} > ${since.toISOString()}::timestamptz`))
          .limit(1);
        if (dup) return;
        await tx.insert(trialRequests).values({
          contactName: input.contactName,
          businessName: input.businessName,
          email,
          phone,
          callbackWindow: input.callbackWindow,
          useCase: input.useCase ?? null,
          consentText: TRIAL_CONSENT_TEXT,
          consentAt: now(),
        });
      });
    },

    async list(status?: Row["status"]): Promise<TrialRequest[]> {
      return deps.db.withSystem(async (tx) => {
        const rows = await tx.select().from(trialRequests).where(status ? eq(trialRequests.status, status) : undefined).orderBy(desc(trialRequests.createdAt)).limit(200);
        const names = await decidedByNames(tx, rows);
        return rows.map((r) => toApi(r, names));
      });
    },

    async markContacted(p: StaffPrincipal, id: string, meta: Meta): Promise<TrialRequest> {
      return deps.db.withSystem(async (tx) => {
        const [r] = await tx
          .update(trialRequests)
          .set({ status: "contacted", contactedBy: p.staffId, contactedAt: now() })
          .where(and(eq(trialRequests.id, id), eq(trialRequests.status, "new")))
          .returning();
        const row = r ?? (await one(tx, id));
        if (r) await recordStaffAudit(tx, { staffId: p.staffId, action: "trials.contacted", targetType: "trial_request", targetId: id, metadata: {}, ...meta });
        return toApi(row, await decidedByNames(tx, [row]));
      });
    },

    candidate,

    /**
     * Super Admin only (route permission). Starts the trial on the account's own workspace and marks the request
     * approved. Repeating it returns the same result; a person who already had a trial, or a workspace with a trial or
     * plan already, is refused.
     */
    async approve(p: StaffPrincipal, id: string, body: { accountEmail: string; workspaceId?: string | undefined; note?: string | undefined }, meta: Meta) {
      const request = await deps.db.withSystem((tx) => one(tx, id));
      if (request.status === "rejected") throw new AppError("CONFLICT", "This request was rejected. Ask the person to send a new one.", { reason: "request_rejected" });
      const result = async (row: Row) => {
        const ws = row.workspaceId ?? "";
        const [sub] = await deps.db.withWorkspace(ws, (tx) => tx.select({ createdAt: subscriptions.createdAt, trialEndsAt: subscriptions.trialEndsAt }).from(subscriptions).where(eq(subscriptions.workspaceId, ws)));
        const [settings] = await deps.db.withSystem((tx) => tx.select({ credits: billingSettings.trialCredits }).from(billingSettings).limit(1));
        if (!sub?.trialEndsAt || !settings) throw new AppError("INTERNAL", "The approved trial has no subscription row");
        const names = await deps.db.withSystem((tx) => decidedByNames(tx, [row]));
        return { request: toApi(row, names), trialStartedAt: sub.createdAt.toISOString(), trialEndsAt: sub.trialEndsAt.toISOString(), credits: settings.credits };
      };
      if (request.status === "approved") return result(request);

      const who = await candidate(body.accountEmail);
      if (!who) throw new AppError("NOT_FOUND", "No MUSHIN account uses that email. Ask the person to sign up first, then approve.", { reason: "no_account" });
      const owned = body.workspaceId ? who.workspaces.filter((w) => w.id === body.workspaceId) : who.workspaces;
      if (owned.length === 0) throw new AppError("NOT_FOUND", "That account owns no active workspace with this id.", { reason: "no_workspace" });
      if (owned.length > 1) throw new AppError("CONFLICT", "This account owns several workspaces. Choose one.", { reason: "choose_workspace", workspaceIds: owned.map((w) => w.id) });
      const ws = owned[0] as TrialCandidate["workspaces"][number];

      // Recovery: an earlier attempt started this trial (after the request arrived) but stopped before marking the
      // request. The grant is the source of truth, so only the request is completed.
      const resumed = who.trialGrantedAt && ws.subscriptionCreatedAt && new Date(ws.subscriptionCreatedAt) >= request.createdAt;
      if (!resumed) {
        if (ws.subscriptionCreatedAt) throw new AppError("CONFLICT", "This workspace already has a trial or a plan.", { reason: "workspace_has_subscription" });
        if (who.trialGrantedAt) throw new AppError("CONFLICT", "This person already had a free trial.", { reason: "trial_already_granted" });
        await deps.db.withTenant({ userId: who.userId, workspaceId: ws.id }, async (tx) => {
          // Atomic once-per-person claim: of two concurrent approvals only one passes.
          const claimed = await tx.update(users).set({ trialGrantedAt: sql`now()` }).where(sql`${users.id} = ${who.userId} and ${users.trialGrantedAt} is null`).returning({ id: users.id });
          if (claimed.length === 0) throw new AppError("CONFLICT", "This person already had a free trial.", { reason: "trial_already_granted" });
          await deps.startTrial(tx, ws.id);
        });
        await deps.onTrialStarted?.(ws.id);
      }
      const row = await deps.db.withSystem(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial-approve:${ws.id}`}))`);
        // Another request already holds this workspace's approval (e.g. a concurrent approval won): this one is refused,
        // which also keeps the recovery path above from claiming someone else's grant.
        const [other] = await tx
          .select({ id: trialRequests.id })
          .from(trialRequests)
          .where(and(eq(trialRequests.workspaceId, ws.id), eq(trialRequests.status, "approved"), sql`${trialRequests.id} <> ${id}`))
          .limit(1);
        if (other) throw new AppError("CONFLICT", "This person already had a free trial.", { reason: "trial_already_granted" });
        const [r] = await tx
          .update(trialRequests)
          .set({ status: "approved", workspaceId: ws.id, decidedBy: p.staffId, decidedAt: now(), decisionNote: body.note ?? null })
          .where(and(eq(trialRequests.id, id), inArray(trialRequests.status, ["new", "contacted"])))
          .returning();
        if (!r) return one(tx, id); // a concurrent approval of this request finished first
        await recordStaffAudit(tx, { staffId: p.staffId, action: "trials.approved", targetType: "workspace", targetId: ws.id, metadata: { requestId: id, resumed: !!resumed }, ...meta });
        return r;
      });
      return result(row);
    },

    async reject(p: StaffPrincipal, id: string, note: string, meta: Meta): Promise<TrialRequest> {
      return deps.db.withSystem(async (tx) => {
        const [r] = await tx
          .update(trialRequests)
          .set({ status: "rejected", decidedBy: p.staffId, decidedAt: now(), decisionNote: note })
          .where(and(eq(trialRequests.id, id), inArray(trialRequests.status, ["new", "contacted"])))
          .returning();
        if (!r) {
          const cur = await one(tx, id);
          if (cur.status === "approved") throw new AppError("CONFLICT", "This request was already approved.", { reason: "request_approved" });
          return toApi(cur, await decidedByNames(tx, [cur]));
        }
        await recordStaffAudit(tx, { staffId: p.staffId, action: "trials.rejected", targetType: "trial_request", targetId: id, metadata: {}, ...meta });
        return toApi(r, await decidedByNames(tx, [r]));
      });
    },

    async submitFeedback(ctx: TenantContext, input: z.output<typeof trialFeedbackCreateSchema>): Promise<void> {
      await deps.db.withTenant({ userId: ctx.userId, workspaceId: ctx.workspaceId }, (tx) =>
        tx.insert(trialFeedback).values({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          searchQuality: input.searchQuality ?? null,
          contactAccuracy: input.contactAccuracy ?? null,
          easeOfUse: input.easeOfUse ?? null,
          savedTime: input.savedTime ?? null,
          wouldPay: input.wouldPay ?? null,
          preferredPlan: input.preferredPlan ?? null,
          missingFeatures: input.missingFeatures ?? null,
          comments: input.comments ?? null,
        }),
      );
    },

    async feedback(limit: number) {
      const [row] = await deps.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.staff_trial_feedback(${limit}) v`));
      return trialFeedbackListSchema.parse({ feedback: row?.v ?? [] }).feedback;
    },
  };
}
export type TrialService = ReturnType<typeof createTrialService>;
