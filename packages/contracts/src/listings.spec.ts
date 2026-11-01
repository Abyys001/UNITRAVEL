import { describe, expect, it } from "vitest"

import { CuratedListingBody, CuratedListingPatch, CuratedListingView, FlightListingItem } from "./listings"

const base = { vertical: "BUS", title: { en: "Istanbul to Van", fa: "استانبول به وان" }, toPlace: "Van" }

describe("curated listings (ADR-0021)", () => {
  it("accepts a row with no price (indicative only)", () => {
    const r = CuratedListingBody.parse(base)
    expect(r.priceQuoted).toBe(false)
    expect(r.price).toBeNull()
  })
  it("a price must be marked quoted, and a quoted flag needs a price", () => {
    expect(CuratedListingBody.safeParse({ ...base, price: { amountMinor: 2500, currency: "GBP" } }).success).toBe(false)
    expect(CuratedListingBody.safeParse({ ...base, priceQuoted: true }).success).toBe(false)
    expect(CuratedListingBody.safeParse({ ...base, priceQuoted: true, price: { amountMinor: 2500, currency: "GBP" } }).success).toBe(true)
    expect(CuratedListingBody.safeParse({ ...base, priceQuoted: true, price: { amountMinor: 0, currency: "GBP" } }).success).toBe(false)
  })
  it("the public view always carries the INDICATIVE label", () => {
    const view = { id: "0192f3a0-0000-7000-8000-000000000001", vertical: "STAY", title: { en: "a", fa: "b" }, summary: { en: "", fa: "" }, fromPlace: null, toPlace: "Tabriz", operator: null, price: null, validUntil: null, updatedAt: "2026-11-01T10:00:00Z" }
    expect(CuratedListingView.safeParse({ ...view, label: "INDICATIVE" }).success).toBe(true)
    expect(CuratedListingView.safeParse({ ...view, label: "CACHED_OFFER" }).success).toBe(false)
    expect(CuratedListingView.safeParse(view).success).toBe(false)
  })
})

describe("listing patch", () => {
  it("has no defaults: a status-only patch carries nothing else", () => {
    expect(CuratedListingPatch.parse({ version: 1, status: "PUBLISHED" })).toEqual({ version: 1, status: "PUBLISHED" })
  })
})

describe("flight listing item", () => {
  it("has a fetch time and a label, and cannot carry an amount", () => {
    const item = { label: "CACHED_OFFER", fetchedAt: "2026-11-01T10:00:00Z", origin: "LHR", destination: "IKA", departureDate: "2026-11-20", carriers: ["TK"], stops: 1, durationMin: 600, departureLocal: "2026-11-20T10:00", arrivalLocal: "2026-11-20T22:00" }
    expect(FlightListingItem.safeParse(item).success).toBe(true)
    expect(FlightListingItem.safeParse({ ...item, fetchedAt: undefined }).success).toBe(false)
    expect(Object.keys(FlightListingItem.shape)).not.toContain("price")
  })
})
