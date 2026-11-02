import { describe, expect, it } from "vitest"

import { NormalisedOffer } from "@unitravel/contracts"

import { CALENDAR_DAY, DIRECT, ERROR_ROW, MIXED_DATASET, NOTICE, ONE_STOP, PRICE_UNAVAILABLE, SEARCH_ROW, UNKNOWN_AIRPORT } from "../../../../../test/fixtures/apify/google-flights"
import { reference } from "../../../../../test/fixtures/apify/helpers"
import { identityKey, normaliseRows } from "./normalise"

const ctx = { reference, fetchedAt: new Date("2026-11-03T10:00:00Z"), ttlSeconds: 10800 }

describe("Apify rows to offers (ADR-0029 A3, A4)", () => {
  const out = normaliseRows(MIXED_DATASET, ctx)

  it("turns flight rows with a price and known airports into valid offers, and nothing else", () => {
    expect(out.offers.map((o) => o.source.providerOfferId)).toEqual([
      identityKey(DIRECT.flightNumbers, DIRECT.departAt, "economy"), identityKey(ONE_STOP.flightNumbers, ONE_STOP.departAt, "economy"),
    ])
    for (const o of out.offers) expect(() => NormalisedOffer.parse(o)).not.toThrow()
  })

  it("never infers brand, baggage, conditions or seat selection: always UNKNOWN", () => {
    for (const o of out.offers) {
      expect(o.brand).toEqual({ status: "UNKNOWN" })
      expect(o.conditions).toEqual({ change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } })
      expect(o.seatSelection).toEqual({ status: "UNKNOWN" })
      expect(o.baggage.every((b) => b.checked.status === "UNKNOWN" && b.cabin.status === "UNKNOWN")).toBe(true)
      expect(o.ticketing).toBe("SINGLE_TICKET")
      expect(o.source).toMatchObject({ provider: "apify-google-flights", confidence: "INDICATIVE", rung: "CACHED_OFFER", fake: false })
    }
  })

  it("converts local airport times to UTC with the reference zone", () => {
    const seg = out.offers[0]!.slices[0]!.segments[0]!
    expect(seg.departure).toEqual({ local: "2026-12-10T08:40", utc: "2026-12-10T05:40:00Z", tz: "Europe/Istanbul" })
    expect(seg.arrival.utc).toBe("2026-12-10T10:55:00Z")
    expect(seg.marketing).toEqual({ carrier: "TK", flightNumber: "1979" })
    expect(out.offers[1]!.slices[0]!.segments).toHaveLength(2)
  })

  it("drops a priceUnavailable row and a row with an unknown airport, keeping a note for staff", () => {
    expect(out.offers.some((o) => o.source.providerOfferId.startsWith("PC1261"))).toBe(false)
    expect(out.notices).toContain("PRICE_UNAVAILABLE PC1261 2026-12-10T13:10")
    expect(out.notices).toContain("UNKNOWN_AIRPORT ZZZ")
    expect(normaliseRows([{ ...DIRECT, price: null }], ctx).offers).toEqual([])
  })

  it("stores notice and error rows and ignores calendar_day and search rows", () => {
    expect(out.notices).toContain(NOTICE.message)
    expect(out.errors).toEqual([ERROR_ROW.message])
    expect(normaliseRows([CALENDAR_DAY, SEARCH_ROW], ctx)).toEqual({ offers: [], notices: [], errors: [] })
  })

  it("keeps the booking token, link and price level in staff-only providerData", () => {
    expect(out.offers[0]!.providerData).toMatchObject({ bookingToken: DIRECT.bookingToken, googleFlightsUrl: DIRECT.googleFlightsUrl, priceLevel: "low", typicalPriceLow: 210, typicalPriceHigh: 340 })
    expect(out.offers[0]!.price.total).toEqual({ amountMinor: 23100, currency: "GBP" })
    expect(out.offers[1]!.price.total.amountMinor).toBe(19850)
  })

  it("is deterministic for the identity key used by staff recheck", () => {
    expect(identityKey(["JQ86"], "2026-10-15T15:05", "economy")).toBe("JQ86|2026-10-15T15:05|economy")
    expect(UNKNOWN_AIRPORT.origin).toBe("ZZZ")
    expect(PRICE_UNAVAILABLE.priceUnavailable).toBe(true)
  })
})
