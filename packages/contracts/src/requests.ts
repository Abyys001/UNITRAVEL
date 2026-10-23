import { z } from "zod"

import { CarrierCode, IsoDate, IsoDateTime, Money, Reference, Uuid, tri } from "./common"
import {
  ContactChannel, ContactOutcome, FlightRequestKind, FlightRequestStatus, PassengerType, PaymentMethod, PaymentRecordStatus,
  PaymentStatus, QuoteOptionSource, QuoteStatus, ReservationStatus, ReservationSystem, TicketStatus, TicketingModel, TripType,
  AfterSalesStatus, AfterSalesType,
} from "./enums"
import { Condition, SegmentBaggage, Slice } from "./offer"
import { Itinerary, SearchQuery } from "./search"

export const SeatPreference = z.enum(["NONE", "WINDOW", "AISLE", "TOGETHER", "EXTRA_LEGROOM"])
export const SsrCode = z.enum(["WCHR", "WCHS", "WCHC", "VGML", "MOML", "CHML", "DBML", "PETC", "EXST", "UMNR", "MEDA", "OTHER"])

// Chapter 11.3 "Submitting the request" and 11.4 (manual request).
export const CreateFlightRequestBody = z
  .object({
    kind: FlightRequestKind,
    searchId: Uuid.optional(),
    itineraryId: z.string().optional(),
    query: SearchQuery.optional(),
    manual: z
      .object({
        flexibility: z.string().max(500).optional(),
        budget: Money.optional(),
        airlinesAvoid: z.array(CarrierCode).max(10).default([]),
        airlinesPrefer: z.array(CarrierCode).max(10).default([]),
        overlandAcceptable: z.boolean().default(false),
      })
      .optional(),
    travellers: z.array(z.object({ travellerId: Uuid, passengerType: PassengerType })).min(1).max(9),
    contactIdentityId: Uuid,
    alternativeContact: z.object({ name: z.string().max(120), phone: z.string().max(32), relationship: z.string().max(60) }).optional(),
    seatPreference: SeatPreference.default("NONE"),
    seatChoice: z.array(z.object({ segmentRef: z.string(), designator: z.string() })).optional(),
    ssrs: z.array(z.object({ travellerId: Uuid, code: SsrCode, note: z.string().max(300).optional() })).default([]),
    bestTimeToCall: z.string().max(80).optional(),
    note: z.string().max(2000).optional(),
    acknowledgements: z.object({
      notABooking: z.literal(true),
      privacy: z.literal(true),
      selfTransfer: z.boolean().optional(),
    }),
    acceptPriceChange: z.boolean().default(false),
  })
  .superRefine((b, ctx) => {
    if (b.kind === "ITINERARY" && (!b.searchId || !b.itineraryId)) ctx.addIssue({ code: "custom", path: ["itineraryId"], message: "Itinerary requests need searchId and itineraryId" })
    if (b.kind === "MANUAL" && !b.query) ctx.addIssue({ code: "custom", path: ["query"], message: "Manual requests need the search details" })
  })
export type CreateFlightRequestBody = z.infer<typeof CreateFlightRequestBody>

export const TimelineEntry = z.object({
  at: IsoDateTime,
  kind: z.enum(["STATUS", "MESSAGE", "CONTACT", "RECORD", "NOTE", "QUOTE", "DOCUMENT"]),
  label: z.string(),
  detail: z.string().optional(),
  actor: z.string().optional(),
  fromStatus: z.string().optional(),
  toStatus: z.string().optional(),
})
export type TimelineEntry = z.infer<typeof TimelineEntry>

export const MessageView = z.object({
  id: Uuid,
  direction: z.enum(["TO_CUSTOMER", "FROM_CUSTOMER"]),
  body: z.string(),
  authorName: z.string(),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
  documentIds: z.array(Uuid),
})

export const QuoteOptionInput = z.object({
  label: z.string().min(1).max(80),
  source: QuoteOptionSource,
  slices: z.array(Slice).min(1),
  components: z.array(z.object({ provider: z.string(), offerId: z.string().optional(), rung: z.string(), fetchedAt: IsoDateTime.optional() })).default([]),
  priceBreakdown: z.object({ fare: Money, taxes: Money, serviceFee: Money, total: Money }),
  baggage: z.array(SegmentBaggage),
  conditions: z.object({ change: tri(Condition), refund: tri(Condition) }),
  ticketingModel: TicketingModel,
  internalCostMinor: z.number().int().nonnegative().optional(),
  supplierPrice: Money.optional(),
  supplierFetchedAt: IsoDateTime.optional(),
  supplierExpiresAt: IsoDateTime.optional(),
})
export type QuoteOptionInput = z.infer<typeof QuoteOptionInput>

export const QuoteDraftBody = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("GBP"),
  validUntil: IsoDateTime.optional(),
  options: z.array(QuoteOptionInput).max(5),
})

export const QuoteOptionView = QuoteOptionInput.omit({ internalCostMinor: true }).extend({
  id: Uuid,
  attestedBy: z.string().nullable(),
  unknownFields: z.array(z.string()),
})
export const QuoteView = z.object({
  id: Uuid,
  version: z.number().int(),
  status: QuoteStatus,
  currency: z.string(),
  validUntil: IsoDateTime.nullable(),
  sentAt: IsoDateTime.nullable(),
  acceptedOptionId: Uuid.nullable(),
  acceptedAt: IsoDateTime.nullable(),
  acceptedVia: z.enum(["APP", "STAFF_RECORDED"]).nullable(),
  options: z.array(QuoteOptionView),
  rowVersion: z.number().int(),
})
export type QuoteView = z.infer<typeof QuoteView>

export const ReservationBody = z.object({
  system: ReservationSystem,
  recordLocator: z.string().regex(/^[A-Z0-9]{6}$/),
  airlineLocators: z.record(z.string(), z.string().regex(/^[A-Z0-9]{5,8}$/)).default({}),
  ticketingDeadline: IsoDateTime,
  quoteOptionId: Uuid,
  travellerIds: z.array(Uuid).min(1),
  slices: z.array(Slice).min(1),
  status: z.enum(["HELD", "CONFIRMED"]).default("HELD"),
  mismatchReason: z.string().max(500).optional(),
})
export type ReservationBody = z.infer<typeof ReservationBody>

export const TicketInput = z.object({
  travellerId: Uuid,
  ticketNumber: z.string().regex(/^\d{13}$/),
  validatingCarrier: CarrierCode,
  issueDate: IsoDate,
  coupons: z.array(z.object({ sliceIndex: z.number().int(), segmentIndex: z.number().int() })).min(1),
  receiptDocumentId: Uuid.optional(),
})

export const PaymentBody = z.object({
  amount: Money,
  method: PaymentMethod,
  receivedAt: IsoDateTime,
  externalReference: z.string().min(1).max(80),
  payerName: z.string().min(2).max(120),
  evidenceDocumentId: Uuid.optional(),
})
export type PaymentBody = z.infer<typeof PaymentBody>

export const TicketsBody = z.object({
  reservationId: Uuid,
  tickets: z.array(TicketInput).min(1),
  /** PAY_ON_TICKETING: the payment is recorded in the same step as the tickets (ch. 27.6). */
  payment: PaymentBody.optional(),
  creditOverride: z.object({ reason: z.string().min(5) }).optional(),
})

export const PaymentView = z.object({
  id: Uuid, amount: Money, method: PaymentMethod, receivedAt: IsoDateTime, externalReference: z.string(), payerName: z.string(),
  status: PaymentRecordStatus, recordedBy: z.string(), verifiedBy: z.string().nullable(), needsSecondVerifier: z.boolean(),
})
export const ReservationView = z.object({
  id: Uuid, system: ReservationSystem, recordLocator: z.string(), status: ReservationStatus, ticketingDeadline: IsoDateTime,
  quoteOptionId: Uuid.nullable(), mismatchReason: z.string().nullable(), recordedBy: z.string(), createdAt: IsoDateTime,
})
export const TicketView = z.object({
  id: Uuid, travellerId: Uuid, travellerName: z.string(), ticketNumber: z.string(), validatingCarrier: z.string(), issueDate: IsoDate,
  status: TicketStatus, documentId: Uuid.nullable(),
})

export const RequestTravellerView = z.object({
  travellerId: Uuid, passengerType: PassengerType, name: z.string(), documentComplete: z.boolean(),
})

export const OfferSnapshotView = z.object({
  id: Uuid,
  itinerary: Itinerary,
  priceAtSubmit: Money,
  priceRevalidated: Money.nullable(),
  revalidatedAt: IsoDateTime.nullable(),
  ruleVersion: z.number().int(),
  engineVersion: z.string(),
  contentHash: z.string(),
  createdAt: IsoDateTime,
})

export const CustomerAction = z.enum(["PROVIDE_PASSPORT", "RESPOND", "ACCEPT_QUOTE", "CANCEL", "MESSAGE"])

// Customer-facing serialisation: never includes notes, costs, assignee details or screening results (ch. 25.6).
export const FlightRequestCustomerView = z.object({
  ref: Reference,
  kind: FlightRequestKind,
  status: FlightRequestStatus,
  statusLabel: z.string(),
  paymentStatus: PaymentStatus,
  tripType: TripType,
  query: SearchQuery,
  routeLabel: z.string(),
  firstTravelDate: IsoDate,
  submittedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  snapshot: OfferSnapshotView.nullable(),
  travellers: z.array(RequestTravellerView),
  timeline: z.array(TimelineEntry),
  messages: z.array(MessageView),
  quotes: z.array(QuoteView),
  reservation: z.object({ status: ReservationStatus, ticketingDeadline: IsoDateTime }).nullable(),
  tickets: z.array(TicketView.pick({ ticketNumber: true, travellerName: true, status: true, documentId: true, validatingCarrier: true })),
  documents: z.array(z.object({ id: Uuid, type: z.string(), filename: z.string(), createdAt: IsoDateTime })),
  actions: z.array(CustomerAction),
  truthBadge: z.string(),
})
export type FlightRequestCustomerView = z.infer<typeof FlightRequestCustomerView>

export const FlightRequestListItem = z.object({
  ref: Reference,
  productType: z.enum(["FLIGHT", "CARGO"]),
  status: z.string(),
  statusLabel: z.string(),
  routeLabel: z.string(),
  firstDate: IsoDate.nullable(),
  submittedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  unread: z.number().int(),
})

export const AllowedCommand = z.object({ command: z.string(), allowed: z.boolean(), reason: z.string().optional() })
export type AllowedCommand = z.infer<typeof AllowedCommand>

export const ContactAttemptBody = z.object({
  channel: ContactChannel,
  outcome: ContactOutcome,
  callBackAt: IsoDateTime.optional(),
  note: z.string().max(1000).optional(),
  templateKey: z.string().optional(),
})

export const NoteBody = z.object({ body: z.string().min(1).max(4000) })
export const MessageBody = z.object({ body: z.string().min(1).max(4000), documentIds: z.array(Uuid).max(5).default([]) })

export const FLIGHT_COMMANDS = [
  "claim", "assign", "request_info", "send_quote", "record_acceptance", "close", "reopen", "cancel", "decline", "mark_reservation_lapsed",
] as const
export type FlightCommand = (typeof FLIGHT_COMMANDS)[number]

export const CommandBodies = {
  claim: z.object({}).strict(),
  assign: z.object({ assigneeUserId: Uuid }),
  request_info: z.object({ message: z.string().min(1).max(4000) }),
  send_quote: z.object({ quoteId: Uuid }),
  record_acceptance: z.object({ quoteId: Uuid, optionId: Uuid, calledAt: IsoDateTime, note: z.string().min(3).max(1000) }),
  close: z.object({ note: z.string().max(1000).optional() }),
  reopen: z.object({ note: z.string().max(1000).optional() }),
  cancel: z.object({ reasonCode: z.string().min(1), message: z.string().min(1).max(2000) }),
  decline: z.object({ reasonCode: z.string().min(1), message: z.string().min(1).max(2000) }),
  mark_reservation_lapsed: z.object({ reason: z.string().min(3) }),
} satisfies Record<FlightCommand, z.ZodType>

export const AfterSalesBody = z.object({ type: AfterSalesType, ticketIds: z.array(Uuid).min(1), note: z.string().min(1).max(2000) })
export const AfterSalesView = z.object({
  ref: Reference, type: AfterSalesType, status: AfterSalesStatus, originalRef: Reference, createdAt: IsoDateTime, note: z.string().nullable(),
})

/** After-sales cases and credit overrides on the staff request detail (ch. 13.8, 13.3 record_tickets). */
export const StaffAfterSalesItem = z.object({
  ref: Reference, type: AfterSalesType, status: AfterSalesStatus, note: z.string().nullable(), resolutionNote: z.string().nullable(), ticketIds: z.array(Uuid), createdAt: IsoDateTime,
})
export type StaffAfterSalesItem = z.infer<typeof StaffAfterSalesItem>
export const CreditOverrideView = z.object({
  id: Uuid, reason: z.string(), requestedBy: z.string(), requestedByMe: z.boolean(), approvedBy: z.string().nullable(), approvedAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
})
export type CreditOverrideView = z.infer<typeof CreditOverrideView>

/** Staff directory entry for pickers (assign dialog); no contact details. */
export const StaffDirectoryEntry = z.object({ id: Uuid, displayName: z.string(), roles: z.array(z.string()), onDuty: z.boolean() })
export type StaffDirectoryEntry = z.infer<typeof StaffDirectoryEntry>
