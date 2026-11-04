import { env, sandboxAllowed } from "../../../../core/env"
import { SupplierError } from "../../adapter"

/** The provider id of the offers and the ledger rows (ADR-0035). */
export const FLIGHTAPI_PROVIDER_ID = "flightapi" as const
/** OBSERVED 4 Nov 2026: one one-way call is synchronous and takes 30-60 s. */
const CALL_TIMEOUT_MS = 90_000
const PRODUCTION_BASE = "https://api.flightapi.io"

/** A developer-machine mock only; deployed hosts always use api.flightapi.io. */
export const flightapiBaseUrl = () => (sandboxAllowed() && env().FLIGHTAPI_BASE_URL ? env().FLIGHTAPI_BASE_URL!.replace(/\/$/, "") : PRODUCTION_BASE)

export type FlightapiCabin = "Economy" | "Business" | "First" | "Premium_Economy"

export interface FlightapiQuery { from: string; to: string; date: string; adults: number; children: number; infants: number; cabin: FlightapiCabin; currency: string }

/** Same guard as the Apify client: tests never reach the real host unless a mock base URL was injected or `fetch` is a test double. */
const refusedUnderTest = (base: string) => process.env.NODE_ENV === "test" && base === PRODUCTION_BASE && !("mock" in (globalThis.fetch as unknown as object))

/**
 * FlightAPI.io, DOCUMENTED + OBSERVED. The key is a URL path segment, so the URL is never logged, stored or put in an error message:
 * every failure is rebuilt from the status code alone.
 */
export class FlightapiClient {
  constructor(private readonly key: string, private readonly base = flightapiBaseUrl()) {}

  async onewayTrip(q: FlightapiQuery): Promise<unknown> {
    if (refusedUnderTest(this.base)) throw new SupplierError("SUPPLIER_UNAVAILABLE", "FlightAPI is not reachable under NODE_ENV=test: inject a mock base URL")
    const seg = [q.from, q.to, q.date, q.adults, q.children, q.infants, q.cabin, q.currency].map((p) => encodeURIComponent(String(p))).join("/")
    let res: Response
    try {
      res = await fetch(`${this.base}/onewaytrip/${encodeURIComponent(this.key)}/${seg}`, { method: "GET", signal: AbortSignal.timeout(CALL_TIMEOUT_MS), headers: { accept: "application/json" } })
    } catch (err) {
      // Node's fetch errors can carry the URL in their cause; only the error name is kept.
      if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") throw new SupplierError("SUPPLIER_TIMEOUT", "FlightAPI did not answer in time")
      throw new SupplierError("SUPPLIER_UNAVAILABLE", `FlightAPI unreachable: ${(err as Error).name}`)
    }
    if (res.ok) {
      try { return JSON.parse(await res.text()) } catch { throw new SupplierError("SUPPLIER_UNKNOWN", "FlightAPI answered with invalid JSON") }
    }
    await res.body?.cancel().catch(() => undefined)
    // `raw` feeds the pacer's failure matrix: 402 reads as credits exhausted (pause until the allowance resets), 429 as a rate limit that passes.
    if (res.status === 401 || res.status === 403) throw new SupplierError("SUPPLIER_AUTH", `FlightAPI ${res.status}`)
    if (res.status === 402) throw new SupplierError("SUPPLIER_RATE_LIMITED", "FlightAPI 402: credits exhausted", "payment")
    if (res.status === 429) throw new SupplierError("SUPPLIER_RATE_LIMITED", "FlightAPI 429", "429")
    if (res.status === 404 || res.status === 400 || res.status === 422) throw new SupplierError("SUPPLIER_BAD_REQUEST", `FlightAPI ${res.status}`)
    if (res.status >= 500 || res.status === 408) throw new SupplierError("SUPPLIER_UNAVAILABLE", `FlightAPI ${res.status}`)
    throw new SupplierError("SUPPLIER_UNKNOWN", `FlightAPI ${res.status}`)
  }
}
