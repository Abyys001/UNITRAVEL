import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { BillingDocuments, CargoCustomerView, CustomerInvoice, CustomerServiceRequestView, PublicTrackView, StaffServiceRequestView, ServiceQuoteView, StaffInvoice, CustomerSearchState, CustomerSeatMap, FlightRequestCustomerView, FlightRequestListItem, Itinerary, MyDetails, NormalisedOffer, SeatMap, ShipmentSummary, ShipmentView, TRACKING_EVENT_CODES, VerificationStatus } from "@unitravel/contracts"

import { encryptField } from "./core/crypto"
import { CustomersService } from "./modules/customers/customers.service"
import { InvoicesService } from "./modules/invoices/invoices.service"
import { ServicesService } from "./modules/services/services.service"

import { customerItinerary, customerSeatMaps } from "./modules/search/customer-projection"

/** Field names that exist on staff/internal records and must never reach a customer (ch. 25.6, 32.2). */
const INTERNAL = ["internalCostMinor", "internalNotes", "notes", "assigneeId", "assigneeName", "screening", "screeningScore", "riskScore", "complianceCase", "passportNumber", "documentNumberEnc", "supplierRaw", "createdBy", "customerUserId", "contactIdentityId", "costMinor", "supplierPrice", "supplierFetchedAt", "supplierExpiresAt", "priceAtSubmit", "priceRevalidated"]
/** Amount carriers that must not appear anywhere outside a sent quote; contaminated separately so a quote's real amounts stay valid. */
const AMOUNT_FIELDS = ["amountMinor", "price", "priceBreakdown", "penalty", "totalMinor", "score", "explain", "supplierPrice"]

const uuid = fc.uuid({ version: 4 })
const iso = fc.date({ min: new Date("2026-01-01"), max: new Date("2027-12-31"), noInvalidDate: true }).map((d) => d.toISOString())
const message = fc.record({ id: uuid, direction: fc.constantFrom("TO_CUSTOMER", "FROM_CUSTOMER"), body: fc.string(), authorName: fc.string({ minLength: 1 }), createdAt: iso, readAt: fc.option(iso, { nil: null }), documentIds: fc.array(uuid, { maxLength: 2 }) })
const traveller = fc.record({ travellerId: uuid, passengerType: fc.constantFrom("ADT", "CHD", "INF"), name: fc.string({ minLength: 1 }), documentComplete: fc.boolean() })
const timeline = fc.record({ at: iso, kind: fc.constantFrom("STATUS", "MESSAGE", "QUOTE"), label: fc.string({ minLength: 1 }) })

const money = { amountMinor: 41000, currency: "GBP" }
const point = (utc: string) => ({ local: utc.slice(0, 16), utc, tz: "Asia/Tehran" })
const slice = { origin: "IKA", destination: "LHR", durationMin: 420, segments: [{ marketing: { carrier: "TK", flightNumber: "879" }, operating: { carrier: "TK" }, origin: { iata: "IKA" }, destination: { iata: "LHR" }, departure: point("2026-11-20T03:00:00.000Z"), arrival: point("2026-11-20T10:00:00.000Z"), cabin: "ECONOMY", technicalStops: [] }] }
/** A sent quote as the service builds it for staff, i.e. with every supplier field present. */
const sentQuote = {
  id: "0b6a1f7e-3c1d-4f7a-9b2e-5d4c3b2a1f00", version: 1, status: "SENT", currency: "GBP", validUntil: null, sentAt: "2026-11-01T10:00:00.000Z", acceptedOptionId: null, acceptedAt: null, acceptedVia: null, rowVersion: 1,
  options: [{
    id: "1c7b2a8f-4d2e-4a8b-8c3f-6e5d4c3b2a10", label: "Option A", source: "STAFF_SEARCH", attestedBy: null, slices: [slice], unknownFields: [],
    priceBreakdown: { fare: money, taxes: money, serviceFee: money, total: money }, baggage: [], conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } }, ticketingModel: "SINGLE_TICKET",
    components: [{ provider: "duffel", offerId: "off_SECRET", rung: "LIVE" }], supplierPrice: money, supplierFetchedAt: "2026-11-01T09:00:00.000Z", supplierExpiresAt: "2026-11-01T11:00:00.000Z", internalCostMinor: 39000,
  }],
}

/** A stored (staff) itinerary with every amount-shaped field present: totals, ticket prices, fee penalties, score. */
const staffOffer = NormalisedOffer.parse({
  source: { provider: "duffel", providerOfferId: "off_1", rung: "LIVE_OFFER", fetchedAt: "2026-11-01T09:00:00.000Z", fake: false },
  slices: [slice], price: { total: money, base: money, taxes: money }, ticketing: "SINGLE_TICKET", brand: { status: "UNKNOWN" }, baggage: [],
  conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: money } }, refund: { status: "KNOWN", value: { allowed: false, penalty: money } } },
})
const staffItinerary = Itinerary.parse({
  id: "itn_1", construction: "THROUGH", ticketing: "SINGLE_TICKET", tabs: ["BEST", "CHEAPEST", "FASTEST"], price: { total: money, isSumOfTickets: false }, durationMin: 420, components: [staffOffer],
  connections: [], truth: [], baggage: [], riskFlags: [], score: 0.12, explain: { price: 0.5, duration: 0.1, layoverFit: 0, risk: 0, stops: 0, timeOfDay: 0, preferredCarrierBonus: 0 },
  stops: 0, firstDeparture: "2026-11-20T03:00:00.000Z", lastArrival: "2026-11-20T10:00:00.000Z", carriers: ["TK"],
})
const staffSeatMap = SeatMap.parse({
  segmentRef: "s1", source: { provider: "duffel", fetchedAt: "2026-11-01T09:00:00.000Z" },
  cabins: [{ cabinClass: "ECONOMY", deck: 0, rows: [{ sections: [{ elements: [{ type: "seat", designator: "12A", available: true, price: money, characteristics: ["WINDOW"] }, { type: "exit_row" }] }] }] }],
})
const snapshot = { id: "2d8c3b9a-5e3f-4b9c-9d4a-7f6e5d4c3b20", itinerary: customerItinerary(staffItinerary), priceAtSubmit: money, priceRevalidated: money, revalidatedAt: "2026-11-01T09:00:00.000Z", ruleVersion: 1, engineVersion: "1", contentHash: "a".repeat(64), createdAt: "2026-11-01T09:00:00.000Z" }

const aggregate = fc.record({
  ref: fc.constant("UT-F-7Q2K9M"), kind: fc.constantFrom("ITINERARY", "MANUAL"), status: fc.constantFrom("SUBMITTED", "IN_REVIEW", "QUOTED", "CANCELLED"),
  statusLabel: fc.string({ minLength: 1 }), paymentStatus: fc.constantFrom("NONE", "PARTIAL", "PAID"), tripType: fc.constant("ONE_WAY"),
  query: fc.constant({ tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-11-20", flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" }),
  routeLabel: fc.string(), firstTravelDate: fc.constant("2026-11-20"), submittedAt: iso, updatedAt: iso, snapshot: fc.constant(snapshot),
  travellers: fc.array(traveller, { maxLength: 4 }), timeline: fc.array(timeline, { maxLength: 5 }), messages: fc.array(message, { maxLength: 5 }),
  quotes: fc.constant([sentQuote]), reservation: fc.constant(null), tickets: fc.constant([]), documents: fc.constant([]),
  actions: fc.subarray(["RESPOND", "CANCEL", "MESSAGE"]), truthBadge: fc.constant("REQUEST"),
})

/** Attaches internal fields to the root and to randomly chosen nested objects, as a careless join might. */
function contaminate(o: unknown, picks: { key: string; depthSeed: number }[]): unknown {
  const objects: Record<string, unknown>[] = []
  const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { objects.push(v as Record<string, unknown>); Object.values(v).forEach(walk) } }
  walk(o)
  if (!objects.length) return o
  for (const p of picks) objects[p.depthSeed % objects.length]![p.key] = "SECRET-" + p.key
  return o
}

/** Paths of any amount-shaped field: `amountMinor`, a `*Minor` key, or the price/penalty/score carriers (ADR-0004). */
const AMOUNT_KEY = /(^amountMinor$|Minor$|^(price|priceBreakdown|supplierPrice|penalty|score|explain|fare|taxes|serviceFee)$)/
function amountPaths(v: unknown, path = "$"): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => amountPaths(x, `${path}[${i}]`))
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => (AMOUNT_KEY.test(k) ? [`${path}.${k}`] : amountPaths(x, `${path}.${k}`)))
  return []
}

describe("customer serialisers never emit internal fields (property)", () => {
  const picks = fc.array(fc.record({ key: fc.constantFrom(...INTERNAL), depthSeed: fc.nat() }), { minLength: 1, maxLength: 12 })

  it("flight request detail", () => {
    fc.assert(fc.property(aggregate, picks, (a, p) => {
      const out = JSON.stringify(FlightRequestCustomerView.parse(contaminate(structuredClone(a), p)))
      expect(out).not.toContain("SECRET-")
    }), { numRuns: 300 })
  })

  it("request detail carries an amount only inside a sent quote", () => {
    const amountPicks = fc.array(fc.record({ key: fc.constantFrom(...AMOUNT_FIELDS), depthSeed: fc.nat() }), { minLength: 1, maxLength: 12 })
    fc.assert(fc.property(aggregate, amountPicks, (a, p) => {
      const sent = JSON.parse(JSON.stringify(a.quotes)) // fresh copy: the fixtures share one `money` object
      const { quotes: _q, ...rest } = structuredClone(a)
      const out = FlightRequestCustomerView.parse({ ...(contaminate(rest, p) as object), quotes: sent })
      const { quotes, ...outsideQuotes } = out
      expect(amountPaths(outsideQuotes)).toEqual([])
      // Positive control: the sent quote still shows its amounts.
      expect(amountPaths(quotes).some((x) => x.endsWith("priceBreakdown"))).toBe(true)
    }), { numRuns: 200 })
  })

  it("search results, itinerary detail and seat maps carry no amount for a customer", () => {
    const state = (results: unknown[]) => ({
      id: "3e9d4c0b-6f40-4c0d-8e5b-8a7f6e5d4c30", status: "COMPLETE", version: 1, query: fc.sample(aggregate, 1)[0]!.query, progress: { sourcesTotal: 1, sourcesDone: 1, removedByPolicy: 0, slowSources: [], wave: 1 },
      expiresAt: "2026-11-01T10:00:00.000Z", historical: false, ruleVersion: 1, engineVersion: "1", notices: [], results, nextCursor: null, total: results.length,
    })
    const amountPicks = fc.array(fc.record({ key: fc.constantFrom(...AMOUNT_FIELDS), depthSeed: fc.nat() }), { minLength: 1, maxLength: 12 })
    fc.assert(fc.property(amountPicks, (p) => {
      const projected = customerItinerary(structuredClone(staffItinerary))
      expect(amountPaths(projected)).toEqual([])
      expect(projected.tabs).not.toContain("CHEAPEST")
      // Contamination of the projected objects is stripped by the strict customer schema.
      const parsed = CustomerSearchState.parse(contaminate(state([structuredClone(projected)]), p))
      expect(amountPaths(parsed)).toEqual([])
      expect(JSON.stringify(parsed)).not.toContain("SECRET-")
      const maps = customerSeatMaps([structuredClone(staffSeatMap)])
      expect(amountPaths(CustomerSeatMap.array().parse(contaminate(maps, p)))).toEqual([])
    }), { numRuns: 200 })
  })

  it("the guard itself fails on a leaked amount", () => {
    expect(amountPaths({ results: [{ price: { total: money } }] }).length).toBeGreaterThan(0)
    expect(amountPaths(staffItinerary).length).toBeGreaterThan(0)
    expect(amountPaths(staffSeatMap).length).toBeGreaterThan(0)
  })

  it("quote options drop supplier cost, offer timestamps and supplier offer ids", () => {
    const out = FlightRequestCustomerView.parse({ ...fc.sample(aggregate, 1)[0], quotes: [structuredClone(sentQuote)] })
    expect(Object.keys(out.quotes[0]!.options[0]!)).not.toEqual(expect.arrayContaining(["components"]))
    expect(JSON.stringify(out.quotes)).not.toMatch(/supplier|internalCost|off_SECRET|duffel/)
  })

  it("request list", () => {
    const item = fc.record({ ref: fc.constant("UT-C-7Q2K9M"), productType: fc.constantFrom("FLIGHT", "CARGO"), status: fc.string(), statusLabel: fc.string(), routeLabel: fc.string(), firstDate: fc.constant("2026-11-20"), submittedAt: iso, updatedAt: iso, unread: fc.nat(9) })
    fc.assert(fc.property(fc.array(item, { maxLength: 6 }), picks, (a, p) => {
      expect(JSON.stringify(FlightRequestListItem.array().parse(contaminate(structuredClone(a), p)))).not.toContain("SECRET-")
    }), { numRuns: 300 })
  })
})


describe("identity verification customer views (ADR-0005)", () => {
  const PASSPORT = "X98765432"
  const REVIEWER = "9f1b6a52-7c0d-4e1b-8c3a-2d4e5f607182"
  const svc = new CustomersService({} as never, {} as never, {} as never, {} as never, {} as never)
  const enc = encryptField(PASSPORT)
  const t = { id: "0b6a1f7e-3c1d-4f7a-9b2e-5d4c3b2a1f00", ownerUserId: "1c7b2a8f-4d2e-4a8b-8c3f-6e5d4c3b2a10", title: "MS", givenNames: "NEDA", surname: "TEST", nameFa: "ندا", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", deletedAt: null, createdAt: new Date(), updatedAt: new Date() } as never
  const doc = (status: string) => ({ id: "2d8c3b9a-5e3f-4b9c-9d4a-7f6e5d4c3b20", travellerId: "0b6a1f7e-3c1d-4f7a-9b2e-5d4c3b2a1f00", type: "PASSPORT", numberCiphertext: enc.ciphertext, numberLast4: PASSPORT.slice(-4), issuingCountry: "IR", expiryDate: "2031-01-01", keyId: enc.keyId, verificationStatus: status, scanDocumentId: "3e9d4c0b-6f40-4c0d-8e5b-8a7f6e5d4c30", customerConfirmedAt: new Date(), confirmedValuesHash: "a".repeat(64), submittedAt: new Date(), verifiedAt: null, erasedAt: null, createdAt: new Date(), updatedAt: new Date() }) as never
  const scan = { id: "3e9d4c0b-6f40-4c0d-8e5b-8a7f6e5d4c30", filename: "passport.jpg", scanStatus: "CLEAN", erasedAt: null, storageKey: "2026-10/secret-key.jpg", storageBucket: "unitravel-documents-identity", sha256: "b".repeat(64) } as never
  const review = { reasonCode: "NAME_MISMATCH", reasonText: "Check the surname", reviewerUserId: REVIEWER, valueHash: "c".repeat(64), decision: "CORRECTION_REQUIRED" } as never
  const details = (status: string) => MyDetails.parse({ givenNamesLatin: null, surnameLatin: null, nameFa: null, contactTimePref: null, address: null, identities: [], self: svc.view(t, doc(status), scan, review) })

  it("shows the state, the customer-facing reason and the scan name; nothing of the reviewer, the number or the storage", () => {
    fc.assert(fc.property(fc.constantFrom(...VerificationStatus.options), (status) => {
      const out = JSON.stringify(details(status))
      for (const secret of [PASSPORT, REVIEWER, "c".repeat(64), "secret-key", "unitravel-documents-identity", "reviewer"]) expect(out).not.toContain(secret)
      expect(out).toContain("5432")
      const reasoned = status === "REJECTED" || status === "CORRECTION_REQUIRED"
      expect(details(status).self!.verification.reason).toEqual(reasoned ? { code: "NAME_MISMATCH", text: "Check the surname" } : null)
    }))
  })

  it("contamination of the view is stripped by the schema", () => {
    const picks = fc.array(fc.record({ key: fc.constantFrom("reviewerUserId", "reviewerName", "valueHash", "internalNote", "passportNumber", "number", "storageKey"), depthSeed: fc.nat() }), { minLength: 1, maxLength: 8 })
    fc.assert(fc.property(fc.constantFrom(...VerificationStatus.options), picks, (status, p) => {
      expect(JSON.stringify(MyDetails.parse(contaminate(JSON.parse(JSON.stringify(details(status))), p)))).not.toContain("SECRET-")
    }), { numRuns: 200 })
  })

  it("a document without a scan or an erased document shows an empty scan, never a dangling reference", () => {
    expect(svc.view(t, doc("UNVERIFIED"), undefined, undefined).verification.scan).toBeNull()
    expect(svc.view(t, { ...(doc("VERIFIED") as object), erasedAt: new Date() } as never).verification).toMatchObject({ status: "UNVERIFIED", reviewHash: null })
  })
})

describe("cargo tracking customer views (Phase E)", () => {
  const STAFF_ONLY = ["source", "externalEventId", "correctsEventId", "correctionReason", "reason", "createdBy", "internalNotes", "rawPayload", "partnerPayload", "partnerReference", "author"]
  const event = fc.record({ id: uuid, eventCode: fc.constantFrom(...TRACKING_EVENT_CODES), label: fc.string({ minLength: 1 }), location: fc.string({ minLength: 2 }), occurredAt: iso, description: fc.option(fc.string(), { nil: undefined }), corrected: fc.boolean() })
  const shipment = fc.record({ ref: fc.constant("UT-C-7Q2K9M"), service: fc.constantFrom("DOCUMENTS", "PARCEL", "EXCESS_BAGGAGE", "AIR_FREIGHT"), status: fc.constantFrom("BOOKED", "IN_TRANSIT", "DELIVERED"), statusLabel: fc.string(), laneLabel: fc.string(), awbNumber: fc.option(fc.constant("176-12345675"), { nil: null }), estimatedDeliveryAt: fc.option(iso, { nil: null }), lastEvent: fc.option(event, { nil: null }), timeline: fc.array(event, { maxLength: 5 }) })
  const picks = fc.array(fc.record({ key: fc.constantFrom(...STAFF_ONLY), depthSeed: fc.nat() }), { minLength: 1, maxLength: 10 })

  it("shipment views drop staff-only fields even when the record carries them", () => {
    fc.assert(fc.property(shipment, picks, (s, p) => {
      expect(JSON.stringify(ShipmentView.parse(contaminate(structuredClone(s), p)))).not.toContain("SECRET-")
    }), { numRuns: 300 })
  })

  it("summary drops staff-only fields", () => {
    const summary = fc.record({ total: fc.nat(9), inTransit: fc.nat(9), delivered: fc.nat(9), next: fc.option(fc.record({ ref: fc.constant("UT-C-7Q2K9M"), estimatedDeliveryAt: fc.option(iso, { nil: null }), lastEvent: fc.option(event, { nil: null }), laneLabel: fc.string() }), { nil: null }) })
    fc.assert(fc.property(summary, picks, (s, p) => {
      expect(JSON.stringify(ShipmentSummary.parse(contaminate(structuredClone(s), p)))).not.toContain("SECRET-")
    }), { numRuns: 200 })
  })

  it("the cargo request view's tracking is the same customer event shape, with the estimate", () => {
    const view = CargoCustomerView.shape.tracking.element
    fc.assert(fc.property(event, picks, (e, p) => {
      const out = view.parse(contaminate(structuredClone(e), p))
      expect(Object.keys(out).filter((k) => STAFF_ONLY.includes(k))).toEqual([])
    }), { numRuns: 200 })
    expect(CargoCustomerView.shape.estimatedDeliveryAt.safeParse(null).success).toBe(true)
  })
})

describe("billing customer views (ADR-0006, Phase C)", () => {
  const INTERNAL_INVOICE = ["id", "createdBy", "customerUserId", "quoteId", "requestId", "rowVersion", "actorUserId", "reasonText", "history", "actions", "storageKey", "internalNote"]
  const svc = new InvoicesService(...(Array(10).fill({}) as ConstructorParameters<typeof InvoicesService>))
  const ref = "UT-C-7Q2K9M"
  const row = (status: string) => ({
    id: "0b6a1f7e-3c1d-4f7a-9b2e-5d4c3b2a1f00", number: "INV-2026-000001", requestType: "CARGO", requestId: "1c7b2a8f-4d2e-4a8b-8c3f-6e5d4c3b2a10", requestRef: ref, customerUserId: "2d8c3b9a-5e3f-4b9c-9d4a-7f6e5d4c3b20",
    quoteId: "3e9d4c0b-6f40-4c0d-8e5b-8a7f6e5d4c30", status, currency: "GBP", totalMinor: 5000, issuedAt: new Date("2026-11-01T10:00:00Z"), expiresAt: new Date("2026-11-15T10:00:00Z"), paidAt: null, cancelledAt: null, cancelReason: null,
    documentId: "4f0e5d1c-7051-4d1e-9f6c-9b8a7f6e5d40", createdBy: "5a1f6e2d-8162-4e2f-8a7d-0c9b8a7f6e50", rowVersion: 2, createdAt: new Date(), updatedAt: new Date(),
  })
  const line = { id: "6b2a7f3e-9273-4f3a-9b8e-1d0c9b8a7f60", invoiceId: "0b6a1f7e-3c1d-4f7a-9b2e-5d4c3b2a1f00", position: 0, description: "Freight (8 kg)", quantity: 1, unitAmountMinor: 5000, amountMinor: 5000, createdAt: new Date() }
  const view = (status: string) => (svc as unknown as { customerView(i: unknown, l: unknown[]): unknown }).customerView(row(status), [line])
  const picks = fc.array(fc.record({ key: fc.constantFrom(...INTERNAL_INVOICE), depthSeed: fc.nat() }), { minLength: 1, maxLength: 10 })
  const issuedStates = fc.constantFrom("ISSUED", "PAID", "CANCELLED", "REFUNDED")
  const quotation = { number: "QT-2026-000001", requestRef: ref, productType: "CARGO", status: "SENT", sentAt: "2026-11-01T10:00:00.000Z", validUntil: null, documentId: null }

  it("an issued invoice shows its amounts; internal fields are dropped even when the record carries them", () => {
    fc.assert(fc.property(issuedStates, picks, (status, p) => {
      const out = CustomerInvoice.parse(contaminate(structuredClone(view(status)), p))
      expect(JSON.stringify(out)).not.toContain("SECRET-")
      expect(amountPaths(out).sort()).toEqual(["$.lines[0].amount.amountMinor", "$.lines[0].unitAmount.amountMinor", "$.total.amountMinor"].sort())
      expect(JSON.stringify(out)).not.toMatch(/createdBy|customerUserId|quoteId|rowVersion/)
    }), { numRuns: 200 })
  })

  it("a draft invoice cannot be represented to a customer: amounts only on issued invoices", () => {
    expect(CustomerInvoice.safeParse(view("DRAFT")).success).toBe(false)
    expect(BillingDocuments.safeParse({ quotations: [], invoices: [view("DRAFT")] }).success).toBe(false)
  })

  it("quotations carry no amount even when contaminated with amount fields; the invoices keep theirs", () => {
    const amountPicks = fc.array(fc.record({ key: fc.constantFrom(...AMOUNT_FIELDS), depthSeed: fc.nat() }), { minLength: 1, maxLength: 8 })
    fc.assert(fc.property(issuedStates, amountPicks, (status, p) => {
      const { quotations } = contaminate({ quotations: [structuredClone(quotation)] }, p) as { quotations: unknown[] }
      const out = BillingDocuments.parse({ quotations, invoices: [structuredClone(view(status))] })
      expect(amountPaths(out.quotations)).toEqual([])
      expect(out.invoices[0]!.total).toEqual({ amountMinor: 5000, currency: "GBP" })
    }), { numRuns: 200 })
  })

  it("staff views without pricing.read.internal carry null amounts and the schema accepts them", () => {
    const hidden = { id: row("DRAFT").id, number: null, status: "DRAFT", requestRef: ref, productType: "CARGO", currency: "GBP", lines: [{ description: "Freight", quantity: 1, unitAmount: null, amount: null }], total: null, issuedAt: null, expiresAt: null, paidAt: null, cancelledAt: null, cancelReason: null, documentId: null, createdAt: "2026-11-01T10:00:00.000Z", history: [], actions: [{ command: "issue", allowed: false, reason: "no" }] }
    expect(amountPaths(StaffInvoice.parse(hidden))).toEqual([])
  })
})

describe("service request customer views (ADR-0015)", () => {
  const svc = new ServicesService(...(Array(11).fill({}) as ConstructorParameters<typeof ServicesService>))
  const internal = (svc as unknown as { quoteView(q: unknown): unknown; summary(r: unknown, l: string): unknown })
  const STAFF_ONLY = ["version", "customer", "assignee", "slaDueAt", "submittedVia", "submittedLocale", "complianceCaseId", "travellers", "quotes", "allowedCommands", "assigneeUserId", "customerUserId", "contactPhoneSnapshot", "contactIdentityId", "reasonText", "internalNote", "createdBy", "serviceNote"]
  const row = { id: "0b6a1f7e-3c1d-4f7a-9b2e-5d4c3b2a1f00", ref: "UT-S-7Q2K9M", type: "VISA", status: "COMPLIANCE_HOLD", submittedAt: new Date("2026-11-01T10:00:00Z"), updatedAt: new Date("2026-11-01T10:05:00Z") }
  const sentQuote = (status: string) => ({
    id: "1c7b2a8f-4d2e-4a8b-8c3f-6e5d4c3b2a10", status, currency: "GBP", validUntil: new Date("2026-11-05T10:00:00Z"), sentAt: new Date("2026-11-01T10:00:00Z"), documentNumber: "QT-2026-000007",
    serviceNote: "Takes about 5 working days", serviceLines: [{ kind: "SERVICE_FEE", label: "Service fee", amount: money }, { kind: "CLUB_DISCOUNT", label: "Club", amount: { amountMinor: 1000, currency: "GBP" }, benefitId: "2d8c3b9a-5e3f-4b9c-9d4a-7f6e5d4c3b20" }],
  })
  const base = (quote: unknown) => ({
    ...(internal.summary(row, "en") as object), details: { destinationCountry: "TR", purpose: "TOURISM" }, timeline: [{ at: "2026-11-01T10:00:00.000Z", kind: "STATUS", label: "Received", toStatus: "SUBMITTED" }],
    messages: [], quote, canCancel: true, canAcceptQuote: false,
  })
  const picks = fc.array(fc.record({ key: fc.constantFrom(...INTERNAL, ...STAFF_ONLY), depthSeed: fc.nat() }), { minLength: 1, maxLength: 12 })
  /** The customer's own details are validated when written and shown back verbatim, so contamination targets everything around them. */
  const contaminateOutsideDetails = (v: Record<string, unknown>, p: { key: string; depthSeed: number }[]) => {
    const { details, ...rest } = structuredClone(v)
    return { ...(contaminate(rest, p) as object), details }
  }

  it("a compliance hold is shown as received, never as a hold", () => {
    expect((internal.summary(row, "en") as { status: string }).status).toBe("SUBMITTED")
  })

  it("never emits staff fields, even when the record carries them (property)", () => {
    fc.assert(fc.property(fc.constantFrom("SENT", "ACCEPTED", "EXPIRED"), picks, (status, p) => {
      const out = CustomerServiceRequestView.parse(contaminateOutsideDetails(base(internal.quoteView(sentQuote(status))) as Record<string, unknown>, p))
      expect(JSON.stringify(out)).not.toContain("SECRET-")
      for (const k of STAFF_ONLY) expect(out).not.toHaveProperty(k)
    }), { numRuns: 200 })
  })

  it("a draft or replaced quote cannot be represented to a customer, so no draft amount can reach one", () => {
    for (const status of ["DRAFT", "SUPERSEDED"]) expect(CustomerServiceRequestView.safeParse(base(internal.quoteView(sentQuote(status)))).success).toBe(false)
    expect(CustomerServiceRequestView.safeParse(base(null)).success).toBe(true)
  })

  it("amounts appear only inside the sent quote, and the club discount is a negative contribution to the total", () => {
    const amountPicks = fc.array(fc.record({ key: fc.constantFrom(...AMOUNT_FIELDS), depthSeed: fc.nat() }), { minLength: 1, maxLength: 8 })
    fc.assert(fc.property(amountPicks, (p) => {
      const { quote: sent, ...rest } = base(internal.quoteView(sentQuote("SENT"))) as Record<string, unknown>
      const out = CustomerServiceRequestView.parse({ ...contaminateOutsideDetails(rest, p), quote: sent })
      const { quote, ...outside } = out
      expect(amountPaths(outside)).toEqual([])
      expect(quote?.total).toEqual({ amountMinor: 41000 - 1000, currency: "GBP" })
    }), { numRuns: 100 })
  })

  it("the staff schema keeps the staff fields the customer schema drops", () => {
    const staff = { ...base(internal.quoteView(sentQuote("SENT"))), status: "COMPLIANCE_HOLD", version: 3, customer: { userId: row.id, name: "Leila", phone: "+989121234567" }, assignee: null, slaDueAt: null, submittedVia: "WEB", submittedLocale: "en", complianceCaseId: null, travellers: [], quotes: [], allowedCommands: [] }
    expect(StaffServiceRequestView.parse(staff)).toMatchObject({ version: 3, status: "COMPLIANCE_HOLD" })
    expect(ServiceQuoteView.safeParse(internal.quoteView(sentQuote("DRAFT"))).success).toBe(true)
  })
})

describe("public tracking view (spec 4.5)", () => {
  const view = (extra: object = {}) => ({ ref: "UT-S-7Q2K9M", kind: "SERVICE", serviceType: "VISA", status: "QUOTED", timeline: [{ at: "2026-11-01T10:00:00.000Z", status: "SUBMITTED" }, { at: "2026-11-02T10:00:00.000Z", status: "QUOTED" }], ...extra })
  const LEAKS = [...INTERNAL, ...AMOUNT_FIELDS, "name", "givenNames", "surname", "nameFa", "passportNumber", "dateOfBirth", "phone", "email", "details", "quote", "total", "customer", "messages", "reasonText", "note"]

  it("carries only the reference, kind, type, status and a status timeline, whatever the record carries (property)", () => {
    fc.assert(fc.property(fc.array(fc.record({ key: fc.constantFrom(...LEAKS), depthSeed: fc.nat() }), { minLength: 1, maxLength: 12 }), (p) => {
      const out = PublicTrackView.parse(contaminate(structuredClone(view()), p))
      expect(Object.keys(out).sort()).toEqual(["kind", "ref", "serviceType", "status", "timeline"])
      for (const t of out.timeline) expect(Object.keys(t).sort()).toEqual(["at", "status"])
      expect(JSON.stringify(out)).not.toContain("SECRET-")
      expect(amountPaths(out)).toEqual([])
    }), { numRuns: 200 })
  })
})
