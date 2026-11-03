import type { Itinerary, NormalisedOffer } from "@unitravel/contracts"
import { FlightListingItem, ProviderMetering } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { MIN_WARM_INTERVAL_MS, prewarmCostUsd, prewarmIntervalMs } from "../suppliers/apify/flight-data.service"
import { listingQuery, rotatedDate, toFlightItems, WARM_ROTATION_DAYS } from "./listings.service"

const tp = (local: string) => ({ local, utc: `${local}:00Z`, tz: "UTC" })
const offer = (amountMinor: number, fake = false, stops = 0): NormalisedOffer => ({
  source: { provider: fake ? "fake" : "apify-google-flights", providerOfferId: `o-${amountMinor}`, rung: "CACHED_OFFER", fetchedAt: "2026-11-01T10:00:00Z", fake, confidence: "INDICATIVE" },
  slices: [{
    origin: "LHR", destination: "IKA", durationMin: 600 + stops * 90,
    segments: Array.from({ length: stops + 1 }, (_, i) => ({
      marketing: { carrier: i ? "OS" : "TK", flightNumber: "1" }, operating: { carrier: "TK" }, origin: { iata: "LHR" }, destination: { iata: "IKA" },
      departure: tp(`2026-11-22T0${i}:00`), arrival: tp(`2026-11-22T1${i}:00`), cabin: "ECONOMY", bookingClass: "Y", fareBasis: "YOW", aircraft: "Airbus A321", technicalStops: [],
    })),
  }],
  price: { total: { amountMinor, currency: "GBP" } }, ticketing: "SINGLE_TICKET", brand: { status: "UNKNOWN" }, baggage: [], conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } },
  seatSelection: { status: "UNKNOWN" }, seatMapAvailable: false, restrictions: [],
  providerData: { bookingToken: "SECRET-token", googleFlightsUrl: "https://www.google.com/travel/flights?SECRET", priceLevel: "SECRET-low" },
} as unknown as NormalisedOffer)
const itin = (o: NormalisedOffer, review = false): Itinerary => ({
  id: `itn-${o.price.total.amountMinor}`, construction: "THROUGH", ticketing: "SINGLE_TICKET", tabs: ["BEST"], price: { total: o.price.total, isSumOfTickets: false }, durationMin: o.slices[0]!.durationMin,
  components: [o], connections: [], truth: [], baggage: [], riskFlags: [], score: 0.1, explain: {} as Itinerary["explain"], stops: o.slices[0]!.segments.length - 1,
  firstDeparture: "2026-11-22T00:00:00Z", lastArrival: "2026-11-22T10:00:00Z", carriers: ["TK"], complianceReview: review,
} as Itinerary)
const SEARCH = "0190f000-0000-7000-8000-000000000001"

describe("cached flight listing items (ADR-0021, ADR-0032 B4/B5)", () => {
  it("keeps the cheapest few, with segment detail and an offer reference, and carries no amount or provider-private field", () => {
    const items = toFlightItems([itin(offer(90_000)), itin(offer(40_000), true), itin(offer(70_000, false, 1))], SEARCH, "2026-11-22", (c) => (c === "TK" ? "Turkish Airlines" : undefined), 2)
    expect(items).toHaveLength(2)
    for (const i of items) {
      expect(i).toMatchObject({ label: "CACHED_OFFER", fetchedAt: "2026-11-01T10:00:00Z", origin: "LHR", destination: "IKA", departureDate: "2026-11-22", offerRef: { searchId: SEARCH } })
      expect(FlightListingItem.strict().safeParse(i).success).toBe(true)
      expect(JSON.stringify(i)).not.toMatch(/amount|price|GBP|bookingToken|googleFlights|SECRET|providerData|bookingClass|fareBasis/i)
    }
    expect(items[0]).toMatchObject({ offerRef: { itineraryId: "itn-40000" }, complianceReview: true })
    expect(items[0]!.segments![0]).toMatchObject({ marketing: { carrier: "TK", flightNumber: "1" }, operating: { carrier: "TK" }, aircraft: "Airbus A321", cabin: "ECONOMY", carrierName: "Turkish Airlines" })
    expect(items.map((i) => i.stops).sort()).toEqual([0, 1])
  })
  it("a FAKE offer is labelled SANDBOX so it can never pass for a live fare", () => {
    expect(toFlightItems([itin(offer(10_000, true))], SEARCH, "2026-11-22")[0]!.label).toBe("SANDBOX")
  })
})

describe("popular-route warm (ADR-0032 B3)", () => {
  const m = ProviderMetering.parse({})
  it("defaults: 10 routes at 10 rows cost $0.101 a warm; the $1.50 prewarm pool pays for 14 warms, so one every 52 h", () => {
    expect(m.maxResultsPrewarm).toBe(10)
    expect(prewarmCostUsd(10, m)).toBe(0.101)
    expect(prewarmIntervalMs(10, m)).toBe(52 * 3600_000)
  })
  it("never more often than every 6 hours, and not at all when the pool cannot pay for one warm a month", () => {
    expect(prewarmIntervalMs(1, { ...m, monthlyBudgetUsd: 1000 })).toBe(MIN_WARM_INTERVAL_MS)
    expect(prewarmIntervalMs(10, { ...m, monthlyBudgetUsd: 0.3 })).toBeNull()
    expect(prewarmIntervalMs(0, m)).toBeNull()
    // Twice the routes, half the warms.
    expect(prewarmIntervalMs(20, m)).toBe(Math.ceil(720 / Math.floor(1.5 / 0.201)) * 3600_000)
  })
  it("one date per route per warm, within the next 14 days, shifting each warm", () => {
    const now = new Date("2026-11-03T12:00:00Z")
    const dates = Array.from({ length: WARM_ROTATION_DAYS * 2 }, (_, w) => rotatedDate(now, w, 0))
    expect(new Set(dates).size).toBe(WARM_ROTATION_DAYS)
    for (const d of dates) expect(d > "2026-11-03" && d <= "2026-11-17").toBe(true)
    expect(rotatedDate(now, 1, 0)).not.toBe(rotatedDate(now, 2, 0))
  })
  it("the listing query is the one-way, one-adult economy search the request flow stores", () => {
    expect(listingQuery({ from: "IST", to: "LHR", date: "2026-11-10" })).toMatchObject({ tripType: "ONE_WAY", passengers: [{ type: "ADT" }], cabin: "ECONOMY", slices: [{ from: { airport: "IST" }, to: { airport: "LHR" }, date: "2026-11-10" }] })
  })
})
