import type { StayOffer, StaySearchQuery } from "@unitravel/contracts"

import type { CallContext, HealthResult, ProviderEnv } from "../suppliers/adapter"

/**
 * ADR-0015, spec section 4.3: the port for hotel and villa/stay suppliers, modelled on FlightSupplierAdapter. INTERFACE ONLY.
 * No implementation exists and no ProviderId is added until the owner names a contracted provider whose API terms allow
 * serving our customers (O8). Offers carry tri-state facts and no customer amounts (O8b, ADR-0004); listings are never faked.
 * When an adapter is added it runs behind the same gateway as flights (deadlines, circuit breaker, budgets, call records)
 * and its `providers` row has vertical = 'STAY'.
 */
export interface AccommodationCapabilities { search: boolean; price: boolean }

export interface AccommodationSupplierAdapter {
  readonly id: string
  capabilities(env: ProviderEnv): AccommodationCapabilities
  search(q: StaySearchQuery, ctx: CallContext): Promise<StayOffer[]>
  /** Re-checks one offer before a request is created from it; throws SupplierError OFFER_EXPIRED or PRICE_CHANGED. */
  price(offer: { provider: string; providerOfferId: string; offer?: StayOffer }, ctx: CallContext): Promise<StayOffer>
  healthCheck(ctx: CallContext): Promise<HealthResult>
}
