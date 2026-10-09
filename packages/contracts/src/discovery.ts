import { z } from "zod";
import { creatorCardSchema, creatorPlatformSchema, searchRequestSchema } from "./search";

const iso = z.iso.datetime();

export const discoveryJobKindSchema = z.enum(["add_by_url", "refresh", "live"]);
export const discoveryJobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export const discoveryJobStepSchema = z.enum(["searching", "filtering", "fetching", "archiving", "cleaning", "assessing", "saving"]);
export type DiscoveryJobStep = z.output<typeof discoveryJobStepSchema>;

/** Brain 2 runs the user's Brain 1 search: the same text and filter chips (spec §4.1). */
export const liveSearchSchema = searchRequestSchema.pick({ text: true, filters: true });
export type LiveSearch = z.output<typeof liveSearchSchema>;
export const liveRunSizeSchema = z.union([z.literal(5), z.literal(10), z.literal(20)]);
export type LiveRunSize = z.output<typeof liveRunSizeSchema>;

export const startDiscoveryJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_by_url"), url: z.string().trim().min(3).max(500), confirmedCost: z.number().int().min(1) }),
  z.object({ kind: z.literal("refresh"), creatorId: z.uuid(), confirmedCost: z.number().int().min(1) }),
  z.object({ kind: z.literal("live"), search: liveSearchSchema, maxNew: liveRunSizeSchema, confirmedCost: z.number().int().min(1) }),
]);
export type StartDiscoveryJob = z.output<typeof startDiscoveryJobSchema>;

export const discoveryJobSchema = z.object({
  id: z.uuid(),
  kind: discoveryJobKindSchema,
  status: discoveryJobStatusSchema,
  step: discoveryJobStepSchema.nullable(),
  outcome: z.enum(["created", "refreshed", "reused"]).nullable(),
  creatorId: z.uuid().nullable(),
  platform: creatorPlatformSchema.nullable(),
  handle: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: iso,
  finishedAt: iso.nullable(),
  /** Live runs only: the search, its size and progress counters (found = new + known). */
  live: z
    .object({
      search: liveSearchSchema,
      maxNew: z.number().int(),
      found: z.number().int().nonnegative(),
      new: z.number().int().nonnegative(),
      known: z.number().int().nonnegative(),
      maxCost: z.number().int().nonnegative(),
      creditsCharged: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type DiscoveryJob = z.output<typeof discoveryJobSchema>;

export const startDiscoveryJobResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("started"), job: discoveryJobSchema }),
  z.object({ status: z.literal("known"), creatorId: z.uuid() }),
  z.object({ status: z.literal("up_to_date"), creatorId: z.uuid(), updatedAt: iso }),
]);
export type StartDiscoveryJobResponse = z.output<typeof startDiscoveryJobResponseSchema>;

export const discoveryJobListSchema = z.object({ jobs: z.array(discoveryJobSchema) });

/** A creator a live run returned: Brain 1's card plus where it came from (spec §6). */
export const discoveryResultSchema = creatorCardSchema.extend({
  seq: z.number().int().positive(),
  rank: z.number().int().nonnegative(),
  isNew: z.boolean(),
  reason: z.string().nullable(),
});
export type DiscoveryResult = z.output<typeof discoveryResultSchema>;
export const discoveryResultsResponseSchema = z.object({ results: z.array(discoveryResultSchema), done: z.boolean() });
