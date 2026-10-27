import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { PAYMENT_PROVIDERS, type PaymentSessionStatus, PERMISSIONS, type Permission } from "@unitravel/contracts"

import type { MachineActor } from "./machine"
import { canEnterStripeMode, CHECKOUT_MAX_MS, CHECKOUT_MIN_MS, checkoutExpiry, ONLINE_PAYMENT_LIVE_ENABLED, onlinePaymentEligibility, REFUND_TRANSITIONS, type RefundFacts, SESSION_TRANSITIONS, sessionNext, settlementCheck } from "./online-payment"
import { evaluate } from "./machine"

const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }
const staff = (id: string, perms: Permission[] = [...PERMISSIONS]): MachineActor => ({ kind: "STAFF", userId: id, permissions: new Set(perms) })
const customer: MachineActor = { kind: "CUSTOMER", userId: "c", permissions: new Set(), isOwner: true }
const UID = "11111111-1111-4111-8111-111111111111"
const base = { product: "FLIGHT", currency: "GBP", totalMinor: 10_000, customerUserId: UID } as const
const allow = [{ key: "product:FLIGHT", action: "ALLOW" }, { key: "currency:GBP", action: "ALLOW" }] as const

describe("online payment: live mode stays blocked (ADR-0007 P1)", () => {
  it("the constant is false and live is refused, test is accepted", () => {
    expect(ONLINE_PAYMENT_LIVE_ENABLED).toBe(false)
    expect(canEnterStripeMode("live")).toMatchObject({ ok: false })
    expect(canEnterStripeMode("test")).toEqual({ ok: true })
  })
  it("deployed hosts refuse test mode too, so no sandbox ever serves them (ADR-0014)", () => {
    expect(canEnterStripeMode("test", true)).toMatchObject({ ok: false, reason: expect.stringMatching(/ADR-0014/) })
    expect(canEnterStripeMode("live", true)).toMatchObject({ ok: false })
  })
  it("the FAKE provider is a payment provider but not a mode", () => expect(PAYMENT_PROVIDERS).toEqual(["STRIPE", "FAKE"]))
})

describe("checkout session expiry (P5)", () => {
  it("never exceeds the invoice's expiry or 24 hours, and needs 30 minutes", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 40 * 24 * 3600_000 }), (remaining) => {
      const now = new Date("2026-10-24T10:00:00Z")
      const invoice = new Date(now.getTime() + remaining)
      const e = checkoutExpiry(invoice, now)
      if (remaining < CHECKOUT_MIN_MS) { expect(e).toBeNull(); return }
      expect(e!.getTime()).toBeLessThanOrEqual(invoice.getTime())
      expect(e!.getTime() - now.getTime()).toBeLessThanOrEqual(CHECKOUT_MAX_MS)
      expect(e!.getTime() - now.getTime()).toBeGreaterThanOrEqual(CHECKOUT_MIN_MS)
    }))
  })
})

describe("eligibility policy (P11)", () => {
  it("default deny: no policy, nothing offered", () => expect(onlinePaymentEligibility([], base)).toEqual({ offered: false, reasons: ["NO_PRODUCT_POLICY", "NO_CURRENCY_POLICY"] }))
  it("offered with ALLOW for product and currency", () => expect(onlinePaymentEligibility(allow, base)).toEqual({ offered: true, reasons: [] }))
  it("the product and the currency are checked separately", () => {
    expect(onlinePaymentEligibility(allow, { ...base, product: "CARGO" }).reasons).toEqual(["NO_PRODUCT_POLICY"])
    expect(onlinePaymentEligibility(allow, { ...base, currency: "USD" }).reasons).toEqual(["NO_CURRENCY_POLICY"])
  })
  it("a BLOCK on the customer wins over any ALLOW", () => {
    const r = onlinePaymentEligibility([...allow, { key: `customer:${UID}`, action: "BLOCK" }], base)
    expect(r).toEqual({ offered: false, reasons: ["BLOCKED"] })
  })
  it("max_minor caps the amount", () => {
    const p = [...allow, { key: "max_minor:5000", action: "ALLOW" }] as const
    expect(onlinePaymentEligibility(p, base).reasons).toEqual(["OVER_LIMIT"])
    expect(onlinePaymentEligibility(p, { ...base, totalMinor: 5000 }).offered).toBe(true)
  })
  it("property: offered implies no BLOCK key matches", () => {
    const keys = fc.constantFrom("product:FLIGHT", "product:CARGO", "currency:GBP", "currency:USD", `customer:${UID}`, "max_minor:20000")
    fc.assert(fc.property(fc.array(fc.record({ key: keys, action: fc.constantFrom("ALLOW", "BLOCK") }), { maxLength: 8 }), (ps) => {
      const r = onlinePaymentEligibility(ps, base)
      if (r.offered) for (const p of ps) if (p.action === "BLOCK") expect([`product:FLIGHT`, "currency:GBP", `customer:${UID}`]).not.toContain(p.key)
    }))
  })
})

describe("payment session machine", () => {
  const all: PaymentSessionStatus[] = ["OPEN", "COMPLETE", "EXPIRED", "FAILED", "MISMATCH"]
  it("only the system moves a session; COMPLETE, FAILED and MISMATCH are terminal", () => {
    for (const s of all) for (const c of Object.keys(SESSION_TRANSITIONS) as (keyof typeof SESSION_TRANSITIONS)[]) {
      expect(sessionNext(s, c, customer)).toBeNull()
      expect(sessionNext(s, c, staff("s"))).toBeNull()
    }
    for (const s of ["COMPLETE", "FAILED", "MISMATCH"] as const) for (const c of Object.keys(SESSION_TRANSITIONS) as (keyof typeof SESSION_TRANSITIONS)[]) expect(sessionNext(s, c, system)).toBeNull()
  })
  it("a late payment can still complete an EXPIRED session", () => {
    expect(sessionNext("EXPIRED", "complete", system)).toBe("COMPLETE")
    expect(sessionNext("EXPIRED", "fail", system)).toBeNull()
    expect(sessionNext("OPEN", "expire", system)).toBe("EXPIRED")
  })
})

describe("settlement check (P8)", () => {
  it("accepts only the exact amount in the invoice currency", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e7 }), fc.integer({ min: 1, max: 1e7 }), fc.constantFrom("GBP", "USD", "gbp"), (a, b, cur) => {
      const r = settlementCheck({ totalMinor: a, currency: "GBP" }, { amountMinor: b, currency: cur })
      expect(r === "OK").toBe(a === b && cur.toUpperCase() === "GBP")
    }))
  })
})

describe("refund machine: four-eyes above the existing threshold (P10)", () => {
  const f = (over: Partial<RefundFacts> = {}): RefundFacts => ({ status: "PENDING_APPROVAL", requestedBy: "a", amountMinor: 1000, thresholdMinor: 100_000, ...over })
  const request = staff("a", ["payment.refund.request"])
  const approver = staff("b", ["payment.refund.approve"])
  it("within the threshold the requester submits alone", () => expect(evaluate(REFUND_TRANSITIONS, "submit", f(), request)).toMatchObject({ ok: true, to: "SUBMITTED" }))
  it("above the threshold the requester cannot submit", () => expect(evaluate(REFUND_TRANSITIONS, "submit", f({ amountMinor: 100_001 }), request)).toMatchObject({ ok: false }))
  it("above the threshold a different approver can; the requester cannot approve their own", () => {
    const big = f({ amountMinor: 100_001 })
    expect(evaluate(REFUND_TRANSITIONS, "approve", { ...big, actorId: "b" }, approver)).toMatchObject({ ok: true, to: "SUBMITTED" })
    expect(evaluate(REFUND_TRANSITIONS, "approve", { ...big, actorId: "a" }, staff("a", ["payment.refund.approve"]))).toMatchObject({ ok: false })
  })
  it("approving needs the approve permission, completing is a system command", () => {
    expect(evaluate(REFUND_TRANSITIONS, "approve", { ...f(), actorId: "b" }, request)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(evaluate(REFUND_TRANSITIONS, "complete", f({ status: "SUBMITTED" }), approver)).toMatchObject({ ok: false })
    expect(evaluate(REFUND_TRANSITIONS, "complete", f({ status: "SUBMITTED" }), system)).toMatchObject({ ok: true, to: "COMPLETED" })
  })
  it("property: from a terminal status nothing moves", () => {
    fc.assert(fc.property(fc.constantFrom("COMPLETED", "REJECTED", "FAILED"), fc.constantFrom(...(Object.keys(REFUND_TRANSITIONS) as (keyof typeof REFUND_TRANSITIONS)[])), (status, cmd) => {
      expect(evaluate(REFUND_TRANSITIONS, cmd, f({ status }), staff("b"))).toMatchObject({ ok: false })
      expect(evaluate(REFUND_TRANSITIONS, cmd, f({ status }), system)).toMatchObject({ ok: false })
    }))
  })
})
