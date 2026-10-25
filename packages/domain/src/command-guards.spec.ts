import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { PERMISSIONS, TRACKING_EVENT_CODES, type CargoStatus } from "@unitravel/contracts"

import { CARGO_TRANSITIONS, type CargoFacts } from "./cargo-request"
import { trackingEventAllowed } from "./cargo-tracking"
import { FLIGHT_TRANSITIONS, type FlightFacts } from "./flight-request"
import { allowedCommands, evaluate, type MachineActor } from "./machine"
import { passengerMixMismatch } from "./passengers"
import { POLICY_PROPOSAL_TRANSITIONS, type PolicyProposalFacts } from "./policy-proposal"
import { unknownQuoteFields } from "./payments"

const staff: MachineActor = { kind: "STAFF", userId: "s", permissions: new Set(PERMISSIONS) }
const now = new Date("2026-11-01T10:00:00Z")
const sentQuote = { id: "q", status: "SENT" as const, validUntil: new Date("2026-11-05"), options: [{ id: "o1", unknownFields: [] }] }

describe("allowedCommands (ADR-0008 W1)", () => {
  const flight = (status: FlightFacts["status"], extra: Partial<FlightFacts> = {}): FlightFacts => ({ status, paymentStatus: "NONE", now, ...extra })
  const cargo = (status: CargoStatus, extra: Partial<CargoFacts> = {}): CargoFacts => ({ status, now, ...extra })

  it("offers dialog commands before any input exists", () => {
    const offered = (r: { command: string; allowed: boolean }[], c: string) => r.find((x) => x.command === c)
    const f = allowedCommands(FLIGHT_TRANSITIONS, flight("ACCEPTED"), staff)
    expect(offered(f, "record_reservation")).toMatchObject({ allowed: true })
    expect(offered(f, "cancel")).toMatchObject({ allowed: true })
    expect(offered(f, "decline")).toMatchObject({ allowed: true })
    expect(offered(allowedCommands(FLIGHT_TRANSITIONS, flight("IN_REVIEW"), staff), "request_info")).toMatchObject({ allowed: true })
    expect(offered(allowedCommands(FLIGHT_TRANSITIONS, flight("QUOTED", { quote: sentQuote }), staff), "record_acceptance")).toMatchObject({ allowed: true })
    const c = allowedCommands(CARGO_TRANSITIONS, cargo("ACCEPTED"), staff)
    expect(offered(c, "record_booking")).toMatchObject({ allowed: true })
    expect(offered(c, "cancel")).toMatchObject({ allowed: true })
    expect(offered(c, "decline")).toMatchObject({ allowed: true })
  })

  it("keeps state-based reasons visible", () => {
    const r = allowedCommands(FLIGHT_TRANSITIONS, flight("RESERVED", { allTravellersVerified: false, paymentStatus: "PARTIAL" }), staff).find((x) => x.command === "record_tickets")!
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/verified/i)
    const paid = allowedCommands(FLIGHT_TRANSITIONS, flight("RESERVED", { allTravellersVerified: true, paymentStatus: "PARTIAL" }), staff).find((x) => x.command === "record_tickets")!
    expect(paid.reason).toMatch(/PAID/)
    expect(allowedCommands(FLIGHT_TRANSITIONS, flight("RESERVED", { allTravellersVerified: true, paymentStatus: "PAID" }), staff).find((x) => x.command === "record_tickets")!.allowed).toBe(true)
    expect(allowedCommands(FLIGHT_TRANSITIONS, flight("QUOTED", { quote: { ...sentQuote, status: "DRAFT" } }), staff).find((x) => x.command === "record_acceptance")!.allowed).toBe(false)
  })

  const tables = [{ name: "flight", table: FLIGHT_TRANSITIONS as never }, { name: "cargo", table: CARGO_TRANSITIONS as never }] as { name: string; table: Record<string, { from: readonly string[]; inputGuard?: unknown; actor: string }> }[]
  it.each(tables)("$name: a reason is never produced by an inputGuard when listing, and execution still checks it", ({ table }) => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(table)), (command) => {
      const def = table[command]!
      if (!def.inputGuard || def.actor !== "STAFF") return
      for (const status of def.from) {
        // Facts with no input at all: any reason reported here would have to come from the state guard.
        const bare = { status, paymentStatus: "PAID", now, allTravellersVerified: true, quote: sentQuote }
        const listed = allowedCommands(table as never, bare as never, staff, [command] as never)[0]!
        const executed = evaluate(table as never, command as never, bare as never, staff)
        if (listed.allowed) expect(executed.ok).toBe(false)
        else expect(executed.ok).toBe(false)
        if (!listed.allowed) expect(listed.reason).toBe((executed as { reason: string }).reason)
      }
    }))
  })
})

describe("cargo input guards on execution", () => {
  it("record_booking still needs a partner, cancel a reason, record_acceptance a note", () => {
    expect(evaluate(CARGO_TRANSITIONS, "record_booking", { status: "ACCEPTED", now }, staff)).toMatchObject({ ok: false, reason: "Choose a partner" })
    expect(evaluate(CARGO_TRANSITIONS, "cancel", { status: "ACCEPTED", now }, staff).ok).toBe(false)
    expect(evaluate(CARGO_TRANSITIONS, "decline", { status: "ACCEPTED", now, reasonCode: "X" }, staff).ok).toBe(false)
    expect(evaluate(CARGO_TRANSITIONS, "record_acceptance", { status: "QUOTED", now, quote: { status: "SENT", validUntil: null, linesComplete: true } }, staff).ok).toBe(false)
    expect(evaluate(CARGO_TRANSITIONS, "record_acceptance", { status: "QUOTED", now, quote: { status: "SENT", validUntil: null, linesComplete: true }, acceptanceNote: "called" }, staff).ok).toBe(true)
  })
})

describe("flight input guards on execution", () => {
  it("record_reservation, request_info, cancel and record_acceptance reject bad input", () => {
    expect(evaluate(FLIGHT_TRANSITIONS, "record_reservation", { status: "ACCEPTED", paymentStatus: "NONE", now }, staff).ok).toBe(false)
    expect(evaluate(FLIGHT_TRANSITIONS, "request_info", { status: "IN_REVIEW", paymentStatus: "NONE", now }, staff).ok).toBe(false)
    expect(evaluate(FLIGHT_TRANSITIONS, "cancel", { status: "ACCEPTED", paymentStatus: "NONE", now }, staff).ok).toBe(false)
    expect(evaluate(FLIGHT_TRANSITIONS, "record_acceptance", { status: "QUOTED", paymentStatus: "NONE", now, quote: sentQuote, optionId: "o1" }, staff).ok).toBe(false)
    expect(evaluate(FLIGHT_TRANSITIONS, "record_acceptance", { status: "QUOTED", paymentStatus: "NONE", now, quote: sentQuote, optionId: "o1", acceptanceNote: { calledAt: now, note: "agreed" } }, staff).ok).toBe(true)
    expect(evaluate(FLIGHT_TRANSITIONS, "record_tickets", { status: "RESERVED", paymentStatus: "PAID", now, allTravellersVerified: true }, staff).ok).toBe(false)
  })
})

describe("tracking events follow the request (ADR-0008 W4)", () => {
  it("allows only NOTE before booking", () => {
    for (const status of ["NEW", "IN_REVIEW", "QUOTED", "ACCEPTED"] as CargoStatus[]) {
      for (const code of TRACKING_EVENT_CODES) expect(trackingEventAllowed(code, status) === null).toBe(code === "NOTE")
    }
  })
  it("gates pickup and delivery on progress", () => {
    expect(trackingEventAllowed("PICKED_UP", "BOOKED")).toBeNull()
    expect(trackingEventAllowed("DEPARTED", "AWAITING_HANDOVER")).toMatch(/RECEIVED first/)
    expect(trackingEventAllowed("DELIVERED", "IN_TRANSIT")).toMatch(/OUT_FOR_DELIVERY/)
    expect(trackingEventAllowed("DELIVERED", "OUT_FOR_DELIVERY")).toBeNull()
    expect(trackingEventAllowed("PICKED_UP", "IN_TRANSIT")).toBeNull()
  })
})

describe("passenger mix (ADR-0008 W6)", () => {
  it("matches only the same count per type, in any order", () => {
    expect(passengerMixMismatch(["ADT"], ["ADT"])).toBeNull()
    expect(passengerMixMismatch(["ADT", "CHD"], ["CHD", "ADT"])).toBeNull()
    expect(passengerMixMismatch(["ADT"], ["ADT", "ADT"])).toMatch(/1 ADT.*2 ADT/)
    expect(passengerMixMismatch(["ADT", "CHD"], ["ADT", "ADT"])).not.toBeNull()
    fc.assert(fc.property(fc.array(fc.constantFrom("ADT", "CHD", "INF"), { minLength: 1, maxLength: 6 }), (types) => {
      expect(passengerMixMismatch(types as never, [...types].reverse() as never)).toBeNull()
      expect(passengerMixMismatch(types as never, [...types, "ADT"] as never)).not.toBeNull()
    }))
  })
})

describe("fee facts (ADR-0008 W7)", () => {
  const base = { segmentCount: 1, baggage: [{ segmentIndex: 0, checked: { status: "KNOWN" as const, value: { pieces: 1 } }, cabin: { status: "KNOWN" as const, value: true } }] }
  it("flags an allowed-with-fee condition whose amount is blank", () => {
    const fee = (amountMinor: number) => ({ status: "KNOWN" as const, value: { allowed: true, penalty: { amountMinor } } })
    expect(unknownQuoteFields({ ...base, conditions: { change: fee(0), refund: fee(1000) } })).toEqual(["conditions.change.penalty"])
    expect(unknownQuoteFields({ ...base, conditions: { change: fee(2500), refund: { status: "KNOWN", value: { allowed: true } } } })).toEqual([])
  })
})

describe("policy proposals (ADR-0008 W5)", () => {
  const owner = { ...staff }
  const f = (extra: Partial<PolicyProposalFacts> = {}): PolicyProposalFacts => ({ status: "PENDING_APPROVAL", createdBy: "proposer", actorId: "o", actorIsOwner: true, ...extra })
  it("rejects with a reason, withdraws only by the proposer, approves only by another owner", () => {
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "reject", f(), owner)).toMatchObject({ ok: false, reason: "A reason is required" })
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "reject", f({ reason: "not needed" }), owner)).toMatchObject({ ok: true, to: "REJECTED" })
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "reject", f({ reason: "not needed", actorIsOwner: false }), owner).ok).toBe(false)
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "withdraw", f(), owner).ok).toBe(false)
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "withdraw", f({ actorId: "proposer", actorIsOwner: false }), owner)).toMatchObject({ ok: true, to: "WITHDRAWN" })
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "approve", f({ actorId: "proposer" }), owner).ok).toBe(false)
    expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, "approve", f(), owner)).toMatchObject({ ok: true, to: "ACTIVE" })
  })
  it("a decided proposal cannot be decided again", () => {
    for (const status of ["ACTIVE", "RETIRED", "REJECTED", "WITHDRAWN"] as const) {
      for (const c of ["approve", "reject", "withdraw"] as const) expect(evaluate(POLICY_PROPOSAL_TRANSITIONS, c, f({ status, reason: "xxxx", actorId: "proposer" }), owner).ok).toBe(false)
    }
  })
})
