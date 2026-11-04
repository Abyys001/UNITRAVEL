import type { CatalogSearchResponse, CatalogSearchQuery, PublicItineraryDetail } from "@unitravel/contracts"
import type { SearchParamsShape } from "@/components/search-form"

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4100"

/**
 * ADR-0034: the catalog is read from stored snapshots only. The API's ETag/Cache-Control govern the edge; here Next keeps
 * the page data for 5 minutes and drops it early when the API calls /api/revalidate with the `catalog` tag.
 * `null` means the catalog could not be read, which the page shows as UNAVAILABLE (the old NO_SOURCES case), never as empty.
 */
export async function fetchCatalogSearch(q: Pick<CatalogSearchQuery, "from" | "to" | "date" | "flex" | "cabin" | "adults">): Promise<CatalogSearchResponse | null> {
  const qs = new URLSearchParams({ from: q.from, to: q.to, date: q.date, flex: String(q.flex), cabin: q.cabin, adults: String(q.adults) })
  try {
    const res = await fetch(`${API}/v1/flights/search?${qs}`, { next: { revalidate: 300, tags: ["catalog"] }, headers: { accept: "application/json" } })
    return res.ok ? ((await res.json()) as CatalogSearchResponse) : null
  } catch {
    return null
  }
}

/** `undefined` = no such result (404); `null` = the catalog could not be read. */
export async function fetchCatalogResult(id: string): Promise<PublicItineraryDetail | null | undefined> {
  try {
    const res = await fetch(`${API}/v1/flights/results/${encodeURIComponent(id)}`, { next: { revalidate: 300, tags: ["catalog", `result:${id}`] }, headers: { accept: "application/json" } })
    if (res.status === 404) return undefined
    return res.ok ? ((await res.json()) as PublicItineraryDetail) : null
  } catch {
    return null
  }
}

const CODE = /^[A-Z]{3}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CABINS = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const

/** The default search shape the request flow expects (same preferences as the /flights popular cards). */
export function defaultShape(from: string, to: string, date: string): SearchParamsShape {
  return {
    trip: "ONE_WAY", from: { kind: "AIRPORT", code: from, label: from }, to: { kind: "AIRPORT", code: to, label: to }, date, adt: 1, chd: [], inf: 0, cabin: "ECONOMY",
    flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360],
  }
}

/** Reads the search URL: the form's `?q=` blob, or plain `from`/`to`/`date`/`flex`. Returns null if the route or date is unusable. */
export function shapeFromParams(sp: Record<string, string | string[] | undefined>): SearchParamsShape | null {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k])
  const q = one("q")
  if (q) {
    try {
      const p = JSON.parse(Buffer.from(decodeURIComponent(q), "base64").toString("utf8")) as SearchParamsShape
      if (CODE.test(p.from?.code) && CODE.test(p.to?.code) && DAY.test(p.date)) return p
    } catch { /* fall through to plain params */ }
    return null
  }
  const from = one("from")?.toUpperCase()
  const to = one("to")?.toUpperCase()
  const date = one("date")
  if (!from || !to || !date || !CODE.test(from) || !CODE.test(to) || !DAY.test(date)) return null
  const shape = defaultShape(from, to, date)
  const flex = Number(one("flex") ?? 0)
  return { ...shape, flex: flex > 0 }
}

export const catalogQueryOf = (s: SearchParamsShape): Pick<CatalogSearchQuery, "from" | "to" | "date" | "flex" | "cabin" | "adults"> => ({
  from: s.from.code, to: s.to.code, date: s.date, flex: s.flex ? 3 : 0,
  cabin: (CABINS as readonly string[]).includes(s.cabin) ? (s.cabin.toLowerCase() as CatalogSearchQuery["cabin"]) : "economy",
  adults: Math.min(9, Math.max(1, s.adt)),
})
