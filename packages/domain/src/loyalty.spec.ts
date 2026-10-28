import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { benefitNeedsApproval, type BenefitFacts, canDebit, checkClubDiscountLine, effectiveBenefitStatus, ledgerBalance, type MemberFacts } from "./loyalty"

const now = new Date("2026-11-01T12:00:00Z")
const member: MemberFacts = { userId: "u1", tierId: "t1", status: "ACTIVE" }
const benefit = (b: Partial<BenefitFacts> = {}): BenefitFacts => ({
  id: "b1", kind: "DISCOUNT_FIXED", value: 2000, currency: "GBP", appliesTo: "SERVICE", tierId: null, userId: "u1", status: "ACTIVE",
  validFrom: new Date("2026-10-01T00:00:00Z"), validTo: new Date("2026-12-01T00:00:00Z"), ...b,
})
const line = (amountMinor: number, currency = "GBP") => ({ kind: "CLUB_DISCOUNT" as const, amount: { amountMinor, currency }, benefitId: "b1" })
const check = (l: ReturnType<typeof line>, over: Partial<Parameters<typeof checkClubDiscountLine>[1]> = {}) =>
  checkClubDiscountLine(l, { customerUserId: "u1", member, benefit: benefit(), product: "SERVICE", grossMinor: 10_000, now, ...over })

describe("club benefit approval (ADR-0016)", () => {
  it("percentages above 10 and amounts above the threshold need a second approver; perks never", () => {
    expect(benefitNeedsApproval("DISCOUNT_PERCENT", 10, 50_000)).toBe(false)
    expect(benefitNeedsApproval("DISCOUNT_PERCENT", 11, 50_000)).toBe(true)
    expect(benefitNeedsApproval("DISCOUNT_FIXED", 50_000, 50_000)).toBe(false)
    expect(benefitNeedsApproval("BONUS_CREDIT", 50_001, 50_000)).toBe(true)
    expect(benefitNeedsApproval("PERK", 0, 0)).toBe(false)
  })

  it("an active benefit past its end reads as expired", () => {
    expect(effectiveBenefitStatus({ status: "ACTIVE", validTo: new Date("2026-10-31T00:00:00Z") }, now)).toBe("EXPIRED")
    expect(effectiveBenefitStatus({ status: "ACTIVE", validTo: new Date("2026-11-02T00:00:00Z") }, now)).toBe("ACTIVE")
    expect(effectiveBenefitStatus({ status: "REVOKED", validTo: new Date("2026-10-01T00:00:00Z") }, now)).toBe("REVOKED")
  })
})

describe("club discount lines", () => {
  it("accepts a fixed discount up to the benefit, in its currency", () => {
    expect(check(line(2000))).toEqual({ ok: true })
    expect(check(line(2001))).toMatchObject({ ok: false, code: "DISCOUNT_TOO_LARGE" })
    expect(check(line(500, "EUR"))).toMatchObject({ ok: false, code: "BENEFIT_WRONG_CURRENCY" })
  })

  it("caps a percentage discount at that share of the gross", () => {
    const pct = benefit({ kind: "DISCOUNT_PERCENT", value: 10, currency: null })
    expect(check(line(1000), { benefit: pct })).toEqual({ ok: true })
    expect(check(line(1001), { benefit: pct })).toMatchObject({ ok: false, code: "DISCOUNT_TOO_LARGE" })
  })

  it("refuses non-members, other people's benefits, pending, revoked, out-of-date and wrong-product benefits", () => {
    expect(check(line(100), { member: null })).toMatchObject({ code: "NOT_A_MEMBER" })
    expect(check(line(100), { member: { ...member, status: "SUSPENDED" } })).toMatchObject({ code: "NOT_A_MEMBER" })
    expect(check(line(100), { benefit: benefit({ userId: "u2" }) })).toMatchObject({ code: "BENEFIT_NOT_THEIRS" })
    expect(check(line(100), { benefit: benefit({ userId: null, tierId: "t2" }) })).toMatchObject({ code: "BENEFIT_NOT_THEIRS" })
    expect(check(line(100), { benefit: benefit({ userId: null, tierId: "t1" }) })).toEqual({ ok: true })
    expect(check(line(100), { benefit: benefit({ status: "PENDING_APPROVAL" }) })).toMatchObject({ code: "BENEFIT_NOT_APPROVED" })
    expect(check(line(100), { benefit: benefit({ status: "REVOKED" }) })).toMatchObject({ code: "BENEFIT_INACTIVE" })
    expect(check(line(100), { benefit: benefit({ validTo: new Date("2026-10-15T00:00:00Z") }) })).toMatchObject({ code: "BENEFIT_OUT_OF_DATE" })
    expect(check(line(100), { benefit: benefit({ appliesTo: "FLIGHT" }) })).toMatchObject({ code: "BENEFIT_WRONG_PRODUCT" })
    expect(check(line(100), { benefit: benefit({ appliesTo: "ANY" }) })).toEqual({ ok: true })
    expect(check(line(100), { benefit: null })).toMatchObject({ code: "BENEFIT_UNKNOWN" })
  })

  it("bonus credit and perks are never quote lines", () => {
    expect(check(line(100), { benefit: benefit({ kind: "BONUS_CREDIT" }) })).toMatchObject({ code: "BENEFIT_NOT_A_DISCOUNT" })
    expect(check(line(100), { benefit: benefit({ kind: "PERK", value: 0, currency: null }) })).toMatchObject({ code: "BENEFIT_NOT_A_DISCOUNT" })
  })

  it("property: an accepted percentage discount never exceeds its share of the gross", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 1, max: 10_000_000 }), (pct, gross, amount) => {
      const r = check(line(amount), { benefit: benefit({ kind: "DISCOUNT_PERCENT", value: pct, currency: null }), grossMinor: gross })
      if (r.ok) expect(amount * 100).toBeLessThanOrEqual(gross * pct)
    }))
  })
})

describe("club credit ledger", () => {
  it("adds grants and subtracts debits per currency", () => {
    expect(ledgerBalance([
      { kind: "GRANTED", amountMinor: 5000, currency: "GBP" }, { kind: "USED", amountMinor: 1500, currency: "GBP" },
      { kind: "GRANTED", amountMinor: 300, currency: "EUR" }, { kind: "REVERSED", amountMinor: 500, currency: "GBP" },
    ])).toEqual({ GBP: 3000, EUR: 300 })
  })

  it("property: allowed debits never take a balance below zero", () => {
    fc.assert(fc.property(fc.array(fc.record({ grant: fc.boolean(), amount: fc.integer({ min: 1, max: 100_000 }) }), { maxLength: 40 }), (ops) => {
      const entries: { kind: "GRANTED" | "USED"; amountMinor: number; currency: string }[] = []
      for (const op of ops) {
        if (op.grant) entries.push({ kind: "GRANTED", amountMinor: op.amount, currency: "GBP" })
        else if (canDebit(ledgerBalance(entries), "GBP", op.amount)) entries.push({ kind: "USED", amountMinor: op.amount, currency: "GBP" })
        expect(ledgerBalance(entries).GBP ?? 0).toBeGreaterThanOrEqual(0)
      }
    }))
  })
})
