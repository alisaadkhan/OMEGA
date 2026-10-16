import { z } from "zod";
import { staffRoleSchema } from "./staff";

const iso = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(12, "Give a reason of at least 12 characters").max(1000);

// ── Two-person approvals ──
export const approvalActionSchema = z.enum(["credits.grant", "staff.role.change", "staff.suspend"]);
export const approvalPayloadSchemas = {
  "credits.grant": z.object({ workspaceId: z.uuid(), amount: z.number().int().min(1).max(100_000), expiresInDays: z.number().int().min(1).max(365) }),
  "staff.role.change": z.object({ staffId: z.uuid(), role: z.enum(["support", "admin"]) }),
  "staff.suspend": z.object({ staffId: z.uuid(), suspended: z.boolean() }),
} as const;
export const approvalRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("credits.grant"), payload: approvalPayloadSchemas["credits.grant"], reason }),
  z.object({ action: z.literal("staff.role.change"), payload: approvalPayloadSchemas["staff.role.change"], reason }),
  z.object({ action: z.literal("staff.suspend"), payload: approvalPayloadSchemas["staff.suspend"], reason }),
]);
export type ApprovalRequest = z.output<typeof approvalRequestSchema>;
export const approvalDecisionSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).default("") });
export const approvalSchema = z.object({
  id: z.uuid(),
  action: approvalActionSchema,
  targetType: z.string(),
  targetId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string(),
  requiresSuperAdmin: z.boolean(),
  requestedBy: z.object({ id: z.uuid(), name: z.string() }),
  decidedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  decisionNote: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected", "expired", "executed", "failed"]),
  result: z.record(z.string(), z.unknown()).nullable(),
  createdAt: iso,
  expiresAt: iso,
  decidedAt: iso.nullable(),
  executedAt: iso.nullable(),
});
export type Approval = z.output<typeof approvalSchema>;
export const approvalListSchema = z.object({ approvals: z.array(approvalSchema) });

// ── Providers, jobs ──
export const pausableProviderSchema = z.enum(["apify", "serper", "llm"]);
export const providerControlSchema = z.object({ provider: z.string(), paused: z.boolean(), reason: z.string().nullable(), changedBy: z.string().nullable(), changedAt: iso, controllable: z.boolean() });
export const providerControlListSchema = z.object({ providers: z.array(providerControlSchema) });
export const providerControlUpdateSchema = z.object({ paused: z.boolean(), reason });
export const jobActionSchema = z.object({ reason });
export const jobActionResultSchema = z.object({ status: z.enum(["cancel_requested", "already_requested", "requeued"]) });

// ── Staff directory and management (Super Admin) ──
export const staffMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: staffRoleSchema,
  status: z.enum(["active", "disabled", "suspended"]),
  keys: z.number().int().nonnegative(),
  lastLoginAt: iso.nullable(),
  createdAt: iso,
});
export const staffDirectorySchema = z.object({ staff: z.array(staffMemberSchema) });
/** New staff always start as Support; promotion to Admin is a two-person approval; Super Admin only by bootstrap. */
export const staffCreateSchema = z.object({ email: z.email().max(200), name: z.string().trim().min(1).max(120), reason });
export const staffCreatedSchema = z.object({ id: z.uuid(), temporaryPassword: z.string(), totpSecret: z.string(), totpUri: z.string() });

// ── Audit search and alerts ──
export const staffAuditQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  staffId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  since: iso.optional(),
  until: iso.optional(),
  before: iso.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const staffAlertsSchema = z.object({
  outboxPending: z.number().int(),
  outboxOldestSeconds: z.number().int().nullable(),
  stuckJobs: z.number().int(),
  failedJobs1h: z.number().int(),
  providerErrors1h: z.record(z.string(), z.number()),
  providerCalls1h: z.record(z.string(), z.number()),
  monthSpendUsd: z.record(z.string(), z.number()),
  pausedProviders: z.array(z.string()),
  pendingApprovals: z.number().int(),
  pendingRemovals: z.number().int(),
  oldestRemovalDays: z.number().int().nullable(),
  /** Seconds since the worker's queue last ran its heartbeat job; null = never (audit OPS-03). */
  workerHeartbeatSeconds: z.number().int().nullable(),
  /** Thresholds crossed now; an empty list means none crossed, not that everything is healthy. */
  alerts: z.array(z.object({ key: z.string(), severity: z.enum(["warning", "critical"]), message: z.string() })),
});

/** Result of "send a test alert" (audit OPS-03): where it went. */
export const alertTestResultSchema = z.object({ sent: z.literal(true), channel: z.enum(["webhook", "log"]) });

// ── Consented, read-only support access ──
export const supportAccessStatusSchema = z.enum(["requested", "granted", "declined", "ended", "expired"]);
export const supportAccessSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  staffName: z.string(),
  purpose: z.string(),
  status: supportAccessStatusSchema,
  createdAt: iso,
  decidedAt: iso.nullable(),
  expiresAt: iso.nullable(),
  endedAt: iso.nullable(),
});
export type SupportAccess = z.output<typeof supportAccessSchema>;
export const supportAccessListSchema = z.object({ requests: z.array(supportAccessSchema) });
export const supportAccessCreateSchema = z.object({ workspaceId: z.uuid(), purpose: z.string().trim().min(12, "Say why you need access (at least 12 characters)").max(500) });
export const supportAccessGrantSchema = z.object({ minutes: z.number().int().min(5).max(60).default(60) });
/** What staff can see during granted access: read-only; no ledger amounts, contact values or private notes. */
export const supportAccessViewSchema = z.object({
  workspace: z.object({ id: z.uuid(), name: z.string(), createdAt: iso, members: z.number().int(), subscriptionStatus: z.string().nullable(), planId: z.string().nullable() }),
  lists: z.array(z.object({ id: z.uuid(), name: z.string(), creators: z.number().int(), updatedAt: iso })),
  campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string(), creators: z.number().int(), updatedAt: iso })),
  jobs: z.array(z.object({ id: z.uuid(), kind: z.string(), status: z.string(), outcome: z.string().nullable(), errorCode: z.string().nullable(), createdAt: iso })),
  tickets: z.array(z.object({ id: z.uuid(), subject: z.string(), status: z.string(), lastMessageAt: iso })),
  access: supportAccessSchema,
});
