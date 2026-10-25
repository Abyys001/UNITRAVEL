// Staff-side response shapes (apps/api/src/modules/**). Contracts cover the customer views; these mirror the staff
// serialisers so the console renders exactly what the API computed (allowed actions, guard reasons, unknowns).
import type { AllowedCommand, CaseView, CreditOverrideView, Itinerary, Money, QuoteOptionInput, SearchQuery, Segment, Slice, StaffAfterSalesItem, StaffDirectoryEntry, TimelineEntry } from "@unitravel/contracts"

export type { AllowedCommand, CaseView, CreditOverrideView, Itinerary, Money, QuoteOptionInput, Segment, Slice, StaffAfterSalesItem, StaffDirectoryEntry }

export interface QueueSummary {
  new: number; mine: number; awaitingCustomer: number; quoted: number; reserved: number; complianceHolds: number; slaBreaches: number
  deadlinesNext24h: { ref: string; deadline: string }[]
}

export interface FlightListItem {
  ref: string; kind: string; status: string; paymentStatus: string; routeLabel: string; customer: string | null; travellers: number; firstTravelDate: string
  urgent: boolean; slaDueAt: string | null; slaBreached: boolean; assignee: string | null; submittedAt: string; hasSnapshot: boolean
}
export interface CargoListItem { ref: string; service: string; status: string; lane: string; customer: string | null; readyDate: string; submittedAt: string; slaDueAt: string | null }
export interface Page<T> { items: T[]; nextCursor: string | null }

export interface StaffQuoteOption extends Omit<QuoteOptionInput, "components" | "internalCostMinor"> {
  id: string; attestedBy?: string | null; unknownFields: string[]; components?: QuoteOptionInput["components"]; internalCostMinor?: number | null
}
export interface StaffQuote {
  id: string; version: number; status: string; currency: string; validUntil: string | null; sentAt?: string | null; acceptedOptionId?: string | null
  acceptedAt?: string | null; acceptedVia?: string | null; rowVersion: number; options: StaffQuoteOption[]; sendBlockedBy?: string[]
}

export interface StaffTraveller {
  travellerId: string; passengerType: string; name: { title?: string; givenNames: string; surname: string; nameFa?: string | null }
  document: { type: string; last4: string; issuingCountry: string; expiryDate: string } | null; documentComplete: boolean; nationality?: string
  /** Identity verification state. */
  verificationStatus: "UNVERIFIED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "CORRECTION_REQUIRED"
}

export interface FlightDetail {
  ref: string; id: string; kind: string; status: string; paymentStatus: string; version: number; tripType: string; query: SearchQuery
  manual: { flexibility?: string; budget?: Money; airlinesAvoid?: string[]; airlinesPrefer?: string[]; overlandAcceptable?: boolean } | null
  preferences: Record<string, unknown>; customerNote: string | null; urgent: boolean; firstTravelDate: string; submittedAt: string; submittedVia: string; submittedLocale: string
  routeLabel: string; statusLabel: string
  sla: { dueAt: string | null; firstContactAt: string | null; assignedAt: string | null }
  assignee: { id: string; name: string | null } | null
  customer: {
    id: string; displayName: string; nameLatin: string | null; nameFa: string | null; preferredLocale?: string; contactTimePref: string | null; phone: string
    phoneVerified: boolean; phoneVerifiedAt: string | null; alternativeContact: { name: string; phone: string; relationship: string } | null
    history: { ref: string; status: string; submittedAt: string; productType: string }[]
  }
  travellers: StaffTraveller[]
  snapshot: { id: string; itinerary: Itinerary; priceAtSubmit?: Money; priceRevalidated?: Money | null; revalidatedAt?: string | null; ruleVersion: number; engineVersion: string; contentHash: string; createdAt: string } | null
  timeline: TimelineEntry[]
  messages: { id: string; direction: "TO_CUSTOMER" | "FROM_CUSTOMER"; body: string; authorName: string; createdAt: string; readAt: string | null; documentIds: string[] }[]
  notes: { id: string; body: string; author: string | null; createdAt: string }[]
  contacts: { id: string; channel: string; outcome: string; note: string | null; callBackAt: string | null; staff: string | null; createdAt: string }[]
  quotes: StaffQuote[]
  reservations: { id: string; system: string; recordLocator: string; airlineLocators: Record<string, string>; status: string; ticketingDeadline: string; quoteOptionId: string | null; mismatchReason: string | null; recordedBy: string; createdAt: string }[]
  tickets: { id: string; travellerId: string; travellerName: string; ticketNumber: string; validatingCarrier: string; issueDate: string; status: string; documentId: string | null }[]
  payments: { id: string; amount: Money; method: string; receivedAt: string; externalReference: string; payerName: string; status: string; recordedBy: string; verifiedBy: string | null; needsSecondVerifier: boolean }[]
  documents: { id: string; type: string; filename: string; visibility: string; createdAt: string }[]
  afterSales: StaffAfterSalesItem[]
  creditOverrides: CreditOverrideView[]
  compliance: CaseView[]
  actions: AllowedCommand[]
  paymentRecording: PaymentRecordingState
  atolMode: string
}

/** Server-computed: whether an offline payment can be recorded now, why not, and the amount still outstanding (ADR-0008 W8). */
export interface PaymentRecordingState { allowed: boolean; reason?: string; suggestedAmount: Money | null }

export interface CargoDetail {
  payments: FlightDetail["payments"]
  paymentRecording: PaymentRecordingState
  ref: string; id: string; version: number; service: string; status: string; statusLabel: string; paymentStatus: string
  lane: { origin: string; destination: string; label: string }
  shipper: CargoPartyView; consignee: CargoPartyView; readyDate: string; handoverMode: string
  pieces: { id: string; lengthCm: number; widthCm: number; heightCm: number; weightKg: number; verifiedWeightKg: number | null }[]
  items: { id: string; description: string; category: string; quantity: number; unitValue: Money; originCountry: string; hsCode?: string; purpose: string; screeningOutcome: "ALLOWED" | "REVIEW" | "PROHIBITED"; matchedRule: string | null }[]
  weights: { actualKg: number; volumetricKg: number; chargeableKg: number; divisor: number }
  declaredTotal: Money; submittedAt: string
  timeline: { at: string; label: string; detail?: string }[]
  tracking: { id: string; eventCode: string; location: string; occurredAt: string; description: string | null; source: string; externalEventId: string | null; correctsEventId: string | null; correctionReason: string | null; createdBy: string | null; createdAt: string; effective: boolean }[]
  estimatedDeliveryAt: string | null
  quotes: { id: string; version: number; status: string; validUntil: string | null; lines: CargoLines; transitNote: string | null; sentAt: string | null; acceptedAt: string | null; partnerName: string; partnerId?: string }[]
  messages: { id: string; direction: string; body: string; authorName: string; createdAt: string }[]
  documents: { id: string; type: string; filename: string; createdAt: string }[]
  booking: { partnerName: string; awbNumber: string | null; partnerReference?: string } | null
  customer: { id: string; displayName?: string }
  exceptionReason: string | null; customerNote: string | null; declarations: Record<string, boolean>; commercial: { incoterm?: string; exportLicenceRef?: string } | null
  notes: { id: string; body: string; author: string | null; createdAt: string }[]
  eligiblePartners: { id: string; name: string; complianceStatus: string; slaNote: string | null; cutOffNote: string | null }[]
  compliance: CaseView[]
  actions: AllowedCommand[]
}
export interface CargoPartyView { name: string; company?: string; address: { line1: string; line2?: string; city: string; postcode?: string; country: string }; phone: string; email?: string }
export interface CargoLines {
  freight: { ratePerKg: Money; chargeableKg: number; amount: Money }; fuelSurcharge: Money; securitySurcharge: Money; handling: Money; customsBrokerage: Money
  dutiesTaxes: Money | "PAYABLE_BY_CONSIGNEE"; dutiesEstimate: boolean; insurance: Money; pickup: Money; delivery: Money; total: Money
}
