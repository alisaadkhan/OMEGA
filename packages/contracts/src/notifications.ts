import { z } from "zod";

/** A customer notification (0100): support replies, resolved requests, credits, trial, payments, finished live searches. */
export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  /** The dashboard page it concerns, e.g. "support" or "billing"; null when it has none. */
  view: z.string().nullable(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({ notifications: z.array(notificationSchema), unread: z.number().int().nonnegative() });
export type NotificationList = z.infer<typeof notificationListSchema>;

/** Mark some notifications read, or all of them when `ids` is left out. */
export const markNotificationsReadSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100).optional() });
export const markNotificationsReadResultSchema = z.object({ ok: z.literal(true) });
