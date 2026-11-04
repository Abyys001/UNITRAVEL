import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { NormalisedOffer } from "@unitravel/contracts"
import type { ReferenceLookup } from "@unitravel/engine"

import { reference } from "../../../../../test/fixtures/apify/helpers"
import { identityKey } from "../apify/normalise"
import { type FlightapiContext, normaliseResponse } from "./normalise"

// A trimmed real response: IST→LHR on 2026-11-12, USD, observed 4 Nov 2026 (five itineraries, one of them a self-transfer, one with a null price option).
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "ist-lhr.json"), "utf8")) as Record<string, any>
const TZ: Record<string, string> = { BEG: "Europe/Belgrade", CAI: "Africa/Cairo", DXB: "Asia/Dubai" }
// The shared test reference has no stopover airports; the zones below are the real ones.
const ref: ReferenceLookup = { ...reference, airport: (code: string) => reference.airport(code) ?? (TZ[code] ? ({ ...reference.airport("IST")!, tz: TZ[code] } as never) : undefined) } as ReferenceLookup
const ctx: FlightapiContext = { reference: ref, fetchedAt: new Date("2026-11-04T10:00:00Z"), ttlSeconds: 30 * 86_400, currency: "USD", cabin: "ECONOMY", from: "IST", to: "LHR", date: "2026-11-12", maxResults: 10 }

describe("FlightAPI response to offers (ADR-0035)", () => {
  const out = normaliseResponse(fixture, ctx)

  it("keeps valid offers only, cheapest first, with the cheapest pricing option", () => {
    for (const o of out.offers) expect(() => NormalisedOffer.parse(o)).not.toThrow()
    const totals = out.offers.map((o) => o.price.total.amountMinor)
    expect(totals).toEqual([...totals].sort((a, b) => a - b))
    expect(totals[0]).toBe(19300)
    expect(out.offers[0]!.source.providerOfferId).toBe(identityKey(["TK1983"], "2026-11-12T20:05", "economy"))
  })

  it("drops the self-transfer itinerary and says so", () => {
    expect(out.notices).toContain("SELF_TRANSFER_DROPPED 1")
    expect(out.offers.some((o) => o.slices[0]!.segments.some((s) => s.marketing.flightNumber === "427"))).toBe(false)
  })

  it("ignores a null price option and takes the cheapest remaining one", () => {
    const withNull = out.offers.find((o) => o.slices[0]!.segments[0]!.marketing.flightNumber === "2215")!
    expect(withNull.price.total.amountMinor).toBe(125295)
  })

  it("never infers brand, baggage, conditions or seat selection, and labels the source indicative", () => {
    for (const o of out.offers) {
      expect(o.brand).toEqual({ status: "UNKNOWN" })
      expect(o.conditions).toEqual({ change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } })
      expect(o.seatSelection).toEqual({ status: "UNKNOWN" })
      expect(o.baggage.every((b) => b.checked.status === "UNKNOWN" && b.cabin.status === "UNKNOWN")).toBe(true)
      expect(o.source).toMatchObject({ provider: "flightapi", confidence: "INDICATIVE", rung: "CACHED_OFFER", fake: false })
      expect(o.providerData).toBeUndefined()
    }
  })

  it("converts local times to UTC with the reference zones and keeps connections as segments", () => {
    const direct = out.offers[0]!.slices[0]!
    expect(direct.segments[0]!.departure).toEqual({ local: "2026-11-12T20:05", utc: "2026-11-12T17:05:00Z", tz: "Europe/Istanbul" })
    expect(direct.durationMin).toBe(240)
    const oneStop = out.offers.find((o) => o.slices[0]!.segments.length === 2)!
    expect(oneStop.baggage).toHaveLength(2)
    expect(oneStop.slices[0]!.segments[1]!.origin.iata).toBe(oneStop.slices[0]!.segments[0]!.destination.iata)
  })

  it("keeps only the top maxResults, ties broken by the shorter journey", () => {
    expect(normaliseResponse(fixture, { ...ctx, maxResults: 2 }).offers).toHaveLength(2)
    const twin = structuredClone(fixture)
    const [a] = twin.itineraries
    const clone = { ...structuredClone(a), id: "twin" }
    const leg = { ...structuredClone(twin.legs.find((l: any) => l.id === a.leg_ids[0])), id: "twin-leg", segment_ids: ["twin-seg"], duration: 200 }
    const seg = { ...structuredClone(twin.segments.find((s: any) => s.id === twin.legs[0].segment_ids[0])), id: "twin-seg", marketing_flight_number: "9999", arrival: "2026-11-12T22:00:00" }
    clone.leg_ids = ["twin-leg"]
    twin.itineraries.push(clone); twin.legs.push(leg); twin.segments.push(seg)
    const tied = normaliseResponse(twin, { ...ctx, maxResults: 2 }).offers
    expect(tied.map((o) => o.price.total.amountMinor)).toEqual([19300, 19300])
    expect(tied[0]!.slices[0]!.durationMin).toBeLessThanOrEqual(tied[1]!.slices[0]!.durationMin)
  })

  it("drops other dates and routes, unknown airports, and itineraries without a price", () => {
    expect(normaliseResponse(fixture, { ...ctx, date: "2026-11-13" }).offers).toEqual([])
    expect(normaliseResponse(fixture, { ...ctx, to: "LGW" }).notices.some((n) => n.startsWith("UNREQUESTED_ROUTE"))).toBe(true)
    expect(normaliseResponse(fixture, { ...ctx, reference: reference }).notices.some((n) => n.startsWith("UNKNOWN_AIRPORT"))).toBe(true)
    const noPrice = structuredClone(fixture)
    noPrice.itineraries[0].pricing_options = [{ price: { amount: null } }]
    expect(normaliseResponse(noPrice, ctx).notices).toContain("PRICE_UNAVAILABLE")
  })

  it("answers an empty or malformed body with no offers and no throw", () => {
    expect(normaliseResponse({}, ctx)).toEqual({ offers: [], notices: [], errors: [] })
    expect(normaliseResponse(null, ctx).offers).toEqual([])
  })
})
