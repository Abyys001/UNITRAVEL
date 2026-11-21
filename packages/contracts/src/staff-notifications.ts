import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"

// ADR-0039 D1: the staff notification feed of the Admin Panel. Rows live in `notifications` (one per staff user, INBOX
// channel) under `staff.*` event types, so read state is per person and survives devices.

export const STAFF_NOTIFICATION_CATEGORIES = ["REQUEST", "SERVICE", "SUPPORT", "PAYMENT", "IDENTITY"] as const
export const StaffNotificationCategory = z.enum(STAFF_NOTIFICATION_CATEGORIES)
export type StaffNotificationCategory = z.infer<typeof StaffNotificationCategory>

/** Feed event → category. The event names are in NOTIFICATION_EVENTS too, so templates and the matrix can address them. */
export const STAFF_FEED_EVENTS = {
  "staff.request_submitted": "REQUEST",
  "staff.cargo_submitted": "REQUEST",
  "staff.customer_message": "REQUEST",
  "staff.quote_accepted": "REQUEST",
  "staff.service_submitted": "SERVICE",
  "staff.service_message": "SERVICE",
  "staff.support_ticket": "SUPPORT",
  "staff.support_reply": "SUPPORT",
  "staff.invoice_paid": "PAYMENT",
  "staff.identity_submitted": "IDENTITY",
} as const satisfies Record<string, StaffNotificationCategory>
export type StaffFeedEvent = keyof typeof STAFF_FEED_EVENTS

export const StaffNotification = z.object({
  id: Uuid,
  eventType: z.string(),
  category: StaffNotificationCategory,
  title: z.string(),
  body: z.string(),
  /** Reference the item is about (request, ticket, invoice number; the document id for a passport check). */
  ref: z.string().nullable(),
  /** Console path that opens the item. */
  linkPath: z.string().nullable(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
})
export type StaffNotification = z.infer<typeof StaffNotification>

export const StaffNotificationQuery = z.object({
  category: StaffNotificationCategory.optional(),
  unread: z.enum(["1", "0"]).optional(),
  /** `createdAt` of the last item of the previous page. */
  before: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type StaffNotificationQuery = z.infer<typeof StaffNotificationQuery>

export const StaffNotificationPage = z.object({ items: z.array(StaffNotification), nextBefore: IsoDateTime.nullable() })
export type StaffNotificationPage = z.infer<typeof StaffNotificationPage>

const count = z.number().int().min(0)
export const StaffNotificationSummary = z.object({
  unread: z.object({ total: count, REQUEST: count, SERVICE: count, SUPPORT: count, PAYMENT: count, IDENTITY: count }),
})
export type StaffNotificationSummary = z.infer<typeof StaffNotificationSummary>

/** Exactly one selector: listed ids, everything, one category, or every notification about one reference. */
export const MarkStaffNotificationsBody = z.object({
  ids: z.array(Uuid).min(1).max(200).optional(),
  all: z.literal(true).optional(),
  category: StaffNotificationCategory.optional(),
  ref: z.string().min(1).max(64).optional(),
}).refine((b) => [b.ids, b.all, b.category, b.ref].filter((x) => x !== undefined).length === 1, "Send exactly one of ids, all, category or ref")
export type MarkStaffNotificationsBody = z.infer<typeof MarkStaffNotificationsBody>
