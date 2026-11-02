import type { NormalisedOffer } from "@unitravel/contracts"

import { type CallContext, type Capabilities, type FlightSupplierAdapter, type HealthResult, type ProviderEnv, type SliceQuery, SupplierError } from "../../adapter"
import { ApifyClient } from "./client"

/** What the adapter needs from the flight-data service; the adapter itself never calls Apify inside a search (ADR-0029 A6). */
export interface ApifyLegSource {
  /** Cached offers for the leg, or a `SUPPLIER_PENDING` error after queueing a run that will re-run the search. */
  lookup(q: SliceQuery, ctx: CallContext): Promise<NormalisedOffer[]>
}

/** Google Flights through Apify: indicative schedules and a staff-only price. No repricing, seat map, order or cancel (ADR-0029 A2). */
export class ApifyGoogleFlightsAdapter implements FlightSupplierAdapter {
  readonly id = "apify-google-flights" as const

  constructor(private readonly source: ApifyLegSource) {}

  capabilities(_env: ProviderEnv): Capabilities {
    return { search: true, price: false, seatMap: false, order: false, cancel: false, ancillaries: false, cityCodes: false }
  }

  search(q: SliceQuery, ctx: CallContext) {
    return this.source.lookup(q, ctx)
  }

  async price(): Promise<NormalisedOffer> {
    throw new SupplierError("SUPPLIER_BAD_REQUEST", "Indicative offers cannot be repriced; staff recheck them instead")
  }

  /** `GET /users/me/limits` is free. */
  async healthCheck(ctx: CallContext): Promise<HealthResult> {
    const token = ctx.credentials?.token
    if (!token) throw new SupplierError("SUPPLIER_AUTH", "Apify token not configured")
    const t = Date.now()
    const l = await new ApifyClient(token).limits()
    return { ok: true, latencyMs: Date.now() - t, detail: `Apify usage ${l.monthlyUsageUsd ?? "?"} of ${l.maxMonthlyUsageUsd ?? "?"} USD this cycle` }
  }
}
