import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"
import { Channel, DeliveryStatus, Locale } from "./enums"

// Chapter 17.2 — the event catalogue.
export const NOTIFICATION_EVENTS = [
  "auth.otp",
  "request.submitted", "request.assigned", "request.info_requested", "request.message_from_staff", "request.message_from_customer",
  "request.declined", "request.cancelled", "request.status_changed",
  "quote.sent", "quote.expiring", "quote.accepted", "quote.expired",
  "reservation.recorded", "reservation.deadline_approaching",
  "ticket.issued",
  "sla.unassigned", "sla.first_contact_due", "sla.awaiting_customer_reminder",
  "cargo.submitted", "cargo.status_changed",
  "compliance.hold_created", "compliance.case_decided",
  "security.new_sign_in", "security.role_changed",
  "provider.degraded", "notification.route_degraded",
  "staff.digest",
] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

export const InboxItem = z.object({
  id: Uuid,
  eventType: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()),
  critical: z.boolean(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
})
export type InboxItem = z.infer<typeof InboxItem>

export const MarkReadBody = z.object({ ids: z.array(Uuid).max(200).optional(), all: z.boolean().optional() })

export const TemplateBody = z.object({
  eventType: z.string(),
  channel: Channel,
  locale: Locale,
  title: z.string().max(200).default(""),
  body: z.string().min(1).max(4000),
  variables: z.array(z.string()),
  providerTemplateId: z.string().max(120).optional(),
  active: z.boolean().default(true),
})
export const TemplateView = TemplateBody.extend({ id: Uuid, version: z.number().int(), segments: z.object({ encoding: z.enum(["GSM7", "UCS2"]), count: z.number().int(), chars: z.number().int() }).optional() })

export const SmsRouteBody = z.object({ prefix: z.string().regex(/^\+?\d{0,4}$|^default$/), providers: z.array(z.string()).min(1), enabled: z.boolean() })
export const SmsRouteView = SmsRouteBody.extend({ id: Uuid, successRate: z.number().nullable(), sent24h: z.number().int() })

export const DeliveryView = z.object({
  id: Uuid, channel: Channel, provider: z.string().nullable(), status: DeliveryStatus, error: z.string().nullable(), attempts: z.number().int(),
  sentAt: IsoDateTime.nullable(), deliveredAt: IsoDateTime.nullable(),
})
