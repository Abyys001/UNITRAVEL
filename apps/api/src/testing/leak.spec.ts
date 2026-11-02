import { describe, expect, it } from "vitest"

import { findForbiddenKeys, FORBIDDEN_CUSTOMER_KEYS } from "./leak"

describe("findForbiddenKeys", () => {
  it("returns nothing for a clean value", () => {
    expect(findForbiddenKeys({ a: 1, b: [{ c: "x" }], d: null })).toEqual([])
  })

  it("reports JSON paths through objects and arrays", () => {
    expect(findForbiddenKeys({ items: [{ ok: 1, bookingToken: "t" }], deep: { priceLevel: "HIGH" } })).toEqual(["$.items[0].bookingToken", "$.deep.priceLevel"])
  })

  it("matches keys case-insensitively", () => {
    expect(findForbiddenKeys({ GoogleFlightsUrl: "x", TypicalPriceLow: 1 })).toEqual(["$.GoogleFlightsUrl", "$.TypicalPriceLow"])
  })

  it("flags string values pointing at Google Travel or Flights", () => {
    expect(findForbiddenKeys({ link: "https://www.google.com/travel/flights?x=1", l2: ["https://google.com/flights"], ok: "https://example.com" })).toEqual(["$.link", "$.l2[0]"])
  })

  it("accepts extra keys", () => {
    expect(findForbiddenKeys({ notes: "n", other: 1 })).toEqual([])
    expect(findForbiddenKeys({ notes: "n", other: 1 }, ["notes"])).toEqual(["$.notes"])
  })

  it("covers every key the plan names", () => {
    for (const k of ["priceLevel", "bookingToken", "googleFlightsUrl", "bookingOptions", "bookingUrl", "totalPrice", "cheapestReturn", "priceNote", "fareMinor", "baseFare"]) {
      expect(FORBIDDEN_CUSTOMER_KEYS).toContain(k)
    }
  })
})
