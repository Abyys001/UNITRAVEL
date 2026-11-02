import { describe, expect, it } from "vitest"

import { CustomerOffer, NormalisedOffer, OfferSource } from "./offer"
import { ProviderMetering, ProviderPatchBody } from "./dev"
import { ProviderId } from "./enums"
import { PriceCheckResult, RecheckResult } from "./search"

describe("ProviderMetering (ADR-0029 A6)", () => {
  it("defaults to the owner's budget: $5, pools 40/30/30, $0.75 staff reserve, 15 and 30 rows, 3 h, empty watchlist", () => {
    expect(ProviderMetering.parse({})).toMatchObject({
      monthlyBudgetUsd: 5, poolSplit: { customer: 0.4, prewarm: 0.3, staff: 0.3 }, staffReserveUsd: 0.75, maxResultsCustomer: 15, maxResultsStaff: 30,
      cacheTtlSeconds: 10800, maxLegsPerSearch: 3, excludeAirlines: [], watchlist: [],
    })
  })

  it("pool shares must add up to one", () => {
    expect(ProviderMetering.safeParse({ poolSplit: { customer: 0.5, prewarm: 0.5, staff: 0.5 } }).success).toBe(false)
    expect(ProviderMetering.safeParse({ poolSplit: { customer: 0.5, prewarm: 0.25, staff: 0.25 } }).success).toBe(true)
  })

  it("the watchlist is data: routes with date offsets", () => {
    const m = ProviderMetering.parse({ watchlist: [{ origin: "VAN", destination: "LHR", dateOffsetsDays: [14, 30] }] })
    expect(m.watchlist[0]).toEqual({ origin: "VAN", destination: "LHR", dateOffsetsDays: [14, 30] })
    expect(ProviderMetering.safeParse({ watchlist: [{ origin: "van", destination: "LHR", dateOffsetsDays: [] }] }).success).toBe(false)
  })

  it("the provider patch accepts metering", () => {
    expect(ProviderPatchBody.parse({ metering: { monthlyBudgetUsd: 20 } }).metering?.monthlyBudgetUsd).toBe(20)
  })
})

describe("indicative offers (ADR-0029 A3, A5)", () => {
  it("the provider id and the INDICATIVE source flag exist", () => {
    expect(ProviderId.parse("apify-google-flights")).toBe("apify-google-flights")
    expect(OfferSource.parse({ provider: "apify-google-flights", providerOfferId: "x", rung: "CACHED_OFFER", fetchedAt: "2026-11-03T10:00:00Z", confidence: "INDICATIVE" }).confidence).toBe("INDICATIVE")
    expect(OfferSource.safeParse({ provider: "duffel", providerOfferId: "x", rung: "LIVE_OFFER", fetchedAt: "2026-11-03T10:00:00Z", confidence: "VERIFIED" }).success).toBe(false)
  })

  it("the customer offer schema has no providerData key at all", () => {
    expect(Object.keys(CustomerOffer.shape)).not.toContain("providerData")
    expect(Object.keys(NormalisedOffer.shape)).toContain("providerData")
  })

  it("price check and recheck shapes", () => {
    expect(PriceCheckResult.shape.outcome.options).toContain("NOT_REVALIDATABLE")
    const money = { amountMinor: 100, currency: "GBP" }
    expect(RecheckResult.parse({ stillListed: true, priceChanged: false, old: money, new: money, fetchedAt: "2026-11-03T10:00:00Z", components: [] }).stillListed).toBe(true)
  })
})
