import { z } from "zod";

/** Staff operations views (canonical spec pages 20–23). Only instrumented values; nothing defaults to "healthy". */
const iso = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

export const staffOverviewSchema = z.object({
  workspaces: count,
  users: count,
  openTickets: count,
  pendingRemovals: count,
  openJobs: count,
  stuckJobs: count,
  jobs24h: z.record(z.string(), count),
});

export const staffJobSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  kind: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  step: z.string().nullable(),
  attempts: count,
  platform: z.string().nullable(),
  handle: z.string().nullable(),
  brief: z.string().nullable(),
  maxNew: z.number().int().nullable(),
  found: count,
  new: count,
  maxCost: count,
  creditsCharged: count,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  cancelRequested: z.boolean(),
  createdAt: iso,
  startedAt: iso.nullable(),
  finishedAt: iso.nullable(),
});
export const staffJobListSchema = z.object({ jobs: z.array(staffJobSchema) });
export const staffJobQuerySchema = z.object({ status: z.enum(["open", "failed", "stuck"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const staffJobDetailSchema = z.object({
  progress: z.record(z.string(), z.number()),
  decisions: z.array(z.object({ stage: z.string(), decision: z.string(), reason: z.string().nullable(), count })),
  providerCalls: z.array(
    z.object({
      provider: z.string(),
      operation: z.string(),
      model: z.string().nullable(),
      status: z.string(),
      errorCode: z.string().nullable(),
      calls: count,
      tokensIn: count,
      tokensOut: count,
      units: z.number(),
      avgLatencyMs: z.number().nullable(),
      costUsd: z.number(),
    }),
  ),
  /** Direct provider cost (USD, reported or estimated per call) next to the customer's credit charge. */
  cost: z.object({
    totalUsd: z.number(),
    failedCalls: count,
    attempts: count,
    newCreators: count,
    creditsCharged: count,
    costPerNewCreatorUsd: z.number().nullable(),
  }),
});

export const providerUsageSchema = z.object({
  since: iso,
  providers: z.array(z.object({ provider: z.string(), calls: count, errors: count, costUsd: z.number(), p95LatencyMs: z.number().nullable(), lastCallAt: iso.nullable(), lastErrorCode: z.string().nullable() })),
});
export const providerUsageQuerySchema = z.object({ hours: z.coerce.number().int().min(1).max(24 * 31).default(24) });

export const staffWorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: iso,
  /** Masked for support staff; full for admins. */
  ownerEmail: z.string(),
  members: count,
  subscriptionStatus: z.string().nullable(),
  jobs30d: count,
  openTickets: count,
});
export const staffWorkspaceListSchema = z.object({ workspaces: z.array(staffWorkspaceSchema) });
export const staffWorkspaceQuerySchema = z.object({ q: z.string().trim().max(120).default("") });

export const staffAuditEventSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  workspaceId: z.uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: iso,
  staffName: z.string().nullable(),
  staffRole: z.string().nullable(),
});
export const staffAuditListSchema = z.object({ events: z.array(staffAuditEventSchema) });
