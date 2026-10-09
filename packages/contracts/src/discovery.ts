import { z } from "zod";
import { creatorPlatformSchema } from "./search";

const iso = z.iso.datetime();

export const discoveryJobKindSchema = z.enum(["add_by_url", "refresh"]);
export const discoveryJobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export const discoveryJobStepSchema = z.enum(["fetching", "archiving", "cleaning", "assessing", "saving"]);
export type DiscoveryJobStep = z.output<typeof discoveryJobStepSchema>;

export const startDiscoveryJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_by_url"), url: z.string().trim().min(3).max(500), confirmedCost: z.number().int().min(1) }),
  z.object({ kind: z.literal("refresh"), creatorId: z.uuid(), confirmedCost: z.number().int().min(1) }),
]);
export type StartDiscoveryJob = z.output<typeof startDiscoveryJobSchema>;

export const discoveryJobSchema = z.object({
  id: z.uuid(),
  kind: discoveryJobKindSchema,
  status: discoveryJobStatusSchema,
  step: discoveryJobStepSchema.nullable(),
  outcome: z.enum(["created", "refreshed", "reused"]).nullable(),
  creatorId: z.uuid().nullable(),
  platform: creatorPlatformSchema,
  handle: z.string(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: iso,
  finishedAt: iso.nullable(),
});
export type DiscoveryJob = z.output<typeof discoveryJobSchema>;

export const startDiscoveryJobResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("started"), job: discoveryJobSchema }),
  z.object({ status: z.literal("known"), creatorId: z.uuid() }),
  z.object({ status: z.literal("up_to_date"), creatorId: z.uuid(), updatedAt: iso }),
]);
export type StartDiscoveryJobResponse = z.output<typeof startDiscoveryJobResponseSchema>;

export const discoveryJobListSchema = z.object({ jobs: z.array(discoveryJobSchema) });
