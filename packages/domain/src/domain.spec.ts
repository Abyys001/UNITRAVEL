import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { FlightRequestStatus, PERMISSIONS, type Permission } from "@unitravel/contracts"

import { CARGO_TRANSITIONS, cargoWeights } from "./cargo-request"
import { FLIGHT_TRANSITIONS, type FlightCommandName, type FlightFacts } from "./flight-request"
import { generateReference, normaliseDigits, normaliseReference, smsSegments, validateAwb, validateTicketNumber } from "./formats"
import { evaluate, type MachineActor } from "./machine"
import { ageOn, passengerTypeOn } from "./passengers"
import { atolAllowsPayment, computePaymentStatus, unknownQuoteFields } from "./payments"

const staff = (perms: Permission[] = [...PERMISSIONS]): MachineActor => ({ kind: "STAFF", userId: "s", permissions: new Set(perms) })
const customer: MachineActor = { kind: "CUSTOMER", userId: "c", permissions: new Set(), isOwner: true }
const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }

describe("references and formats", () => {
  it("generates UT references from the Crockford alphabet only", () => {
    fc.assert(fc.property(fc.uint8Array({ minLength: 6, maxLength: 6 }), (bytes) => {
      const ref = generateReference("F", () => bytes)
      expect(ref).toMatch(/^UT-F-[0-9A-HJKMNP-TV-Z]{6}$/)
      expect(normaliseReference(ref.toLowerCase())).toBe(ref)
    }))
  })
  it("validates AWB check digits", () => {
    expect(validateAwb("176-12345675")).toEqual({ ok: true, normalised: "176-12345675" })
    expect(validateAwb("17612345676").ok).toBe(false)
  })
  it("checks ticket prefixes against the accounting code", () => {
    expect(validateTicketNumber("1252345678901", "125").ok).toBe(true)
    expect(validateTicketNumber("2352345678901", "125").ok).toBe(false)
    expect(validateTicketNumber("125234567890", "125").ok).toBe(false)
  })
  it("normalises Persian digits", () => expect(normaliseDigits("۰۹۱۲۳۴۵")).toBe("0912345"))
  it("counts UCS-2 segments for Persian", () => {
    expect(smsSegments("Hello").encoding).toBe("GSM7")
    const fa = smsSegments("درخواست شما دریافت شد UT-F-8K4Q7M")
    expect(fa.encoding).toBe("UCS2")
    expect(fa.count).toBe(1)
    expect(smsSegments("د".repeat(71)).count).toBe(2)
  })
})

describe("passengers", () => {
  it("computes age against each segment's local date", () => {
    expect(ageOn("2024-11-20", "2026-11-19")).toBe(1)
    expect(passengerTypeOn("2024-11-20", "2026-11-19")).toBe("INF")
    expect(passengerTypeOn("2024-11-20", "2026-11-25")).toBe("CHD")
  })
})

const arbFacts: fc.Arbitrary<FlightFacts> = fc.record({
  status: fc.constantFrom(...FlightRequestStatus.options),
  paymentStatus: fc.constantFrom("NONE", "PARTIAL", "PAID", "REFUND_PENDING", "REFUNDED" as const),
  now: fc.constant(new Date("2026-11-01T10:00:00Z")),
  ticketsIssuedForEveryTraveller: fc.boolean(),
  allTravellersVerified: fc.boolean(),
  creditOverrideApproved: fc.boolean(),
  travellerDocumentsComplete: fc.boolean(),
  responseProvided: fc.boolean(),
  assigneeCanTransition: fc.boolean(),
  message: fc.option(fc.string(), { nil: undefined }),
  reasonCode: fc.option(fc.constantFrom("NO_AVAILABILITY"), { nil: undefined }),
  decisionReason: fc.option(fc.string(), { nil: undefined }),
  optionId: fc.option(fc.constant("o1"), { nil: undefined }),
  quote: fc.option(fc.record({
    id: fc.constant("q1"),
    status: fc.constantFrom("DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "SUPERSEDED" as const),
    validUntil: fc.option(fc.date({ min: new Date("2026-10-01"), max: new Date("2026-12-01"), noInvalidDate: true }), { nil: null }),
    options: fc.array(fc.record({ id: fc.constantFrom("o1", "o2"), unknownFields: fc.array(fc.constantFrom("conditions.refund"), { maxLength: 1 }) }), { maxLength: 3 }),
  }), { nil: undefined }),
  reservation: fc.option(fc.record({
    recordLocator: fc.stringMatching(/^[A-Z0-9]{4,7}$/),
    ticketingDeadline: fc.option(fc.date({ min: new Date("2026-10-01"), max: new Date("2026-12-01"), noInvalidDate: true }), { nil: null }),
    passengersMatch: fc.boolean(), segmentsMatch: fc.boolean(), mismatchReason: fc.option(fc.string(), { nil: undefined }),
  }), { nil: undefined }),
  activeReservation: fc.option(fc.record({ status: fc.constantFrom("HELD", "CONFIRMED", "CANCELLED", "LAPSED" as const), ticketingDeadline: fc.date({ min: new Date("2026-10-01"), max: new Date("2026-12-01"), noInvalidDate: true }) }), { nil: null }),
  lastSegmentDeparture: fc.option(fc.date({ min: new Date("2026-09-01"), max: new Date("2026-12-01"), noInvalidDate: true }), { nil: null }),
})

const commands = Object.keys(FLIGHT_TRANSITIONS) as FlightCommandName[]
const actors = [staff(), customer, system]

describe("flight request state machine (property)", () => {
  it("never reaches TICKETED without a verified document and an issued ticket per traveller, and payment or override", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(FLIGHT_TRANSITIONS, cmd, facts, actor)
      if (r.ok && r.to === "TICKETED") {
        expect(facts.ticketsIssuedForEveryTraveller).toBe(true)
        expect(facts.allTravellersVerified).toBe(true)
        expect(facts.paymentStatus === "PAID" || facts.creditOverrideApproved).toBe(true)
      }
    }), { numRuns: 5000 })
  })
  it("never reaches RESERVED without a valid record locator and a future deadline", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(FLIGHT_TRANSITIONS, cmd, facts, actor)
      if (r.ok && r.to === "RESERVED") {
        expect(facts.reservation?.recordLocator).toMatch(/^[A-Z0-9]{6}$/)
        expect(facts.reservation!.ticketingDeadline!.getTime()).toBeGreaterThan(facts.now.getTime())
      }
    }), { numRuns: 5000 })
  })
  it("never sends a quote with an UNKNOWN attribute or a past validity", () => {
    fc.assert(fc.property(arbFacts, (facts) => {
      const r = evaluate(FLIGHT_TRANSITIONS, "send_quote", facts, staff())
      if (r.ok) {
        expect(facts.quote!.options.length).toBeGreaterThan(0)
        expect(facts.quote!.options.every((o) => o.unknownFields.length === 0)).toBe(true)
        expect(facts.quote!.validUntil!.getTime()).toBeGreaterThan(facts.now.getTime())
      }
    }), { numRuns: 3000 })
  })
  it("terminal states accept no commands", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const f = { ...facts, status: fc.sample(fc.constantFrom("COMPLETED", "DECLINED", "CANCELLED" as const), 1)[0]! }
      expect(evaluate(FLIGHT_TRANSITIONS, cmd, f, actor).ok).toBe(false)
    }), { numRuns: 1000 })
  })
  it("rejects staff commands without the permission and customer commands from non-owners", () => {
    const f: FlightFacts = { status: "NEW", paymentStatus: "NONE", now: new Date(), assigneeCanTransition: true }
    expect(evaluate(FLIGHT_TRANSITIONS, "claim", f, staff(["flight_request.read.any"])).ok).toBe(false)
    expect(evaluate(FLIGHT_TRANSITIONS, "claim", f, staff(["flight_request.assign"])).ok).toBe(true)
    const q: FlightFacts = { status: "QUOTED", paymentStatus: "NONE", now: new Date("2026-11-01"), optionId: "o1", travellerDocumentsComplete: true, quote: { id: "q", status: "SENT", validUntil: new Date("2026-11-02"), options: [{ id: "o1", unknownFields: [] }] } }
    expect(evaluate(FLIGHT_TRANSITIONS, "accept_quote", q, { ...customer, isOwner: false }).ok).toBe(false)
    expect(evaluate(FLIGHT_TRANSITIONS, "accept_quote", q, customer).ok).toBe(true)
  })
})

describe("payments and ATOL", () => {
  it("payment status equals the computed sum of verified records", () => {
    fc.assert(fc.property(fc.array(fc.record({ amountMinor: fc.integer({ min: 1, max: 100000 }), currency: fc.constant("GBP"), status: fc.constantFrom("RECORDED", "VERIFIED", "REJECTED" as const) })), fc.integer({ min: 1, max: 200000 }), (records, total) => {
      const verified = records.filter((r) => r.status === "VERIFIED").reduce((s, r) => s + r.amountMinor, 0)
      const status = computePaymentStatus(records, total)
      expect(status).toBe(verified === 0 ? "NONE" : verified >= total ? "PAID" : "PARTIAL")
    }))
  })
  it("PAY_ON_TICKETING only allows payment at ticketing", () => {
    expect(atolAllowsPayment("PAY_ON_TICKETING", "RESERVED").ok).toBe(false)
    expect(atolAllowsPayment("PAY_ON_TICKETING", "AT_TICKETING").ok).toBe(true)
    expect(atolAllowsPayment("AGENT_FOR_ATOL_HOLDER", "RESERVED").ok).toBe(true)
  })
  it("lists unknown quote fields", () => {
    expect(unknownQuoteFields({ segmentCount: 2, baggage: [{ segmentIndex: 0, checked: { status: "KNOWN", value: {} }, cabin: { status: "UNKNOWN" } }], conditions: { change: { status: "UNKNOWN" }, refund: { status: "KNOWN", value: {} } } }))
      .toEqual(["baggage[1].checked", "conditions.change"])
  })
})

describe("cargo", () => {
  it("moves a re-weigh beyond tolerance to EXCEPTION", () => {
    const r = evaluate(CARGO_TRANSITIONS, "receive", { status: "AWAITING_HANDOVER", now: new Date(), reweighChangePct: 8, reweighTolerancePct: 5 }, staff())
    expect(r).toMatchObject({ ok: true, to: "EXCEPTION" })
    const ok = evaluate(CARGO_TRANSITIONS, "receive", { status: "AWAITING_HANDOVER", now: new Date(), reweighChangePct: 3, reweighTolerancePct: 5 }, staff())
    expect(ok).toMatchObject({ ok: true, to: "RECEIVED" })
  })
  it("computes chargeable weight", () => {
    expect(cargoWeights([{ lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 5 }], 5000)).toMatchObject({ volumetricKg: 12, chargeableKg: 12, actualKg: 5 })
  })
  it("rejects a booking with a bad AWB", () => {
    const r = evaluate(CARGO_TRANSITIONS, "record_booking", { status: "ACCEPTED", now: new Date(), partner: { servesLaneAndService: true, complianceCleared: true }, awbNumber: "176-12345676" }, staff())
    expect(r.ok).toBe(false)
  })
})
