import type { PublicItinerary } from "@unitravel/contracts"

/** Pure filter, sort and paginate helpers for the flight results list (ADR-0041 D3). Client-side over the stored-snapshot response; no price exists to filter on. */

export const PAGE_SIZE = 10

export const STOPS = ["any", "direct", "max1"] as const
export const WINDOWS = ["night", "morning", "afternoon", "evening"] as const
export const SORTS = ["departure", "arrival", "duration"] as const
export type StopsFilter = (typeof STOPS)[number]
export type DepWindow = (typeof WINDOWS)[number]
export type SortKey = (typeof SORTS)[number]

export interface ResultFilters { stops: StopsFilter; airline: string; dep: "" | DepWindow; sort: SortKey }
export const DEFAULT_FILTERS: ResultFilters = { stops: "any", airline: "", dep: "", sort: "departure" }

const oneOf = <T extends string>(list: readonly T[], v: string | null | undefined, fallback: T): T => (list as readonly string[]).includes(v ?? "") ? (v as T) : fallback

/** Reads filters from URL params; unknown values fall back to the default instead of failing. */
export function filtersFromParams(get: (k: string) => string | null): ResultFilters {
  return {
    stops: oneOf(STOPS, get("stops"), "any"),
    airline: /^[A-Z0-9]{2,3}$/.test(get("airline") ?? "") ? get("airline")! : "",
    dep: oneOf(["", ...WINDOWS] as const, get("dep"), ""),
    sort: oneOf(SORTS, get("sort"), "departure"),
  }
}

export const activeFilterCount = (f: ResultFilters) => Number(f.stops !== "any") + Number(f.airline !== "") + Number(f.dep !== "")

/** Airport-local hour of departure ("YYYY-MM-DDTHH:mm"). */
const hourOf = (local: string) => Number(local.slice(11, 13))

export function windowOf(local: string): DepWindow {
  const h = hourOf(local)
  return h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"
}

export function applyFilters(results: PublicItinerary[], f: ResultFilters): PublicItinerary[] {
  return results.filter((r) =>
    (f.stops === "any" || (f.stops === "direct" ? r.stops === 0 : r.stops <= 1)) &&
    (f.airline === "" || r.carriers.includes(f.airline)) &&
    (f.dep === "" || windowOf(r.departLocal) === f.dep))
}

const asUtc = (local: string) => Date.parse(`${local.slice(0, 16)}:00Z`)

/**
 * Arrival sorts on departure-local plus elapsed minutes: the response has no UTC instant, and for one route the origin's
 * offset is the same for every result, so the order is right even though the value is not a true instant.
 */
const arrivalKey = (r: PublicItinerary) => asUtc(r.departLocal) + r.durationMin * 60_000

export function sortResults(results: PublicItinerary[], sort: SortKey): PublicItinerary[] {
  const key = sort === "arrival" ? arrivalKey : sort === "duration" ? (r: PublicItinerary) => r.durationMin : (r: PublicItinerary) => asUtc(r.departLocal)
  return results.map((r, i) => [r, i] as const).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(([r]) => r)
}

/** Airlines present in the results with the number of flights each operates on, most flights first. */
export function airlineOptions(results: PublicItinerary[]): { code: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const r of results) for (const c of new Set(r.carriers)) counts.set(c, (counts.get(c) ?? 0) + 1)
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size))
/** An out-of-range or non-numeric `p` clamps into 1..pages. */
export const clampPage = (p: unknown, pages: number) => Math.min(Math.max(Number.parseInt(String(p ?? ""), 10) || 1, 1), pages)

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; from: number; to: number; total: number } {
  const pages = pageCount(items.length, size)
  const p = clampPage(page, pages)
  const start = (p - 1) * size
  const slice = items.slice(start, start + size)
  return { items: slice, page: p, pages, from: items.length ? start + 1 : 0, to: start + slice.length, total: items.length }
}

/** Numbered page list with ellipses: first, last, and the current page with one neighbour each side. */
export function pageItems(current: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const keep = new Set([1, pages, current - 1, current, current + 1].filter((n) => n >= 1 && n <= pages))
  const out: (number | "gap")[] = []
  let prev = 0
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev === 2) out.push(prev + 1)
    else if (n - prev > 2) out.push("gap")
    out.push(n)
    prev = n
  }
  return out
}
