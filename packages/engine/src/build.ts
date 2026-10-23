import type { Connection, Construction, Itinerary, NormalisedOffer, RiskFlag, Segment, SegmentBaggage, Slice } from "@unitravel/contracts"

import type { RuleResolver } from "./rules"
import { crossesLocalNight, minutesBetween, stableHash } from "./time"
import type { EngineContext } from "./types"

/** A slice-level solution: the tickets that together get the traveller from the slice origin to its destination. */
export interface SliceSolution {
  sliceIndex: number
  components: NormalisedOffer[]
  construction: Construction
  gateway?: { iata: string; dayOffset: number; country: string }
}

export const firstSegment = (o: NormalisedOffer, slice = 0): Segment => o.slices[slice]!.segments[0]!
export const lastSegment = (o: NormalisedOffer, slice = 0): Segment => {
  const segs = o.slices[slice]!.segments
  return segs[segs.length - 1]!
}

/** Flight key for deduplication (ch. 21.7): (carrier, flight number, departure UTC date, origin, destination) + cabin. */
export function flightKey(segments: Segment[]): string {
  return segments.map((s) => `${s.marketing.carrier}${s.marketing.flightNumber}@${s.departure.utc.slice(0, 10)}:${s.origin.iata}-${s.destination.iata}/${s.cabin}`).join("|")
}

export function offerFlightKey(o: NormalisedOffer): string {
  return o.slices.map((s) => flightKey(s.segments)).join("#")
}

/**
 * Step 5 — joining hub legs (ch. 22.4). Pure; with 4 hubs and 25 offers per leg this is at most 2,500 pairs per date.
 * The hard filters on the connection are applied here; ranking signals are computed later.
 */
export function joinAtHub(legA: NormalisedOffer[], legB: NormalisedOffer[], rules: RuleResolver, allowAirportChange: boolean, sliceIndex: number): SliceSolution[] {
  const out: SliceSolution[] = []
  const byAirport = new Map<string, NormalisedOffer[]>()
  for (const b of legB) {
    const k = firstSegment(b).origin.iata
    byAirport.set(k, [...(byAirport.get(k) ?? []), b])
  }
  for (const a of legA) {
    const arr = lastSegment(a)
    const partners = allowAirportChange ? rules.airportChanges(arr.destination.iata).map((c) => c.to) : []
    for (const depAirport of [arr.destination.iata, ...partners]) {
      for (const b of byAirport.get(depAirport) ?? []) {
        const dep = firstSegment(b)
        const r = rules.forConnection({ at: arr.destination.iata, to: depAirport, inbound: arr.marketing.carrier, outbound: dep.marketing.carrier })
        if (r.blocked) continue
        const change = depAirport !== arr.destination.iata
        const required = r.selfTransferMinMin + (change ? (rules.airportChangeMin(arr.destination.iata, depAirport) ?? Infinity) : 0)
        const layover = minutesBetween(arr.arrival.utc, dep.departure.utc)
        if (layover < required || layover > r.maxLayoverMin) continue
        const overnight = crossesLocalNight(arr.arrival.local, dep.departure.local, r.nightWindow)
        if (overnight && (!r.allowOvernight || layover > r.maxOvernightMin)) continue
        out.push({ sliceIndex, components: [a, b], construction: "SELF_TRANSFER" })
      }
    }
  }
  return out
}

interface Built {
  itinerary: Omit<Itinerary, "tabs" | "score" | "explain">
  key: string
}

/**
 * Steps 6 (validate) and assembly: turn slice solutions into an itinerary with connections, risk flags, truth items
 * and aggregated baggage. Returns null when a hard filter fails.
 */
export function buildItinerary(solutions: SliceSolution[], ctx: EngineContext, rules: RuleResolver): Built | null {
  const prefs = ctx.query.preferences
  const connections: Connection[] = []
  const slices: Slice[] = []
  const baggage: SegmentBaggage[] = []
  const components: NormalisedOffer[] = []
  const flags = new Set<RiskFlag>()
  let segOffset = 0
  let stopsMax = 0
  let duration = 0

  for (const sol of solutions) {
    // Each component contributes its slice(s); a round-trip offer covers several slices in one ticket.
    const parts = sol.components.flatMap((c, ci) => c.slices.map((s, si) => ({ slice: s, component: c, ci, si })))
    const sliceIndices = sol.components.length === 1 && sol.components[0]!.slices.length > 1 ? sol.components[0]!.slices.map((_, i) => i) : [sol.sliceIndex]
    for (const c of sol.components) if (!components.includes(c)) components.push(c)

    const groups = sliceIndices.length > 1 ? parts.map((p) => [p]) : [parts]
    groups.forEach((group, gi) => {
      const sliceIdx = sliceIndices[gi] ?? sol.sliceIndex
      const segs: { seg: Segment; component: NormalisedOffer; segInOffer: number }[] = []
      for (const p of group) p.slice.segments.forEach((seg, k) => segs.push({ seg, component: p.component, segInOffer: k + p.component.slices.slice(0, p.si).reduce((n, s) => n + s.segments.length, 0) }))
      const sliceRule = rules.forRoute(segs[0]!.seg.origin.iata, segs[segs.length - 1]!.seg.destination.iata)
      for (let i = 0; i < segs.length - 1; i++) {
        const a = segs[i]!.seg
        const b = segs[i + 1]!.seg
        const protectedConn = segs[i]!.component === segs[i + 1]!.component
        const r = rules.forConnection({ at: a.destination.iata, to: b.origin.iata, inbound: a.marketing.carrier, outbound: b.marketing.carrier, origin: segs[0]!.seg.origin.iata, destination: segs[segs.length - 1]!.seg.destination.iata })
        const layover = minutesBetween(a.arrival.utc, b.departure.utc)
        const change = a.destination.iata !== b.origin.iata
        if (change && !prefs.allowAirportChange) return void (connections.push({ ...invalid }))
        const changeMin = change ? rules.airportChangeMin(a.destination.iata, b.origin.iata) : 0
        if (change && !protectedConn && changeMin === null) return void connections.push({ ...invalid })
        // Supplier-validated (single-ticket) connections carry the supplier's own MCT; the engine assumes 60 min as the
        // floor for ranking because the MCT value itself is not returned by suppliers (ch. 6.4).
        const required = protectedConn ? Math.max(1, 60 + r.protectedMinBufferMin) : r.selfTransferMinMin + (changeMin ?? 0)
        if (!protectedConn && layover < required) return void connections.push({ ...invalid })
        if (layover <= 0 || layover > r.maxLayoverMin) return void connections.push({ ...invalid })
        const overnight = crossesLocalNight(a.arrival.local, b.departure.local, r.nightWindow)
        if (overnight && (!r.allowOvernight || !prefs.allowOvernight || layover > r.maxOvernightMin)) return void connections.push({ ...invalid })
        const window = prefs.preferredLayoverMin ?? r.preferredLayover
        const cFlags: RiskFlag[] = []
        if (!protectedConn) cFlags.push("SEPARATE_TICKETS")
        if (change) cFlags.push("AIRPORT_CHANGE")
        if (overnight) cFlags.push("OVERNIGHT")
        const tightBelow = protectedConn ? required : window[0]
        if (layover < tightBelow && (protectedConn ? true : layover >= required)) cFlags.push("TIGHT")
        if (!change) {
          if (a.destination.terminal && b.origin.terminal && a.destination.terminal !== b.origin.terminal) cFlags.push("TERMINAL_CHANGE")
          else if (!a.destination.terminal || !b.origin.terminal) cFlags.push("TERMINAL_UNKNOWN")
        }
        if (!protectedConn && r.selfTransferRequiresEntry) cFlags.push("ENTRY_REQUIRED")
        cFlags.forEach((f) => flags.add(f))
        connections.push({
          sliceIndex: sliceIdx, at: a.destination.iata, departAirport: b.origin.iata, layoverMin: layover, requiredMin: required,
          inPreferredWindow: layover >= window[0] && layover <= window[1], protected: protectedConn, overnight, flags: cFlags,
          advisory: !protectedConn ? r.entryAdvisory?.[ctx.locale] : undefined, ruleId: r.id,
        })
      }
      const stops = segs.length - 1
      stopsMax = Math.max(stopsMax, stops)
      if (stops > Math.min(prefs.maxStops, sliceRule.maxStops)) connections.push({ ...invalid })
      const tickets = new Set(segs.map((s) => s.component)).size
      if (tickets > sliceRule.maxSeparateTickets) connections.push({ ...invalid })
      const sliceDuration = minutesBetween(segs[0]!.seg.departure.utc, segs[segs.length - 1]!.seg.arrival.utc)
      if (sliceDuration > sliceRule.maxTotalDurationMin) connections.push({ ...invalid })
      duration += sliceDuration
      slices.push({ origin: segs[0]!.seg.origin.iata, destination: segs[segs.length - 1]!.seg.destination.iata, segments: segs.map((s) => s.seg), durationMin: sliceDuration })
      segs.forEach((s, k) => {
        const b = s.component.baggage.find((x) => x.segmentIndex === s.segInOffer)
        baggage.push({ segmentIndex: segOffset + k, passengerType: b?.passengerType ?? "ADT", checked: b?.checked ?? { status: "UNKNOWN" }, cabin: b?.cabin ?? { status: "UNKNOWN" } })
      })
      segOffset += segs.length
    })
  }
  if (connections.some((c) => c.ruleId === INVALID)) return null

  const currency = components[0]!.price.total.currency
  if (components.some((c) => c.price.total.currency !== currency)) return null
  const total = components.reduce((s, c) => s + c.price.total.amountMinor, 0)
  const construction: Construction = solutions.some((s) => s.construction === "GATEWAY") ? "GATEWAY" : solutions.some((s) => s.construction === "SELF_TRANSFER") ? "SELF_TRANSFER" : "THROUGH"
  const gw = solutions.find((s) => s.gateway)?.gateway
  const restricted = gw ? ctx.hubs.restrictedOrigins.flatMap((r) => r.gateways).find((g) => g.iata === gw.iata) : undefined
  const allSegs = slices.flatMap((s) => s.segments)
  const id = `itn_${stableHash(components.map((c) => `${c.source.provider}:${c.source.providerOfferId}`).join("+"))}`
  return {
    key: `${slices.map((s) => flightKey(s.segments)).join("#")}|${components.length}`,
    itinerary: {
      id,
      construction,
      ticketing: components.length > 1 ? "SEPARATE_TICKETS" : "SINGLE_TICKET",
      price: { total: { amountMinor: total, currency }, isSumOfTickets: components.length > 1 },
      durationMin: duration,
      components,
      connections,
      gateway: gw && restricted ? { iata: gw.iata, dayOffset: gw.dayOffset, country: gw.country, access: restricted.access[ctx.locale] } : undefined,
      truth: components.map((c, i) => ({ component: i + 1, provider: c.source.provider, rung: c.source.rung, fetchedAt: c.source.fetchedAt, expiresAt: c.source.expiresAt, fake: c.source.fake })),
      baggage,
      riskFlags: [...flags],
      stops: stopsMax,
      firstDeparture: allSegs[0]!.departure.utc,
      lastArrival: allSegs[allSegs.length - 1]!.arrival.utc,
      carriers: [...new Set(allSegs.map((s) => s.marketing.carrier))],
    },
  }
}

const INVALID = "__invalid__"
const invalid: Connection = {
  sliceIndex: -1, at: "XXX", departAirport: "XXX", layoverMin: 0, requiredMin: 0, inPreferredWindow: false, protected: false, overnight: false, flags: [], ruleId: INVALID,
}
