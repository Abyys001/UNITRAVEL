import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"
import { Channel, DeliveryStatus, Locale } from "./enums"

// Chapter 17.2 — the event catalogue.
export const NOTIFICATION_EVENTS = [
  "auth.otp",
  "request.submitted", "request.assigned", "request.info_requested", "request.message_from_staff", "request.message_from_customer",
  "request.declined", "request.cancelled", "request.status_changed", "request.amended",
  "quote.sent", "quotation.sent", "invoice.issued", "invoice.cancelled", "invoice.expired", "invoice.paid",
  "payment.requested", "payment.failed", "payment.refunded", "quote.expiring", "quote.accepted", "quote.expired",
  "reservation.recorded", "reservation.deadline_approaching",
  "ticket.issued",
  "identity.verification_verified", "identity.verification_rejected", "identity.verification_correction",
  "sla.unassigned", "sla.first_contact_due", "sla.awaiting_customer_reminder",
  "cargo.submitted", "cargo.status_changed",
  "service_request.submitted", "service_request.quoted", "service_request.confirmed", "service_request.cancelled",
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

/** Providers the SMS sender implements; a route can only name these (ch. 8.1). `console` is the local sink and is refused in production. */
export const SMS_PROVIDERS = ["kavenegar", "smsir", "sinch", "infobip", "console"] as const
/** Providers outside Iran: +98 numbers are never routed through them. */
export const INTERNATIONAL_SMS_PROVIDERS: readonly string[] = ["sinch", "infobip", "twilio", "vonage"]
/** Whether a route prefix can match Iranian numbers: "+98…" itself, or a shorter prefix such as "+9" that contains it. */
export const prefixCoversIran = (prefix: string): boolean => prefix !== "default" && ("+98".startsWith(prefix) || prefix.startsWith("+98"))

export const SmsRouteBody = z.object({
  prefix: z.string().regex(/^\+\d{1,4}$|^default$/, "Use an international prefix such as +44, or default"),
  providers: z.array(z.enum(SMS_PROVIDERS)).min(1).refine((a) => new Set(a).size === a.length, "Each provider once"),
  enabled: z.boolean(),
})
export const SmsRouteView = SmsRouteBody.extend({ id: Uuid, successRate: z.number().nullable(), sent24h: z.number().int() })

export const DeliveryView = z.object({
  id: Uuid, channel: Channel, provider: z.string().nullable(), status: DeliveryStatus, error: z.string().nullable(), attempts: z.number().int(),
  sentAt: IsoDateTime.nullable(), deliveredAt: IsoDateTime.nullable(),
})
