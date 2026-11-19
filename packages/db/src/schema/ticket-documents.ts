import { sql } from "drizzle-orm"
import { type AnyPgColumn, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import type { CodeIntegrityResult, TicketDocumentRecords } from "@unitravel/contracts"

import { createdAt, id, timestamps, tstz } from "./columns"
import { travellers } from "./customers"
import { users } from "./identity"
import { documents } from "./platform"
import { flightRequests, reservations, tickets } from "./requests"

/** What the cover shows, frozen with the version (the branded file was built and verified from exactly this). */
export interface TicketCover {
  pnr: string | null
  passengers: { travellerId: string; name: string; ticketNumber: string | null }[]
  segments: { carrier: string; flightNumber: string; origin: string; destination: string; departureLocal: string | null; departureUtc: string; arrivalLocal: string | null; arrivalUtc: string | null }[]
  customerName: string
  notes: string | null
  locale: "en" | "fa"
}

/**
 * ADR-0038 D1: one version of an issued ticket document. A chain (`chain_id`) holds the versions of one provider document;
 * replace and reissue add a version, nothing is edited in place except the status and its stamps.
 */
export const ticketDocuments = pgTable("ticket_documents", {
  id: id(),
  requestId: uuid().notNull().references(() => flightRequests.id),
  reservationId: uuid().references(() => reservations.id),
  chainId: uuid().notNull(),
  version: integer().notNull(),
  supersedesId: uuid().references((): AnyPgColumn => ticketDocuments.id),
  kind: text({ enum: ["E_TICKET", "BOARDING_PASS"] }).notNull(),
  status: text({ enum: ["DRAFT", "ISSUED", "SUPERSEDED", "REVOKED"] }).notNull().default("DRAFT"),
  originalDocumentId: uuid().notNull().references(() => documents.id),
  /** sha256 recorded by the virus scan at upload; checked again before every read of the original (D2). */
  originalSha256: varchar({ length: 64 }).notNull(),
  brandedDocumentId: uuid().references(() => documents.id),
  brandedSha256: varchar({ length: 64 }),
  wrapperMode: text({ enum: ["FULL", "COVER_ONLY"] }).notNull(),
  verification: jsonb().$type<CodeIntegrityResult>().notNull(),
  cover: jsonb().$type<TicketCover>().notNull(),
  /** D5: reservation/tickets to record on issue when the request has none (staff input, validated by the commands). */
  pendingRecords: jsonb().$type<TicketDocumentRecords>(),
  notes: text(),
  /** Why this version replaced or reissued the previous one. */
  reason: text(),
  /** Encrypted (encryptField) optional passenger email for the issue delivery. */
  passengerEmailEnc: text(),
  textWarningsAcknowledgedBy: uuid().references(() => users.id),
  createdBy: uuid().notNull().references(() => users.id),
  issuedBy: uuid().references(() => users.id),
  issuedAt: tstz(),
  supersededAt: tstz(),
  revokedBy: uuid().references(() => users.id),
  revokedAt: tstz(),
  revokedReason: text(),
  ...timestamps,
}, (t) => [
  index("ticket_documents_request_idx").on(t.requestId, t.createdAt),
  uniqueIndex("ticket_documents_chain_version_uq").on(t.chainId, t.version),
  uniqueIndex("ticket_documents_chain_issued_uq").on(t.chainId).where(sql`${t.status} = 'ISSUED'`),
  uniqueIndex("ticket_documents_supersedes_live_uq").on(t.supersedesId).where(sql`${t.supersedesId} is not null and ${t.status} in ('DRAFT','ISSUED')`),
  index("ticket_documents_status_idx").on(t.status, t.createdAt),
])

/** Travellers a ticket document covers (one provider PDF may cover several); `ticket_id` is linked on issue. */
export const ticketDocumentTravellers = pgTable("ticket_document_travellers", {
  ticketDocumentId: uuid().notNull().references(() => ticketDocuments.id),
  travellerId: uuid().notNull().references(() => travellers.id),
  ticketId: uuid().references(() => tickets.id),
  name: varchar({ length: 200 }).notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.ticketDocumentId, t.travellerId] }), index("ticket_document_travellers_traveller_idx").on(t.travellerId)])
