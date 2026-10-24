import { type AnyPgColumn, bigint, boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, rowVersion, timestamps, tstz } from "./columns"
import { userIdentities, users } from "./identity"
import { paymentStatus } from "./requests"

export const cargoStatus = pgEnum("cargo_status", [
  "SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED",
  "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "EXCEPTION", "DECLINED", "CANCELLED", "EXPIRED",
])
export const cargoService = pgEnum("cargo_service", ["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"])

// Chapter 23.8 — cargo.
export const cargoLanes = pgTable("cargo_lanes", {
  id: id(),
  originCountry: varchar({ length: 2 }).notNull(),
  destinationCountry: varchar({ length: 2 }).notNull(),
  services: cargoService().array().notNull(),
  enabled: boolean().notNull().default(false),
  requiresComplianceApproval: boolean().notNull().default(false),
  volumetricDivisor: integer().notNull().default(5000),
  customerNotice: jsonb().$type<{ en: string; fa: string }>(),
  counselReference: varchar({ length: 120 }),
  enabledByOwner: uuid(),
  enabledByCompliance: uuid(),
  version: rowVersion(),
  ...timestamps,
})

export const partners = pgTable("partners", {
  id: id(),
  name: varchar({ length: 160 }).notNull(),
  type: text({ enum: ["COURIER", "CONSOLIDATOR", "FORWARDER", "BAGGAGE_SHIPPER"] }).notNull(),
  laneIds: uuid().array().notNull().default([]),
  services: cargoService().array().notNull().default([]),
  integrationLevel: text({ enum: ["MANUAL", "EMAIL", "API"] }).notNull().default("MANUAL"),
  complianceStatus: text({ enum: ["PENDING", "CLEARED", "HOLD", "BLOCKED"] }).notNull().default("PENDING"),
  lastScreenedAt: tstz(),
  contacts: jsonb().$type<{ name: string; phone?: string; email?: string }[]>().notNull().default([]),
  slaNote: text(),
  cutOffNote: text(),
  active: boolean().notNull().default(true),
  ...timestamps,
})

export const cargoRequests = pgTable("cargo_requests", {
  id: id(),
  ref: varchar({ length: 12 }).notNull().unique(),
  customerUserId: uuid().notNull().references(() => users.id),
  service: cargoService().notNull(),
  laneId: uuid().notNull().references(() => cargoLanes.id),
  status: cargoStatus().notNull().default("SUBMITTED"),
  paymentStatus: paymentStatus().notNull().default("NONE"),
  assigneeUserId: uuid().references(() => users.id),
  shipperIdentityId: uuid().notNull().references(() => userIdentities.id),
  shipper: jsonb().notNull(),
  consignee: jsonb().notNull(),
  purpose: varchar({ length: 30 }),
  declaredValueMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  insuranceRequested: boolean().notNull().default(false),
  readyDate: date({ mode: "string" }).notNull(),
  handoverMode: text({ enum: ["PICKUP", "DROP_OFF"] }).notNull(),
  dgDeclared: boolean().notNull().default(false),
  declarations: jsonb().notNull(),
  commercial: jsonb(),
  customerNote: text(),
  exceptionReason: varchar({ length: 20 }),
  exceptionResumeTo: varchar({ length: 30 }),
  slaDueAt: tstz(),
  version: rowVersion(),
  submittedAt: tstz().notNull().defaultNow(),
  closedAt: tstz(),
  /** Phase E: an estimate shown as such to the customer, never a promise. */
  estimatedDeliveryAt: tstz(),
  ...timestamps,
}, (t) => [index("cargo_queue_idx").on(t.status, t.slaDueAt), index("cargo_customer_idx").on(t.customerUserId)])

export const cargoItems = pgTable("cargo_items", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  description: text().notNull(),
  category: varchar({ length: 40 }).notNull(),
  quantity: integer().notNull(),
  unitValueMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  hsCode: varchar({ length: 10 }),
  originCountry: varchar({ length: 2 }).notNull(),
  purpose: varchar({ length: 30 }).notNull(),
  screeningOutcome: text({ enum: ["ALLOWED", "REVIEW", "PROHIBITED"] }).notNull().default("ALLOWED"),
  matchedRule: varchar({ length: 160 }),
  createdAt: createdAt(),
})

export const cargoPieces = pgTable("cargo_pieces", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  lengthCm: numeric({ precision: 6, scale: 1, mode: "number" }).notNull(),
  widthCm: numeric({ precision: 6, scale: 1, mode: "number" }).notNull(),
  heightCm: numeric({ precision: 6, scale: 1, mode: "number" }).notNull(),
  weightKg: numeric({ precision: 8, scale: 2, mode: "number" }).notNull(),
  verifiedWeightKg: numeric({ precision: 8, scale: 2, mode: "number" }),
  createdAt: createdAt(),
})

export const partnerBookings = pgTable("partner_bookings", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  partnerId: uuid().notNull().references(() => partners.id),
  partnerReference: varchar({ length: 60 }).notNull(),
  awbNumber: varchar({ length: 12 }),
  bookedAt: tstz().notNull().defaultNow(),
  recordedBy: uuid().notNull().references(() => users.id),
})

export const trackingEvents = pgTable("tracking_events", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  eventCode: varchar({ length: 30 }).notNull(),
  location: varchar({ length: 120 }).notNull(),
  occurredAt: tstz().notNull(),
  description: text(),
  source: text({ enum: ["STAFF", "PARTNER_API"] }).notNull().default("STAFF"),
  /** The source's own id; unique per source so a replayed partner event is a no-op. */
  externalEventId: varchar({ length: 120 }),
  /** Append-only: a correction is a new row pointing at the event it replaces (never an update in place). */
  correctsEventId: uuid().references((): AnyPgColumn => trackingEvents.id),
  correctionReason: text(),
  createdBy: uuid(),
  createdAt: createdAt(),
}, (t) => [index("tracking_req_idx").on(t.cargoRequestId, t.occurredAt), uniqueIndex("tracking_source_external_uq").on(t.source, t.externalEventId)])

/** Which carriers and couriers currently serve a lane (ch. 14.7); entries older than 30 days are flagged. */
export const serviceAvailability = pgTable("service_availability", {
  id: id(),
  providerName: varchar({ length: 160 }).notNull(),
  lane: varchar({ length: 5 }).notNull(),
  service: cargoService().notNull(),
  status: text({ enum: ["AVAILABLE", "SUSPENDED", "UNKNOWN"] }).notNull(),
  sourceUrl: text().notNull(),
  lastCheckedAt: tstz().notNull().defaultNow(),
  checkedBy: uuid().notNull().references(() => users.id),
  note: text(),
  ...timestamps,
})
