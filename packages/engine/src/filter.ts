import type { NormalisedOffer } from "@unitravel/contracts"

import type { CarrierPolicy, FilterStats, ReferenceLookup } from "./types"

export function emptyStats(): FilterStats {
  return { removedByPolicy: 0, removedExpired: 0, removedTimezone: 0, removedInvalid: 0, reviewFlagged: 0 }
}

/** Carriers on a segment, marketing and operating — both are checked against policy (ch. 27.1). */
export function offerCarriers(o: NormalisedOffer): string[] {
  const out = new Set<string>()
  for (const s of o.slices) for (const seg of s.segments) { out.add(seg.marketing.carrier); out.add(seg.operating.carrier) }
  return [...out]
}

export function offerAirports(o: NormalisedOffer): string[] {
  const out = new Set<string>()
  for (const s of o.slices) for (const seg of s.segments) {
    out.add(seg.origin.iata); out.add(seg.destination.iata)
    for (const t of seg.technicalStops) out.add(t.iata)
  }
  return [...out]
}

/**
 * Lane keys are `ORIGIN:*`, `*:DESTINATION`, `ORIGIN:DESTINATION` or `COUNTRY:*` (touching a country in either direction).
 * Shared with the cargo and service lane checks so every vertical reads a lane key the same way (ch. 27.4, ADR-0031).
 */
export function laneKeyMatches(key: string, origin: string, destination: string): boolean {
  return key === `${origin}:*` || key === `*:${destination}` || key === `${origin}:${destination}` || key === `${destination}:*`
}

/** Country pairs an offer travels: every slice end to end, every segment, and every technical stop. */
function offerCountryPairs(o: NormalisedOffer, ref: ReferenceLookup): [string, string][] {
  const country = (iata: string) => ref.airport(iata)?.country
  const pairs: [string | undefined, string | undefined][] = []
  for (const s of o.slices) {
    const first = s.segments[0]
    const last = s.segments[s.segments.length - 1]
    if (first && last) pairs.push([country(first.origin.iata), country(last.destination.iata)])
    for (const seg of s.segments) {
      pairs.push([country(seg.origin.iata), country(seg.destination.iata)])
      for (const t of seg.technicalStops) pairs.push([country(seg.origin.iata), country(t.iata)], [country(t.iata), country(seg.destination.iata)])
    }
  }
  return pairs.filter((p): p is [string, string] => !!p[0] && !!p[1])
}

/** Flight lane verdict for one offer (ADR-0031 I3): BLOCK wins over REVIEW; null when no lane policy applies. */
export function offerLaneVerdict(o: NormalisedOffer, policy: CarrierPolicy, ref: ReferenceLookup): "BLOCK" | "REVIEW" | null {
  const blocked = policy.blockedLanes
  const review = policy.reviewLanes
  if (!blocked?.size && !review?.size) return null
  const pairs = offerCountryPairs(o, ref)
  if (blocked && [...blocked].some((k) => pairs.some(([a, b]) => laneKeyMatches(k, a, b)))) return "BLOCK"
  if (review && [...review].some((k) => pairs.some(([a, b]) => laneKeyMatches(k, a, b)))) return "REVIEW"
  return null
}

/**
 * Step 4 — remove offers that use blocked carriers or airports, expired offers and offers with unresolvable time
 * zones. Compliance runs on adapter output before anything else sees it (ch. 21.1 principle 5). Counts are kept so
 * the progress line can say "Some results were hidden by our carrier policy".
 */
export function filterOffers(offers: NormalisedOffer[], policy: CarrierPolicy, ref: ReferenceLookup, now: Date, stats: FilterStats): NormalisedOffer[] {
  return offers.filter((o) => {
    if (offerCarriers(o).some((c) => policy.blockedCarriers.has(c))) { stats.removedByPolicy++; return false }
    if (offerAirports(o).some((a) => policy.blockedAirports.has(a))) { stats.removedByPolicy++; return false }
    const lane = offerLaneVerdict(o, policy, ref)
    if (lane === "BLOCK") { stats.removedByPolicy++; return false }
    if (o.source.expiresAt && Date.parse(o.source.expiresAt) <= now.getTime()) { stats.removedExpired++; return false }
    for (const s of o.slices) for (const seg of s.segments) {
      const a = ref.airport(seg.origin.iata)
      const b = ref.airport(seg.destination.iata)
      if (!a?.tz || !b?.tz || seg.departure.tz !== a.tz || seg.arrival.tz !== b.tz) { stats.removedTimezone++; return false }
      if (Date.parse(seg.arrival.utc) <= Date.parse(seg.departure.utc)) { stats.removedInvalid++; return false }
    }
    if (offerCarriers(o).some((c) => policy.reviewCarriers.has(c)) || offerAirports(o).some((a) => policy.reviewAirports.has(a)) || lane === "REVIEW") stats.reviewFlagged++
    return true
  })
}
