import type { NormalisedOffer } from "@unitravel/contracts"
import { FlightListingItem } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { toFlightItems } from "./listings.service"

const tp = (local: string) => ({ local, utc: `${local}:00Z`, tz: "UTC" })
const offer = (amountMinor: number, fake = false, stops = 0): NormalisedOffer => ({
  source: { provider: fake ? "fake" : "duffel", providerOfferId: `o-${amountMinor}`, rung: "LIVE_CONFIRMED", fetchedAt: "2026-11-01T10:00:00Z", fake },
  slices: [{
    origin: "LHR", destination: "IKA", durationMin: 600 + stops * 90,
    segments: Array.from({ length: stops + 1 }, (_, i) => ({
      marketing: { carrier: i ? "OS" : "TK", flightNumber: "1" }, operating: { carrier: "TK" }, origin: { iata: "LHR" }, destination: { iata: "IKA" },
      departure: tp(`2026-11-22T0${i}:00`), arrival: tp(`2026-11-22T1${i}:00`), cabin: "ECONOMY", technicalStops: [],
    })),
  }],
  price: { total: { amountMinor, currency: "GBP" } }, ticketing: "SINGLE_TICKET", brand: { status: "UNKNOWN" }, baggage: [], conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } },
  seatSelection: { status: "UNKNOWN" }, seatMapAvailable: false, restrictions: [],
} as unknown as NormalisedOffer)

describe("cached flight listing items (ADR-0021)", () => {
  it("keeps the cheapest few, labelled with the fetch time, and carries no amount", () => {
    const items = toFlightItems([offer(90_000), offer(40_000), offer(70_000, false, 1)], "2026-11-01T10:05:00Z", "2026-11-22", 2)
    expect(items).toHaveLength(2)
    for (const i of items) {
      expect(i).toMatchObject({ label: "CACHED_OFFER", fetchedAt: "2026-11-01T10:05:00Z", origin: "LHR", destination: "IKA", departureDate: "2026-11-22" })
      expect(FlightListingItem.strict().safeParse(i).success).toBe(true)
      expect(JSON.stringify(i)).not.toMatch(/amount|price|GBP/i)
    }
    expect(items.map((i) => i.stops).sort()).toEqual([0, 1])
  })
  it("a FAKE offer is labelled SANDBOX so it can never pass for a live fare", () => {
    expect(toFlightItems([offer(10_000, true)], "2026-11-01T10:05:00Z", "2026-11-22")[0]!.label).toBe("SANDBOX")
  })
})
