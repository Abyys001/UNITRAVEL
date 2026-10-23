import type { NormalisedOffer, ProviderId, SeatMap } from "@unitravel/contracts"
import type { ReferenceLookup } from "@unitravel/engine"

export type ProviderEnv = "test" | "production"

export interface Capabilities { search: boolean; price: boolean; seatMap: boolean; order: boolean; cancel: boolean; ancillaries: boolean; cityCodes: boolean }

export interface SliceQuery {
  slices: { origin: string; destination: string; date: string }[]
  passengers: { type: string; age?: number }[]
  cabin: string
  maxConnections: number
}

export interface OfferRef { provider: ProviderId; providerOfferId: string; offer?: NormalisedOffer }

export interface CallContext {
  requestId: string
  /** Absolute deadline, not a per-call timeout (ch. 21.5). */
  deadline: Date
  pointOfSale: { country: string; currency: string }
  reference: ReferenceLookup
  credentials: Record<string, string> | null
  environment: ProviderEnv
  signal: AbortSignal
}

// Chapter 21.6 — error taxonomy.
export type SupplierErrorCode =
  | "SUPPLIER_TIMEOUT" | "SUPPLIER_UNAVAILABLE" | "SUPPLIER_AUTH" | "SUPPLIER_RATE_LIMITED" | "SUPPLIER_BAD_REQUEST" | "NO_AVAILABILITY"
  | "OFFER_EXPIRED" | "PRICE_CHANGED" | "CONTENT_RESTRICTED" | "SUPPLIER_UNKNOWN"

export class SupplierError extends Error {
  constructor(readonly code: SupplierErrorCode, message: string, readonly raw?: string) { super(message) }
  get retryable() { return this.code === "SUPPLIER_TIMEOUT" || this.code === "SUPPLIER_UNAVAILABLE" }
}

export interface CallMeta { durationMs: number; sizeBytes?: number; rawRequest?: unknown; rawResponse?: unknown }

export type SupplierResult<T> = { ok: true; value: T; meta: CallMeta } | { ok: false; error: SupplierError; meta: CallMeta }

export interface HealthResult { ok: boolean; latencyMs: number; detail: string }

/** Chapter 21.2 — every flight provider sits behind this interface and speaks the normalised model. */
export interface FlightSupplierAdapter {
  readonly id: ProviderId
  capabilities(env: ProviderEnv): Capabilities
  search(q: SliceQuery, ctx: CallContext): Promise<NormalisedOffer[]>
  price(offer: OfferRef, ctx: CallContext): Promise<NormalisedOffer>
  seatMap?(offer: OfferRef, ctx: CallContext): Promise<SeatMap[]>
  healthCheck(ctx: CallContext): Promise<HealthResult>
}

export const ADAPTERS = Symbol("FLIGHT_ADAPTERS")
