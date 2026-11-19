import { env, sandboxAllowed } from "../../../../core/env"
import { SupplierError } from "../../adapter"

/** The provider id of the schedule rows and the ledger rows (ADR-0036). */
export const AVIATION_EDGE_PROVIDER_ID = "aviation-edge" as const
const CALL_TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 2_000
const PRODUCTION_BASE = "https://aviation-edge.com"

/** A developer-machine mock only; deployed hosts always use aviation-edge.com. */
export const aviationEdgeBaseUrl = () => (sandboxAllowed() && env().AVIATION_EDGE_BASE_URL ? env().AVIATION_EDGE_BASE_URL!.replace(/\/$/, "") : PRODUCTION_BASE)

export interface FutureScheduleQuery { iataCode: string; type: "departure"; arrIata?: string; date: string }

/** Same guard as the FlightAPI client: tests never reach the real host unless a mock base URL was injected or `fetch` is a test double. */
const refusedUnderTest = (base: string) => process.env.NODE_ENV === "test" && base === PRODUCTION_BASE && !("mock" in (globalThis.fetch as unknown as object))

const AUTH_TEXT = /api[\s_-]?key|\bkey\b|unauthori[sz]ed|subscription|forbidden|invalid token/i
const LIMIT_TEXT = /limit|quota|exceed|too many/i
const NO_RECORD = /no record found/i

/** Error text of an AE error body, whatever its shape (`{error}`, `{error:{text}}`, `{message}`, a bare string). */
const errorText = (body: unknown): string | null => {
  if (typeof body === "string") return body
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const o = body as Record<string, unknown>
  for (const k of ["error", "message", "Error", "detail", "text"]) {
    const v = o[k]
    if (typeof v === "string") return v
    const nested = errorText(v)
    if (nested) return nested
  }
  return null
}

/**
 * Aviation Edge, DOCUMENTED (ADR-0036). The key is a query parameter, so the URL is never logged, stored or put in an error:
 * every failure is rebuilt from the status code (and a fixed word for a body class) alone.
 * `raw` on a thrown error says whether AE counted the call: "billed" (a 200 with a bad body, or a timeout) or nothing (refused or never reached).
 */
export class AviationEdgeClient {
  constructor(private readonly key: string, private readonly base = aviationEdgeBaseUrl(), private readonly retryDelayMs = RETRY_DELAY_MS) {}

  async futureSchedule(q: FutureScheduleQuery): Promise<unknown[]> {
    if (refusedUnderTest(this.base)) throw new SupplierError("SUPPLIER_UNAVAILABLE", "Aviation Edge is not reachable under NODE_ENV=test: inject a mock base URL")
    const params = new URLSearchParams({ key: this.key, type: q.type, iataCode: q.iataCode })
    if (q.arrIata) params.set("arr_iataCode", q.arrIata)
    params.set("date", q.date)
    const url = `${this.base}/v2/public/flightsFuture?${params.toString()}`
    try {
      return await this.once(url)
    } catch (err) {
      if (!(err instanceof SupplierError) || (err.code !== "SUPPLIER_TIMEOUT" && err.code !== "SUPPLIER_UNAVAILABLE")) throw err
      await new Promise((r) => setTimeout(r, this.retryDelayMs))
      return this.once(url)
    }
  }

  private async once(url: string): Promise<unknown[]> {
    let res: Response
    try {
      res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(CALL_TIMEOUT_MS), headers: { accept: "application/json" } })
    } catch (err) {
      // Node's fetch errors can carry the URL in their cause; only the error name is kept.
      if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") throw new SupplierError("SUPPLIER_TIMEOUT", "Aviation Edge did not answer in time", "billed")
      throw new SupplierError("SUPPLIER_UNAVAILABLE", `Aviation Edge unreachable: ${(err as Error).name}`)
    }
    let text: string
    try { text = await res.text() } catch { throw new SupplierError("SUPPLIER_UNAVAILABLE", `Aviation Edge ${res.status}`) }
    let body: unknown
    let json = true
    try { body = JSON.parse(text) } catch { json = false }
    const msg = json ? errorText(body) : null

    if (res.status === 401 || res.status === 403) throw new SupplierError("SUPPLIER_AUTH", `Aviation Edge ${res.status}`)
    if (res.status === 429) throw new SupplierError("SUPPLIER_RATE_LIMITED", "Aviation Edge 429", "429")
    if (res.status >= 500 || res.status === 408) throw new SupplierError("SUPPLIER_UNAVAILABLE", `Aviation Edge ${res.status}`)
    if (!res.ok) {
      if (msg && NO_RECORD.test(msg)) return []
      if (msg && AUTH_TEXT.test(msg) && !LIMIT_TEXT.test(msg)) throw new SupplierError("SUPPLIER_AUTH", `Aviation Edge ${res.status}`)
      if (msg && LIMIT_TEXT.test(msg)) throw new SupplierError("SUPPLIER_RATE_LIMITED", `Aviation Edge ${res.status}`, "quota")
      throw new SupplierError("SUPPLIER_BAD_REQUEST", `Aviation Edge ${res.status}`)
    }
    if (!json) {
      if (NO_RECORD.test(text)) return []
      throw new SupplierError("SUPPLIER_UNKNOWN", "Aviation Edge answered with invalid JSON", "billed")
    }
    if (Array.isArray(body)) return body
    if (msg !== null) {
      if (NO_RECORD.test(msg)) return []
      if (LIMIT_TEXT.test(msg)) throw new SupplierError("SUPPLIER_RATE_LIMITED", "Aviation Edge reported a limit", "quota")
      if (AUTH_TEXT.test(msg)) throw new SupplierError("SUPPLIER_AUTH", "Aviation Edge rejected the key")
    }
    throw new SupplierError("SUPPLIER_UNKNOWN", "Aviation Edge answered with something other than a list", "billed")
  }
}
