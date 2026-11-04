import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { DEFAULT_ENGINE_RULES, DEFAULT_HUBS, type NormalisedOffer, PublicItinerary, PublicItineraryDetail } from "@unitravel/contracts"
import { buildItinerary, catalogEngineRules, joinAtHub, makeOffer, RuleResolver } from "@unitravel/engine"
import { DEFAULT_CATALOG_SETTINGS } from "@unitravel/contracts"

import { reference } from "../../../test/fixtures/apify/helpers"
import { combinedIdentity, detailFromItinerary, detailFromOffer, etagOf, snapshotPayload, toPublicItinerary } from "./catalog-model"

const FETCHED = "2026-11-10T06:00:00Z"
const direct = (id: string, dep: string, arr: string, from: string, to: string, fromTz: string, toTz: string, minor = 23100) => makeOffer({
  provider: "apify-google-flights", id, fetchedAt: FETCHED, totalMinor: minor, currency: "USD", rung: "CACHED_OFFER",
  slices: [[{ carrier: "TK", number: "1979", from, to, dep, arr, fromTz, toTz, aircraft: "Airbus A321", terminals: ["1", "2"] }]],
})
// The second leg departs 5 h after the first lands (a daytime connection), inside the 4–6 h window.
const ikaIst = direct("TK879|2026-11-12T08:00|economy", "2026-11-12T08:00", "2026-11-12T11:30", "IKA", "IST", "Asia/Tehran", "Europe/Istanbul")
const istLhr = direct("TK1979|2026-11-12T16:30|economy", "2026-11-12T16:30", "2026-11-12T18:45", "IST", "LHR", "Europe/Istanbul", "Europe/London", 18900)

const withSecrets = (o: NormalisedOffer): NormalisedOffer => ({ ...o, providerData: { bookingToken: "SECRET-token", googleFlightsUrl: "https://www.google.com/travel/flights?SECRET", priceLevel: "SECRET-low", typicalPriceLow: 111222, typicalPriceHigh: 333444 } })

describe("catalog allowlist serializer (ADR-0034 C8)", () => {
  it("a single-ticket offer becomes a price-free detail whose keys are exactly the allowlist", () => {
    const d = detailFromOffer(withSecrets(istLhr), false)
    expect(Object.keys(d).sort()).toEqual(["arriveLocal", "carriers", "complianceReview", "departLocal", "departureDate", "destination", "durationMin", "fetchedAt", "flightNumbers", "layovers", "legs", "origin", "riskFlags", "selfTransfer", "stops"])
    expect(d).toMatchObject({ origin: "IST", destination: "LHR", departureDate: "2026-11-12", departLocal: "2026-11-12T16:30", arriveLocal: "2026-11-12T18:45", stops: 0, flightNumbers: ["TK1979"], carriers: ["TK"], selfTransfer: false, complianceReview: false })
    expect(d.legs[0]).toMatchObject({ carrier: "TK", flightNumber: "TK1979", from: { iata: "IST", local: "2026-11-12T16:30", terminal: "1" }, to: { iata: "LHR", terminal: "2" }, aircraft: "Airbus A321" })
    expect(JSON.stringify(d)).not.toMatch(/SECRET|111222|333444|amount|price|currency|USD|bookingToken|googleFlights|baggage|fare/i)
    expect(PublicItineraryDetail.strict().safeParse({ id: "0190f000-0000-7000-8000-000000000003", ...d, isCurrent: true, lastSeenAt: FETCHED }).success).toBe(true)
  })

  it("the list view is strict: a field that is not on the allowlist fails the build instead of reaching a customer", () => {
    const id = "0190f000-0000-7000-8000-000000000003"
    const d = detailFromOffer(istLhr, false)
    expect(() => toPublicItinerary(id, { ...d, price: 231 } as never)).not.toThrow() // never copied: the serializer names every field
    expect(Object.keys(toPublicItinerary(id, { ...d, price: 231 } as never))).not.toContain("price")
    expect(PublicItinerary.strict().safeParse({ ...toPublicItinerary(id, d), amountMinor: 1 }).success).toBe(false)
    expect(PublicItinerary.strict().safeParse({ ...toPublicItinerary(id, d), provider: "apify" }).success).toBe(false)
  })

  it("whatever the offer carries, the snapshot has no amount, currency, token, link or provider field (property)", () => {
    fc.assert(fc.property(fc.string({ minLength: 4 }), fc.integer({ min: 1, max: 9_999_999 }), (secret, minor) => {
      const o = { ...direct(`TK1|${secret}`, "2026-11-12T16:30", "2026-11-12T18:45", "IST", "LHR", "Europe/Istanbul", "Europe/London", minor), providerData: { bookingToken: `SECRET-${secret}`, googleFlightsUrl: `https://g.example/SECRET-${secret}`, priceLevel: "SECRET-low" } } as NormalisedOffer
      const out = JSON.stringify(snapshotPayload([{ id: "0190f000-0000-7000-8000-000000000004", detail: detailFromOffer(o, false) }]))
      expect(out).not.toContain("SECRET")
      expect(out).not.toMatch(/amount|currency|"price"|bookingToken|googleFlights|provider/i)
    }), { numRuns: 100 })
  })

  it("a self-transfer keeps the engine's layover and its separate-ticket flag, and carries the review flag of its legs", () => {
    const rules = catalogEngineRules(DEFAULT_ENGINE_RULES, DEFAULT_CATALOG_SETTINGS.connections)
    const resolver = new RuleResolver(rules)
    const [sol] = joinAtHub([ikaIst], [istLhr], resolver, false, 0)
    expect(sol).toBeDefined()
    const ctx = {
      query: { tripType: "ONE_WAY", slices: [{ from: { airport: "IKA" }, to: { airport: "LHR" }, date: "2026-11-12", flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", preferences: { allowSelfTransfer: true, allowAirportChange: false, allowOvernight: false, maxStops: 3, nearestCabin: false, studentFare: false } },
      rules, hubs: DEFAULT_HUBS, policy: { blockedCarriers: new Set<string>(), reviewCarriers: new Set<string>(), blockedAirports: new Set<string>(), reviewAirports: new Set<string>(), reviewLanes: new Set(["IR:*"]), blockedLanes: new Set<string>() },
      reference, ruleVersion: 1, flags: { selfTransfer: true, gateways: false }, locale: "en" as const, now: new Date("2026-11-10T00:00:00Z"),
    }
    const built = buildItinerary([sol!], ctx as never, resolver)
    expect(built).not.toBeNull()
    const d = detailFromItinerary(built!.itinerary, FETCHED)
    expect(d).toMatchObject({ origin: "IKA", destination: "LHR", selfTransfer: true, stops: 1, flightNumbers: ["TK1979", "TK1979"], complianceReview: true })
    expect(d.riskFlags).toContain("SEPARATE_TICKETS")
    expect(d.layovers).toHaveLength(1)
    expect(d.layovers[0]).toMatchObject({ at: "IST", minutes: 300 })
    expect(JSON.stringify(d)).not.toMatch(/amount|price|currency|USD/i)
  })

  it("snapshot order is by departure time and the ETag depends on slot versions only", () => {
    const rows = [
      { id: "0190f000-0000-7000-8000-00000000000b", detail: detailFromOffer(istLhr, false) },
      { id: "0190f000-0000-7000-8000-00000000000a", detail: detailFromOffer(ikaIst, false) },
    ]
    expect(snapshotPayload(rows).map((r) => r.origin)).toEqual(["IKA", "IST"])
    expect(etagOf(["s1@3", "RESULTS"])).toBe(etagOf(["s1@3", "RESULTS"]))
    expect(etagOf(["s1@3", "RESULTS"])).not.toBe(etagOf(["s1@4", "RESULTS"]))
    expect(combinedIdentity("a", "b")).toBe("a>b")
  })
})
