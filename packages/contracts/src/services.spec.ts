import { describe, expect, it } from "vitest"

import { AccommodationDetails } from "./services"

const base = { location: "Istanbul", checkIn: "2026-12-01", checkOut: "2026-12-04", guests: 2, rooms: 1 }

describe("hotel request preferences (ADR-0017)", () => {
  it("accepts the original form without preferences", () => {
    expect(AccommodationDetails.safeParse(base).success).toBe(true)
  })
  it("accepts every preference when valid", () => {
    expect(AccommodationDetails.safeParse({ ...base, accommodationType: "APARTMENT_HOTEL", minStars: 4, roomType: "TWIN", mealPlan: "HB", cheapestFirst: true }).success).toBe(true)
  })
  it("rejects unknown codes and out-of-range stars", () => {
    for (const bad of [{ mealPlan: "XX" }, { roomType: "PENTHOUSE" }, { accommodationType: "VILLA" }, { minStars: 0 }, { minStars: 6 }, { minStars: 3.5 }]) {
      expect(AccommodationDetails.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false)
    }
  })
  it("still requires check-out after check-in", () => {
    expect(AccommodationDetails.safeParse({ ...base, checkOut: base.checkIn }).success).toBe(false)
  })
})
