import type { Cabin, NormalisedOffer } from "@unitravel/contracts"
import { localToUtc, type ReferenceLookup } from "@unitravel/engine"

import { identityKey, minor, type NormalisedRows, numberPart } from "../apify/normalise"
import { FLIGHTAPI_PROVIDER_ID } from "./client"

type Row = Record<string, unknown>
type Segment = NormalisedOffer["slices"][number]["segments"][number]

const CABIN_KEY: Record<Cabin, string> = { ECONOMY: "economy", PREMIUM_ECONOMY: "premium_economy", BUSINESS: "business", FIRST: "first" }

const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z")
const by = (list: Row[]) => new Map(list.map((r) => [r.id as string | number, r]))

export interface FlightapiContext {
  reference: ReferenceLookup
  fetchedAt: Date
  ttlSeconds: number
  /** The request: the response carries neither currency nor cabin. */
  currency: string
  cabin: Cabin
  /** The slot's route and date: anything else the response lists is not this slot's. */
  from: string
  to: string
  date: string
  /** The route's `maxResults`: how many of the cheapest itineraries are kept. */
  maxResults: number
}

/**
 * FlightAPI one-way response (Skyscanner shape) → offers, mirroring the Apify normaliser: brand, baggage, conditions and seat selection are
 * UNKNOWN (rule 3), the instant comes from our airport zones, and the identity key is the flight numbers + first local departure + cabin.
 * The price is the cheapest pricing option. Self-transfer itineraries are dropped (our own joiner builds those). Cheapest first, shorter first on a tie.
 */
export function normaliseResponse(raw: unknown, ctx: FlightapiContext): NormalisedRows {
  const out: NormalisedRows = { offers: [], notices: [], errors: [] }
  const doc = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const legs = by(rows(doc.legs))
  const segs = by(rows(doc.segments))
  const places = by(rows(doc.places))
  const carriers = by(rows(doc.carriers))
  const iata = (m: Map<string | number, Row>, id: unknown) => str(m.get(id as string | number)?.display_code)
  let selfTransfer = 0
  const best = new Map<string, NormalisedOffer>()
  for (const it of rows(doc.itineraries)) {
    const legIds = Array.isArray(it.leg_ids) ? (it.leg_ids as string[]) : []
    const leg = legIds.length === 1 ? legs.get(legIds[0]!) : undefined
    if (!leg) { out.notices.push("MALFORMED_ROW"); continue }
    if (leg.self_transfer === true) { selfTransfer++; continue }
    const amounts = rows(it.pricing_options).map((p) => num((p.price as Row | undefined)?.amount)).filter((a): a is number => a !== undefined && a > 0)
    if (!amounts.length) { out.notices.push("PRICE_UNAVAILABLE"); continue }
    const offer = toOffer(leg, Math.min(...amounts), segs, places, carriers, iata, ctx, out)
    if (!offer) continue
    const prev = best.get(offer.source.providerOfferId)
    if (!prev || offer.price.total.amountMinor < prev.price.total.amountMinor) best.set(offer.source.providerOfferId, offer)
  }
  if (selfTransfer) out.notices.push(`SELF_TRANSFER_DROPPED ${selfTransfer}`)
  out.offers = [...best.values()].sort((a, b) => a.price.total.amountMinor - b.price.total.amountMinor || a.slices[0]!.durationMin - b.slices[0]!.durationMin).slice(0, ctx.maxResults)
  return out
}

function toOffer(leg: Row, price: number, segs: Map<string | number, Row>, places: Map<string | number, Row>, carriers: Map<string | number, Row>, iata: (m: Map<string | number, Row>, id: unknown) => string | undefined, ctx: FlightapiContext, out: NormalisedRows): NormalisedOffer | null {
  const segmentIds = Array.isArray(leg.segment_ids) ? (leg.segment_ids as string[]) : []
  if (!segmentIds.length) { out.notices.push("MALFORMED_ROW"); return null }
  const segments: Segment[] = []
  const flightNumbers: string[] = []
  for (const id of segmentIds) {
    const s = segs.get(id)
    const from = s && iata(places, s.origin_place_id)
    const to = s && iata(places, s.destination_place_id)
    const carrier = s && iata(carriers, s.marketing_carrier_id)
    const operating = (s && iata(carriers, s.operating_carrier_id)) ?? carrier
    const dep = str(s?.departure)?.slice(0, 16)
    const arr = str(s?.arrival)?.slice(0, 16)
    const fn = s && (typeof s.marketing_flight_number === "string" || typeof s.marketing_flight_number === "number") ? String(s.marketing_flight_number) : undefined
    if (!s || !from || !to || !carrier || !operating || !dep || !arr || !fn) { out.notices.push("MALFORMED_ROW"); return null }
    const fromTz = ctx.reference.airport(from)?.tz
    const toTz = ctx.reference.airport(to)?.tz
    // Local times carry no zone; without our airport data the instant is unknown, so the itinerary is dropped (as ADR-0029 A4 does for Apify).
    if (!fromTz || !toTz) { out.notices.push(`UNKNOWN_AIRPORT ${!fromTz ? from : to}`); return null }
    const number = /^\d/.test(fn) ? fn : numberPart(fn, carrier)
    if (!/^\d{1,4}[A-Z]?$/.test(number)) { out.notices.push(`MALFORMED_ROW ${carrier}${fn}`); return null }
    flightNumbers.push(`${carrier}${number}`)
    segments.push({
      marketing: { carrier, flightNumber: number }, operating: { carrier: operating },
      origin: { iata: from }, destination: { iata: to },
      departure: { local: dep, utc: localToUtc(dep, fromTz), tz: fromTz }, arrival: { local: arr, utc: localToUtc(arr, toTz), tz: toTz },
      cabin: ctx.cabin, technicalStops: [],
    })
  }
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  if (first.origin.iata !== ctx.from || last.destination.iata !== ctx.to || first.departure.local.slice(0, 10) !== ctx.date) {
    out.notices.push(`UNREQUESTED_ROUTE ${first.origin.iata}-${last.destination.iata} ${first.departure.local.slice(0, 10)}`)
    return null
  }
  const fetchedAt = iso(ctx.fetchedAt)
  return {
    source: { provider: FLIGHTAPI_PROVIDER_ID, providerOfferId: identityKey(flightNumbers, first.departure.local, CABIN_KEY[ctx.cabin]), rung: "CACHED_OFFER", fetchedAt, expiresAt: iso(new Date(ctx.fetchedAt.getTime() + ctx.ttlSeconds * 1000)), fake: false, confidence: "INDICATIVE" },
    slices: [{ origin: first.origin.iata, destination: last.destination.iata, segments, durationMin: Math.round((Date.parse(last.arrival.utc) - Date.parse(first.departure.utc)) / 60000) }],
    price: { total: { amountMinor: minor(price, ctx.currency), currency: ctx.currency } },
    validatingCarrier: first.marketing.carrier,
    ticketing: "SINGLE_TICKET",
    brand: { status: "UNKNOWN" },
    baggage: segments.map((_, i) => ({ segmentIndex: i, passengerType: "ADT", checked: { status: "UNKNOWN" as const }, cabin: { status: "UNKNOWN" as const } })),
    conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } },
    seatSelection: { status: "UNKNOWN" },
    seatMapAvailable: false,
    restrictions: [],
  }
}
