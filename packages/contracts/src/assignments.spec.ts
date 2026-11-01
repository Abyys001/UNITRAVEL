import { describe, expect, it } from "vitest"

import { ASSIGNABLE_SERVICE_TYPES, AssignServiceBody } from "./assignments"

const quote = { lines: [{ kind: "SERVICE_FEE", label: "Airport CIP", amount: { amountMinor: 12000, currency: "GBP" } }], validUntil: "2026-12-01T00:00:00Z" }
const cip = { type: "CIP", details: { airport: "IKA", direction: "ARRIVAL", flightNumber: "BA 6601", date: "2026-12-20", passengersCount: 2 }, quote }

describe("admin-assigned service body (ADR-0020)", () => {
  it("accepts details that match the type and a valid quote", () => {
    expect(AssignServiceBody.safeParse(cip).success).toBe(true)
  })
  it("validates the details with the same schema the customer form uses", () => {
    const bad = AssignServiceBody.safeParse({ ...cip, details: { ...cip.details, airport: "THR" } })
    expect(bad.success).toBe(false)
    expect(JSON.stringify(bad.error?.issues)).toContain("details")
  })
  it("refuses a tour call-back (never quoted) and unknown types", () => {
    expect(ASSIGNABLE_SERVICE_TYPES).not.toContain("TOUR_CALLBACK")
    expect(AssignServiceBody.safeParse({ ...cip, type: "TOUR_CALLBACK" }).success).toBe(false)
    expect(AssignServiceBody.safeParse({ ...cip, type: "FLIGHT" }).success).toBe(false)
  })
  it("refuses mixed currencies, a zero total and extra fields", () => {
    expect(AssignServiceBody.safeParse({ ...cip, quote: { ...quote, lines: [...quote.lines, { kind: "THIRD_PARTY_FEE", label: "Fee", amount: { amountMinor: 100, currency: "EUR" } }] } }).success).toBe(false)
    expect(AssignServiceBody.safeParse({ ...cip, quote: { ...quote, lines: [{ ...quote.lines[0]!, amount: { amountMinor: 0, currency: "GBP" } }] } }).success).toBe(false)
    expect(AssignServiceBody.safeParse({ ...cip, customerId: "x" }).success).toBe(false)
  })
})
