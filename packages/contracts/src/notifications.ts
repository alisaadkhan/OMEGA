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

export const notificationListSchema = z.object({
  notifications: z.array(notificationSchema),
  unread: z.number().int().nonnegative(),
  /** Unread count per dashboard page (owner, 26 Nov: the page a notification concerns is highlighted with a number). */
  unreadByView: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

/** Mark some notifications read, or all of them when `ids` is left out. */
export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100).optional(),
    /** Opening a page marks its notifications read. */
    view: z.string().regex(/^[a-z]{2,20}$/).optional(),
  })
  .refine((b) => !(b.ids && b.view), { message: "Give ids or a view, not both" });
export const markNotificationsReadResultSchema = z.object({ ok: z.literal(true) });
