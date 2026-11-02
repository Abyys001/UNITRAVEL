import { env, sandboxAllowed } from "../../../../core/env"
import { SupplierError } from "../../adapter"

/** DOCUMENTED: Apify API v2 and the actor README, checked 2 Nov 2026. */
export const APIFY_ACTOR = "lergassy~google-flights-scraper"
const PRODUCTION_BASE = "https://api.apify.com/v2"
const CALL_TIMEOUT_MS = 15_000

/** ADR-0029 A9: the mock override exists on a developer machine only. */
export const apifyBaseUrl = () => (sandboxAllowed() && env().APIFY_BASE_URL ? env().APIFY_BASE_URL!.replace(/\/$/, "") : PRODUCTION_BASE)

export interface ApifyRoute { origin: string; destination: string; departureDate: string; returnDate?: string }

/** Only the documented fields. KAYAK fallback, booking options and return resolution are left at their defaults, which are off. */
export interface ApifyInput {
  routes: ApifyRoute[]
  maxResults: number
  sortBy: "best"
  currency: string
  market?: string
  adults: number
  children: number
  infantsInSeat: number
  infantsOnLap: number
  cabinClass: "economy" | "premium_economy" | "business" | "first"
  maxStops: "any" | 0 | 1 | 2
  excludeAirlines?: string[]
}

export type ApifyRunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED"
export interface ApifyRun { id: string; defaultDatasetId: string; status: ApifyRunStatus }
export interface ApifyLimits { cycle: string | null; maxMonthlyUsageUsd: number | null; monthlyUsageUsd: number | null }

/** Thin client over the global `fetch`. The token goes only into the Authorization header and never into an error message. */
export class ApifyClient {
  constructor(private readonly token: string, private readonly base = apifyBaseUrl()) {}

  startRun(input: ApifyInput, maxTotalChargeUsd: number): Promise<ApifyRun> {
    return this.call<{ data: ApifyRun }>("POST", `/acts/${APIFY_ACTOR}/runs?maxTotalChargeUsd=${maxTotalChargeUsd.toFixed(4)}`, input).then((r) => r.data)
  }

  runStatus(runId: string): Promise<ApifyRun> {
    return this.call<{ data: ApifyRun }>("GET", `/actor-runs/${encodeURIComponent(runId)}`).then((r) => r.data)
  }

  items(datasetId: string): Promise<Record<string, unknown>[]> {
    return this.call<Record<string, unknown>[]>("GET", `/datasets/${encodeURIComponent(datasetId)}/items?clean=1`)
  }

  /** Free; used for the health check, the usage view and the daily reconciliation. */
  async limits(): Promise<ApifyLimits> {
    const r = await this.call<{ data: { monthlyUsageCycle?: { startAt?: string; endAt?: string }; limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number } } }>("GET", "/users/me/limits")
    const d = r.data
    return { cycle: d.monthlyUsageCycle?.startAt ?? null, maxMonthlyUsageUsd: d.limits?.maxMonthlyUsageUsd ?? null, monthlyUsageUsd: d.current?.monthlyUsageUsd ?? null }
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.base}${path}`, {
        method, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") throw new SupplierError("SUPPLIER_TIMEOUT", "Apify did not answer in time")
      throw new SupplierError("SUPPLIER_UNAVAILABLE", `Apify unreachable: ${(err as Error).name}`)
    }
    const text = await res.text()
    if (res.ok) return JSON.parse(text) as T
    const type = (() => {
      try { return (JSON.parse(text) as { error?: { type?: string } }).error?.type } catch { return undefined }
    })()
    if (res.status === 401 || res.status === 403) throw new SupplierError("SUPPLIER_AUTH", `Apify ${res.status}`, type)
    if (res.status === 402 || res.status === 429) throw new SupplierError("SUPPLIER_RATE_LIMITED", `Apify ${res.status}`, type)
    if (res.status === 404) throw new SupplierError("SUPPLIER_BAD_REQUEST", "Apify run or dataset not found", type)
    if (res.status >= 500 || res.status === 408) throw new SupplierError("SUPPLIER_UNAVAILABLE", `Apify ${res.status}`, type)
    if (res.status === 400 || res.status === 422) throw new SupplierError("SUPPLIER_BAD_REQUEST", `Apify ${res.status}: ${type ?? "invalid input"}`, type)
    throw new SupplierError("SUPPLIER_UNKNOWN", `Apify ${res.status}`, type)
  }
}
