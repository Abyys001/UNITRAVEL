import { createHash } from "node:crypto"

import type { Itinerary, NormalisedOffer, PublicLeg, RiskFlag, Segment } from "@unitravel/contracts"
import { PublicItinerary } from "@unitravel/contracts"

/** What `flight_results.detail` holds: the customer-safe view of one result, without its id or liveness (those live in columns). */
export type ResultDetail = Omit<PublicItinerary, "id"> & { legs: PublicLeg[] }

const minutes = (fromUtc: string, toUtc: string) => Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 60_000)
const iso = (d: Date | string) => new Date(d).toISOString()

function legOf(s: Segment): PublicLeg {
  return {
    carrier: s.marketing.carrier,
    flightNumber: `${s.marketing.carrier}${s.marketing.flightNumber}`,
    ...(s.operating.carrier !== s.marketing.carrier ? { operatingCarrier: s.operating.carrier } : {}),
    from: { iata: s.origin.iata, local: s.departure.local, ...(s.origin.terminal ? { terminal: s.origin.terminal } : {}) },
    to: { iata: s.destination.iata, local: s.arrival.local, ...(s.destination.terminal ? { terminal: s.destination.terminal } : {}) },
    durationMin: Math.max(0, minutes(s.departure.utc, s.arrival.utc)),
    ...(s.aircraft ? { aircraft: s.aircraft } : {}),
  }
}

/**
 * The allowlist (ADR-0034 C8): every field is copied by name, so a field added to an offer later cannot reach a customer.
 * No amount, currency, fare, baggage, booking token or provider appears here.
 */
function detailOf(segments: Segment[], extra: { selfTransfer: boolean; complianceReview: boolean; fetchedAt: string; layovers?: ResultDetail["layovers"]; riskFlags?: RiskFlag[] }): ResultDetail {
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const layovers = extra.layovers ?? segments.slice(0, -1).map((a, i) => ({ at: a.destination.iata, minutes: minutes(a.arrival.utc, segments[i + 1]!.departure.utc), flags: [] as RiskFlag[] }))
  return {
    origin: first.origin.iata,
    destination: last.destination.iata,
    departureDate: first.departure.local.slice(0, 10),
    departLocal: first.departure.local,
    arriveLocal: last.arrival.local,
    durationMin: Math.max(0, minutes(first.departure.utc, last.arrival.utc)),
    stops: segments.length - 1,
    carriers: [...new Set(segments.map((s) => s.marketing.carrier))],
    flightNumbers: segments.map((s) => `${s.marketing.carrier}${s.marketing.flightNumber}`),
    selfTransfer: extra.selfTransfer,
    layovers,
    riskFlags: extra.riskFlags ?? [],
    complianceReview: extra.complianceReview,
    fetchedAt: extra.fetchedAt,
    legs: segments.map(legOf),
  }
}

/** One Apify offer (a single ticket, possibly with protected connections). */
export function detailFromOffer(offer: NormalisedOffer, complianceReview: boolean): ResultDetail {
  return detailOf(offer.slices[0]!.segments, { selfTransfer: false, complianceReview, fetchedAt: iso(offer.source.fetchedAt) })
}

/** A self-transfer built by the engine from two feeder offers; layovers and risk flags come from the engine's own connection check. */
export function detailFromItinerary(it: Pick<Itinerary, "components" | "connections" | "riskFlags" | "complianceReview">, fetchedAt: string): ResultDetail {
  const segments = it.components.flatMap((c) => c.slices[0]!.segments)
  return detailOf(segments, {
    selfTransfer: true, complianceReview: it.complianceReview, fetchedAt,
    layovers: it.connections.map((c) => ({ at: c.at, minutes: c.layoverMin, flags: c.flags })),
    riskFlags: [...it.riskFlags],
  })
}

/** The list view of a result. Strict: an unexpected key fails the build of the snapshot instead of reaching a customer. */
export function toPublicItinerary(id: string, d: ResultDetail): PublicItinerary {
  return PublicItinerary.strict().parse({
    id, origin: d.origin, destination: d.destination, departureDate: d.departureDate, departLocal: d.departLocal, arriveLocal: d.arriveLocal, durationMin: d.durationMin,
    stops: d.stops, carriers: d.carriers, flightNumbers: d.flightNumbers, selfTransfer: d.selfTransfer, layovers: d.layovers, riskFlags: d.riskFlags,
    complianceReview: d.complianceReview, fetchedAt: d.fetchedAt,
  })
}

/** Snapshot payload for a slot: current results in departure order. */
export function snapshotPayload(rows: { id: string; detail: ResultDetail }[]): PublicItinerary[] {
  return rows.map((r) => toPublicItinerary(r.id, r.detail)).sort((a, b) => a.departLocal.localeCompare(b.departLocal) || a.id.localeCompare(b.id))
}

/** ETag over the slot ids and versions that make up a response. */
export function etagOf(parts: string[]): string {
  return `W/"${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20)}"`
}

/** Identity of a self-transfer: both feeder identities, in order. */
export const combinedIdentity = (a: string, b: string) => `${a}>${b}`

export const slotKey = (routeId: string, date: string) => `${routeId}:${date}`
