import type { GroundOffer, GroundSearchQuery } from "@unitravel/contracts"

import type { CallContext, HealthResult, ProviderEnv } from "../suppliers/adapter"

/**
 * ADR-0015, spec section 4.3: the port for train and bus suppliers (vertical RAIL or BUS), modelled on
 * FlightSupplierAdapter. INTERFACE ONLY; see the notes on AccommodationSupplierAdapter. Offers carry tri-state facts and no
 * customer amounts (O8b).
 */
export interface GroundCapabilities { search: boolean; price: boolean }

export interface GroundSupplierAdapter {
  readonly id: string
  /** Which providers.vertical value this adapter serves. */
  readonly vertical: "RAIL" | "BUS"
  capabilities(env: ProviderEnv): GroundCapabilities
  search(q: GroundSearchQuery, ctx: CallContext): Promise<GroundOffer[]>
  /** Re-checks one offer before a request is created from it; throws SupplierError OFFER_EXPIRED or PRICE_CHANGED. */
  price(offer: { provider: string; providerOfferId: string; offer?: GroundOffer }, ctx: CallContext): Promise<GroundOffer>
  healthCheck(ctx: CallContext): Promise<HealthResult>
}
