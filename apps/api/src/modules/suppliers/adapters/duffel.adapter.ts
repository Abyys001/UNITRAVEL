import type { NormalisedOffer, SeatElement, SeatMap, SegmentBaggage } from "@unitravel/contracts"
import { localToUtc } from "@unitravel/engine"

import { type CallContext, type Capabilities, type FlightSupplierAdapter, type HealthResult, type OfferRef, type SliceQuery, SupplierError } from "../adapter"

const BASE = "https://api.duffel.com"
const CABIN: Record<string, string> = { ECONOMY: "economy", PREMIUM_ECONOMY: "premium_economy", BUSINESS: "business", FIRST: "first" }
const CABIN_BACK: Record<string, NormalisedOffer["slices"][number]["segments"][number]["cabin"]> = { economy: "ECONOMY", premium_economy: "PREMIUM_ECONOMY", business: "BUSINESS", first: "FIRST" }

interface DuffelSegment {
  id: string
  marketing_carrier: { iata_code: string }; marketing_carrier_flight_number: string
  operating_carrier: { iata_code: string }; operating_carrier_flight_number?: string
  origin: { iata_code: string }; destination: { iata_code: string }; origin_terminal?: string; destination_terminal?: string
  departing_at: string; arriving_at: string; aircraft?: { iata_code?: string }
  passengers: { passenger_id: string; cabin_class: string; fare_basis_code?: string; baggages?: { type: string; quantity: number }[] }[]
  stops?: { airport: { iata_code: string }; duration?: string }[]
}
interface DuffelOffer {
  id: string; total_amount: string; total_currency: string; base_amount?: string; tax_amount?: string; expires_at?: string
  owner: { iata_code: string }
  slices: { fare_brand_name?: string; segments: DuffelSegment[] }[]
  passengers: { id: string; type?: string }[]
  conditions?: { change_before_departure?: { allowed: boolean; penalty_amount?: string; penalty_currency?: string } | null; refund_before_departure?: { allowed: boolean; penalty_amount?: string; penalty_currency?: string } | null }
  available_services?: unknown[]
}

const minor = (amount: string, currency: string) => Math.round(Number(amount) * (currency === "JPY" ? 1 : currency === "KWD" || currency === "OMR" || currency === "BHD" ? 1000 : 100))

/**
 * Duffel (secondary provider, ch. 6.3): offer requests, single-offer revalidation, seat maps. Credentials:
 * { accessToken } entered in the Developer Panel. Orders are a Stage 7 capability and are not implemented.
 */
export class DuffelAdapter implements FlightSupplierAdapter {
  readonly id = "duffel" as const

  capabilities(): Capabilities {
    return { search: true, price: true, seatMap: true, order: false, cancel: false, ancillaries: false, cityCodes: true }
  }

  private async call<T>(method: "GET" | "POST", path: string, ctx: CallContext, body?: unknown): Promise<T> {
    const token = ctx.credentials?.accessToken
    if (!token) throw new SupplierError("SUPPLIER_AUTH", "Duffel access token not configured")
    // Prefix INFERRED from Duffel's token format (ADR-0014): a sandbox token must never serve a deployed host.
    if (ctx.environment === "production" && token.startsWith("duffel_test_")) {
      throw new SupplierError("SUPPLIER_AUTH", "A Duffel test token cannot serve live searches (ADR-0014)")
    }
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, {
        method, signal: ctx.signal,
        headers: { authorization: `Bearer ${token}`, "duffel-version": "v2", accept: "application/json", "content-type": "application/json", "accept-encoding": "gzip" },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") throw new SupplierError("SUPPLIER_TIMEOUT", "Duffel did not answer before the deadline")
      throw new SupplierError("SUPPLIER_UNAVAILABLE", String(err))
    }
    const text = await res.text()
    if (res.ok) return JSON.parse(text) as T
    const code = (() => {
      try { return (JSON.parse(text) as { errors?: { code?: string }[] }).errors?.[0]?.code } catch { return undefined }
    })()
    if (res.status === 401 || res.status === 403) throw new SupplierError("SUPPLIER_AUTH", `Duffel ${res.status}`, code)
    if (res.status === 429) throw new SupplierError("SUPPLIER_RATE_LIMITED", "Duffel rate limit", code)
    if (code === "offer_no_longer_available" || code === "offer_expired" || res.status === 404) throw new SupplierError("OFFER_EXPIRED", "Offer no longer available", code)
    if (res.status >= 500) throw new SupplierError("SUPPLIER_UNAVAILABLE", `Duffel ${res.status}`, code)
    if (res.status === 400 || res.status === 422) throw new SupplierError("SUPPLIER_BAD_REQUEST", `Duffel ${res.status}: ${code ?? text.slice(0, 120)}`, code)
    throw new SupplierError("SUPPLIER_UNKNOWN", `Duffel ${res.status}`, code)
  }

  /** Normalise at the edge (ch. 21.1). Local times are converted with the reference zone; unknown zones drop the offer. */
  normalise(o: DuffelOffer, ctx: CallContext, rung: "LIVE_OFFER" | "PRICED_OFFER"): NormalisedOffer | null {
    const baggage: SegmentBaggage[] = []
    let flat = 0
    const slices: NormalisedOffer["slices"] = []
    for (const s of o.slices) {
      const segments = []
      for (const seg of s.segments) {
        const fromTz = ctx.reference.airport(seg.origin.iata_code)?.tz
        const toTz = ctx.reference.airport(seg.destination.iata_code)?.tz
        if (!fromTz || !toTz) return null
        const dep = seg.departing_at.slice(0, 16)
        const arr = seg.arriving_at.slice(0, 16)
        const pax = seg.passengers[0]
        segments.push({
          marketing: { carrier: seg.marketing_carrier.iata_code, flightNumber: seg.marketing_carrier_flight_number },
          operating: { carrier: seg.operating_carrier.iata_code, flightNumber: seg.operating_carrier_flight_number },
          origin: { iata: seg.origin.iata_code, terminal: seg.origin_terminal ?? undefined }, destination: { iata: seg.destination.iata_code, terminal: seg.destination_terminal ?? undefined },
          departure: { local: dep, utc: localToUtc(dep, fromTz), tz: fromTz }, arrival: { local: arr, utc: localToUtc(arr, toTz), tz: toTz },
          cabin: CABIN_BACK[pax?.cabin_class ?? "economy"] ?? "ECONOMY", fareBasis: pax?.fare_basis_code, aircraft: seg.aircraft?.iata_code,
          technicalStops: (seg.stops ?? []).map((t) => ({ iata: t.airport.iata_code })),
        })
        // Baggage only when the supplier returned it; never inferred (ch. 12.5).
        const checked = pax?.baggages?.find((b) => b.type === "checked")
        const carry = pax?.baggages?.find((b) => b.type === "carry_on")
        baggage.push({ segmentIndex: flat++, passengerType: "ADT", checked: checked ? { status: "KNOWN", value: { pieces: checked.quantity } } : pax?.baggages ? { status: "KNOWN", value: { pieces: 0 } } : { status: "UNKNOWN" }, cabin: carry ? { status: "KNOWN", value: carry.quantity > 0 } : { status: "UNKNOWN" } })
      }
      const first = segments[0]!
      const last = segments[segments.length - 1]!
      slices.push({ origin: first.origin.iata, destination: last.destination.iata, segments, durationMin: Math.round((Date.parse(last.arrival.utc) - Date.parse(first.departure.utc)) / 60000) })
    }
    const cond = (c?: { allowed: boolean; penalty_amount?: string; penalty_currency?: string } | null) =>
      c ? { status: "KNOWN" as const, value: { allowed: c.allowed, penalty: c.penalty_amount && c.penalty_currency ? { amountMinor: minor(c.penalty_amount, c.penalty_currency), currency: c.penalty_currency } : undefined } } : { status: "UNKNOWN" as const }
    const brand = o.slices[0]?.fare_brand_name
    return {
      source: { provider: "duffel", providerOfferId: o.id, rung, fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), expiresAt: o.expires_at ? new Date(o.expires_at).toISOString().replace(/\.\d+Z$/, "Z") : undefined, fake: false },
      slices,
      price: { total: { amountMinor: minor(o.total_amount, o.total_currency), currency: o.total_currency }, base: o.base_amount ? { amountMinor: minor(o.base_amount, o.total_currency), currency: o.total_currency } : undefined, taxes: o.tax_amount ? { amountMinor: minor(o.tax_amount, o.total_currency), currency: o.total_currency } : undefined },
      validatingCarrier: o.owner.iata_code,
      ticketing: "SINGLE_TICKET",
      brand: brand ? { status: "KNOWN", value: { name: brand } } : { status: "UNKNOWN" },
      baggage,
      conditions: { change: cond(o.conditions?.change_before_departure), refund: cond(o.conditions?.refund_before_departure) },
      seatSelection: { status: "UNKNOWN" },
      seatMapAvailable: true,
      restrictions: [],
    }
  }

  async search(q: SliceQuery, ctx: CallContext): Promise<NormalisedOffer[]> {
    const passengers = q.passengers.map((p) => (p.type === "ADT" || p.type === "YTH" || p.type === "STU" ? { type: "adult" } : { age: p.age ?? (p.type === "INF" ? 1 : 8) }))
    const timeout = Math.max(2000, ctx.deadline.getTime() - Date.now() - 500)
    const res = await this.call<{ data: { offers: DuffelOffer[] } }>("POST", `/air/offer_requests?return_offers=true&supplier_timeout=${Math.min(timeout, 20000)}`, ctx, {
      data: { slices: q.slices.map((s) => ({ origin: s.origin, destination: s.destination, departure_date: s.date })), passengers, cabin_class: CABIN[q.cabin] ?? "economy", max_connections: Math.min(q.maxConnections, 2) },
    })
    const offers = res.data.offers.map((o) => this.normalise(o, ctx, "LIVE_OFFER")).filter((o): o is NormalisedOffer => !!o)
    if (offers.length === 0) throw new SupplierError("NO_AVAILABILITY", "No offers")
    return offers
  }

  async price(ref: OfferRef, ctx: CallContext): Promise<NormalisedOffer> {
    const res = await this.call<{ data: DuffelOffer }>("GET", `/air/offers/${encodeURIComponent(ref.providerOfferId)}?return_available_services=false`, ctx)
    const o = this.normalise(res.data, ctx, "PRICED_OFFER")
    if (!o) throw new SupplierError("SUPPLIER_UNKNOWN", "Offer could not be normalised")
    return o
  }

  /** One seat map per segment; an empty list is a normal response (ch. 7.1). */
  async seatMap(ref: OfferRef, ctx: CallContext): Promise<SeatMap[]> {
    const res = await this.call<{ data: { segment_id: string; cabins: { cabin_class: string; deck: number; wings?: { first_row_index: number; last_row_index: number }; rows: { sections: { elements: { type: string; designator?: string; available_services?: { total_amount: string; total_currency: string }[]; disclosures?: string[] }[] }[] }[] }[] }[] }>("GET", `/air/seat_maps?offer_id=${encodeURIComponent(ref.providerOfferId)}`, ctx)
    const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z")
    return res.data.map((sm) => ({
      segmentRef: sm.segment_id,
      source: { provider: "duffel", fetchedAt },
      cabins: sm.cabins.map((c) => ({
        cabinClass: CABIN_BACK[c.cabin_class] ?? "ECONOMY",
        deck: (c.deck === 1 ? 1 : 0) as 0 | 1,
        wings: c.wings ? { firstRow: c.wings.first_row_index, lastRow: c.wings.last_row_index } : undefined,
        rows: c.rows.map((r) => ({
          sections: r.sections.map((s) => ({
            elements: s.elements.map((e): SeatElement => e.type === "seat"
              ? { type: "seat", designator: e.designator ?? "", available: (e.available_services ?? []).length > 0, price: e.available_services?.[0] && Number(e.available_services[0].total_amount) > 0 ? { amountMinor: minor(e.available_services[0].total_amount, e.available_services[0].total_currency), currency: e.available_services[0].total_currency } : undefined, characteristics: e.disclosures ?? [] }
              : { type: (["empty", "exit_row", "lavatory", "galley", "closet", "stairs", "bassinet"].includes(e.type) ? e.type : "empty") as "empty" }),
          })),
        })),
      })),
    }))
  }

  async healthCheck(ctx: CallContext): Promise<HealthResult> {
    const t = Date.now()
    await this.call("GET", "/air/airlines?limit=1", ctx)
    return { ok: true, latencyMs: Date.now() - t, detail: "GET /air/airlines" }
  }
}
