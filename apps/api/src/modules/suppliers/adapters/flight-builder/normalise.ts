import { type CapturedBaggage, type CapturedCondition, type FareType, type FlightBuilderCaptureInput, NormalisedOffer, type Segment } from "@unitravel/contracts"
import { localToUtc, type ReferenceLookup } from "@unitravel/engine"

export const FLIGHT_BUILDER_PROVIDER_ID = "flight-builder"

/** A capture the panel data cannot be trusted to describe (unknown airport, impossible times). Never filled in, always sent back to staff. */
export class FlightBuilderInputError extends Error {
  constructor(readonly path: string, message: string) { super(message) }
}

export interface FareRow {
  position: number
  cabin: string
  bookingClasses: string[]
  seatsRaw: string[]
  fareBasis: string[]
  fareType: FareType
  fareTypeRaw: string | null
  baseMinor: number | null
  taxesMinor: number | null
  totalMinor: number
  currency: string
  baggage: CapturedBaggage[]
  conditions: { change: CapturedCondition; refund: CapturedCondition; rulesText?: string; confirmedBy: string; confirmedAt: string }
  ticketingDeadline: string | null
}

export interface NormalisedCapture { offer: NormalisedOffer; fares: FareRow[]; identityKey: string }

export interface NormaliseContext {
  reference: ReferenceLookup
  /** The staff member who confirmed the conditions, and when. */
  confirmedBy: string
  now: Date
}

/** `fb:{flight numbers}:{first departure date}`: staff re-entering the same flight updates the row instead of adding one. */
export function identityOf(input: Pick<FlightBuilderCaptureInput, "segments">): string {
  const numbers = input.segments.map((s) => `${s.carrier}${s.flightNumber}`).join(",")
  return `fb:${numbers}:${input.segments[0]!.departLocal.slice(0, 10)}`
}

const minutes = (fromUtc: string, toUtc: string) => Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 60_000)

/**
 * ADR-0037: staff-typed panel data → the normalised offer and its per-class fare rows. Pure: no provider is called and nothing is fetched.
 * Time zones come from the reference data; a zone the staff member typed must agree with it. The offer carries the cheapest fare of the
 * first fare's currency for its price and baggage, because a normalised offer has exactly one; every class option is kept as a fare row.
 * Any future adapter must reuse this function.
 */
export function normalise(input: FlightBuilderCaptureInput, ctx: NormaliseContext): NormalisedCapture {
  const segs: Segment[] = []
  input.segments.forEach((s, i) => {
    const from = ctx.reference.airport(s.from)
    const to = ctx.reference.airport(s.to)
    if (!from?.tz) throw new FlightBuilderInputError(`segments.${i}.from`, `Unknown airport ${s.from}`)
    if (!to?.tz) throw new FlightBuilderInputError(`segments.${i}.to`, `Unknown airport ${s.to}`)
    if (s.departTz && s.departTz !== from.tz) throw new FlightBuilderInputError(`segments.${i}.departTz`, `${s.from} is in ${from.tz}, not ${s.departTz}`)
    if (s.arriveTz && s.arriveTz !== to.tz) throw new FlightBuilderInputError(`segments.${i}.arriveTz`, `${s.to} is in ${to.tz}, not ${s.arriveTz}`)
    const depUtc = localToUtc(s.departLocal, from.tz)
    const arrUtc = localToUtc(s.arriveLocal, to.tz)
    if (Date.parse(arrUtc) <= Date.parse(depUtc)) throw new FlightBuilderInputError(`segments.${i}.arriveLocal`, "Arrival must be after departure")
    const prev = segs[i - 1]
    if (prev) {
      if (prev.destination.iata !== s.from) throw new FlightBuilderInputError(`segments.${i}.from`, "Segments must connect: this one must leave from where the previous one landed")
      if (Date.parse(depUtc) <= Date.parse(prev.arrival.utc)) throw new FlightBuilderInputError(`segments.${i}.departLocal`, "Connection departs before the previous segment arrives")
    }
    segs.push({
      marketing: { carrier: s.carrier, flightNumber: s.flightNumber },
      operating: { carrier: s.operatingCarrier ?? s.carrier },
      origin: { iata: s.from }, destination: { iata: s.to },
      departure: { local: s.departLocal, utc: depUtc, tz: from.tz }, arrival: { local: s.arriveLocal, utc: arrUtc, tz: to.tz },
      cabin: "ECONOMY", ...(s.aircraft ? { aircraft: s.aircraft } : {}), technicalStops: [],
    })
  })

  const fares: FareRow[] = input.fares.map((f, position) => {
    f.baggage.forEach((b, i) => { if (b.segmentIndex >= segs.length) throw new FlightBuilderInputError(`fares.${position}.baggage.${i}.segmentIndex`, "No such segment") })
    return {
      position, cabin: f.cabin, bookingClasses: f.bookingClasses, seatsRaw: f.seats, fareBasis: f.fareBasis, fareType: f.fareType, fareTypeRaw: f.fareTypeRaw ?? null,
      baseMinor: f.baseMinor ?? null, taxesMinor: f.taxesMinor ?? null, totalMinor: f.totalMinor, currency: f.currency, baggage: f.baggage,
      conditions: { change: f.change, refund: f.refund, ...(f.rulesText ? { rulesText: f.rulesText } : {}), confirmedBy: ctx.confirmedBy, confirmedAt: ctx.now.toISOString() },
      ticketingDeadline: f.ticketingDeadline ?? null,
    }
  })

  const currency = fares[0]!.currency
  const rep = fares.filter((f) => f.currency === currency).reduce((a, b) => (b.totalMinor < a.totalMinor ? b : a))
  const known = (c: CapturedCondition) =>
    c.state === "UNKNOWN" ? ({ status: "UNKNOWN" } as const)
      : ({ status: "KNOWN", value: { allowed: c.state === "KNOWN_ALLOWED", ...(c.penaltyMinor ? { penalty: { amountMinor: c.penaltyMinor, currency } } : {}) } } as const)
  const identityKey = identityOf(input)
  const first = segs[0]!
  const last = segs[segs.length - 1]!
  const offer = NormalisedOffer.parse({
    source: { provider: FLIGHT_BUILDER_PROVIDER_ID, providerOfferId: identityKey, rung: "MANUAL", fetchedAt: new Date(input.observedAt).toISOString(), fake: false },
    slices: [{
      origin: first.origin.iata, destination: last.destination.iata, durationMin: minutes(first.departure.utc, last.arrival.utc),
      segments: segs.map((s, i) => ({ ...s, cabin: rep.cabin, bookingClass: rep.bookingClasses[i], ...(rep.fareBasis[i] ? { fareBasis: rep.fareBasis[i] } : {}) })),
    }],
    price: { total: { amountMinor: rep.totalMinor, currency }, ...(rep.baseMinor !== null ? { base: { amountMinor: rep.baseMinor, currency } } : {}), ...(rep.taxesMinor !== null ? { taxes: { amountMinor: rep.taxesMinor, currency } } : {}) },
    validatingCarrier: first.marketing.carrier,
    ticketing: "SINGLE_TICKET",
    brand: { status: "UNKNOWN" },
    baggage: rep.baggage.map((b) => ({ segmentIndex: b.segmentIndex, passengerType: b.passengerType, checked: b.checked, cabin: b.cabin })),
    conditions: { change: known(rep.conditions.change), refund: known(rep.conditions.refund) },
  })
  return { offer, fares, identityKey }
}
