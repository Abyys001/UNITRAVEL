import { z } from "zod"

import { CountryCode, IsoDate, IsoDateTime, LocalisedText, Money, Reference, Uuid } from "./common"
import { QuoteStatus } from "./enums"
import { MessageView, TimelineEntry, AllowedCommand } from "./requests"

// ADR-0015: one generic, request-based service product (D-02) for non-flight services. Each type sits behind a feature
// flag that stays off until the owner (and counsel where named) enables it; spec docs/CONTENT-MENU-LIVE-DATA.md §4.2.

export const SERVICE_REQUEST_TYPES = ["VISA", "TOUR_CALLBACK", "CIP", "INSURANCE", "HOTEL", "STAY", "TRAIN", "BUS"] as const
export const ServiceRequestType = z.enum(SERVICE_REQUEST_TYPES)
export type ServiceRequestType = z.infer<typeof ServiceRequestType>

/** The flag that switches each type on (spec §4.1). */
export const SERVICE_TYPE_FLAG = {
  VISA: "services.visa.enabled",
  TOUR_CALLBACK: "services.tours.enabled",
  CIP: "services.cip.enabled",
  INSURANCE: "services.insurance.enabled",
  HOTEL: "hotels.enabled",
  STAY: "stays.enabled",
  TRAIN: "trains.enabled",
  BUS: "buses.enabled",
} as const satisfies Record<ServiceRequestType, string>

/**
 * Spec §4.2 plus two states from the flight and cargo machines (ADR-0015): COMPLIANCE_HOLD for a party or SERVICE policy
 * REVIEW at submit, DECLINED for a BLOCK or a staff decline.
 */
export const SERVICE_REQUEST_STATUSES = [
  "SUBMITTED", "COMPLIANCE_HOLD", "IN_PROGRESS", "QUOTED", "CONFIRMED", "COMPLETED", "CANCELLED", "CLOSED_NO_RESPONSE", "DECLINED",
] as const
export const ServiceRequestStatus = z.enum(SERVICE_REQUEST_STATUSES)
export type ServiceRequestStatus = z.infer<typeof ServiceRequestStatus>
export const SERVICE_TERMINAL: readonly ServiceRequestStatus[] = ["COMPLETED", "CANCELLED", "CLOSED_NO_RESPONSE", "DECLINED"]

const Note = z.string().trim().max(1000).optional()
const Travellers = z.array(Uuid).min(1).max(9)

export const VisaPurpose = z.enum(["TOURISM", "BUSINESS", "STUDY", "FAMILY", "TRANSIT"])
export const VisaDetails = z.object({
  destinationCountry: CountryCode,
  purpose: VisaPurpose,
  travellerIds: Travellers,
  intendedTravelDate: IsoDate,
  linkedFlightRequestRef: Reference.optional(),
  note: Note,
})

export const TourCallbackDetails = z.object({
  destination: z.string().trim().min(2).max(120),
  approxDates: z.string().trim().min(1).max(120),
  travellersCount: z.number().int().min(1).max(20),
  bestTimeToCall: z.string().trim().min(1).max(120),
  note: Note,
})

/** CIP is offered at Tehran Imam Khomeini only (owner); sanctions question pending counsel (O9). */
export const CipDetails = z.object({
  airport: z.literal("IKA"),
  direction: z.enum(["ARRIVAL", "DEPARTURE"]),
  flightNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,3} ?\d{1,4}[A-Z]?$/),
  date: IsoDate,
  passengersCount: z.number().int().min(1).max(20),
  note: Note,
})

export const InsuranceRegion = z.enum(["UK", "SCHENGEN", "EUROPE", "WORLDWIDE_EXCL_AMERICAS", "WORLDWIDE"])
export const InsuranceDetails = z
  .object({ destinationRegion: InsuranceRegion, startDate: IsoDate, endDate: IsoDate, travellerIds: Travellers, note: Note })
  .refine((d) => d.endDate >= d.startDate, { message: "The end date must be on or after the start date", path: ["endDate"] })

/** Hotel request preferences (ADR-0017). Codes, not prose: labels live in the en/fa catalogues. */
export const ACCOMMODATION_TYPES = ["HOTEL", "APARTMENT_HOTEL", "BOUTIQUE_HOTEL", "HOSTEL", "MOTEL", "AIRPORT_HOTEL"] as const
export const AccommodationType = z.enum(ACCOMMODATION_TYPES)
export const ROOM_TYPES = ["SINGLE", "DOUBLE", "TWIN", "TRIPLE", "FAMILY", "SUITE"] as const
export const RoomType = z.enum(ROOM_TYPES)
export const MEAL_PLANS = ["RO", "BB", "HB", "FB", "AI"] as const
export const MealPlan = z.enum(MEAL_PLANS)

/** Listing verticals: an immutable offer snapshot once a provider exists (§4.3), else the search-form fields. */
const FromSnapshot = z.object({ offerSnapshotId: Uuid, note: Note })
export const AccommodationDetails = z.union([
  FromSnapshot,
  z.object({
    location: z.string().trim().min(2).max(120), checkIn: IsoDate, checkOut: IsoDate, guests: z.number().int().min(1).max(20), rooms: z.number().int().min(1).max(10), note: Note,
    // Optional preferences from the hotel page workflow (ADR-0017); absent means "no preference".
    accommodationType: AccommodationType.optional(), minStars: z.number().int().min(1).max(5).optional(), roomType: RoomType.optional(),
    mealPlan: MealPlan.optional(), cheapestFirst: z.boolean().optional(),
  })
    .refine((d) => d.checkOut > d.checkIn, { message: "Check-out must be after check-in", path: ["checkOut"] }),
])
export const GroundDetails = z.union([
  FromSnapshot,
  z.object({ from: z.string().trim().min(2).max(120), to: z.string().trim().min(2).max(120), date: IsoDate, passengers: z.number().int().min(1).max(20), note: Note }),
])

export const SERVICE_DETAILS = {
  VISA: VisaDetails,
  TOUR_CALLBACK: TourCallbackDetails,
  CIP: CipDetails,
  INSURANCE: InsuranceDetails,
  HOTEL: AccommodationDetails,
  STAY: AccommodationDetails,
  TRAIN: GroundDetails,
  BUS: GroundDetails,
} as const satisfies Record<ServiceRequestType, z.ZodType>

const create = <T extends ServiceRequestType>(type: T) =>
  z.object({
    type: z.literal(type),
    details: SERVICE_DETAILS[type] as (typeof SERVICE_DETAILS)[T],
    contactIdentityId: Uuid,
    acknowledgements: z.object({ notABooking: z.literal(true), privacy: z.literal(true) }),
  })

export const CreateServiceRequestBody = z.discriminatedUnion("type", [
  create("VISA"), create("TOUR_CALLBACK"), create("CIP"), create("INSURANCE"), create("HOTEL"), create("STAY"), create("TRAIN"), create("BUS"),
])
export type CreateServiceRequestBody = z.infer<typeof CreateServiceRequestBody>
export type ServiceDetails = CreateServiceRequestBody["details"]

// ---- quotes: staff-built lines; the customer sees amounts only once sent (ADR-0004) ----
export const ServiceQuoteLineKind = z.enum(["SERVICE_FEE", "THIRD_PARTY_FEE", "CLUB_DISCOUNT"])
export const ServiceQuoteLine = z.object({
  kind: ServiceQuoteLineKind,
  label: z.string().trim().min(1).max(120),
  /** Positive; a CLUB_DISCOUNT line is subtracted from the total. */
  amount: Money.refine((m) => m.amountMinor > 0, { message: "Amount must be greater than zero" }),
  benefitId: Uuid.optional(),
})
export type ServiceQuoteLine = z.infer<typeof ServiceQuoteLine>

export const ServiceQuoteBody = z
  .object({ lines: z.array(ServiceQuoteLine).min(1).max(20), validUntil: IsoDateTime, note: z.string().trim().max(2000).optional() })
  .superRefine((q, ctx) => {
    const currencies = new Set(q.lines.map((l) => l.amount.currency))
    if (currencies.size > 1) ctx.addIssue({ code: "custom", path: ["lines"], message: "All lines must use one currency" })
    if (serviceQuoteTotal(q.lines).amountMinor <= 0) ctx.addIssue({ code: "custom", path: ["lines"], message: "The total must be greater than zero" })
    if (q.lines.some((l) => l.kind === "CLUB_DISCOUNT" && !l.benefitId)) ctx.addIssue({ code: "custom", path: ["lines"], message: "A club discount line must name the benefit" })
  })
export type ServiceQuoteBody = z.infer<typeof ServiceQuoteBody>

export function serviceQuoteTotal(lines: readonly ServiceQuoteLine[]): Money {
  const currency = lines[0]?.amount.currency ?? "GBP"
  const amountMinor = lines.reduce((sum, l) => sum + (l.kind === "CLUB_DISCOUNT" ? -l.amount.amountMinor : l.amount.amountMinor), 0)
  return { amountMinor, currency }
}

export const ServiceQuoteView = z.object({
  id: Uuid,
  status: QuoteStatus,
  lines: z.array(ServiceQuoteLine),
  total: Money,
  validUntil: IsoDateTime,
  note: z.string().nullable(),
  sentAt: IsoDateTime.nullable(),
  quotationNumber: z.string().nullable(),
})
export type ServiceQuoteView = z.infer<typeof ServiceQuoteView>

// ---- views ----
export const ServiceRequestSummary = z.object({
  ref: Reference,
  type: ServiceRequestType,
  status: ServiceRequestStatus,
  title: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type ServiceRequestSummary = z.infer<typeof ServiceRequestSummary>

/** A customer never sees a quote that was not sent, nor one that was replaced (ADR-0004): those statuses cannot be represented. */
export const CustomerServiceQuoteView = ServiceQuoteView.extend({ status: z.enum(["SENT", "ACCEPTED", "DECLINED", "EXPIRED"]) })
export type CustomerServiceQuoteView = z.infer<typeof CustomerServiceQuoteView>

/** Customer view: own details, timeline, messages and a quote only once sent. No staff notes or assignee. */
export const CustomerServiceRequestView = ServiceRequestSummary.extend({
  details: z.record(z.string(), z.unknown()),
  timeline: z.array(TimelineEntry),
  messages: z.array(MessageView),
  quote: CustomerServiceQuoteView.nullable(),
  canCancel: z.boolean(),
  canAcceptQuote: z.boolean(),
})
export type CustomerServiceRequestView = z.infer<typeof CustomerServiceRequestView>

export const StaffServiceRequestView = CustomerServiceRequestView.extend({
  quote: ServiceQuoteView.nullable(),
  version: z.number().int(),
  customer: z.object({ userId: Uuid, name: z.string(), phone: z.string().nullable() }),
  assignee: z.object({ userId: Uuid, name: z.string() }).nullable(),
  slaDueAt: IsoDateTime.nullable(),
  submittedVia: z.enum(["WEB", "MOBILE", "CONSOLE"]),
  submittedLocale: z.enum(["en", "fa"]),
  complianceCaseId: Uuid.nullable(),
  /** Names for the travellers named in `details.travellerIds`; no document data. */
  travellers: z.array(z.object({ id: Uuid, name: z.string(), nationality: z.string().nullable() })),
  quotes: z.array(ServiceQuoteView),
  allowedCommands: z.array(AllowedCommand),
})
export type StaffServiceRequestView = z.infer<typeof StaffServiceRequestView>

export const StaffServiceRequestRow = ServiceRequestSummary.extend({
  customerName: z.string(),
  assigneeName: z.string().nullable(),
  slaDueAt: IsoDateTime.nullable(),
})
export type StaffServiceRequestRow = z.infer<typeof StaffServiceRequestRow>

export const StaffServiceRequestPage = z.object({ items: z.array(StaffServiceRequestRow), nextCursor: z.string().nullable() })
export type StaffServiceRequestPage = z.infer<typeof StaffServiceRequestPage>

export const ServiceRequestListQuery = z.object({
  type: ServiceRequestType.optional(),
  status: ServiceRequestStatus.optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

export const SERVICE_COMMANDS = [
  "claim", "assign", "send_quote", "record_acceptance", "complete", "cancel", "decline", "release_hold",
] as const
export type ServiceCommand = (typeof SERVICE_COMMANDS)[number]

const Reason = z.string().trim().min(5).max(1000)
export const ServiceCommandBodies = {
  claim: z.object({}).strict(),
  assign: z.object({ assigneeUserId: Uuid }),
  send_quote: ServiceQuoteBody,
  record_acceptance: z.object({ note: z.string().trim().min(3).max(1000) }),
  complete: z.object({ note: z.string().trim().min(3).max(1000) }),
  cancel: z.object({ reason: Reason }),
  decline: z.object({ reason: Reason }),
  release_hold: z.object({ reason: Reason }),
} as const satisfies Record<ServiceCommand, z.ZodType>

export const ServiceTransitionBody = z.object({
  command: z.enum(SERVICE_COMMANDS),
  expectedVersion: z.number().int(),
  input: z.record(z.string(), z.unknown()).default({}),
})
export type ServiceTransitionBody = z.infer<typeof ServiceTransitionBody>

export const ServiceCancelBody = z.object({ reason: z.string().trim().max(1000).optional() })

// ---- site menu and support (spec §4.1, §4.6) ----
export const MENU_KEYS = [
  "flights", "hotels", "trains", "buses", "stays", "visa", "tours", "cip", "cargo", "insurance", "card", "club", "track", "support",
] as const
export const MenuKey = z.enum(MENU_KEYS)
export type MenuKey = z.infer<typeof MenuKey>

export const SiteConfig = z.object({
  menu: z.record(MenuKey, z.boolean()),
  support: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    /** Null until the client confirms staffing hours (O15); never claim 24-hour support without it. */
    hours: LocalisedText.nullable(),
  }),
  payments: z.object({ online: z.boolean() }),
})
export type SiteConfig = z.infer<typeof SiteConfig>

// ---- purchase tracking (spec §4.5) ----
export const TrackItemKind = z.enum(["FLIGHT", "CARGO", "SERVICE", "INVOICE"])
export const TrackItem = z.object({
  kind: TrackItemKind,
  ref: z.string(),
  /** Machine status code (for filters and chips). */
  status: z.string(),
  /** The same status in the request language. */
  statusLabel: z.string(),
  title: z.string(),
  serviceType: ServiceRequestType.nullable(),
  updatedAt: IsoDateTime,
})
export type TrackItem = z.infer<typeof TrackItem>

export const TrackLookupBody = z.object({
  ref: z.string().trim().min(6).max(20),
  phone: z.string().trim().min(6).max(32),
  deviceId: z.string().min(8).max(128),
  /** Proof-of-work solution (same ALTCHA payload as OTP sign-in) once the server asked for one. */
  challenge: z.string().max(4096).optional(),
})
export type TrackLookupBody = z.infer<typeof TrackLookupBody>

export const TrackVerifyBody = z.object({ ref: z.string().trim().min(6).max(20), phone: z.string().trim().min(6).max(32), code: z.string().regex(/^\d{6}$/), deviceId: z.string().min(8).max(128) })
export type TrackVerifyBody = z.infer<typeof TrackVerifyBody>

/** Signed-out tracking answer: the status timeline only; no names, passport data or prices (spec §4.5). */
export const PublicTrackView = z.object({
  ref: z.string(),
  kind: z.enum(["FLIGHT", "CARGO", "SERVICE"]),
  serviceType: ServiceRequestType.nullable(),
  status: z.string(),
  timeline: z.array(z.object({ at: IsoDateTime, status: z.string() })),
})
export type PublicTrackView = z.infer<typeof PublicTrackView>

/** `POST /v1/track/lookup` answers the same body whether or not the reference and phone matched (no enumeration). */
export const TrackLookupResult = z.object({ accepted: z.literal(true) })
export type TrackLookupResult = z.infer<typeof TrackLookupResult>
