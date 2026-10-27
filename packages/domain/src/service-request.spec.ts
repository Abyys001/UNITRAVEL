import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { type Permission, SERVICE_REQUEST_STATUSES, SERVICE_REQUEST_TYPES, SERVICE_TERMINAL, type ServiceRequestStatus } from "@unitravel/contracts"

import { evaluate, type MachineActor } from "./machine"
import { SERVICE_TRANSITIONS, type ServiceCommandName, type ServiceFacts } from "./service-request"

const now = new Date("2026-11-01T10:00:00Z")
const staff: MachineActor = { kind: "STAFF", userId: "s", permissions: new Set<Permission>(["service_request.write", "compliance.case.decide"]) }
const owner: MachineActor = { kind: "CUSTOMER", userId: "c", permissions: new Set(), isOwner: true }
const stranger: MachineActor = { kind: "CUSTOMER", userId: "x", permissions: new Set(), isOwner: false }
const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }
const commands = Object.keys(SERVICE_TRANSITIONS) as ServiceCommandName[]

const arbFacts: fc.Arbitrary<ServiceFacts> = fc.record({
  status: fc.constantFrom(...SERVICE_REQUEST_STATUSES),
  type: fc.constantFrom(...SERVICE_REQUEST_TYPES),
  now: fc.constant(now),
  quote: fc.option(fc.record({
    status: fc.constantFrom("DRAFT", "SENT", "EXPIRED", "SUPERSEDED"),
    validUntil: fc.option(fc.date({ min: new Date("2026-10-01"), max: new Date("2026-12-01"), noInvalidDate: true }), { nil: null }),
    linesComplete: fc.boolean(),
  }), { nil: undefined }),
  reason: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  note: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
  assigneeCanWrite: fc.boolean(),
})
const arbActor = fc.constantFrom(staff, owner, stranger, system)

describe("service request machine (ADR-0015)", () => {
  it("terminal states have no way out, for any actor or facts", () => {
    fc.assert(fc.property(arbFacts, arbActor, fc.constantFrom(...commands), (f, a, c) => {
      if (!SERVICE_TERMINAL.includes(f.status)) return
      expect(evaluate(SERVICE_TRANSITIONS, c, f, a).ok).toBe(false)
    }))
  })

  it("every allowed transition lands on a known status", () => {
    fc.assert(fc.property(arbFacts, arbActor, fc.constantFrom(...commands), (f, a, c) => {
      const r = evaluate(SERVICE_TRANSITIONS, c, f, a)
      if (r.ok) expect(SERVICE_REQUEST_STATUSES).toContain(r.to)
    }))
  })

  it("CONFIRMED is only reached with a sent quote that is still valid", () => {
    fc.assert(fc.property(arbFacts, arbActor, fc.constantFrom(...commands), (f, a, c) => {
      const r = evaluate(SERVICE_TRANSITIONS, c, f, a)
      if (r.ok && r.to === "CONFIRMED" && f.status !== "CONFIRMED") {
        expect(f.quote?.status).toBe("SENT")
        expect(f.quote!.validUntil!.getTime()).toBeGreaterThan(now.getTime())
      }
    }))
  })

  it("a tour call-back is never quoted, and only it completes without a confirmed quote", () => {
    fc.assert(fc.property(arbFacts, arbActor, fc.constantFrom(...commands), (f, a, c) => {
      const r = evaluate(SERVICE_TRANSITIONS, c, f, a)
      if (!r.ok) return
      if (f.type === "TOUR_CALLBACK") expect(r.to).not.toBe("QUOTED")
      if (r.to === "COMPLETED" && f.status === "IN_PROGRESS") expect(f.type).toBe("TOUR_CALLBACK")
    }))
  })

  it("customers act only on their own request, and cannot cancel once confirmed", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), (f, c) => {
      expect(evaluate(SERVICE_TRANSITIONS, c, f, stranger).ok).toBe(false)
      const r = evaluate(SERVICE_TRANSITIONS, c, f, owner)
      if (r.ok) expect(["accept_quote", "decline_quote", "cancel_by_customer"]).toContain(c)
      if (r.ok && c === "cancel_by_customer") expect(f.status).not.toBe("CONFIRMED" as ServiceRequestStatus)
    }))
  })

  it("staff without service_request.write cannot move a request", () => {
    const readOnly: MachineActor = { kind: "STAFF", userId: "r", permissions: new Set<Permission>(["service_request.read.any"]) }
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), (f, c) => {
      expect(evaluate(SERVICE_TRANSITIONS, c, f, readOnly).ok).toBe(false)
    }))
  })

  it("happy path for a visa and a tour call-back", () => {
    const visa: ServiceFacts = { status: "SUBMITTED", type: "VISA", now }
    expect(evaluate(SERVICE_TRANSITIONS, "claim", visa, staff)).toMatchObject({ ok: true, to: "IN_PROGRESS" })
    const quote = { status: "SENT", validUntil: new Date("2026-11-05"), linesComplete: true }
    expect(evaluate(SERVICE_TRANSITIONS, "send_quote", { ...visa, status: "IN_PROGRESS", quote: { ...quote, status: "DRAFT" } }, staff)).toMatchObject({ ok: true, to: "QUOTED" })
    expect(evaluate(SERVICE_TRANSITIONS, "accept_quote", { ...visa, status: "QUOTED", quote }, owner)).toMatchObject({ ok: true, to: "CONFIRMED" })
    expect(evaluate(SERVICE_TRANSITIONS, "complete", { ...visa, status: "CONFIRMED", note: "Visa lodged" }, staff)).toMatchObject({ ok: true, to: "COMPLETED" })
    const tour: ServiceFacts = { status: "IN_PROGRESS", type: "TOUR_CALLBACK", now, note: "Called, sent options" }
    expect(evaluate(SERVICE_TRANSITIONS, "complete", tour, staff)).toMatchObject({ ok: true, to: "COMPLETED" })
    expect(evaluate(SERVICE_TRANSITIONS, "close_no_response", tour, system)).toMatchObject({ ok: true, to: "CLOSED_NO_RESPONSE" })
  })
})
