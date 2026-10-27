import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { FlightRequestStatus, type PriceBreakdown } from "@unitravel/contracts"

import { AMENDABLE_STATUSES, amendState, priceBreakdownIssue, priceBreakdownTotal } from "./amendments"

const GBP = (amountMinor: number) => ({ amountMinor, currency: "GBP" })

describe("amendState (ADR-0013 A2)", () => {
  it("allows amendments before a reservation and asks for acknowledgement while a quote is out", () => {
    expect(amendState("IN_REVIEW")).toEqual({ allowed: true, needsAcknowledge: false })
    expect(amendState("QUOTED")).toEqual({ allowed: true, needsAcknowledge: true })
    expect(amendState("ACCEPTED")).toEqual({ allowed: true, needsAcknowledge: true })
  })
  it("refuses from RESERVED on, during screening and in terminal states, always with a reason", () => {
    for (const s of FlightRequestStatus.options.filter((x) => !AMENDABLE_STATUSES.includes(x))) {
      const st = amendState(s)
      expect(st.allowed).toBe(false)
      expect(st.reason).toBeTruthy()
    }
    expect(amendState("RESERVED").reason).toMatch(/after-sales/)
  })
})

describe("priceBreakdownTotal / priceBreakdownIssue (ADR-0013 A5)", () => {
  const base: PriceBreakdown = { fare: GBP(35000), taxes: GBP(0), serviceFee: GBP(1000), extras: [{ label: "Extra bag", amount: GBP(2500) }], discount: { label: "Loyalty", amount: GBP(1500) }, total: GBP(37000) }

  it("adds extras and subtracts the discount (the brief's worked example)", () => {
    expect(priceBreakdownTotal(base)).toBe(37000)
    expect(priceBreakdownIssue(base, "GBP")).toBeNull()
  })
  it("keeps the old three-part breakdown valid", () => {
    expect(priceBreakdownIssue({ fare: GBP(100), taxes: GBP(20), serviceFee: GBP(5), total: GBP(125) }, "GBP")).toBeNull()
  })
  it("refuses a manipulated total, a mixed currency, a discount above the price and a zero total", () => {
    expect(priceBreakdownIssue({ ...base, total: GBP(1) }, "GBP")?.code).toBe("SUM")
    expect(priceBreakdownIssue({ ...base, extras: [{ label: "x", amount: { amountMinor: 100, currency: "EUR" } }] }, "GBP")?.code).toBe("CURRENCY")
    expect(priceBreakdownIssue({ ...base, discount: { label: "x", amount: GBP(999999) }, total: GBP(37000 - 999999 + 1500) }, "GBP")?.code).toBe("DISCOUNT_TOO_LARGE")
    expect(priceBreakdownIssue({ fare: GBP(100), taxes: GBP(0), serviceFee: GBP(0), discount: { label: "all", amount: GBP(100) }, total: GBP(0) }, "GBP")?.code).toBe("NOT_POSITIVE")
    expect(priceBreakdownIssue({ fare: GBP(-100), taxes: GBP(200), serviceFee: GBP(0), total: GBP(100) }, "GBP")?.code).toBe("NEGATIVE")
  })
  it("property: any breakdown whose total is the computed sum and positive is accepted, and any other total is refused", () => {
    const amt = fc.integer({ min: 0, max: 5_000_000 })
    fc.assert(fc.property(amt, amt, amt, fc.array(fc.integer({ min: 1, max: 100_000 }), { maxLength: 10 }), fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: -1000, max: 1000 }), (fare, taxes, fee, extras, disc, skew) => {
      const pb = { fare: GBP(fare), taxes: GBP(taxes), serviceFee: GBP(fee), extras: extras.map((a, i) => ({ label: `e${i}`, amount: GBP(a) })), ...(disc > 0 ? { discount: { label: "d", amount: GBP(disc) } } : {}) }
      const sum = priceBreakdownTotal(pb)
      const issue = priceBreakdownIssue({ ...pb, total: GBP(sum + skew) }, "GBP")
      if (skew === 0 && sum > 0) expect(issue).toBeNull()
      else expect(issue).not.toBeNull()
    }))
  })
})
