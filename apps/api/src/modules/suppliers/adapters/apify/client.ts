import { env, sandboxAllowed } from "../../../../core/env"
import { SupplierError } from "../../adapter"

/** DOCUMENTED: Apify API v2 and the actor README, checked 2 Nov 2026. */
export const APIFY_ACTOR = "lergassy~google-flights-scraper"
/** The provider id of the credential and the ledger rows. */
export const APIFY_PROVIDER_ID = "apify-google-flights" as const
/** ADR-0034: pinned so a silent default change in a new build cannot start billing KAYAK runs. The weekly schema check alerts on drift. */
export const APIFY_ACTOR_BUILD = "0.1.167"
const PRODUCTION_BASE = "https://api.apify.com/v2"
const CALL_TIMEOUT_MS = 15_000

/** ADR-0029 A9: the mock override exists on a developer machine only. */
export const apifyBaseUrl = () => (sandboxAllowed() && env().APIFY_BASE_URL ? env().APIFY_BASE_URL!.replace(/\/$/, "") : PRODUCTION_BASE)

export interface ApifyRoute { origin: string; destination: string; departureDate: string; returnDate?: string }

/**
 * OBSERVED (input schema, build 0.1.167): `kayakWhenGoogleEmpty` defaults to TRUE and starts a separately billed KAYAK actor run.
 * These four are therefore always sent as false by `startRun`, whatever the caller passes (ADR-0034 F2).
 */
export const APIFY_COST_OFF = { kayakWhenGoogleEmpty: false, fillMissingPricesFromKayak: false, resolveBookingOptions: false, resolveReturnFlights: false } as const
export const APIFY_COST_OFF_FIELDS = Object.keys(APIFY_COST_OFF) as (keyof typeof APIFY_COST_OFF)[]

/** Only the documented fields. */
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
  includePriceInsights?: boolean
  includeSearchSummary?: boolean
  includeRunSummary?: boolean
}

/** A field of the actor's input schema, as returned by the build endpoint. */
export interface ApifyBuildInfo { buildNumber: string; fields: Record<string, { default?: unknown }> }

export type ApifyRunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED"
/** `usageTotalUsd` and `chargedEventCounts` are what Apify billed for the run; absent while it is still running. */
export interface ApifyRun { id: string; defaultDatasetId: string; status: ApifyRunStatus; startedAt?: string; usageTotalUsd?: number; chargedEventCounts?: Record<string, number> }
export interface ApifyLimits { cycle: string | null; cycleEnd: string | null; maxMonthlyUsageUsd: number | null; monthlyUsageUsd: number | null }

/**
 * ADR-0034: CI and unit tests must never reach Apify. Under NODE_ENV=test the production host is refused unless a mock base URL
 * was injected or `fetch` itself is a test double (vitest mocks carry a `.mock` property).
 */
const refusedUnderTest = (base: string) => process.env.NODE_ENV === "test" && base === PRODUCTION_BASE && !("mock" in (globalThis.fetch as unknown as object))

/** Thin client over the global `fetch`. The token goes only into the Authorization header and never into an error message. */
export class ApifyClient {
  constructor(private readonly token: string, private readonly base = apifyBaseUrl()) {}

  startRun(input: ApifyInput, maxTotalChargeUsd: number): Promise<ApifyRun> {
    // The actor defaults to 100 rows per route and has no charge cap, so an uncapped run is refused before any request is sent.
    if (!Number.isInteger(input.maxResults) || input.maxResults < 1) return Promise.reject(new SupplierError("SUPPLIER_BAD_REQUEST", "Apify run refused: maxResults missing"))
    if (!(maxTotalChargeUsd > 0)) return Promise.reject(new SupplierError("SUPPLIER_BAD_REQUEST", "Apify run refused: maxTotalChargeUsd missing"))
    const body = { ...input, ...APIFY_COST_OFF, exploreAnywhere: false, calendarDays: 0 }
    return this.call<{ data: ApifyRun }>("POST", `/acts/${APIFY_ACTOR}/runs?build=${APIFY_ACTOR_BUILD}&maxTotalChargeUsd=${maxTotalChargeUsd.toFixed(4)}`, body).then((r) => r.data)
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
    return { cycle: d.monthlyUsageCycle?.startAt ?? null, cycleEnd: d.monthlyUsageCycle?.endAt ?? null, maxMonthlyUsageUsd: d.limits?.maxMonthlyUsageUsd ?? null, monthlyUsageUsd: d.current?.monthlyUsageUsd ?? null }
  }

  /** Free. The default build's input schema, for the weekly drift check. */
  async defaultBuild(): Promise<ApifyBuildInfo> {
    const r = await this.call<{ data: { buildNumber?: string; inputSchema?: string; actorDefinition?: { input?: { properties?: Record<string, { default?: unknown }> } } } }>("GET", `/acts/${APIFY_ACTOR}/builds/default`)
    const d = r.data
    let props = d.actorDefinition?.input?.properties
    if (!props && d.inputSchema) {
      try { props = (JSON.parse(d.inputSchema) as { properties?: Record<string, { default?: unknown }> }).properties } catch { props = undefined }
    }
    return { buildNumber: d.buildNumber ?? "unknown", fields: props ?? {} }
  }

  /** Account-wide hard cap. Owner-triggered only, from the Developer Panel (ADR-0034). */
  async setMonthlyCap(maxMonthlyUsageUsd: number): Promise<void> {
    if (!(maxMonthlyUsageUsd > 0)) throw new SupplierError("SUPPLIER_BAD_REQUEST", "Apify cap must be positive")
    await this.call<unknown>("PUT", "/users/me/limits", { maxMonthlyUsageUsd })
  }

  private async call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    if (refusedUnderTest(this.base)) throw new SupplierError("SUPPLIER_UNAVAILABLE", "Apify is not reachable under NODE_ENV=test: inject a mock base URL")
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
    if (res.ok) return (text ? JSON.parse(text) : {}) as T
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
