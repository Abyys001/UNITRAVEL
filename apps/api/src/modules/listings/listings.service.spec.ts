import { FlightListingItem, type PublicItinerary } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { popularRoutes, toListingItem, upcomingCards } from "./listings.service"

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

describe("popular-route card limit", () => {
  const on = (date: string, n: number) => Array.from({ length: n }, (_, i) => ({ ...card, id: `0190f000-0000-7000-8000-00000000${date.slice(8)}${i}0`, departureDate: date }))

  it("drops today's departures before applying the limit, so they do not use up the cards", () => {
    const rows = [...on("2026-11-21", 4), ...on("2026-11-22", 3), ...on("2026-11-23", 4)]
    const cards = upcomingCards(rows, "2026-11-21")
    expect(cards).toHaveLength(5)
    expect(cards.every((c) => c.departureDate > "2026-11-21")).toBe(true)
  })
})

describe("popular routes include every route the catalog tracks", () => {
  const tracked = [{ origin: "IKA", destination: "IST" }, { origin: "IST", destination: "LHR" }]

  it("lists tracked routes when the stored settings predate listings.flightRoutes (schema default is empty)", () => {
    expect(popularRoutes([], tracked)).toEqual([{ from: "IKA", to: "IST" }, { from: "IST", to: "LHR" }])
  })

  it("keeps configured routes first and adds tracked ones once", () => {
    expect(popularRoutes([{ from: "IST", to: "LHR" }, { from: "DXB", to: "LHR" }], tracked)).toEqual([{ from: "IST", to: "LHR" }, { from: "DXB", to: "LHR" }, { from: "IKA", to: "IST" }])
  })
})
