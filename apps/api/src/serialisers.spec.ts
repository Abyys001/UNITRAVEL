import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { FlightRequestCustomerView, FlightRequestListItem } from "@unitravel/contracts"

/** Field names that exist on staff/internal records and must never reach a customer (ch. 25.6, 32.2). */
const INTERNAL = ["internalCostMinor", "internalNotes", "notes", "assigneeId", "assigneeName", "screening", "screeningScore", "riskScore", "complianceCase", "passportNumber", "documentNumberEnc", "supplierRaw", "createdBy", "customerUserId", "contactIdentityId", "costMinor"]

const uuid = fc.uuid({ version: 4 })
const iso = fc.date({ min: new Date("2026-01-01"), max: new Date("2027-12-31"), noInvalidDate: true }).map((d) => d.toISOString())
const message = fc.record({ id: uuid, direction: fc.constantFrom("TO_CUSTOMER", "FROM_CUSTOMER"), body: fc.string(), authorName: fc.string({ minLength: 1 }), createdAt: iso, readAt: fc.option(iso, { nil: null }), documentIds: fc.array(uuid, { maxLength: 2 }) })
const traveller = fc.record({ travellerId: uuid, passengerType: fc.constantFrom("ADT", "CHD", "INF"), name: fc.string({ minLength: 1 }), documentComplete: fc.boolean() })
const timeline = fc.record({ at: iso, kind: fc.constantFrom("STATUS", "MESSAGE", "QUOTE"), label: fc.string({ minLength: 1 }) })

const aggregate = fc.record({
  ref: fc.constant("UT-F-7Q2K9M"), kind: fc.constantFrom("ITINERARY", "MANUAL"), status: fc.constantFrom("SUBMITTED", "IN_REVIEW", "QUOTED", "CANCELLED"),
  statusLabel: fc.string({ minLength: 1 }), paymentStatus: fc.constantFrom("NONE", "PARTIAL", "PAID"), tripType: fc.constant("ONE_WAY"),
  query: fc.constant({ tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-11-20", flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" }),
  routeLabel: fc.string(), firstTravelDate: fc.constant("2026-11-20"), submittedAt: iso, updatedAt: iso, snapshot: fc.constant(null),
  travellers: fc.array(traveller, { maxLength: 4 }), timeline: fc.array(timeline, { maxLength: 5 }), messages: fc.array(message, { maxLength: 5 }),
  quotes: fc.constant([]), reservation: fc.constant(null), tickets: fc.constant([]), documents: fc.constant([]),
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

describe("customer serialisers never emit internal fields (property)", () => {
  const picks = fc.array(fc.record({ key: fc.constantFrom(...INTERNAL), depthSeed: fc.nat() }), { minLength: 1, maxLength: 12 })

  it("flight request detail", () => {
    fc.assert(fc.property(aggregate, picks, (a, p) => {
      const out = JSON.stringify(FlightRequestCustomerView.parse(contaminate(structuredClone(a), p)))
      expect(out).not.toContain("SECRET-")
    }), { numRuns: 300 })
  })

  it("request list", () => {
    const item = fc.record({ ref: fc.constant("UT-C-7Q2K9M"), productType: fc.constantFrom("FLIGHT", "CARGO"), status: fc.string(), statusLabel: fc.string(), routeLabel: fc.string(), firstDate: fc.constant("2026-11-20"), submittedAt: iso, updatedAt: iso, unread: fc.nat(9) })
    fc.assert(fc.property(fc.array(item, { maxLength: 6 }), picks, (a, p) => {
      expect(JSON.stringify(FlightRequestListItem.array().parse(contaminate(structuredClone(a), p)))).not.toContain("SECRET-")
    }), { numRuns: 300 })
  })
})
