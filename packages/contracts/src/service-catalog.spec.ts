import { describe, expect, it } from "vitest"

import { CatalogueLineInput, ReservationBody } from "./requests"
import { CreateServiceCatalogItemBody, RequestServiceInterest, UpdateServiceCatalogItemBody } from "./service-catalog"

const item = { code: "BAGGAGE", nameEn: "Extra baggage", nameFa: "بار اضافه", lineType: "BAGGAGE", defaultPriceMinor: 2500, currency: "GBP", perPassenger: true, showPriceToCustomer: false }

describe("service catalogue contracts (STAGE-26)", () => {
  it("creates active by default and keeps the price hidden unless asked", () => {
    const b = CreateServiceCatalogItemBody.parse(item)
    expect(b.active).toBe(true)
    expect(b.showPriceToCustomer).toBe(false)
  })
  it("refuses a negative or fractional price, a lower-case code and an unknown line type", () => {
    for (const bad of [{ defaultPriceMinor: -1 }, { defaultPriceMinor: 10.5 }, { code: "bag" }, { lineType: "GIFT" }]) expect(CreateServiceCatalogItemBody.safeParse({ ...item, ...bad }).success).toBe(false)
  })
  it("never lets the code change on update, and refuses an empty patch", () => {
    expect(UpdateServiceCatalogItemBody.safeParse({}).success).toBe(false)
    expect(UpdateServiceCatalogItemBody.parse({ code: "OTHER", active: false })).toEqual({ active: false })
  })
  it("dedupes interests and caps them", () => {
    expect(RequestServiceInterest.parse(["CIP", "CIP", "VISA"])).toEqual(["CIP", "VISA"])
    expect(RequestServiceInterest.safeParse(Array.from({ length: 21 }, (_, i) => `S${i + 10}`)).success).toBe(false)
  })
  it("a catalogue quote line has a positive whole quantity and a non-negative price", () => {
    const id = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
    expect(CatalogueLineInput.safeParse({ catalogueItemId: id }).success).toBe(true)
    expect(CatalogueLineInput.safeParse({ catalogueItemId: id, quantity: 0 }).success).toBe(false)
    expect(CatalogueLineInput.safeParse({ catalogueItemId: id, priceMinor: -5 }).success).toBe(false)
  })
})

describe("reservation body (ADR-0030)", () => {
  const base = {
    system: "PARTNER", ticketingDeadline: "2026-12-01T10:00:00Z", quoteOptionId: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", travellerIds: ["0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"],
    slices: [{ origin: "LON", destination: "IKA", durationMin: 300, segments: [] }],
  }
  const messages = (b: object) => {
    const r = ReservationBody.safeParse(b)
    return r.success ? [] : r.error.issues.map((i) => i.message)
  }
  it("needs a locator or an external reference", () => {
    expect(messages(base)).toContain("Give a record locator or an external reference")
    expect(messages({ ...base, externalReference: "PANEL-77" })).not.toContain("Give a record locator or an external reference")
    expect(messages({ ...base, recordLocator: "ABC123" })).not.toContain("Give a record locator or an external reference")
  })
  it("refuses a blank or over-long reference", () => {
    expect(messages({ ...base, externalReference: "   " }).length).toBeGreaterThan(0)
    expect(messages({ ...base, externalReference: "x".repeat(65) }).length).toBeGreaterThan(0)
  })
})
