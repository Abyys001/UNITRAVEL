import { describe, expect, it } from "vitest"

import { INVOICE_CANCEL_REASONS } from "@unitravel/contracts"

import { en, fa } from "./index"

describe("billing copy (Phase C)", () => {
  it("every cancel reason (and EXPIRED) and every invoice status has an en and fa line, and the nav entry exists", () => {
    for (const m of [en, fa]) {
      expect(Object.keys(m.billing.cancelReason).sort()).toEqual(["EXPIRED", ...INVOICE_CANCEL_REASONS].sort())
      expect(Object.keys(m.billing.status).sort()).toEqual(["CANCELLED", "ISSUED", "PAID", "REFUNDED"])
      expect(m.nav.billing.length).toBeGreaterThan(0)
    }
    for (const v of Object.values(fa.billing.cancelReason)) expect(/[؀-ۿ]/.test(v)).toBe(true)
  })
})

describe("online payment copy (Phase D, ADR-0007)", () => {
  it("the pay and return pages have the same keys in en and fa, and fa is Persian", () => {
    expect(Object.keys(fa.billing.pay).sort()).toEqual(Object.keys(en.billing.pay).sort())
    for (const k of ["title", "intro", "confirmed", "failed", "stillWaiting", "notOffered"] as const) expect(/[؀-ۿ]/.test(fa.billing.pay[k])).toBe(true)
  })
})
