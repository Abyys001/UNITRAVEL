import { FlightListingItem, type PublicItinerary } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { toListingItem } from "./listings.service"

const card: PublicItinerary = {
  id: "0190f000-0000-7000-8000-000000000002", origin: "IST", destination: "LHR", departureDate: "2026-11-22", departLocal: "2026-11-22T08:40", arriveLocal: "2026-11-22T10:55", durationMin: 255,
  stops: 0, carriers: ["TK"], flightNumbers: ["TK1979"], selfTransfer: false, layovers: [], riskFlags: [], complianceReview: true, fetchedAt: "2026-11-21T10:00:00.000Z",
}

describe("popular-route cards from the flight catalog (ADR-0034, replaces the ADR-0032 B3 prewarm)", () => {
  it("maps a snapshot row to a price-free card that keeps its age and review flag", () => {
    const item = toListingItem(card)
    expect(item).toMatchObject({ label: "CACHED_OFFER", fetchedAt: card.fetchedAt, origin: "IST", destination: "LHR", departureDate: "2026-11-22", carriers: ["TK"], stops: 0, durationMin: 255, departureLocal: card.departLocal, arrivalLocal: card.arriveLocal, complianceReview: true })
    expect(FlightListingItem.strict().safeParse(item).success).toBe(true)
    expect(JSON.stringify(item)).not.toMatch(/amount|price|GBP|USD|bookingToken|googleFlights|providerData/i)
  })

  it("has no stored search behind it, so the card carries no offer reference", () => {
    expect(toListingItem(card).offerRef).toBeNull()
  })
})
