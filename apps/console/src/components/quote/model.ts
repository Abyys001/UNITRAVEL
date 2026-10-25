import type { Itinerary, Money, QuoteOptionInput, Segment, Slice } from "@unitravel/contracts"
import { unknownQuoteFields } from "@unitravel/domain"

/** Builder working copy: amounts as typed strings so half-typed numbers do not jump around. */
export interface DraftOption {
  key: string
  label: string
  source: QuoteOptionInput["source"]
  slices: Slice[]
  components: QuoteOptionInput["components"]
  ticketingModel: QuoteOptionInput["ticketingModel"]
  fare: string; taxes: string; serviceFee: string
  baggage: QuoteOptionInput["baggage"]
  conditions: QuoteOptionInput["conditions"]
  internalCost: string
  supplierPrice?: Money; supplierFetchedAt?: string; supplierExpiresAt?: string
}

const major = (m: number) => (m / 100).toFixed(2)
const minor = (s: string) => Math.round(Number(s || 0) * 100)
export const segCount = (slices: Slice[]) => slices.reduce((n, s) => n + s.segments.length, 0)

/** Every segment gets an explicit baggage row; a missing supplier fact becomes UNKNOWN, never a guess. */
export function normaliseBaggage(slices: Slice[], baggage: QuoteOptionInput["baggage"]): QuoteOptionInput["baggage"] {
  return Array.from({ length: segCount(slices) }, (_, i) => baggage.find((b) => b.segmentIndex === i) ?? { segmentIndex: i, passengerType: "ADT", checked: { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" } })
}

export function fromInput(o: QuoteOptionInput, key = crypto.randomUUID()): DraftOption {
  return {
    key, label: o.label, source: o.source, slices: o.slices, components: o.components ?? [], ticketingModel: o.ticketingModel,
    fare: major(o.priceBreakdown.fare.amountMinor), taxes: major(o.priceBreakdown.taxes.amountMinor), serviceFee: major(o.priceBreakdown.serviceFee.amountMinor),
    baggage: normaliseBaggage(o.slices, o.baggage), conditions: o.conditions, internalCost: o.internalCostMinor != null ? major(o.internalCostMinor) : "",
    supplierPrice: o.supplierPrice ?? undefined, supplierFetchedAt: o.supplierFetchedAt ?? undefined, supplierExpiresAt: o.supplierExpiresAt ?? undefined,
  }
}

export function fromItinerary(it: Itinerary): QuoteOptionInput {
  const first = it.components[0]!
  const single = it.components.length === 1
  const firstSegs = it.components[0]!.slices[0]?.segments ?? []
  return {
    // Customers see this label on their quote: route and carrier only, no internal wording.
    label: `${firstSegs[0]?.origin.iata ?? ""} → ${firstSegs.at(-1)?.destination.iata ?? ""} · ${it.carriers.join("/")}`,
    source: "STAFF_SEARCH",
    slices: it.components.flatMap((c) => c.slices),
    components: it.components.map((c) => ({ provider: c.source.provider, offerId: c.source.providerOfferId, rung: c.source.rung, fetchedAt: c.source.fetchedAt })),
    priceBreakdown: { fare: it.price.total, taxes: { amountMinor: 0, currency: it.price.total.currency }, serviceFee: { amountMinor: 0, currency: it.price.total.currency }, total: it.price.total },
    baggage: it.baggage,
    // Conditions carry over only when one supplier ticket states them; otherwise staff confirm from the fare rules.
    conditions: { change: single ? first.conditions.change : { status: "UNKNOWN" }, refund: single ? first.conditions.refund : { status: "UNKNOWN" } },
    ticketingModel: it.ticketing,
    supplierPrice: it.price.total,
    supplierFetchedAt: first.source.fetchedAt,
    supplierExpiresAt: it.components.map((c) => c.source.expiresAt).filter(Boolean).sort()[0],
  }
}

export function toInput(o: DraftOption, currency: string): QuoteOptionInput {
  const fare = minor(o.fare), taxes = minor(o.taxes), fee = minor(o.serviceFee)
  const m = (n: number) => ({ amountMinor: n, currency })
  return {
    label: o.label, source: o.source, slices: o.slices, components: o.components, ticketingModel: o.ticketingModel,
    priceBreakdown: { fare: m(fare), taxes: m(taxes), serviceFee: m(fee), total: m(fare + taxes + fee) },
    baggage: normaliseBaggage(o.slices, o.baggage), conditions: { change: sendableCondition(o.conditions.change), refund: sendableCondition(o.conditions.refund) },
    internalCostMinor: o.internalCost ? minor(o.internalCost) : undefined,
    supplierPrice: o.supplierPrice, supplierFetchedAt: o.supplierFetchedAt, supplierExpiresAt: o.supplierExpiresAt,
  }
}

/** Price inputs that are not a plain amount (e.g. "0.0025.00"); they block sending instead of becoming NaN. */
const AMOUNT = /^\s*\d+(\.\d{1,2})?\s*$/
export const badAmounts = (o: DraftOption) => (["fare", "taxes", "serviceFee", "internalCost"] as const).filter((k) => (o[k] ?? "").trim() !== "" && !AMOUNT.test(o[k] ?? ""))

/** A fee-type condition with no amount is saved as UNKNOWN, never as a zero fee (ADR-0008 W7); the send guard then blocks it. */
const sendableCondition = (c: DraftOption["conditions"]["change"]): DraftOption["conditions"]["change"] => (c.status === "KNOWN" && c.value.allowed && c.value.penalty && !(c.value.penalty.amountMinor > 0) ? { status: "UNKNOWN" } : c)

export const unknowns = (o: DraftOption) => unknownQuoteFields({ segmentCount: segCount(o.slices), baggage: normaliseBaggage(o.slices, o.baggage), conditions: o.conditions })

/** Wall-clock time at an IANA zone → UTC ISO (manual segments typed from the GDS show local times). */
export function zonedToUtc(local: string, tz: string): string {
  const guess = new Date(`${local}:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]))
  const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  return new Date(guess.getTime() - (asZone - guess.getTime())).toISOString().replace(".000Z", "Z")
}

export interface ManualSeg { carrier: string; flightNumber: string; from: string; to: string; dep: string; depTz: string; arr: string; arrTz: string; cabin: Segment["cabin"]; bookingClass: string; fareBasis: string }
export const emptySeg = (): ManualSeg => ({ carrier: "", flightNumber: "", from: "", to: "", dep: "", depTz: "Asia/Tehran", arr: "", arrTz: "Europe/London", cabin: "ECONOMY", bookingClass: "", fareBasis: "" })
export function manualSlice(segs: ManualSeg[]): Slice {
  const segments: Segment[] = segs.map((s) => ({
    marketing: { carrier: s.carrier.toUpperCase(), flightNumber: s.flightNumber.toUpperCase() }, operating: { carrier: s.carrier.toUpperCase(), flightNumber: s.flightNumber.toUpperCase() },
    origin: { iata: s.from.toUpperCase() }, destination: { iata: s.to.toUpperCase() },
    departure: { local: s.dep, utc: zonedToUtc(s.dep, s.depTz), tz: s.depTz }, arrival: { local: s.arr, utc: zonedToUtc(s.arr, s.arrTz), tz: s.arrTz },
    cabin: s.cabin, bookingClass: s.bookingClass || undefined, fareBasis: s.fareBasis || undefined, technicalStops: [],
  }))
  const dur = Math.round((Date.parse(segments.at(-1)!.arrival.utc) - Date.parse(segments[0]!.departure.utc)) / 60000)
  return { origin: segments[0]!.origin.iata, destination: segments.at(-1)!.destination.iata, segments, durationMin: Math.max(0, dur) }
}
export const ZONES = ["Asia/Tehran", "Europe/London", "Europe/Istanbul", "Asia/Dubai", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Asia/Yerevan", "Asia/Tbilisi", "Asia/Baku", "Asia/Doha", "Europe/Vienna", "Europe/Rome", "Europe/Madrid", "Europe/Stockholm", "America/Toronto"]
