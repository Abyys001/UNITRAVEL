import { sql } from "drizzle-orm"
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import { id, timestamps, tstz } from "./columns"
import { users } from "./identity"
import { invoices } from "./invoices"
import { paymentRecords } from "./requests"

/** ADR-0007 P4: Checkout Sessions. At most one OPEN session per invoice (partial unique index). */
export const paymentSessions = pgTable("payment_sessions", {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id),
  provider: text({ enum: ["STRIPE", "FAKE"] }).notNull(),
  mode: text({ enum: ["test", "live"] }).notNull().default("test"),
  providerSessionId: varchar({ length: 255 }).notNull().unique(),
  status: text({ enum: ["OPEN", "COMPLETE", "EXPIRED", "FAILED", "MISMATCH"] }).notNull().default("OPEN"),
  amountMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  attempt: integer().notNull(),
  paymentIntentId: varchar({ length: 255 }),
  expiresAt: tstz().notNull(),
  completedAt: tstz(),
  createdBy: uuid().references(() => users.id),
  ...timestamps,
}, (t) => [
  index("payment_sessions_invoice_idx").on(t.invoiceId),
  uniqueIndex("payment_sessions_one_open_per_invoice_uq").on(t.invoiceId).where(sql`${t.status} = 'OPEN'`),
  index("payment_sessions_status_idx").on(t.status, t.createdAt),
])

/** ADR-0007 P6: every verified webhook event, unique by the provider's event id; duplicates are no-ops. Payload ids only, no card or contact data. */
export const stripeEvents = pgTable("stripe_events", {
  id: varchar({ length: 255 }).primaryKey(),
  type: varchar({ length: 120 }).notNull(),
  mode: text({ enum: ["test", "live"] }).notNull().default("test"),
  outcome: text({ enum: ["PROCESSED", "IGNORED", "FAILED", "MISMATCH"] }).notNull(),
  error: text(),
  objectId: varchar({ length: 255 }),
  summary: jsonb().$type<Record<string, unknown>>(),
  receivedAt: tstz().notNull().defaultNow(),
  processedAt: tstz(),
}, (t) => [index("stripe_events_received_idx").on(t.receivedAt), index("stripe_events_outcome_idx").on(t.outcome)])

/** ADR-0007 P10. Above the existing four-eyes threshold a different staff member approves before the refund is sent. */
export const refundRequests = pgTable("refund_requests", {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id),
  paymentRecordId: uuid().notNull().references(() => paymentRecords.id),
  amountMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  reasonCode: text({ enum: ["CUSTOMER_REQUEST", "DUPLICATE", "AMOUNT_MISMATCH", "SERVICE_NOT_DELIVERED", "OTHER"] }).notNull(),
  note: text(),
  status: text({ enum: ["PENDING_APPROVAL", "SUBMITTED", "COMPLETED", "REJECTED", "FAILED"] }).notNull().default("PENDING_APPROVAL"),
  requestedBy: uuid().notNull().references(() => users.id),
  approvedBy: uuid().references(() => users.id),
  decidedAt: tstz(),
  providerRefundId: varchar({ length: 255 }),
  failure: text(),
  ...timestamps,
}, (t) => [index("refund_requests_invoice_idx").on(t.invoiceId), index("refund_requests_status_idx").on(t.status)])

/** One row per payment provider: the active adapter, the Stripe mode and a pending mode request (ADR-0007 P2). */
export const paymentConfig = pgTable("payment_config", {
  key: varchar({ length: 20 }).primaryKey(),
  provider: text({ enum: ["STRIPE", "FAKE"] }).notNull().default("STRIPE"),
  mode: text({ enum: ["test", "live"] }).notNull().default("test"),
  pendingMode: text({ enum: ["test", "live"] }),
  pendingBy: uuid(),
  pendingAt: tstz(),
  updatedBy: uuid(),
  updatedAt: tstz().notNull().defaultNow(),
})
