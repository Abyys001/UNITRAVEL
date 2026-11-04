import type { Cabin, NormalisedOffer } from "@unitravel/contracts"
import { localToUtc, type ReferenceLookup } from "@unitravel/engine"

type Row = Record<string, unknown>
type Segment = NormalisedOffer["slices"][number]["segments"][number]

const CABIN: Record<string, Cabin> = { economy: "ECONOMY", premium_economy: "PREMIUM_ECONOMY", business: "BUSINESS", first: "FIRST" }

export interface NormalisedRows {
  offers: NormalisedOffer[]
  /** Free `notice` rows plus our own remarks about dropped rows; kept on the run for staff. */
  notices: string[]
  errors: string[]
}

/** ADR-0029 A4: identity for revalidation is the flight numbers, the first local departure and the cabin. */
export const identityKey = (flightNumbers: string[], departAt: string, cabinClass: string) => `${flightNumbers.join(",")}|${departAt}|${cabinClass}`

export const minor = (amount: number, currency: string) => Math.round(amount * (currency === "JPY" ? 1 : currency === "KWD" || currency === "OMR" || currency === "BHD" ? 1000 : 100))
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z")

/** "JQ86" with carrier "JQ" → "86"; a flight number without the carrier prefix is kept as given. */
export const numberPart = (flightNumber: string, carrier: string) => (flightNumber.startsWith(carrier) ? flightNumber.slice(carrier.length) : flightNumber.replace(/^[A-Z0-9]{2}(?=\d)/, ""))

/**
 * Apify rows → offers. Brand, baggage, change/refund conditions and seat selection are always UNKNOWN (rule 3, never inferred).
 * Rows without a price, or with an airport we have no time zone for, are not offers; the reason goes to the run notices.
 */
export function normaliseRows(rows: Row[], ctx: { reference: ReferenceLookup; fetchedAt: Date; ttlSeconds: number }): NormalisedRows {
  const out: NormalisedRows = { offers: [], notices: [], errors: [] }
  const seen = new Set<string>()
  for (const r of rows) {
    const type = str(r.type)
    if (type === "notice") { out.notices.push(str(r.message) ?? "notice"); continue }
    if (type === "error") { out.errors.push(str(r.message) ?? "error"); continue }
    if (type !== "flight") continue
    const flightNumbers = Array.isArray(r.flightNumbers) ? (r.flightNumbers as string[]) : []
    const label = `${flightNumbers.join("+") || "?"} ${str(r.departAt) ?? "?"}`
    const price = num(r.price)
    const currency = str(r.currency)
    if (r.priceUnavailable === true || price === undefined || !currency) { out.notices.push(`PRICE_UNAVAILABLE ${label}`); continue }
    const offer = toOffer(r, price, currency, flightNumbers, ctx, out)
    if (!offer) continue
    if (seen.has(offer.source.providerOfferId)) continue
    seen.add(offer.source.providerOfferId)
    out.offers.push(offer)
  }
  return out
}

function toOffer(r: Row, price: number, currency: string, flightNumbers: string[], ctx: { reference: ReferenceLookup; fetchedAt: Date; ttlSeconds: number }, out: NormalisedRows): NormalisedOffer | null {
  const legs = Array.isArray(r.legs) ? (r.legs as Row[]) : []
  const departAt = str(r.departAt)
  const cabinClass = str(r.cabinClass) ?? "economy"
  if (!legs.length || !departAt || !flightNumbers.length) { out.notices.push("MALFORMED_ROW"); return null }
  const segments: Segment[] = []
  for (const leg of legs) {
    const from = str(leg.from)
    const to = str(leg.to)
    const dep = str(leg.departAt)?.slice(0, 16)
    const arr = str(leg.arriveAt)?.slice(0, 16)
    const carrier = str(leg.airlineCode)
    const fn = str(leg.flightNumber)
    if (!from || !to || !dep || !arr || !carrier || !fn) { out.notices.push("MALFORMED_ROW"); return null }
    const fromTz = ctx.reference.airport(from)?.tz
    const toTz = ctx.reference.airport(to)?.tz
    // Google's local times carry no zone; without our airport data the instant is unknown, so the row is dropped (ADR-0029 A4).
    if (!fromTz || !toTz) { out.notices.push(`UNKNOWN_AIRPORT ${!fromTz ? from : to}`); return null }
    const number = numberPart(fn, carrier)
    if (!/^\d{1,4}[A-Z]?$/.test(number)) { out.notices.push(`MALFORMED_ROW ${fn}`); return null }
    segments.push({
      marketing: { carrier, flightNumber: number }, operating: { carrier },
      origin: { iata: from }, destination: { iata: to },
      departure: { local: dep, utc: localToUtc(dep, fromTz), tz: fromTz }, arrival: { local: arr, utc: localToUtc(arr, toTz), tz: toTz },
      cabin: CABIN[cabinClass] ?? "ECONOMY", technicalStops: [],
    })
  }
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const fetchedAt = iso(ctx.fetchedAt)
  const providerData = {
    bookingToken: str(r.bookingToken), googleFlightsUrl: str(r.googleFlightsUrl), priceLevel: str(r.priceLevel),
    typicalPriceLow: num(r.typicalPriceLow), typicalPriceHigh: num(r.typicalPriceHigh),
  }
  return {
    // Always delivered from our own cache, so the rung is CACHED_OFFER with the real fetch time (ch. 22.9).
    source: { provider: "apify-google-flights", providerOfferId: identityKey(flightNumbers, departAt, cabinClass), rung: "CACHED_OFFER", fetchedAt, expiresAt: iso(new Date(ctx.fetchedAt.getTime() + ctx.ttlSeconds * 1000)), fake: false, confidence: "INDICATIVE" },
    slices: [{ origin: first.origin.iata, destination: last.destination.iata, segments, durationMin: Math.round((Date.parse(last.arrival.utc) - Date.parse(first.departure.utc)) / 60000) }],
    price: { total: { amountMinor: minor(price, currency), currency } },
    validatingCarrier: first.marketing.carrier,
    ticketing: "SINGLE_TICKET",
    brand: { status: "UNKNOWN" },
    baggage: segments.map((_, i) => ({ segmentIndex: i, passengerType: "ADT", checked: { status: "UNKNOWN" as const }, cabin: { status: "UNKNOWN" as const } })),
    conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } },
    seatSelection: { status: "UNKNOWN" },
    seatMapAvailable: false,
    restrictions: [],
    providerData: Object.values(providerData).some((v) => v !== undefined) ? providerData : undefined,
  }
}
