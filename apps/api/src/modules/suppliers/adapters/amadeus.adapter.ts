import type { NormalisedOffer } from "@unitravel/contracts"

import { type CallContext, type Capabilities, type FlightSupplierAdapter, type HealthResult, type OfferRef, type SliceQuery, SupplierError } from "../adapter"

/**
 * Amadeus Enterprise (primary GDS, ch. 6.2). BLOCKED: the Enterprise contract, the API catalogue for Uni Travel's
 * office ID (Master Pricer over SOAP or Enterprise REST), sandbox credentials and the read-only Flight Builder
 * discovery are Stage 0 deliverables that have not happened. Until then this adapter declares no capabilities, its
 * health check reports the gap, and every call fails with CONTENT_RESTRICTED so the engine skips it.
 * Implementing the Fare_MasterPricerTravelBoardSearch / informative pricing mapping needs the contract's WSDL.
 */
export class AmadeusEnterpriseAdapter implements FlightSupplierAdapter {
  readonly id = "amadeus-enterprise" as const

  capabilities(): Capabilities {
    return { search: false, price: false, seatMap: false, order: false, cancel: false, ancillaries: false, cityCodes: true }
  }

  async search(_q: SliceQuery, _ctx: CallContext): Promise<NormalisedOffer[]> {
    throw new SupplierError("CONTENT_RESTRICTED", "Amadeus Enterprise contract pending (Stage 0)")
  }

  async price(_o: OfferRef, _ctx: CallContext): Promise<NormalisedOffer> {
    throw new SupplierError("CONTENT_RESTRICTED", "Amadeus Enterprise contract pending (Stage 0)")
  }

  async healthCheck(ctx: CallContext): Promise<HealthResult> {
    return { ok: false, latencyMs: 0, detail: ctx.credentials ? "Credentials stored; adapter awaits the contract's WSDL mapping" : "Not configured: contract and sandbox pending (Stage 0)" }
  }
}

/** Manual inventory: staff-entered quote options only (rung MANUAL). It never searches. */
export class ManualAdapter implements FlightSupplierAdapter {
  readonly id = "manual" as const
  capabilities(): Capabilities {
    return { search: false, price: false, seatMap: false, order: false, cancel: false, ancillaries: false, cityCodes: false }
  }
  async search(): Promise<NormalisedOffer[]> {
    throw new SupplierError("CONTENT_RESTRICTED", "Manual inventory does not search")
  }
  async price(): Promise<NormalisedOffer> {
    throw new SupplierError("CONTENT_RESTRICTED", "Manual options are confirmed by staff, not repriced")
  }
  async healthCheck(): Promise<HealthResult> {
    return { ok: true, latencyMs: 0, detail: "Staff-entered options" }
  }
}
