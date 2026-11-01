import { z } from "zod"

import { IsoDateTime, page, Reference, Uuid } from "./common"

// ADR-0019 and plan J5: support tickets (public form, customer thread, staff inbox) and the call log. Bonline's own API is UNKNOWN.

export const SUPPORT_TOPICS = ["BOOKING", "PAYMENT", "DOCUMENTS", "VISA", "CARGO", "ACCOUNT", "FEEDBACK", "OTHER"] as const
export const SupportTopic = z.enum(SUPPORT_TOPICS)
export type SupportTopic = z.infer<typeof SupportTopic>

export const SUPPORT_TICKET_STATUSES = ["OPEN", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"] as const
export const SupportTicketStatus = z.enum(SUPPORT_TICKET_STATUSES)
export type SupportTicketStatus = z.infer<typeof SupportTicketStatus>

export const SupportTicketRef = z.string().regex(/^TK-[0-9A-HJKMNP-TV-Z]{6}$/i)

/** At least one way to answer: an email address or a phone number. */
export const CreateTicketBody = z.strictObject({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(254).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,24}$/).optional(),
  topic: SupportTopic,
  requestRef: Reference.optional(),
  message: z.string().trim().min(10).max(4000),
  locale: z.enum(["en", "fa"]).default("en"),
  deviceId: z.string().min(8).max(128),
  /** Proof-of-work solution (same ALTCHA payload as OTP sign-in and tracking) once the server asked for one. */
  challenge: z.string().max(4096).optional(),
}).refine((b) => !!(b.email || b.phone), { message: "Give an email address or a phone number", path: ["email"] })
export type CreateTicketBody = z.infer<typeof CreateTicketBody>

export const TicketCreated = z.object({ ref: SupportTicketRef, status: SupportTicketStatus, createdAt: IsoDateTime })
export type TicketCreated = z.infer<typeof TicketCreated>

export const TicketReplyBody = z.strictObject({ body: z.string().trim().min(1).max(4000) })
export type TicketReplyBody = z.infer<typeof TicketReplyBody>

export const TicketMessageKind = z.enum(["CUSTOMER", "STAFF", "INTERNAL"])
export const CustomerTicketMessage = z.object({ id: Uuid, direction: z.enum(["FROM_CUSTOMER", "TO_CUSTOMER"]), authorName: z.string(), body: z.string(), createdAt: IsoDateTime })

export const CustomerTicketSummary = z.object({
  ref: SupportTicketRef, topic: SupportTopic, subject: z.string(), status: SupportTicketStatus, requestRef: z.string().nullable(), createdAt: IsoDateTime, updatedAt: IsoDateTime, lastMessageAt: IsoDateTime,
})
export type CustomerTicketSummary = z.infer<typeof CustomerTicketSummary>
/** Internal notes never reach this schema, so they cannot leak to the customer. */
export const CustomerTicketView = CustomerTicketSummary.extend({ messages: z.array(CustomerTicketMessage), canReply: z.boolean() })
export type CustomerTicketView = z.infer<typeof CustomerTicketView>

// ---- staff ----
export const StaffTicketListQuery = z.object({
  status: SupportTicketStatus.optional(),
  topic: SupportTopic.optional(),
  /** "me", "none" (unassigned) or a staff user id. */
  assignee: z.union([z.literal("me"), z.literal("none"), Uuid]).optional(),
  overdue: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  customerId: Uuid.optional(),
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})
export type StaffTicketListQuery = z.infer<typeof StaffTicketListQuery>

export const StaffTicketSummary = z.object({
  ref: SupportTicketRef, topic: SupportTopic, subject: z.string(), status: SupportTicketStatus, contactName: z.string(), customerId: Uuid.nullable(), requestRef: z.string().nullable(),
  assignee: z.object({ userId: Uuid, name: z.string() }).nullable(), slaDueAt: IsoDateTime.nullable(), overdue: z.boolean(), createdAt: IsoDateTime, updatedAt: IsoDateTime, messageCount: z.number().int(),
})
export type StaffTicketSummary = z.infer<typeof StaffTicketSummary>
export const StaffTicketPage = page(StaffTicketSummary)
export type StaffTicketPage = z.infer<typeof StaffTicketPage>

export const CALL_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const
export const CALL_STATUSES = ["ANSWERED", "MISSED", "BUSY", "FAILED", "VOICEMAIL"] as const
export const CallDirection = z.enum(CALL_DIRECTIONS)
export const CallStatus = z.enum(CALL_STATUSES)
const PhoneNumber = z.string().trim().regex(/^\+?[0-9 ()-]{3,24}$/)

export const CallLogBody = z.strictObject({
  direction: CallDirection,
  fromNumber: PhoneNumber,
  toNumber: PhoneNumber,
  durationSeconds: z.number().int().min(0).max(86_400),
  status: CallStatus,
  startedAt: IsoDateTime,
  ticketRef: SupportTicketRef.optional(),
  customerId: Uuid.optional(),
  note: z.string().trim().max(1000).optional(),
})
export type CallLogBody = z.infer<typeof CallLogBody>

export const CallLogView = z.object({
  id: Uuid, direction: CallDirection, fromNumber: z.string(), toNumber: z.string(), durationSeconds: z.number().int(), status: CallStatus, startedAt: IsoDateTime,
  source: z.enum(["MANUAL", "BONLINE"]), ticketRef: z.string().nullable(), customerId: Uuid.nullable(), recordedBy: z.string().nullable(), note: z.string().nullable(), createdAt: IsoDateTime,
})
export type CallLogView = z.infer<typeof CallLogView>

export const CallListQuery = z.object({
  direction: CallDirection.optional(), status: CallStatus.optional(), ticketRef: SupportTicketRef.optional(), customerId: Uuid.optional(),
  from: IsoDateTime.optional(), to: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(200).optional(),
})
export type CallListQuery = z.infer<typeof CallListQuery>
export const CallLogPage = page(CallLogView)

export const StaffTicketMessage = z.object({ id: Uuid, kind: TicketMessageKind, authorName: z.string(), body: z.string(), createdAt: IsoDateTime, emailed: z.boolean() })
export const SUPPORT_TICKET_COMMANDS = ["assign", "resolve", "reopen", "close"] as const
export const StaffTicketView = StaffTicketSummary.extend({
  contact: z.object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  locale: z.enum(["en", "fa"]),
  messages: z.array(StaffTicketMessage),
  calls: z.array(CallLogView),
  version: z.number().int(),
  allowedCommands: z.array(z.object({ command: z.enum(SUPPORT_TICKET_COMMANDS), allowed: z.boolean(), reason: z.string().optional() })),
})
export type StaffTicketView = z.infer<typeof StaffTicketView>

/** `internal: true` is a note the customer never sees and no email is sent for. */
export const StaffReplyBody = z.strictObject({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) })
export type StaffReplyBody = z.infer<typeof StaffReplyBody>
export const StaffTicketCommandBody = z.strictObject({
  command: z.enum(SUPPORT_TICKET_COMMANDS), assigneeUserId: Uuid.optional(), expectedVersion: z.number().int().positive(),
}).refine((b) => b.command !== "assign" || !!b.assigneeUserId, { message: "Choose who to assign", path: ["assigneeUserId"] })
export type StaffTicketCommandBody = z.infer<typeof StaffTicketCommandBody>

export const ClickToCallBody = z.strictObject({ toNumber: PhoneNumber, ticketRef: SupportTicketRef.optional() })
export type ClickToCallBody = z.infer<typeof ClickToCallBody>

/**
 * Fields read from a Bonline webhook. The names are INFERRED, not taken from Bonline's documentation (ADR-0019); the
 * adapter maps the vendor payload into this shape, so changing the mapping never changes the contract.
 */
export const TelephonyEvent = z.object({
  callId: z.string().min(1).max(120), direction: CallDirection, fromNumber: PhoneNumber, toNumber: PhoneNumber,
  durationSeconds: z.number().int().min(0).max(86_400), status: CallStatus, startedAt: IsoDateTime,
})
export type TelephonyEvent = z.infer<typeof TelephonyEvent>
