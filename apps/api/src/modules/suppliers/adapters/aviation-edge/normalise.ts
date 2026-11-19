import { z } from "zod"

import type { Segment } from "@unitravel/contracts"
import { localToUtc, type ReferenceLookup } from "@unitravel/engine"

const MAX_DURATION_MIN = 20 * 60

const text = z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().nullish())
const Point = z.object({ iataCode: z.string().min(1), icaoCode: text, terminal: text, gate: text, scheduledTime: z.string().min(1) })
/** The documented row shape of `flightsFuture` (ADR-0036). Anything that does not fit is dropped with a notice, never filled in. */
const Row = z.object({
  departure: Point,
  arrival: Point,
  aircraft: z.object({ modelCode: text, modelText: text }).nullish(),
  airline: z.object({ name: text, iataCode: z.string().min(1), icaoCode: text }),
  flight: z.object({ number: text, iataNumber: text, icaoNumber: text }),
})

export interface ScheduleContext {
  reference: ReferenceLookup
  /** The slot's route and date: a row for anything else is not this slot's. */
  origin: string
  destination: string
  date: string
}

/** One scheduled flight. `providerData` holds what only staff may see (predicted gates, ICAO codes). */
export interface ScheduleFlight {
  /** `flightNumbers.join(",")|departLocal` (no cabin: a schedule has none). */
  identityKey: string
  segment: Segment
  providerData: Record<string, unknown>
}

export interface ScheduleRows { flights: ScheduleFlight[]; notices: string[] }

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined)

/** "HH:MM", "HH:MM:SS" or a full ISO timestamp (either `T`) → "HH:MM"; undefined when it is none of those. */
export function clock(v: string): string | undefined {
  const m = /^(?:\d{4}-\d{2}-\d{2}[Tt ])?([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/.exec(v.trim())
  return m ? `${m[1]}:${m[2]}` : undefined
}

const addDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/**
 * Aviation Edge future-schedule rows → scheduled flights (ADR-0036 E8). Times are airport-local with no date: the local time is the slot
 * date plus `HH:MM` in the airport's zone; an arrival that is not after the departure moves to the next day, and the row is dropped if the
 * duration is then 20 h or more. Terminal and aircraft are kept only when present. Cabin is not known for a schedule; `ECONOMY` is a placeholder
 * the public view never reads.
 */
export function normaliseSchedule(raw: unknown[], ctx: ScheduleContext): ScheduleRows {
  const out: ScheduleRows = { flights: [], notices: [] }
  const seen = new Set<string>()
  let malformed = 0
  let duplicates = 0
  const notice = (n: string) => { if (out.notices.length < 20) out.notices.push(n) }
  for (const r of raw) {
    const p = Row.safeParse(r)
    if (!p.success) { malformed++; continue }
    const row = p.data
    const from = row.departure.iataCode.toUpperCase()
    const to = row.arrival.iataCode.toUpperCase()
    if (from !== ctx.origin || to !== ctx.destination) { notice(`UNREQUESTED_ROUTE ${from}-${to}`); continue }
    const carrier = row.airline.iataCode.toUpperCase()
    const iataNumber = clean(row.flight.iataNumber)?.toUpperCase()
    const rawNumber = iataNumber ? (iataNumber.startsWith(carrier) ? iataNumber.slice(carrier.length) : iataNumber.replace(/^[A-Z0-9]{2}(?=\d)/, "")) : clean(row.flight.number)?.toUpperCase()
    if (!/^[A-Z0-9]{2}$/.test(carrier) || !rawNumber || !/^\d{1,4}[A-Z]?$/.test(rawNumber)) { notice(`MALFORMED_ROW ${carrier}${rawNumber ?? "?"}`); continue }
    const fromTz = ctx.reference.airport(from)?.tz
    const toTz = ctx.reference.airport(to)?.tz
    if (!fromTz || !toTz) { notice(`UNKNOWN_AIRPORT ${!fromTz ? from : to}`); continue }
    const dep = clock(row.departure.scheduledTime)
    const arr = clock(row.arrival.scheduledTime)
    if (!dep || !arr) { notice(`MALFORMED_ROW ${carrier}${rawNumber}`); continue }

    const departLocal = `${ctx.date}T${dep}`
    const departUtc = localToUtc(departLocal, fromTz)
    let arriveLocal = `${ctx.date}T${arr}`
    let arriveUtc = localToUtc(arriveLocal, toTz)
    if (Date.parse(arriveUtc) <= Date.parse(departUtc)) {
      arriveLocal = `${addDay(ctx.date)}T${arr}`
      arriveUtc = localToUtc(arriveLocal, toTz)
    }
    const durationMin = Math.round((Date.parse(arriveUtc) - Date.parse(departUtc)) / 60_000)
    if (durationMin <= 0 || durationMin >= MAX_DURATION_MIN) { notice(`DURATION_IMPLAUSIBLE ${carrier}${rawNumber}`); continue }

    const identityKey = `${carrier}${rawNumber}|${departLocal}`
    if (seen.has(identityKey)) { duplicates++; continue }
    seen.add(identityKey)

    const depTerminal = clean(row.departure.terminal)
    const arrTerminal = clean(row.arrival.terminal)
    const aircraft = clean(row.aircraft?.modelText) ?? clean(row.aircraft?.modelCode)
    const providerData: Record<string, unknown> = {}
    const put = (k: string, v: string | undefined) => { if (v) providerData[k] = v }
    put("departureGate", clean(row.departure.gate)); put("arrivalGate", clean(row.arrival.gate))
    put("departureIcao", clean(row.departure.icaoCode)); put("arrivalIcao", clean(row.arrival.icaoCode))
    put("airlineIcao", clean(row.airline.icaoCode)); put("flightIcao", clean(row.flight.icaoNumber)); put("airlineName", clean(row.airline.name))
    out.flights.push({
      identityKey,
      segment: {
        marketing: { carrier, flightNumber: rawNumber }, operating: { carrier },
        origin: { iata: from, ...(depTerminal ? { terminal: depTerminal } : {}) }, destination: { iata: to, ...(arrTerminal ? { terminal: arrTerminal } : {}) },
        departure: { local: departLocal, utc: departUtc, tz: fromTz }, arrival: { local: arriveLocal, utc: arriveUtc, tz: toTz },
        cabin: "ECONOMY", ...(aircraft ? { aircraft } : {}), technicalStops: [],
      },
      providerData,
    })
  }
  if (malformed) notice(`MALFORMED_ROW ${malformed}`)
  if (duplicates) notice(`DUPLICATE_ROW ${duplicates}`)
  out.flights.sort((a, b) => a.segment.departure.local.localeCompare(b.segment.departure.local) || a.identityKey.localeCompare(b.identityKey))
  return out
}
