import { boolean, index, integer, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import { createdAt, id, rowVersion, timestamps, tstz } from "./columns"
import { users } from "./identity"

// Plan J5, ADR-0019: support tickets, their messages and the call log. Internal notes live in the same table with kind INTERNAL
// and are filtered out of every customer serialiser.

export const supportTickets = pgTable("support_tickets", {
  id: id(),
  ref: varchar({ length: 12 }).notNull().unique(),
  status: text({ enum: ["OPEN", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"] }).notNull().default("OPEN"),
  topic: text({ enum: ["BOOKING", "PAYMENT", "DOCUMENTS", "VISA", "CARGO", "ACCOUNT", "FEEDBACK", "OTHER"] }).notNull(),
  subject: varchar({ length: 160 }).notNull(),
  /** Set when a signed-in customer opened the ticket; guests stay null and are never auto-linked to an account. */
  userId: uuid().references(() => users.id),
  contactName: varchar({ length: 80 }).notNull(),
  contactEmail: varchar({ length: 254 }),
  contactPhone: varchar({ length: 32 }),
  requestRef: varchar({ length: 20 }),
  locale: text({ enum: ["en", "fa"] }).notNull().default("en"),
  assigneeUserId: uuid().references(() => users.id),
  slaDueAt: tstz(),
  version: rowVersion(),
  lastMessageAt: tstz().notNull().defaultNow(),
  resolvedAt: tstz(),
  closedAt: tstz(),
  ...timestamps,
}, (t) => [
  index("support_tickets_status_idx").on(t.status, t.slaDueAt),
  index("support_tickets_user_idx").on(t.userId, t.createdAt),
  index("support_tickets_assignee_idx").on(t.assigneeUserId, t.status),
])

export const supportMessages = pgTable("support_messages", {
  id: id(),
  ticketId: uuid().notNull().references(() => supportTickets.id),
  kind: text({ enum: ["CUSTOMER", "STAFF", "INTERNAL"] }).notNull(),
  authorUserId: uuid().references(() => users.id),
  authorName: varchar({ length: 120 }).notNull(),
  body: text().notNull(),
  /** A staff reply was queued for email to the contact; false for notes and for contacts with no email. */
  emailQueued: boolean().notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("support_messages_ticket_idx").on(t.ticketId, t.createdAt)])

export const callLogs = pgTable("call_logs", {
  id: id(),
  direction: text({ enum: ["INBOUND", "OUTBOUND"] }).notNull(),
  fromNumber: varchar({ length: 32 }).notNull(),
  toNumber: varchar({ length: 32 }).notNull(),
  durationSeconds: integer().notNull(),
  status: text({ enum: ["ANSWERED", "MISSED", "BUSY", "FAILED", "VOICEMAIL"] }).notNull(),
  startedAt: tstz().notNull(),
  source: text({ enum: ["MANUAL", "BONLINE"] }).notNull(),
  /** Vendor call id; unique per source so a redelivered webhook cannot create a second row. */
  providerRef: varchar({ length: 120 }),
  ticketId: uuid().references(() => supportTickets.id),
  userId: uuid().references(() => users.id),
  recordedBy: uuid().references(() => users.id),
  note: text(),
  createdAt: createdAt(),
}, (t) => [
  index("call_logs_started_idx").on(t.startedAt),
  index("call_logs_ticket_idx").on(t.ticketId),
  index("call_logs_user_idx").on(t.userId, t.startedAt),
  uniqueIndex("call_logs_provider_uq").on(t.source, t.providerRef).where(sql`provider_ref is not null`),
])
