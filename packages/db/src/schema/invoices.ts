import { sql } from "drizzle-orm"
import { bigint, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, rowVersion, timestamps, tstz } from "./columns"
import { users } from "./identity"
import { quotes, requestType } from "./requests"

/** ADR-0006 C6: one counter row per document kind and London year; incremented inside the issuing transaction, so the sequence has no gaps. */
export const documentSequences = pgTable("document_sequences", {
  kind: text({ enum: ["QUOTATION", "INVOICE"] }).notNull(),
  year: integer().notNull(),
  lastValue: integer().notNull().default(0),
}, (t) => [primaryKey({ columns: [t.kind, t.year] })])

export const invoices = pgTable("invoices", {
  id: id(),
  /** Allocated at issue; null while DRAFT. */
  number: varchar({ length: 32 }).unique(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  requestRef: varchar({ length: 12 }).notNull(),
  customerUserId: uuid().notNull().references(() => users.id),
  quoteId: uuid().notNull().references(() => quotes.id),
  status: text({ enum: ["DRAFT", "ISSUED", "PAID", "CANCELLED", "REFUNDED"] }).notNull().default("DRAFT"),
  currency: varchar({ length: 3 }).notNull(),
  /** Frozen by trigger once the invoice leaves DRAFT (ADR-0006 C4). */
  totalMinor: bigint({ mode: "number" }).notNull(),
  issuedAt: tstz(),
  expiresAt: tstz(),
  paidAt: tstz(),
  cancelledAt: tstz(),
  cancelReason: text({ enum: ["EXPIRED", "CORRECTION", "CUSTOMER_REQUEST", "DUPLICATE", "OTHER"] }),
  documentId: uuid(),
  createdBy: uuid().notNull().references(() => users.id),
  rowVersion: rowVersion(),
  ...timestamps,
}, (t) => [
  index("invoices_request_idx").on(t.requestType, t.requestId),
  index("invoices_customer_idx").on(t.customerUserId),
  index("invoices_status_expiry_idx").on(t.status, t.expiresAt),
  // One live (DRAFT, ISSUED or PAID) invoice per quote: a correction cancels first, then reissues; a paid quote is not billed twice.
  uniqueIndex("invoices_one_open_per_quote_uq").on(t.quoteId).where(sql`${t.status} in ('DRAFT', 'ISSUED', 'PAID')`),
])

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id),
  position: integer().notNull(),
  description: varchar({ length: 200 }).notNull(),
  quantity: integer().notNull().default(1),
  unitAmountMinor: bigint({ mode: "number" }).notNull(),
  amountMinor: bigint({ mode: "number" }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId, t.position)])

/** Insert-only (trigger plus no UPDATE/DELETE for app_rw). */
export const invoiceStatusHistory = pgTable("invoice_status_history", {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id),
  fromStatus: text({ enum: ["DRAFT", "ISSUED", "PAID", "CANCELLED", "REFUNDED"] }),
  toStatus: text({ enum: ["DRAFT", "ISSUED", "PAID", "CANCELLED", "REFUNDED"] }).notNull(),
  command: varchar({ length: 30 }).notNull(),
  reasonCode: varchar({ length: 30 }),
  reasonText: text(),
  actorUserId: uuid().references(() => users.id),
  actorKind: text({ enum: ["STAFF", "SYSTEM"] }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("invoice_history_invoice_idx").on(t.invoiceId, t.createdAt)])
