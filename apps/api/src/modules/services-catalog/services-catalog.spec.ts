import { describe, expect, it } from "vitest"

import { PublicServiceCatalogItem } from "@unitravel/contracts"

import { findForbiddenKeys } from "../../testing/leak"
import { type CatalogRow, toPublicItem, toStaffItem } from "./services-catalog.service"

const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", code: "CIP", nameEn: "Airport CIP", nameFa: "سی‌آی‌پی", descriptionEn: null, descriptionFa: null, lineType: "CIP",
  defaultPriceMinor: 12000, currency: "GBP", perPassenger: true, showPriceToCustomer: false, active: true, createdBy: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
  createdAt: new Date("2026-11-02T10:00:00Z"), updatedAt: new Date("2026-11-02T10:00:00Z"), ...over,
})

describe("customer catalogue projection", () => {
  it("carries no price unless staff flagged the item", () => {
    const hidden = toPublicItem(row())
    expect(hidden).not.toHaveProperty("priceMinor")
    expect(hidden).not.toHaveProperty("currency")
    expect(hidden).not.toHaveProperty("defaultPriceMinor")
    expect(toPublicItem(row({ showPriceToCustomer: true }))).toMatchObject({ priceMinor: 12000, currency: "GBP" })
  })
  it("matches the public schema and leaks no internal key", () => {
    for (const showPriceToCustomer of [false, true]) {
      const p = toPublicItem(row({ showPriceToCustomer }))
      expect(PublicServiceCatalogItem.parse(p)).toEqual(p)
      expect(findForbiddenKeys(p)).toEqual([])
      expect(p).not.toHaveProperty("createdBy")
    }
  })
  it("the staff view keeps the default price and never exposes the creator", () => {
    const s = toStaffItem(row())
    expect(s.defaultPriceMinor).toBe(12000)
    expect(s).not.toHaveProperty("createdBy")
  })
})
