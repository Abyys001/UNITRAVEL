import { sql } from "drizzle-orm"
import { bigint, boolean, char, date, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import type { SearchQuery } from "@unitravel/contracts"

import { createdAt, id, rowVersion, timestamps, tstz } from "./columns"
import { userIdentities, users } from "./identity"
import { travellers } from "./customers"
import { offerSnapshots } from "./suppliers"

export const flightRequestStatus = pgEnum("flight_request_status", [
  "SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DECLINED", "CANCELLED", "EXPIRED",
])
export const paymentStatus = pgEnum("payment_status", ["NONE", "PARTIAL", "PAID", "REFUND_PENDING", "REFUNDED"])
export const requestType = pgEnum("request_type", ["FLIGHT", "CARGO", "AFTER_SALES", "SERVICE"])

// Chapter 23.7 / 23.11 — requests, quotes and bookings.
export const flightRequests = pgTable("flight_requests", {
  id: id(),
  ref: varchar({ length: 12 }).notNull().unique(),
  productType: text({ enum: ["FLIGHT"] }).notNull().default("FLIGHT"),
  kind: text({ enum: ["ITINERARY", "MANUAL"] }).notNull(),
  customerUserId: uuid().notNull().references(() => users.id),
  contactIdentityId: uuid().notNull().references(() => userIdentities.id),
  contactPhoneSnapshot: varchar({ length: 16 }).notNull(),
  contactPhoneVerified: boolean().notNull(),
  alternativeContact: jsonb().$type<{ name: string; phone: string; relationship: string }>(),
  status: flightRequestStatus().notNull().default("SUBMITTED"),
  paymentStatus: paymentStatus().notNull().default("NONE"),
  assigneeUserId: uuid().references(() => users.id),
  offerSnapshotId: uuid().references(() => offerSnapshots.id),
  tripType: text({ enum: ["ONE_WAY", "RETURN", "OPEN_JAW", "MULTI_CITY"] }).notNull(),
  query: jsonb().$type<SearchQuery>().notNull(),
  manual: jsonb().$type<Record<string, unknown>>(),
  preferences: jsonb().$type<{ seatPreference: string; seatChoice?: { segmentRef: string; designator: string }[]; ssrs: { travellerId: string; code: string; note?: string }[]; bestTimeToCall?: string; selfTransferAcknowledged?: boolean }>().notNull(),
  customerNote: text(),
  submittedVia: text({ enum: ["WEB", "MOBILE", "CONSOLE"] }).notNull().default("WEB"),
  submittedLocale: text({ enum: ["en", "fa"] }).notNull().default("en"),
  firstTravelDate: date({ mode: "string" }).notNull(),
  urgent: boolean().notNull().default(false),
  slaDueAt: tstz(),
  firstContactAt: tstz(),
  assignedAt: tstz(),
  version: rowVersion(),
  submittedAt: tstz().notNull().defaultNow(),
  closedAt: tstz(),
  ...timestamps,
}, (t) => [
  index("fr_queue_idx").on(t.status, t.slaDueAt),
  index("fr_customer_idx").on(t.customerUserId, t.submittedAt),
  index("fr_assignee_idx").on(t.assigneeUserId, t.status),
])

export const requestTravellers = pgTable("request_travellers", {
  id: id(),
  requestId: uuid().notNull().references(() => flightRequests.id),
  travellerId: uuid().notNull().references(() => travellers.id),
  passengerType: text({ enum: ["ADT", "CHD", "INF", "INS", "YTH", "STU"] }).notNull(),
  nameSnapshot: jsonb().$type<{ title: string; givenNames: string; surname: string; nameFa: string | null; dateOfBirth: string }>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("request_travellers_req_idx").on(t.requestId)])

/** Immutable history row for every transition (ch. 13.9). */
export const requestStatusHistory = pgTable("request_status_history", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  fromStatus: varchar({ length: 30 }),
  toStatus: varchar({ length: 30 }).notNull(),
  command: varchar({ length: 40 }).notNull(),
  actorUserId: uuid(),
  actorKind: text({ enum: ["CUSTOMER", "STAFF", "SYSTEM"] }).notNull(),
  reasonCode: varchar({ length: 40 }),
  reasonText: text(),
  createdAt: createdAt(),
}, (t) => [index("rsh_request_idx").on(t.requestType, t.requestId, t.createdAt)])

/** Internal only; never serialised to customer endpoints. */
export const requestNotes = pgTable("request_notes", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  authorId: uuid().notNull().references(() => users.id),
  body: text().notNull(),
  createdAt: createdAt(),
}, (t) => [index("request_notes_idx").on(t.requestType, t.requestId)])

export const requestMessages = pgTable("request_messages", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  authorId: uuid().references(() => users.id),
  direction: text({ enum: ["TO_CUSTOMER", "FROM_CUSTOMER"] }).notNull(),
  body: text().notNull(),
  documentIds: uuid().array().notNull().default([]),
  readAt: tstz(),
  createdAt: createdAt(),
}, (t) => [index("request_messages_idx").on(t.requestType, t.requestId, t.createdAt)])

export const contactAttempts = pgTable("contact_attempts", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  staffId: uuid().notNull().references(() => users.id),
  channel: text({ enum: ["PHONE", "SMS_TEMPLATE"] }).notNull(),
  outcome: text({ enum: ["REACHED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "CALL_BACK_REQUESTED"] }).notNull(),
  callBackAt: tstz(),
  note: text(),
  templateKey: varchar({ length: 80 }),
  createdAt: createdAt(),
}, (t) => [index("contact_attempts_idx").on(t.requestType, t.requestId)])

export const quotes = pgTable("quotes", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  version: integer().notNull(),
  status: text({ enum: ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "SUPERSEDED"] }).notNull().default("DRAFT"),
  currency: varchar({ length: 3 }).notNull(),
  validUntil: tstz(),
  sentAt: tstz(),
  acceptedOptionId: uuid(),
  acceptedAt: tstz(),
  acceptedVia: text({ enum: ["APP", "STAFF_RECORDED"] }),
  acceptanceNote: text(),
  /** Cargo quote lines (freight, surcharges…); flight quotes use quote_options. */
  cargoLines: jsonb(),
  cargoPartnerId: uuid(),
  /** ADR-0015: service quote lines (SERVICE_FEE, THIRD_PARTY_FEE, CLUB_DISCOUNT) and the staff note shown with the quote. */
  serviceLines: jsonb(),
  serviceNote: text(),
  transitNote: text(),
  partnerCostMinor: bigint({ mode: "number" }),
  /** ADR-0006: the quotation number, allocated when the quote is sent. */
  documentNumber: varchar({ length: 32 }).unique(),
  pdfDocumentId: uuid(),
  createdBy: uuid().notNull().references(() => users.id),
  rowVersion: rowVersion(),
  ...timestamps,
}, (t) => [
  index("quotes_request_idx").on(t.requestType, t.requestId),
  uniqueIndex("quotes_request_version_uq").on(t.requestType, t.requestId, t.version),
])

export const quoteOptions = pgTable("quote_options", {
  id: id(),
  quoteId: uuid().notNull().references(() => quotes.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  label: varchar({ length: 80 }).notNull(),
  source: text({ enum: ["SNAPSHOT", "STAFF_SEARCH", "MANUAL"] }).notNull(),
  attestedBy: uuid().references(() => users.id),
  itinerary: jsonb().notNull(),
  components: jsonb().notNull().default([]),
  priceBreakdown: jsonb().notNull(),
  totalMinor: bigint({ mode: "number" }).notNull(),
  baggage: jsonb().notNull(),
  conditions: jsonb().notNull(),
  ticketingModel: text({ enum: ["SINGLE_TICKET", "SEPARATE_TICKETS"] }).notNull(),
  /** Internal reporting only; never sent to clients (ch. 14.6). */
  internalCostMinor: bigint({ mode: "number" }),
  supplierPrice: jsonb(),
  supplierFetchedAt: tstz(),
  supplierExpiresAt: tstz(),
  createdAt: createdAt(),
}, (t) => [index("quote_options_quote_idx").on(t.quoteId)])

export const reservations = pgTable("reservations", {
  id: id(),
  requestId: uuid().notNull().references(() => flightRequests.id),
  system: text({ enum: ["AMADEUS_TERMINAL", "DUFFEL_API", "PARTNER", "AIRLINE_DIRECT"] }).notNull(),
  recordLocator: varchar({ length: 6 }).notNull(),
  airlineLocators: jsonb().$type<Record<string, string>>().notNull().default({}),
  status: text({ enum: ["HELD", "CONFIRMED", "CANCELLED", "LAPSED"] }).notNull(),
  ticketingDeadline: tstz().notNull(),
  quoteOptionId: uuid().references(() => quoteOptions.id),
  travellerIds: uuid().array().notNull(),
  segments: jsonb().notNull(),
  mismatchReason: text(),
  recordedBy: uuid().notNull().references(() => users.id),
  ...timestamps,
}, (t) => [index("reservations_request_idx").on(t.requestId)])

export const reservationSegments = pgTable("reservation_segments", {
  id: id(),
  reservationId: uuid().notNull().references(() => reservations.id, { onDelete: "cascade" }),
  sliceIndex: integer().notNull(),
  segmentIndex: integer().notNull(),
  carrier: varchar({ length: 3 }).notNull(),
  flightNumber: varchar({ length: 5 }).notNull(),
  origin: varchar({ length: 3 }).notNull(),
  destination: varchar({ length: 3 }).notNull(),
  departureUtc: tstz().notNull(),
  status: varchar({ length: 4 }).notNull().default("HK"),
})

export const tickets = pgTable("tickets", {
  id: id(),
  requestId: uuid().notNull().references(() => flightRequests.id),
  reservationId: uuid().notNull().references(() => reservations.id),
  travellerId: uuid().notNull().references(() => travellers.id),
  ticketNumber: char({ length: 13 }).notNull().unique(),
  validatingCarrier: varchar({ length: 3 }).notNull(),
  issueDate: date({ mode: "string" }).notNull(),
  status: text({ enum: ["ISSUED", "VOIDED", "EXCHANGED", "REFUNDED"] }).notNull().default("ISSUED"),
  coupons: jsonb().notNull(),
  documentId: uuid(),
  recordedBy: uuid().notNull().references(() => users.id),
  ...timestamps,
}, (t) => [index("tickets_request_idx").on(t.requestId)])

export const afterSalesCases = pgTable("after_sales_cases", {
  id: id(),
  ref: varchar({ length: 12 }).notNull().unique(),
  originalRequestId: uuid().notNull().references(() => flightRequests.id),
  customerUserId: uuid().notNull().references(() => users.id),
  type: text({ enum: ["CHANGE", "REFUND", "CANCEL"] }).notNull(),
  status: text({ enum: ["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER", "RESOLVED", "REJECTED"] }).notNull().default("OPEN"),
  ticketIds: uuid().array().notNull(),
  note: text(),
  resolutionNote: text(),
  assigneeUserId: uuid().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
})

export const paymentRecords = pgTable("payment_records", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  amountMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  method: text({ enum: ["BANK_TRANSFER", "CASH", "CARD_TERMINAL", "OTHER", "CARD_ONLINE"] }).notNull(),
  receivedAt: tstz().notNull(),
  externalReference: varchar({ length: 80 }).notNull(),
  payerName: varchar({ length: 120 }).notNull(),
  payerScreeningId: uuid(),
  evidenceDocumentId: uuid(),
  status: text({ enum: ["RECORDED", "VERIFIED", "REJECTED", "REFUNDED"] }).notNull().default("RECORDED"),
  atolCertificateDocumentId: uuid(),
  /** Null for payments recorded by the system from a verified provider event (ADR-0007 P7). */
  recordedBy: uuid().references(() => users.id),
  verifiedBy: uuid().references(() => users.id),
  verifiedAt: tstz(),
  /** ADR-0007: CARD_ONLINE payments name their invoice, provider and PaymentIntent (unique, so a replayed event cannot pay twice). */
  invoiceId: uuid(),
  provider: text({ enum: ["STRIPE", "FAKE"] }),
  providerRef: varchar({ length: 255 }),
  refundedMinor: bigint({ mode: "number" }).notNull().default(0),
  ...timestamps,
}, (t) => [index("payment_records_request_idx").on(t.requestType, t.requestId), uniqueIndex("payment_records_provider_ref_uq").on(t.providerRef).where(sql`${t.providerRef} is not null`)])

/** Owner-approved credit override for ticketing before payment (ch. 13.3 record_tickets). */
export const creditOverrides = pgTable("credit_overrides", {
  id: id(),
  requestId: uuid().notNull().references(() => flightRequests.id),
  reason: text().notNull(),
  requestedBy: uuid().notNull().references(() => users.id),
  approvedBy: uuid().references(() => users.id),
  approvedAt: tstz(),
  createdAt: createdAt(),
})
