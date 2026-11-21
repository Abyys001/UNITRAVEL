import { sql } from "drizzle-orm"
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
  /** ADR-0042: public tracking number (UT + 10 digits + Luhn), issued once on confirmation. */
  trackingNumber: varchar({ length: 13 }).unique(),
  trackingNumberIssuedAt: tstz(),
  preferredDeliveryDate: date({ mode: "string" }),
  handlingInstructions: text(),
  /** ADR-0042 D13: set when staff created the request for the customer; `intakeChannel` says how it reached us. */
  createdByStaffId: uuid().references(() => users.id),
  intakeChannel: varchar({ length: 12 }).notNull().default("ONLINE"),
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

/** ADR-0040 D5: state of live carrier tracking (TrackingMore) per shipment. No row = never registered. */
export const cargoCarrierTracking = pgTable("cargo_carrier_tracking", {
  cargoRequestId: uuid().primaryKey().references(() => cargoRequests.id),
  provider: text({ enum: ["TRACKINGMORE"] }).notNull().default("TRACKINGMORE"),
  awbNumber: varchar({ length: 12 }).notNull(),
  state: text({ enum: ["PENDING", "ACTIVE", "UNAVAILABLE"] }).notNull().default("PENDING"),
  airline: varchar({ length: 120 }),
  lastSyncedAt: tstz(),
  lastError: text(),
  ...timestamps,
}, (t) => [index("cargo_carrier_tracking_state_idx").on(t.state, t.lastSyncedAt)])

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
  /** ADR-0043: the agent who recorded the event (their public name is what customers see). */
  agentId: uuid(),
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

// ---------------- ADR-0042/0043: agents, assignments, proof, labels, notification log ----------------

/** ADR-0043: an agent is anyone who collects, handles or delivers cargo; the type (driver, courier, ...) is an attribute. */
export const cargoAgents = pgTable("cargo_agents", {
  id: id(),
  /** Unique Agent ID shown to staff and, through `publicName`, to customers (AG-00012). Assigned by a sequence. */
  agentCode: varchar({ length: 12 }).notNull().unique(),
  userId: uuid().notNull().unique().references(() => users.id),
  displayName: varchar({ length: 120 }).notNull(),
  publicName: varchar({ length: 80 }),
  email: varchar({ length: 200 }).notNull(),
  phone: varchar({ length: 32 }),
  agentType: varchar({ length: 30 }).notNull().default("DRIVER"),
  responsibilities: text().array().notNull().default(["COLLECTION", "DELIVERY"]),
  company: varchar({ length: 120 }),
  vehicle: varchar({ length: 120 }),
  notes: text(),
  photoDocumentId: uuid(),
  requiresAcceptance: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
  createdBy: uuid().notNull().references(() => users.id),
  ...timestamps,
})

export const cargoAgentAssignments = pgTable("cargo_agent_assignments", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  agentId: uuid().notNull().references(() => cargoAgents.id),
  kind: text({ enum: ["COLLECTION", "HANDLING", "DELIVERY"] }).notNull(),
  status: text({ enum: ["OFFERED", "ASSIGNED", "COMPLETED", "FAILED", "DECLINED", "CANCELLED"] }).notNull().default("ASSIGNED"),
  scheduledFor: tstz(),
  attempts: integer().notNull().default(0),
  note: text(),
  assignedBy: uuid().notNull().references(() => users.id),
  assignedAt: tstz().notNull().defaultNow(),
  acceptedAt: tstz(),
  declinedAt: tstz(),
  declineReason: text(),
  completedAt: tstz(),
  cancelReason: text(),
}, (t) => [index("cda_agent_idx").on(t.agentId, t.status), index("cda_request_idx").on(t.cargoRequestId)])

/** ADR-0046 D4: postage rates per lane and service, set by staff with pricing.write (booklet 14.6). Amounts in minor units. */
export const cargoRateCards = pgTable("cargo_rate_cards", {
  id: id(),
  laneId: uuid().notNull().references(() => cargoLanes.id),
  service: cargoService().notNull(),
  currency: varchar({ length: 3 }).notNull(),
  ratePerKgMinor: integer().notNull(),
  minimumChargeMinor: integer().notNull().default(0),
  fuelSurchargePct: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
  handlingFeeMinor: integer().notNull().default(0),
  insurancePct: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
  /** ADR-0047 D3: the rate card is the courier's cost; the customer price adds the markup and a fixed margin. */
  markupPct: numeric({ precision: 6, scale: 2, mode: "number" }).notNull().default(0),
  marginFixedMinor: integer().notNull().default(0),
  notes: text(),
  updatedBy: uuid().notNull().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
}, (t) => [uniqueIndex("crc_lane_service_uq").on(t.laneId, t.service)])

/** ADR-0047 D2: one handover to a manual courier (outbound or return). Never changes the request's state. */
export const cargoConsignments = pgTable("cargo_consignments", {
  id: id(),
  /** SH-000001, from a sequence (database default). */
  shipmentNo: varchar({ length: 12 }).notNull().unique().default(sql`('SH-' || lpad(nextval('cargo_consignment_seq')::text, 6, '0'))`),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  direction: text({ enum: ["OUTBOUND", "RETURN"] }).notNull().default("OUTBOUND"),
  partnerId: uuid().notNull().references(() => partners.id),
  serviceLevel: varchar({ length: 20 }).notNull(),
  tracked: boolean().notNull().default(true),
  signedFor: boolean().notNull().default(false),
  courierTrackingNumber: varchar({ length: 60 }),
  courierTrackingUrl: varchar({ length: 500 }),
  shipDate: date(),
  estimatedDelivery: date(),
  costMinor: integer(),
  costCurrency: varchar({ length: 3 }),
  labelDocumentId: uuid(),
  status: text({ enum: ["BOOKED", "DISPATCHED", "CANCELLED"] }).notNull().default("BOOKED"),
  cancelReason: text(),
  note: text(),
  dispatchedAt: tstz(),
  createdBy: uuid().notNull().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
}, (t) => [index("ccons_request_idx").on(t.cargoRequestId), index("ccons_status_idx").on(t.status, t.shipDate)])

/** ADR-0047 D3: a customer's special rate: a discount on the customer price, or its own markup, for a lane/service or all. */
export const cargoCustomerRates = pgTable("cargo_customer_rates", {
  id: id(),
  customerUserId: uuid().notNull().references(() => users.id),
  laneId: uuid().references(() => cargoLanes.id),
  service: cargoService(),
  discountPct: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
  markupPct: numeric({ precision: 6, scale: 2, mode: "number" }),
  note: text(),
  updatedBy: uuid().notNull().references(() => users.id),
  ...timestamps,
}, (t) => [index("ccr_customer_idx").on(t.customerUserId)])

/** ADR-0047 D4: staff review and approval of the customs data before an international dispatch. */
export const cargoCustomsReviews = pgTable("cargo_customs_reviews", {
  cargoRequestId: uuid().primaryKey().references(() => cargoRequests.id),
  exportReason: varchar({ length: 30 }).notNull(),
  incoterm: text({ enum: ["DAP", "DDP"] }).notNull().default("DAP"),
  dutiesPayer: text({ enum: ["RECEIVER", "SENDER"] }).notNull().default("RECEIVER"),
  invoiceNumber: varchar({ length: 40 }),
  notes: text(),
  /** A hash of the declared items at approval; any change to them voids the approval. */
  itemsHash: varchar({ length: 64 }),
  approvedBy: uuid().references(() => users.id),
  approvedAt: tstz(),
  updatedBy: uuid().notNull().references(() => users.id),
  ...timestamps,
})

/** ADR-0045: single-use, 10-minute sign-in codes shown as a QR on the agent's profile; only the SHA-256 hash is stored. */
export const agentSignInCodes = pgTable("agent_sign_in_codes", {
  id: id(),
  agentId: uuid().notNull().references(() => cargoAgents.id),
  tokenHash: varchar({ length: 64 }).notNull().unique(),
  expiresAt: tstz().notNull(),
  usedAt: tstz(),
  sessionId: uuid(),
  createdBy: uuid().notNull().references(() => users.id),
  createdAt: tstz().notNull().defaultNow(),
}, (t) => [index("asic_agent_idx").on(t.agentId)])

export const cargoDeliveryProofs = pgTable("cargo_delivery_proofs", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  assignmentId: uuid().references(() => cargoAgentAssignments.id),
  kind: text({ enum: ["COLLECTION", "DELIVERY"] }).notNull(),
  receiverName: varchar({ length: 120 }),
  signatureDocumentId: uuid(),
  photoDocumentIds: uuid().array().notNull().default([]),
  location: varchar({ length: 120 }).notNull(),
  note: text(),
  capturedBy: uuid().notNull().references(() => users.id),
  capturedAt: tstz().notNull().defaultNow(),
}, (t) => [index("cdp_request_idx").on(t.cargoRequestId)])

export const cargoLabels = pgTable("cargo_labels", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  documentId: uuid().notNull(),
  format: varchar({ length: 4 }).notNull(),
  pieces: integer().notNull(),
  trackingNumber: varchar({ length: 13 }).notNull(),
  createdBy: uuid().notNull().references(() => users.id),
  createdAt: createdAt(),
  voidedAt: tstz(),
}, (t) => [index("cargo_labels_request_idx").on(t.cargoRequestId)])

/** One row per customer notice; the unique key is what stops a second email for the same milestone (ADR-0042 D10). */
export const cargoNotifications = pgTable("cargo_notifications", {
  id: id(),
  cargoRequestId: uuid().notNull().references(() => cargoRequests.id),
  key: varchar({ length: 80 }).notNull(),
  milestone: varchar({ length: 40 }).notNull(),
  eventType: varchar({ length: 60 }).notNull(),
  outboxEventId: varchar({ length: 64 }),
  /** CUSTOMER (account notice through the notification service) or RECIPIENT (direct email to the consignee, D10a). */
  audience: varchar({ length: 12 }).notNull().default("CUSTOMER"),
  recipientEmail: varchar({ length: 200 }),
  deliveryStatus: varchar({ length: 16 }),
  deliveryError: text(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("cargo_notifications_uq").on(t.cargoRequestId, t.key), index("cargo_notifications_created_idx").on(t.createdAt)])
