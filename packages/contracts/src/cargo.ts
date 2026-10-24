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
export const CreateCargoRequestBody = z
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
  })
  .superRefine((b, ctx) => {
    if (b.service === "AIR_FREIGHT") {
      if (!b.shipper.company) ctx.addIssue({ code: "custom", path: ["shipper", "company"], message: "Required for air freight" })
      if (!b.consignee.company) ctx.addIssue({ code: "custom", path: ["consignee", "company"], message: "Required for air freight" })
      if (!b.commercial) ctx.addIssue({ code: "custom", path: ["commercial"], message: "Incoterms are required for air freight" })
      b.items.forEach((it, i) => { if (!it.hsCode) ctx.addIssue({ code: "custom", path: ["items", i, "hsCode"], message: "HS code is required for air freight" }) })
    }
  })
export type CreateCargoRequestBody = z.infer<typeof CreateCargoRequestBody>

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
export const TRACKING_EVENT_CODES = ["PICKED_UP", "RECEIVED", "DEPARTED", "ARRIVED", "AT_CUSTOMS", "CLEARED", "OUT_FOR_DELIVERY", "DELIVERED", "HELD", "DAMAGED", "RETURNED", "NOTE"] as const
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
}
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
})
export type ShipmentView = z.infer<typeof ShipmentView>
export const ShipmentSummary = z.object({
  total: z.number().int(), inTransit: z.number().int(), delivered: z.number().int(),
  next: z.object({ ref: Reference, estimatedDeliveryAt: IsoDateTime.nullable(), lastEvent: TrackingEventView.nullable(), laneLabel: z.string() }).nullable(),
})
export type ShipmentSummary = z.infer<typeof ShipmentSummary>

export const CARGO_COMMANDS = [
  "claim", "assign", "request_info", "send_quote", "record_acceptance", "record_booking", "schedule_handover", "receive", "depart",
  "arrive_customs", "clear_customs", "out_for_delivery", "deliver", "close", "raise_exception", "resolve_exception", "cancel", "decline", "reopen",
] as const
export type CargoCommand = (typeof CARGO_COMMANDS)[number]

export const CargoCommandBodies = {
  claim: z.object({}).strict(),
  assign: z.object({ assigneeUserId: Uuid }),
  request_info: z.object({ message: z.string().min(1).max(4000) }),
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
})
export type CargoCustomerView = z.infer<typeof CargoCustomerView>
