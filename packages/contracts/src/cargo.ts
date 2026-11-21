import { z } from "zod"

import { CountryCode, IsoDate, IsoDateTime, LocalisedText, Money, Reference, Uuid } from "./common"
import {
  AvailabilityStatus, CargoPurpose, CargoService, CargoStatus, GoodsCategory, HandoverMode, Incoterm, IntegrationLevel, PartnerType,
  PaymentStatus, ScreeningOutcome,
} from "./enums"
import { QuoteStatus } from "./enums"

const LatinName = z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9 .,'&\-]*$/, "Latin script")

export const CargoParty = z.object({
  name: LatinName,
  company: z.string().max(160).optional(),
  address: z.object({ line1: z.string().min(2).max(200), line2: z.string().max(200).optional(), city: z.string().min(1).max(80), postcode: z.string().max(20).optional(), country: CountryCode }),
  phone: z.string().min(6).max(32),
  email: z.email().optional(),
  idNumber: z.string().max(40).optional(),
})
export type CargoParty = z.infer<typeof CargoParty>

export const CargoPieceInput = z.object({
  lengthCm: z.number().positive().max(400),
  widthCm: z.number().positive().max(400),
  heightCm: z.number().positive().max(400),
  weightKg: z.number().positive().max(5000),
})

export const CargoItemInput = z.object({
  description: z.string().trim().min(2).max(300),
  category: GoodsCategory,
  quantity: z.number().int().min(1).max(10000),
  unitValue: Money,
  originCountry: CountryCode,
  hsCode: z.string().regex(/^\d{4,10}$/).optional(),
  purpose: CargoPurpose,
})

// Chapter 14.3 — what the customer provides; † fields enforced for AIR_FREIGHT.
const CargoRequestFields = z
  .object({
    service: CargoService,
    laneId: Uuid,
    shipper: CargoParty,
    consignee: CargoParty,
    shipperIdentityId: Uuid,
    readyDate: IsoDate,
    handoverMode: HandoverMode,
    pieces: z.array(CargoPieceInput).min(1).max(50),
    items: z.array(CargoItemInput).min(1).max(100),
    commercial: z.object({ incoterm: Incoterm, exportLicenceRef: z.string().max(60).optional() }).optional(),
    declarations: z.object({
      batteries: z.boolean(), liquids: z.boolean(), medicines: z.boolean(), magnets: z.boolean(), dangerousGoods: z.boolean(),
      insuranceRequested: z.boolean(),
    }),
    declaredTotal: Money,
    documentIds: z.array(Uuid).max(20).default([]),
    consents: z.object({ accuracy: z.literal(true), prohibitedItems: z.literal(true), privacy: z.literal(true) }),
    note: z.string().max(2000).optional(),
    /** ADR-0042 D12: a wish, not a promise; never before the collection (ready) date. */
    preferredDeliveryDate: IsoDate.optional(),
    handlingInstructions: z.string().trim().max(500).optional(),
  })
type CargoRequestFieldsT = Omit<z.infer<typeof CargoRequestFields>, "shipperIdentityId" | "consents" | "documentIds"> & { documentIds?: string[] }
function refineCargoRequest(b: CargoRequestFieldsT, ctx: z.RefinementCtx) {
  {
    if (b.preferredDeliveryDate && b.preferredDeliveryDate < b.readyDate) ctx.addIssue({ code: "custom", path: ["preferredDeliveryDate"], message: "Must not be before the collection date" })
    if (b.service === "AIR_FREIGHT") {
      if (!b.shipper.company) ctx.addIssue({ code: "custom", path: ["shipper", "company"], message: "Required for air freight" })
      if (!b.consignee.company) ctx.addIssue({ code: "custom", path: ["consignee", "company"], message: "Required for air freight" })
      if (!b.commercial) ctx.addIssue({ code: "custom", path: ["commercial"], message: "Incoterms are required for air freight" })
      b.items.forEach((it, i) => { if (!it.hsCode) ctx.addIssue({ code: "custom", path: ["items", i, "hsCode"], message: "HS code is required for air freight" }) })
    }
  }
}
export const CreateCargoRequestBody = CargoRequestFields.superRefine(refineCargoRequest)
export type CreateCargoRequestBody = z.infer<typeof CreateCargoRequestBody>

/**
 * ADR-0042 D13: staff create a request for a customer (phone, walk-in, email). Same fields and the same screening; the
 * customer is an existing account (exact email or phone lookup) or a new one; staff confirm the customer made the declarations.
 */
export const StaffCreateCargoBody = CargoRequestFields.omit({ shipperIdentityId: true, consents: true }).extend({
  customer: z.union([
    z.object({ userId: Uuid }),
    z.object({ name: z.string().trim().min(2).max(120), email: z.email().max(200), phone: z.string().trim().min(6).max(32).optional() }),
  ]),
  customerConfirmed: z.literal(true),
  channel: z.enum(["PHONE", "IN_PERSON", "EMAIL", "OTHER"]),
  staffNote: z.string().trim().max(1000).optional(),
}).superRefine(refineCargoRequest)
export type StaffCreateCargoBody = z.infer<typeof StaffCreateCargoBody>
export const CargoCustomerLookup = z.object({ q: z.string().trim().min(3).max(200) })

export const LaneView = z.object({
  id: Uuid,
  originCountry: z.string(),
  destinationCountry: z.string(),
  services: z.array(CargoService),
  enabled: z.boolean(),
  requiresComplianceApproval: z.boolean(),
  volumetricDivisor: z.number().int(),
  customerNotice: LocalisedText.nullable(),
  counselReference: z.string().nullable(),
  version: z.number().int(),
})
export type LaneView = z.infer<typeof LaneView>

export const LaneUpsertBody = LaneView.omit({ id: true, version: true }).extend({ disabledServices: z.array(CargoService).default([]) })

export const PartnerBody = z.object({
  name: z.string().min(2).max(160),
  type: PartnerType,
  laneIds: z.array(Uuid),
  services: z.array(CargoService),
  integrationLevel: IntegrationLevel,
  contacts: z.array(z.object({ name: z.string(), phone: z.string().optional(), email: z.string().optional() })).default([]),
  slaNote: z.string().max(500).optional(),
  cutOffNote: z.string().max(500).optional(),
  active: z.boolean().default(true),
})
export const PartnerView = PartnerBody.extend({ id: Uuid, complianceStatus: z.enum(["PENDING", "CLEARED", "HOLD", "BLOCKED"]), lastScreenedAt: IsoDateTime.nullable() })

export const AvailabilityBody = z.object({
  providerName: z.string().min(2).max(160),
  lane: z.string().regex(/^[A-Z]{2}-[A-Z]{2}$/),
  service: CargoService,
  status: AvailabilityStatus,
  sourceUrl: z.url(),
  note: z.string().max(500).optional(),
})
export const AvailabilityView = AvailabilityBody.extend({ id: Uuid, lastCheckedAt: IsoDateTime, checkedBy: z.string(), stale: z.boolean() })

export const CargoWeights = z.object({ actualKg: z.number(), volumetricKg: z.number(), chargeableKg: z.number(), divisor: z.number().int(), estimate: z.literal(true) })

export const CargoItemView = CargoItemInput.extend({ id: Uuid, screeningOutcome: ScreeningOutcome, matchedRule: z.string().nullable() })

export const CargoQuoteLines = z.object({
  freight: z.object({ ratePerKg: Money, chargeableKg: z.number(), amount: Money }),
  fuelSurcharge: Money, securitySurcharge: Money, handling: Money, customsBrokerage: Money,
  dutiesTaxes: z.union([Money, z.literal("PAYABLE_BY_CONSIGNEE")]),
  dutiesEstimate: z.boolean(),
  insurance: Money, pickup: Money, delivery: Money, total: Money,
})
export const CargoQuoteBody = z.object({
  validUntil: IsoDateTime.optional(),
  partnerId: Uuid,
  lines: CargoQuoteLines,
  transitNote: z.string().max(500).optional(),
  partnerCostMinor: z.number().int().nonnegative().optional(),
})
export const CargoQuoteView = z.object({
  id: Uuid, version: z.number().int(), status: QuoteStatus, validUntil: IsoDateTime.nullable(), lines: CargoQuoteLines,
  transitNote: z.string().nullable(), sentAt: IsoDateTime.nullable(), acceptedAt: IsoDateTime.nullable(), partnerName: z.string(),
})

export const PartnerBookingBody = z.object({ partnerId: Uuid, partnerReference: z.string().min(2).max(60), awbNumber: z.string().regex(/^\d{3}-?\d{8}$/).optional() })
export const TRACKING_EVENT_CODES = [
  "PICKED_UP", "RECEIVED", "DEPARTED", "ARRIVED", "AT_CUSTOMS", "CLEARED", "OUT_FOR_DELIVERY", "DELIVERED", "HELD", "DAMAGED", "RETURNED", "NOTE",
  // ADR-0042/0043: last-mile events (staff and assigned agents).
  "COLLECTION_AGENT_ASSIGNED", "COLLECTION_SCHEDULED", "COLLECTION_FAILED", "HANDLED", "SORTING_FACILITY", "DELIVERY_AGENT_ASSIGNED", "DELIVERY_FAILED",
] as const
export const TrackingEventCode = z.enum(TRACKING_EVENT_CODES)
export type TrackingEventCode = z.infer<typeof TrackingEventCode>
/** Phase E: customers never see raw codes. The en/fa i18n catalogues and the Flutter ARB repeat these; a test pins them. */
export const TRACKING_EVENT_LABELS: Record<TrackingEventCode, { en: string; fa: string }> = {
  PICKED_UP: { en: "Picked up", fa: "از فرستنده تحویل گرفته شد" },
  RECEIVED: { en: "Received at our partner", fa: "نزد شریک ما دریافت شد" },
  DEPARTED: { en: "Departed", fa: "حرکت کرد" },
  ARRIVED: { en: "Arrived", fa: "رسید" },
  AT_CUSTOMS: { en: "At customs", fa: "در گمرک" },
  CLEARED: { en: "Cleared customs", fa: "ترخیص گمرکی انجام شد" },
  OUT_FOR_DELIVERY: { en: "Out for delivery", fa: "برای تحویل در راه است" },
  DELIVERED: { en: "Delivered", fa: "تحویل داده شد" },
  HELD: { en: "On hold", fa: "متوقف شده است" },
  DAMAGED: { en: "Damage reported", fa: "آسیب‌دیدگی گزارش شد" },
  RETURNED: { en: "Returned", fa: "بازگردانده شد" },
  NOTE: { en: "Update", fa: "به‌روزرسانی" },
  COLLECTION_AGENT_ASSIGNED: { en: "Assigned to collection agent", fa: "به مأمور جمع‌آوری سپرده شد" },
  HANDLED: { en: "Cargo handled by agent", fa: "بار توسط مأمور جابه‌جا شد" },
  DELIVERY_AGENT_ASSIGNED: { en: "Assigned to delivery agent", fa: "به مأمور تحویل سپرده شد" },
  COLLECTION_SCHEDULED: { en: "Collection scheduled", fa: "زمان جمع‌آوری تعیین شد" },
  COLLECTION_FAILED: { en: "Collection attempt failed", fa: "جمع‌آوری انجام نشد" },
  SORTING_FACILITY: { en: "Arrived at sorting facility", fa: "به مرکز تفکیک رسید" },
  DELIVERY_FAILED: { en: "Delivery attempt failed", fa: "تلاش برای تحویل ناموفق بود" },
}
/** ADR-0043: what the customer sees when an agent recorded the event (the agent is named by their public name only). */
export const AGENT_EVENT_LABELS: Partial<Record<TrackingEventCode, { en: string; fa: string }>> = {
  PICKED_UP: { en: "Cargo collected by agent", fa: "بار توسط مأمور جمع‌آوری شد" },
  DELIVERED: { en: "Delivered by agent", fa: "توسط مأمور تحویل داده شد" },
  NOTE: { en: "Cargo handled by agent", fa: "بار توسط مأمور جابه‌جا شد" },
}
/** Events stored before ADR-0043 renamed the code (tracking_events is append-only, so old rows keep it). */
export const LEGACY_EVENT_CODES: Record<string, TrackingEventCode> = { DRIVER_ASSIGNED: "COLLECTION_AGENT_ASSIGNED" }
export const TrackingEventBody = z.object({
  eventCode: TrackingEventCode,
  location: z.string().min(2).max(120),
  occurredAt: IsoDateTime,
  description: z.string().max(500).optional(),
})
export const TrackingSource = z.enum(["STAFF", "PARTNER_API"])
/** A staff correction is appended and points at the event it replaces; RETRACTED withdraws the event without a replacement. */
export const TrackingCorrectionBody = z.object({
  correctsEventId: Uuid,
  eventCode: z.union([TrackingEventCode, z.literal("RETRACTED")]),
  location: z.string().min(2).max(120),
  occurredAt: IsoDateTime,
  description: z.string().max(500).optional(),
  reason: z.string().trim().min(3).max(500),
})
export const EstimatedDeliveryBody = z.object({ estimatedDeliveryAt: IsoDateTime.nullable() })
/** What the customer sees: the effective (corrected) state only. No source, author, reason or partner payload. */
export const TrackingEventView = z.object({
  id: Uuid, eventCode: TrackingEventCode, label: z.string(), location: z.string(), occurredAt: IsoDateTime, description: z.string().optional(), corrected: z.boolean(),
  agent: z.string().nullable().optional(),
})
export const StaffTrackingEventView = z.object({
  id: Uuid, eventCode: z.string(), location: z.string(), occurredAt: IsoDateTime, description: z.string().nullable(), source: TrackingSource,
  externalEventId: z.string().nullable(), correctsEventId: z.string().nullable(), correctionReason: z.string().nullable(), createdBy: z.string().nullable(), createdAt: IsoDateTime,
  effective: z.boolean(),
})

/** One shipment as the customer sees it in "Shipments". `estimatedDeliveryAt` is an estimate, never a promise. */
export const ShipmentView = z.object({
  ref: Reference,
  service: CargoService,
  status: CargoStatus,
  statusLabel: z.string(),
  laneLabel: z.string(),
  awbNumber: z.string().nullable(),
  estimatedDeliveryAt: IsoDateTime.nullable(),
  lastEvent: TrackingEventView.nullable(),
  timeline: z.array(TrackingEventView),
  trackingNumber: z.string().nullable(),
  milestone: z.string(),
  milestoneLabel: z.string(),
  /** ADR-0047 D2: dispatched consignments only; never the courier's cost. */
  couriers: z.array(z.object({ shipmentNo: z.string(), direction: z.enum(["OUTBOUND", "RETURN"]), courier: z.string(), serviceLevel: z.string(), trackingNumber: z.string().nullable(), trackingUrl: z.string().nullable(), shipDate: z.string().nullable(), estimatedDelivery: z.string().nullable() })).default([]),
})
export type ShipmentView = z.infer<typeof ShipmentView>
export const ShipmentSummary = z.object({
  total: z.number().int(), inTransit: z.number().int(), delivered: z.number().int(),
  next: z.object({ ref: Reference, estimatedDeliveryAt: IsoDateTime.nullable(), lastEvent: TrackingEventView.nullable(), laneLabel: z.string() }).nullable(),
})
export type ShipmentSummary = z.infer<typeof ShipmentSummary>

export const CARGO_COMMANDS = [
  "claim", "assign", "request_info", "resume_review", "send_quote", "record_acceptance", "record_booking", "schedule_handover", "receive", "depart",
  "arrive_customs", "clear_customs", "out_for_delivery", "deliver", "close", "raise_exception", "resolve_exception", "cancel", "decline", "reopen",
] as const
export type CargoCommand = (typeof CARGO_COMMANDS)[number]

export const CargoCommandBodies = {
  claim: z.object({}).strict(),
  assign: z.object({ assigneeUserId: Uuid }),
  request_info: z.object({ message: z.string().min(1).max(4000) }),
  resume_review: z.object({ note: z.string().trim().min(3).max(1000) }),
  send_quote: z.object({ quoteId: Uuid }),
  record_acceptance: z.object({ quoteId: Uuid, calledAt: IsoDateTime, note: z.string().min(3) }),
  record_booking: PartnerBookingBody,
  schedule_handover: z.object({ note: z.string().min(1).max(500), at: IsoDateTime.optional() }),
  receive: z.object({ verifiedWeights: z.array(z.object({ pieceId: Uuid, weightKg: z.number().positive() })).min(1), location: z.string().min(2) }),
  depart: z.object({ location: z.string().min(2), occurredAt: IsoDateTime }),
  arrive_customs: z.object({ location: z.string().min(2), occurredAt: IsoDateTime }),
  clear_customs: z.object({ location: z.string().min(2), occurredAt: IsoDateTime }),
  out_for_delivery: z.object({ location: z.string().min(2), occurredAt: IsoDateTime }),
  deliver: z.object({ location: z.string().min(2), occurredAt: IsoDateTime, podName: z.string().min(2), podDocumentId: Uuid.optional() }),
  close: z.object({ note: z.string().optional() }),
  raise_exception: z.object({ reason: z.enum(["HELD", "DAMAGED", "LOST", "RETURNED", "REWEIGH"]), note: z.string().min(3) }),
  resolve_exception: z.object({ note: z.string().min(3) }),
  cancel: z.object({ reasonCode: z.string(), message: z.string().min(1) }),
  decline: z.object({ reasonCode: z.string(), message: z.string().min(1) }),
  reopen: z.object({ note: z.string().optional() }),
} satisfies Record<CargoCommand, z.ZodType>

export const CargoCustomerView = z.object({
  ref: Reference,
  service: CargoService,
  status: CargoStatus,
  statusLabel: z.string(),
  paymentStatus: PaymentStatus,
  lane: z.object({ origin: z.string(), destination: z.string() }),
  shipper: CargoParty,
  consignee: CargoParty,
  readyDate: IsoDate,
  handoverMode: HandoverMode,
  pieces: z.array(CargoPieceInput.extend({ id: Uuid, verifiedWeightKg: z.number().nullable() })),
  items: z.array(CargoItemInput.extend({ id: Uuid })),
  weights: CargoWeights,
  declaredTotal: Money,
  submittedAt: IsoDateTime,
  timeline: z.array(z.object({ at: IsoDateTime, label: z.string(), detail: z.string().optional() })),
  tracking: z.array(TrackingEventView),
  estimatedDeliveryAt: IsoDateTime.nullable(),
  quotes: z.array(CargoQuoteView),
  messages: z.array(z.object({ id: Uuid, direction: z.string(), body: z.string(), authorName: z.string(), createdAt: IsoDateTime })),
  documents: z.array(z.object({ id: Uuid, type: z.string(), filename: z.string(), createdAt: IsoDateTime })),
  booking: z.object({ partnerName: z.string(), awbNumber: z.string().nullable() }).nullable(),
  actions: z.array(z.string()),
  trackingNumber: z.string().nullable(),
  milestone: z.string(),
  milestoneLabel: z.string(),
  preferredDeliveryDate: IsoDate.nullable(),
  handlingInstructions: z.string().nullable(),
})
export type CargoCustomerView = z.infer<typeof CargoCustomerView>

// ---------------- ADR-0042: tracking numbers, milestones, agents, labels, public tracking ----------------

/** `UT` + 10 random digits + a Luhn check digit. */
export const TrackingNumber = z.string().trim().toUpperCase().regex(/^UT\d{11}$/, "Tracking number")

export const CARGO_MILESTONES = [
  "REQUEST_RECEIVED", "REQUEST_CONFIRMED", "AWAITING_COLLECTION", "AGENT_ASSIGNED", "COLLECTION_SCHEDULED", "COLLECTION_FAILED", "CARGO_COLLECTED",
  "IN_TRANSIT", "AT_SORTING_FACILITY", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "DELIVERED", "RETURNED_TO_SENDER", "ON_HOLD", "CANCELLED",
] as const
export const CargoMilestone = z.enum(CARGO_MILESTONES)
export type CargoMilestone = z.infer<typeof CargoMilestone>
/** Customer wording; the web i18n catalogues repeat these and a test pins them. */
export const CARGO_MILESTONE_LABELS: Record<CargoMilestone, { en: string; fa: string }> = {
  REQUEST_RECEIVED: { en: "Cargo request received", fa: "درخواست بار دریافت شد" },
  REQUEST_CONFIRMED: { en: "Request confirmed", fa: "درخواست تأیید شد" },
  AWAITING_COLLECTION: { en: "Awaiting collection", fa: "در انتظار جمع‌آوری" },
  AGENT_ASSIGNED: { en: "Collection agent assigned", fa: "مأمور جمع‌آوری تعیین شد" },
  COLLECTION_SCHEDULED: { en: "Collection scheduled", fa: "زمان جمع‌آوری تعیین شد" },
  COLLECTION_FAILED: { en: "Collection attempt failed", fa: "جمع‌آوری انجام نشد" },
  CARGO_COLLECTED: { en: "Cargo collected", fa: "بار جمع‌آوری شد" },
  IN_TRANSIT: { en: "In transit", fa: "در مسیر" },
  AT_SORTING_FACILITY: { en: "Arrived at sorting facility", fa: "در مرکز تفکیک" },
  OUT_FOR_DELIVERY: { en: "Out for delivery", fa: "در راه تحویل" },
  DELIVERY_FAILED: { en: "Delivery attempt failed", fa: "تحویل ناموفق بود" },
  DELIVERED: { en: "Delivered", fa: "تحویل داده شد" },
  RETURNED_TO_SENDER: { en: "Returned to sender", fa: "به فرستنده بازگردانده شد" },
  ON_HOLD: { en: "On hold", fa: "متوقف شده" },
  CANCELLED: { en: "Cancelled", fa: "لغو شد" },
}
/** Milestones whose notice also goes by SMS (same set as CARGO_SMS_STATUSES, ch. 17.2). */
export const IMPORTANT_MILESTONES: readonly CargoMilestone[] = ["COLLECTION_SCHEDULED", "DELIVERED", "DELIVERY_FAILED", "RETURNED_TO_SENDER", "ON_HOLD", "CANCELLED"]
/** Shown to the customer but not sent: it follows confirmation within minutes. */
export const SILENT_MILESTONES: readonly CargoMilestone[] = ["AWAITING_COLLECTION"]
/** ADR-0042 D10a: the recipient (when the sender gave their email) hears about the last mile only. */
export const RECIPIENT_MILESTONES: readonly CargoMilestone[] = ["OUT_FOR_DELIVERY", "DELIVERY_FAILED", "DELIVERED"]

export const FAILURE_REASONS = ["NO_ONE_AVAILABLE", "ADDRESS_ISSUE", "REFUSED", "ACCESS_PROBLEM", "UNSAFE", "DAMAGED", "OTHER"] as const
export const FailureReason = z.enum(FAILURE_REASONS)
export const FAILURE_REASON_LABELS: Record<z.infer<typeof FailureReason>, { en: string; fa: string }> = {
  NO_ONE_AVAILABLE: { en: "No one available", fa: "کسی در محل نبود" },
  ADDRESS_ISSUE: { en: "Address problem", fa: "مشکل نشانی" },
  REFUSED: { en: "Refused", fa: "تحویل گرفته نشد" },
  ACCESS_PROBLEM: { en: "No access to the property", fa: "دسترسی به محل ممکن نبود" },
  UNSAFE: { en: "Unsafe to complete", fa: "انجام آن ایمن نبود" },
  DAMAGED: { en: "Goods damaged", fa: "آسیب‌دیدگی کالا" },
  OTHER: { en: "Other", fa: "سایر" },
}

/** Public view (ADR-0042 D4): no names, phones, emails, street addresses, notes, prices or documents. */
/** `agent`: the agent's company-approved public name (ADR-0043), never their account name, phone or email. */
export const PublicTrackingEvent = z.object({ eventCode: TrackingEventCode, label: z.string(), location: z.string(), occurredAt: IsoDateTime, agent: z.string().nullable() })
export const PublicCargoTracking = z.object({
  trackingNumber: z.string(),
  service: CargoService,
  milestone: CargoMilestone,
  milestoneLabel: z.string(),
  origin: z.object({ city: z.string().nullable(), country: z.string() }),
  destination: z.object({ city: z.string().nullable(), country: z.string() }),
  timeline: z.array(PublicTrackingEvent),
  lastUpdatedAt: IsoDateTime,
  estimatedDeliveryAt: IsoDateTime.nullable(),
  delivered: z.object({ at: IsoDateTime, receivedBy: z.string().nullable() }).nullable(),
  labelVerified: z.boolean().nullable(),
  /** ADR-0045: set only when the page was opened from a signed label QR; opens the parcel in the Agent Dashboard (agents only). */
  agentUrl: z.string().nullable().optional(),
  progress: z.array(z.object({ milestone: CargoMilestone, label: z.string(), reached: z.boolean(), current: z.boolean() })),
})
export type PublicCargoTracking = z.infer<typeof PublicCargoTracking>

const Phone = z.string().trim().min(6).max(32).regex(/^\+?[0-9 ()-]{6,32}$/, "Phone number")

// ---------------- ADR-0043: agents (couriers, drivers, collection and delivery agents, logistics representatives) ----------------

export const AGENT_TYPES = ["DRIVER", "COURIER", "COLLECTION_AGENT", "DELIVERY_AGENT", "LOGISTICS_REPRESENTATIVE", "OTHER"] as const
export const AgentType = z.enum(AGENT_TYPES)
export const AGENT_TYPE_LABELS: Record<z.infer<typeof AgentType>, { en: string; fa: string }> = {
  DRIVER: { en: "Driver", fa: "راننده" },
  COURIER: { en: "Courier", fa: "پیک" },
  COLLECTION_AGENT: { en: "Collection agent", fa: "مأمور جمع‌آوری" },
  DELIVERY_AGENT: { en: "Delivery agent", fa: "مأمور تحویل" },
  LOGISTICS_REPRESENTATIVE: { en: "Logistics representative", fa: "نمایندهٔ لجستیک" },
  OTHER: { en: "Other", fa: "سایر" },
}
/** What an agent does on a shipment: collect it, handle it in between (transport, hub), deliver it. */
export const ASSIGNMENT_KINDS = ["COLLECTION", "HANDLING", "DELIVERY"] as const
export const AssignmentKind = z.enum(ASSIGNMENT_KINDS)
export type AssignmentKind = z.infer<typeof AssignmentKind>
/** OFFERED waits for the agent to accept (agents set to require acceptance); DECLINED is the agent's answer. */
export const AssignmentStatus = z.enum(["OFFERED", "ASSIGNED", "COMPLETED", "FAILED", "DECLINED", "CANCELLED"])

export const AgentBody = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  phone: Phone.optional(),
  agentType: AgentType,
  responsibilities: z.array(AssignmentKind).min(1).max(3),
  /** Shown to customers on the tracking page; defaults to "Agent <ID>". */
  publicName: z.string().trim().min(2).max(80).optional(),
  company: z.string().trim().max(120).optional(),
  vehicle: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  requiresAcceptance: z.boolean().default(false),
})
export const AgentUpdateBody = AgentBody.omit({ email: true }).partial().extend({ active: z.boolean().optional(), publicName: z.string().trim().min(2).max(80).nullable().optional() })
export const AgentView = z.object({
  id: Uuid, agentCode: z.string(), userId: Uuid, displayName: z.string(), publicName: z.string(), email: z.string(), phone: z.string().nullable(), agentType: AgentType,
  responsibilities: z.array(AssignmentKind), company: z.string().nullable(), vehicle: z.string().nullable(), notes: z.string().nullable(), active: z.boolean(), requiresAcceptance: z.boolean(), hasPhoto: z.boolean(),
  offeredJobs: z.number().int(), activeJobs: z.number().int(), completedJobs: z.number().int(), failedJobs: z.number().int(), createdAt: IsoDateTime,
})
export type AgentView = z.infer<typeof AgentView>
export const AgentPhotoBody = z.object({ filename: z.string().trim().min(1).max(200), data: z.string().min(16).max(1_000_000) })

/** One or several agents for one kind of job (ADR-0043: "one or multiple agents"). */
export const AssignAgentBody = z.object({
  agentIds: z.array(Uuid).min(1).max(5),
  kind: AssignmentKind,
  scheduledFor: IsoDateTime.optional(),
  /** Customer-visible place for the "agent assigned" event: a town or facility, never an address. */
  location: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
})
export const UnassignAgentBody = z.object({ reason: z.string().trim().min(3).max(500) })
export const AssignmentView = z.object({
  id: Uuid, kind: AssignmentKind, status: AssignmentStatus, agentId: Uuid, agentCode: z.string(), agentName: z.string(), trackingNumber: z.string().nullable(), scheduledFor: IsoDateTime.nullable(),
  attempts: z.number().int(), note: z.string().nullable(), assignedAt: IsoDateTime, acceptedAt: IsoDateTime.nullable(), completedAt: IsoDateTime.nullable(), declineReason: z.string().nullable(),
})

/** Agent dashboard: only what the job needs (addresses and contacts of this shipment). */
export const AgentJobView = z.object({
  assignmentId: Uuid,
  kind: AssignmentKind,
  status: AssignmentStatus,
  ref: Reference,
  trackingNumber: z.string().nullable(),
  cargoStatus: CargoStatus,
  milestone: CargoMilestone,
  milestoneLabel: z.string(),
  service: CargoService,
  scheduledFor: IsoDateTime.nullable(),
  attempts: z.number().int(),
  pickup: z.object({ name: z.string(), company: z.string().nullable(), phone: z.string(), email: z.string().nullable(), address: z.string(), city: z.string() }),
  dropoff: z.object({ name: z.string(), company: z.string().nullable(), phone: z.string(), email: z.string().nullable(), address: z.string(), city: z.string() }),
  pieces: z.number().int(),
  weightKg: z.number(),
  description: z.string(),
  handlingInstructions: z.string().nullable(),
  readyDate: IsoDate,
  preferredDeliveryDate: IsoDate.nullable(),
  note: z.string().nullable(),
  actions: z.array(z.string()),
  otherAgents: z.array(z.object({ kind: AssignmentKind, agentCode: z.string(), name: z.string() })),
  timeline: z.array(z.object({ label: z.string(), location: z.string(), occurredAt: IsoDateTime, description: z.string().nullable(), agent: z.string().nullable() })),
  proofs: z.array(z.object({ id: Uuid, kind: AssignmentKind, receiverName: z.string().nullable(), capturedAt: IsoDateTime, files: z.number().int() })),
})
export type AgentJobView = z.infer<typeof AgentJobView>

export const AGENT_ACTIONS = [
  "accept", "decline", "start_collection", "collected", "collection_failed", "handled", "at_sorting_facility", "handling_done",
  "out_for_delivery", "delivered", "delivery_failed", "report_problem", "note",
] as const
export type AgentAction = (typeof AGENT_ACTIONS)[number]
const Place = z.string().trim().min(2).max(120)
export const PROBLEM_CATEGORIES = ["ADDRESS", "CONTACT", "PACKAGING", "DAMAGE", "VEHICLE", "SAFETY", "OTHER"] as const
export const AgentActionBodies = {
  accept: z.object({}).strict(),
  decline: z.object({ reason: z.string().trim().min(3).max(500) }),
  start_collection: z.object({ location: Place, occurredAt: IsoDateTime.optional(), description: z.string().trim().max(500).optional() }),
  collected: z.object({ location: Place, occurredAt: IsoDateTime.optional(), handedOverBy: z.string().trim().min(2).max(120), signatureDocumentId: Uuid.optional(), photoDocumentIds: z.array(Uuid).max(6).default([]), description: z.string().trim().max(500).optional() }),
  collection_failed: z.object({ location: Place, occurredAt: IsoDateTime.optional(), reason: FailureReason, description: z.string().trim().max(500).optional(), photoDocumentIds: z.array(Uuid).max(6).default([]) }),
  handled: z.object({ location: Place, occurredAt: IsoDateTime.optional(), description: z.string().trim().max(500).optional() }),
  at_sorting_facility: z.object({ location: Place, occurredAt: IsoDateTime.optional() }),
  handling_done: z.object({ description: z.string().trim().max(500).optional() }),
  out_for_delivery: z.object({ location: Place, occurredAt: IsoDateTime.optional() }),
  delivered: z.object({ location: Place, occurredAt: IsoDateTime.optional(), receiverName: z.string().trim().min(2).max(120), signatureDocumentId: Uuid.optional(), photoDocumentIds: z.array(Uuid).max(6).default([]), description: z.string().trim().max(500).optional() })
    .refine((b) => !!b.signatureDocumentId || b.photoDocumentIds.length > 0, { message: "A signature or a photo is required", path: ["signatureDocumentId"] }),
  delivery_failed: z.object({ location: Place, occurredAt: IsoDateTime.optional(), reason: FailureReason, description: z.string().trim().max(500).optional(), photoDocumentIds: z.array(Uuid).max(6).default([]) }),
  report_problem: z.object({ category: z.enum(PROBLEM_CATEGORIES), description: z.string().trim().min(3).max(1000), photoDocumentIds: z.array(Uuid).max(6).default([]) }),
  note: z.object({ body: z.string().trim().min(1).max(1000) }),
} satisfies Record<AgentAction, z.ZodType>

export const LABEL_FORMATS = ["4x6", "A6", "A4"] as const
export const LabelFormat = z.enum(LABEL_FORMATS)
export const GenerateLabelBody = z.object({ format: LabelFormat.default("4x6") })
export const LabelView = z.object({ id: Uuid, documentId: Uuid, format: LabelFormat, pieces: z.number().int(), createdAt: IsoDateTime, createdBy: z.string(), voidedAt: IsoDateTime.nullable() })

/** ADR-0042 D11: addresses, contacts, dates and instructions only; names, goods and pieces stay as screened. */
const AddressPatch = z.object({ line1: z.string().min(2).max(200), line2: z.string().max(200).optional(), city: z.string().min(1).max(80), postcode: z.string().max(20).optional() })
export const CargoDetailsPatch = z.object({
  shipper: z.object({ address: AddressPatch.optional(), phone: Phone.optional(), email: z.email().optional().or(z.literal("")) }).optional(),
  consignee: z.object({ address: AddressPatch.optional(), phone: Phone.optional(), email: z.email().optional().or(z.literal("")) }).optional(),
  readyDate: IsoDate.optional(),
  preferredDeliveryDate: IsoDate.nullable().optional(),
  handlingInstructions: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
})

export const ProofView = z.object({
  id: Uuid, kind: AssignmentKind, receiverName: z.string().nullable(), location: z.string(), capturedAt: IsoDateTime, capturedBy: z.string(), note: z.string().nullable(),
  signatureDocumentId: Uuid.nullable(), photoDocumentIds: z.array(Uuid),
})
export const StaffProofBody = z.object({
  kind: z.enum(["COLLECTION", "DELIVERY"]), receiverName: z.string().trim().min(2).max(120).optional(), location: Place, note: z.string().trim().max(500).optional(),
  signatureDocumentId: Uuid.optional(), photoDocumentIds: z.array(Uuid).max(6).default([]),
}).refine((b) => !!b.signatureDocumentId || b.photoDocumentIds.length > 0, { message: "Attach a signature or a photo", path: ["photoDocumentIds"] })

export const CargoNotificationView = z.object({
  id: Uuid, ref: Reference, trackingNumber: z.string().nullable(), key: z.string(), milestone: z.string(), eventType: z.string(), createdAt: IsoDateTime,
  customerName: z.string(), email: z.object({ status: z.string(), destination: z.string().nullable(), sentAt: IsoDateTime.nullable(), error: z.string().nullable() }).nullable(),
  sms: z.string().nullable(),
})

export const CARGO_OPS_TABS = ["all", "pending", "confirmed", "assigned", "in_transit", "delivered", "failed", "cancelled"] as const
export const CargoOpsQuery = z.object({
  tab: z.enum(CARGO_OPS_TABS).default("all"),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(["submitted_desc", "submitted_asc", "updated_desc", "ready_asc"]).default("submitted_desc"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
})
export const CargoOpsRow = z.object({
  ref: Reference, trackingNumber: z.string().nullable(), status: CargoStatus, milestone: CargoMilestone, milestoneLabel: z.string(), service: CargoService, lane: z.string(),
  shipperName: z.string(), consigneeName: z.string(), destinationCity: z.string(), readyDate: IsoDate, submittedAt: IsoDateTime, updatedAt: IsoDateTime,
  agents: z.array(z.object({ kind: AssignmentKind, name: z.string(), agentCode: z.string() })), failedAttempts: z.number().int(), pieces: z.number().int(), weightKg: z.number(),
})
export const CargoOpsStats = z.object({
  total: z.number().int(), pending: z.number().int(), pendingCollections: z.number().int(), active: z.number().int(), delivered: z.number().int(), failed: z.number().int(), cancelled: z.number().int(),
  tabs: z.record(z.string(), z.number().int()),
})

// ---------------- ADR-0046: postage tools ----------------

/** Agent updates that need only a location, so they can be applied to many scanned parcels in a row. */
export const AGENT_BULK_ACTIONS = ["start_collection", "at_sorting_facility", "handled", "out_for_delivery"] as const satisfies readonly AgentAction[]
/** Staff commands that need only a location and a time. */
export const STAFF_BULK_COMMANDS = ["depart", "arrive_customs", "clear_customs", "out_for_delivery"] as const

export const ManifestQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })

export const RateCardBody = z.object({
  laneId: Uuid,
  service: z.enum(["DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"]),
  currency: z.string().length(3).toUpperCase(),
  ratePerKgMinor: z.number().int().min(0).max(10_000_000),
  minimumChargeMinor: z.number().int().min(0).max(10_000_000).default(0),
  fuelSurchargePct: z.number().min(0).max(100).default(0),
  handlingFeeMinor: z.number().int().min(0).max(10_000_000).default(0),
  insurancePct: z.number().min(0).max(100).default(0),
  /** ADR-0047 D3: customer price = cost × (1 + markup%) + fixed margin. */
  markupPct: z.number().min(0).max(1000).default(0),
  marginFixedMinor: z.number().int().min(0).max(10_000_000).default(0),
  notes: z.string().trim().max(500).nullable().optional(),
})
export type RateCardBody = z.infer<typeof RateCardBody>

export const CalculateBody = z.object({
  laneId: Uuid,
  service: RateCardBody.shape.service,
  pieces: z.array(z.object({ lengthCm: z.number().positive().max(500), widthCm: z.number().positive().max(500), heightCm: z.number().positive().max(500), weightKg: z.number().positive().max(2000) })).min(1).max(50),
  declaredValueMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  /** ADR-0047 D3: apply this customer's special rate. */
  customerUserId: Uuid.optional(),
})
export type CalculateBody = z.infer<typeof CalculateBody>

// ---------------- ADR-0047: manual-courier consignments, customer rates, customs review, dashboard ----------------

export const SERVICE_LEVELS = ["ECONOMY", "STANDARD", "EXPRESS", "PRIORITY", "NEXT_DAY", "SAME_DAY", "FREIGHT", "PALLET"] as const
export const ConsignmentBody = z.object({
  direction: z.enum(["OUTBOUND", "RETURN"]).default("OUTBOUND"),
  partnerId: Uuid,
  serviceLevel: z.enum(SERVICE_LEVELS),
  tracked: z.boolean().default(true),
  signedFor: z.boolean().default(false),
  courierTrackingNumber: z.string().trim().min(3).max(60).nullable().optional(),
  courierTrackingUrl: z.url({ protocol: /^https$/ }).max(500).nullable().optional(),
  shipDate: IsoDate.nullable().optional(),
  estimatedDelivery: IsoDate.nullable().optional(),
  costMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  costCurrency: z.string().length(3).toUpperCase().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})
export type ConsignmentBody = z.infer<typeof ConsignmentBody>
export const ConsignmentLabelBody = z.object({ filename: z.string().trim().min(1).max(200), data: z.string().min(16).max(8_000_000) })
export const ConsignmentCancelBody = z.object({ reason: z.string().trim().min(3).max(500) })

export const EXPORT_REASONS = ["GIFT", "SALE", "SAMPLE", "RETURN", "REPAIR", "PERSONAL_EFFECTS", "DOCUMENTS", "OTHER"] as const
export const CustomsReviewBody = z.object({
  exportReason: z.enum(EXPORT_REASONS),
  incoterm: z.enum(["DAP", "DDP"]).default("DAP"),
  dutiesPayer: z.enum(["RECEIVER", "SENDER"]).default("RECEIVER"),
  invoiceNumber: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  approve: z.boolean().default(false),
})
export type CustomsReviewBody = z.infer<typeof CustomsReviewBody>

export const CustomerRateBody = z.object({
  customerUserId: Uuid,
  laneId: Uuid.nullable().optional(),
  service: RateCardBody.shape.service.nullable().optional(),
  discountPct: z.number().min(0).max(100).default(0),
  markupPct: z.number().min(0).max(1000).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})
export type CustomerRateBody = z.infer<typeof CustomerRateBody>

export const ShippingDashboardQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() })
