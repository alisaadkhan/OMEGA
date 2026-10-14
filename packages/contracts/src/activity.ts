import { z } from "zod";

export const activityKindSchema = z.enum(["list_created", "creator_saved", "campaign_created", "creator_added_to_campaign", "outreach_logged", "live_run_finished", "contact_revealed"]);

/**
 * Workspace activity (canonical frontend spec page 15), derived from records the team actually created: nothing is
 * seeded or generated. `target` lets the UI open what the event is about.
 */
export const activityEventSchema = z.object({
  id: z.string(),
  kind: activityKindSchema,
  at: z.iso.datetime(),
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  text: z.string(),
  target: z.object({ type: z.enum(["list", "campaign", "creator", "discovery_job"]), id: z.uuid() }).nullable(),
});
export type ActivityEvent = z.output<typeof activityEventSchema>;
export const activityQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.iso.datetime().optional() });
export const activityFeedSchema = z.object({ events: z.array(activityEventSchema) });
