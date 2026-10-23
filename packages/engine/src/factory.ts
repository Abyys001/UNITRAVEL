import type { Cabin, NormalisedOffer, ProviderId, Rung, Segment, SegmentBaggage, Tri } from "@unitravel/contracts"

/** Offset in minutes of `tz` at the given UTC instant, using the platform's IANA database (no I/O). */
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return Math.round((asUtc - utcMs) / 60000)
}

/** Local wall time at an airport ('2026-11-14T07:10') → UTC ISO string. Handles DST by re-checking the offset. */
export function localToUtc(local: string, tz: string): string {
  const naive = Date.parse(`${local}:00Z`)
  let utc = naive - tzOffsetMinutes(tz, naive) * 60000
  utc = naive - tzOffsetMinutes(tz, utc) * 60000
  return new Date(utc).toISOString().replace(".000Z", "Z")
}

export function utcToLocal(utcIso: string, tz: string): string {
  const ms = Date.parse(utcIso)
  return new Date(ms + tzOffsetMinutes(tz, ms) * 60000).toISOString().slice(0, 16)
}

export interface SegmentSpec {
  carrier: string
  number: string
  operating?: string
  from: string
  to: string
  dep: string
  arr: string
  fromTz: string
  toTz: string
  cabin?: Cabin
  terminals?: [string | undefined, string | undefined]
  aircraft?: string
  bookingClass?: string
  fareBasis?: string
}

export function makeSegment(s: SegmentSpec): Segment {
  return {
    marketing: { carrier: s.carrier, flightNumber: s.number },
    operating: { carrier: s.operating ?? s.carrier, flightNumber: s.number },
    origin: { iata: s.from, terminal: s.terminals?.[0] },
    destination: { iata: s.to, terminal: s.terminals?.[1] },
    departure: { local: s.dep, utc: localToUtc(s.dep, s.fromTz), tz: s.fromTz },
    arrival: { local: s.arr, utc: localToUtc(s.arr, s.toTz), tz: s.toTz },
    cabin: s.cabin ?? "ECONOMY",
    bookingClass: s.bookingClass,
    fareBasis: s.fareBasis,
    aircraft: s.aircraft,
    technicalStops: [],
  }
}

export interface OfferSpec {
  provider: ProviderId
  id: string
  slices: SegmentSpec[][]
  totalMinor: number
  currency?: string
  rung?: Rung
  fetchedAt: string
  expiresAt?: string
  fake?: boolean
  checkedBags?: Tri<{ pieces?: number; kgPerPiece?: number }>
  brand?: string
  change?: Tri<{ allowed: boolean }>
  refund?: Tri<{ allowed: boolean }>
  seatMapAvailable?: boolean
}

export function makeOffer(o: OfferSpec): NormalisedOffer {
  const slices = o.slices.map((segs) => {
    const segments = segs.map(makeSegment)
    return {
      origin: segments[0]!.origin.iata,
      destination: segments[segments.length - 1]!.destination.iata,
      segments,
      durationMin: Math.round((Date.parse(segments[segments.length - 1]!.arrival.utc) - Date.parse(segments[0]!.departure.utc)) / 60000),
    }
  })
  const total = slices.reduce((n, s) => n + s.segments.length, 0)
  const baggage: SegmentBaggage[] = Array.from({ length: total }, (_, i) => ({ segmentIndex: i, passengerType: "ADT", checked: o.checkedBags ?? { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" } }))
  return {
    source: { provider: o.provider, providerOfferId: o.id, rung: o.rung ?? "LIVE_OFFER", fetchedAt: o.fetchedAt, expiresAt: o.expiresAt, fake: o.fake ?? o.provider === "fake" },
    slices,
    price: { total: { amountMinor: o.totalMinor, currency: o.currency ?? "GBP" } },
    validatingCarrier: o.slices[0]![0]!.carrier,
    ticketing: "SINGLE_TICKET",
    brand: o.brand ? { status: "KNOWN", value: { name: o.brand } } : { status: "UNKNOWN" },
    baggage,
    conditions: { change: o.change ?? { status: "UNKNOWN" }, refund: o.refund ?? { status: "UNKNOWN" } },
    seatSelection: { status: "UNKNOWN" },
    seatMapAvailable: o.seatMapAvailable ?? false,
    restrictions: [],
  }
}
