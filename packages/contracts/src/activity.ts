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
  /** Opaque page cursor for `before`: exact time and id, so events that share one time are never skipped. */
  cursor: z.string(),
});
export type ActivityEvent = z.output<typeof activityEventSchema>;
/** `before`: an event's `cursor` (exact, preferred) or an ISO time (events strictly older than it). */
export const activityCursorSchema = z.string().regex(/^\d{1,20}~[\w:.-]{1,200}$/);
export const activityQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.union([activityCursorSchema, z.iso.datetime()]).optional() });
export const activityFeedSchema = z.object({ events: z.array(activityEventSchema) });
