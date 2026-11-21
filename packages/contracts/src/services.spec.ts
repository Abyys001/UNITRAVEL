import { describe, expect, it } from "vitest"

import { AccommodationDetails, CipDetails, CreateServiceRequestBody } from "./services"

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

describe("CIP options and request documents (ADR-0041)", () => {
  const cip = { airport: "IKA", direction: "DEPARTURE", flightNumber: "tk 879", date: "2026-12-01", passengersCount: 2 }
  const body = { type: "CIP", details: cip, contactIdentityId: "00000000-0000-4000-8000-000000000001", acknowledgements: { notABooking: true, privacy: true } }

  it("keeps the original CIP form valid", () => {
    expect(CipDetails.safeParse(cip).success).toBe(true)
  })
  it("accepts options and companions", () => {
    expect(CipDetails.safeParse({ ...cip, companions: 1, services: ["CIP_TERMINAL", "HOME_CHECK_IN"] }).success).toBe(true)
  })
  it("refuses departure-only options on an arrival", () => {
    const r = CipDetails.safeParse({ ...cip, direction: "ARRIVAL", services: ["BUSINESS_LOUNGE"] })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(["services"])
  })
  it("refuses unknown options", () => {
    expect(CipDetails.safeParse({ ...cip, services: ["SPA"] }).success).toBe(false)
  })
  it("accepts up to ten document ids and refuses more or non-uuids", () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    expect(CreateServiceRequestBody.safeParse(body).success).toBe(true)
    expect(CreateServiceRequestBody.safeParse({ ...body, documentIds: Array.from({ length: 10 }, (_, i) => id(i)) }).success).toBe(true)
    expect(CreateServiceRequestBody.safeParse({ ...body, documentIds: Array.from({ length: 11 }, (_, i) => id(i)) }).success).toBe(false)
    expect(CreateServiceRequestBody.safeParse({ ...body, documentIds: ["nope"] }).success).toBe(false)
  })
})
