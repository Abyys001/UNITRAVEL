import type { NormalisedOffer, SeatElement, SeatMap } from "@unitravel/contracts"
import { localToUtc, utcToLocal } from "@unitravel/engine"

import { sandboxAllowed } from "../../../core/env"
import { type CallContext, type Capabilities, type FlightSupplierAdapter, type HealthResult, type OfferRef, type SliceQuery, SupplierError } from "../adapter"
import { FAKE_OFFERS, hash32, type LegTemplate, type OfferTemplate } from "./fake-network"

interface FakeId { t: number[]; d: string[]; c: string; p: string; r: number[]; f: string }
const CABIN_FACTOR: Record<string, number> = { ECONOMY: 1, PREMIUM_ECONOMY: 1.7, BUSINESS: 3.2, FIRST: 5 }
const OFFER_TTL_MS = 30 * 60_000

function reverse(t: OfferTemplate, i: number): OfferTemplate {
  // Return direction: legs reversed, a different flight number and a departure a few hours later.
  const legs = [...t.legs].reverse().map((l, k) => ({ ...l, from: l.to, to: l.from, number: String(Number(l.number) + 1), dep: shift(l.dep, 180 + k * 60 + (i % 3) * 30), terminals: l.terminals ? [l.terminals[1], l.terminals[0]] as [string, string] : undefined }))
  return { ...t, legs }
}
function shift(hhmm: string, minutes: number) {
  const m = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + minutes) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** All templates in both directions, indexed: even = as written, odd = reversed. */
const TEMPLATES: OfferTemplate[] = FAKE_OFFERS.flatMap((t, i) => [t, reverse(t, i)])

/**
 * Deterministic FAKE supplier for local development and end-to-end tests (ch. 21.8). Every offer is labelled
 * fake; the adapter refuses to run unless APP_ENV=local (ADR-0014).
 */
export class FakeAdapter implements FlightSupplierAdapter {
  readonly id = "fake" as const

  constructor() {
    if (!sandboxAllowed()) {
      throw new Error("The FAKE supplier adapter only runs with APP_ENV=local (ADR-0014)")
    }
  }

  capabilities(): Capabilities {
    return { search: true, price: true, seatMap: true, order: false, cancel: false, ancillaries: false, cityCodes: true }
  }

  private airports(code: string, ctx: CallContext): string[] {
    const city = ctx.reference.cityAirports(code)
    return city.length ? city : [code]
  }

  private build(sliceTemplates: number[], dates: string[], q: SliceQuery, ctx: CallContext, fetchedAt: Date): NormalisedOffer | null {
    const segments: NormalisedOffer["slices"] = []
    let flat = 0
    const baggage: NormalisedOffer["baggage"] = []
    let priceMinor = 0
    for (let s = 0; s < sliceTemplates.length; s++) {
      const t = TEMPLATES[sliceTemplates[s]!]!
      const legs: NormalisedOffer["slices"][number]["segments"] = []
      let day = dates[s]!
      let prevArrUtc: string | null = null
      for (const leg of t.legs) {
        const fromTz = ctx.reference.airport(leg.from)?.tz
        const toTz = ctx.reference.airport(leg.to)?.tz
        if (!fromTz || !toTz) return null
        let depLocal = `${day}T${leg.dep}`
        let depUtc = localToUtc(depLocal, fromTz)
        if (prevArrUtc && Date.parse(depUtc) - Date.parse(prevArrUtc) < 60 * 60_000) {
          day = nextDay(day)
          depLocal = `${day}T${leg.dep}`
          depUtc = localToUtc(depLocal, fromTz)
        }
        const arrUtc = new Date(Date.parse(depUtc) + leg.durationMin * 60_000).toISOString().replace(".000Z", "Z")
        const arrLocal = utcToLocal(arrUtc, toTz)
        legs.push({
          marketing: { carrier: leg.carrier, flightNumber: leg.number }, operating: { carrier: leg.carrier, flightNumber: leg.number },
          origin: { iata: leg.from, terminal: leg.terminals?.[0] }, destination: { iata: leg.to, terminal: leg.terminals?.[1] },
          departure: { local: depLocal, utc: depUtc, tz: fromTz }, arrival: { local: arrLocal, utc: arrUtc, tz: toTz },
          cabin: q.cabin as never, bookingClass: q.cabin === "BUSINESS" ? "J" : "Y", fareBasis: `${q.cabin === "BUSINESS" ? "J" : "Y"}${leg.carrier}FAKE`, aircraft: leg.aircraft, technicalStops: [],
        })
        prevArrUtc = arrUtc
        day = arrLocal.slice(0, 10)
        const checked = t.bags === "UNKNOWN" ? { status: "UNKNOWN" as const } : { status: "KNOWN" as const, value: t.bags === "CABIN_ONLY" ? { pieces: 0 } : { pieces: 1, kgPerPiece: t.bags === "23KG" ? 23 : 20 } }
        baggage.push({ segmentIndex: flat++, passengerType: "ADT", checked, cabin: t.bags === "UNKNOWN" ? { status: "UNKNOWN" } : { status: "KNOWN", value: true } })
      }
      const first = legs[0]!.departure.local.slice(0, 10)
      if (!legs[0]!.departure.local.startsWith(dates[s]!)) return null
      const wd = new Date(`${first}T00:00:00Z`).getUTCDay()
      if (!t.legs[0]!.days.includes(wd)) return null
      const [lo, hi] = t.price
      const base = lo + (hash32(`${sliceTemplates[s]}|${dates[s]}`) % Math.max(1, hi - lo))
      priceMinor += Math.round(base * 100 * (CABIN_FACTOR[q.cabin] ?? 1))
      segments.push({ origin: legs[0]!.origin.iata, destination: legs[legs.length - 1]!.destination.iata, segments: legs, durationMin: Math.round((Date.parse(legs[legs.length - 1]!.arrival.utc) - Date.parse(legs[0]!.departure.utc)) / 60000) })
    }
    // Passenger mix: adults full fare, children 75%, lap infants 10%.
    const factor = q.passengers.reduce((s, p) => s + (p.type === "CHD" ? 0.75 : p.type === "INF" ? 0.1 : 1), 0)
    // Round trips on one ticket are priced a little below two one-ways, as suppliers typically do.
    const total = Math.round(priceMinor * factor * (sliceTemplates.length > 1 ? 0.92 : 1))
    const t0 = TEMPLATES[sliceTemplates[0]!]!
    const id: FakeId = { t: sliceTemplates, d: dates, c: q.cabin, p: q.passengers.map((p) => p.type).join(","), r: [total], f: fetchedAt.toISOString() }
    const conds = t0.conditions
    return {
      source: { provider: "fake", providerOfferId: `fake_${Buffer.from(JSON.stringify(id)).toString("base64url")}`, rung: "LIVE_OFFER", fetchedAt: fetchedAt.toISOString().replace(/\.\d+Z$/, "Z"), expiresAt: new Date(fetchedAt.getTime() + OFFER_TTL_MS).toISOString().replace(/\.\d+Z$/, "Z"), fake: true },
      slices: segments,
      price: { total: { amountMinor: total, currency: "GBP" }, base: { amountMinor: Math.round(total * 0.72), currency: "GBP" }, taxes: { amountMinor: total - Math.round(total * 0.72), currency: "GBP" } },
      validatingCarrier: t0.legs[0]!.carrier,
      ticketing: "SINGLE_TICKET",
      brand: t0.brand ? { status: "KNOWN", value: { name: t0.brand } } : { status: "UNKNOWN" },
      baggage,
      conditions: conds === "UNKNOWN" ? { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } }
        : conds === "FLEX" ? { change: { status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 5000, currency: "GBP" } } }, refund: { status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 10000, currency: "GBP" } } } }
        : { change: { status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 7500, currency: "GBP" } } }, refund: { status: "KNOWN", value: { allowed: false } } },
      seatSelection: t0.seatMap ? { status: "KNOWN", value: "PAID" } : { status: "UNKNOWN" },
      seatsRemaining: 2 + (hash32(id.f.slice(0, 13) + sliceTemplates.join()) % 7),
      seatMapAvailable: t0.seatMap,
      restrictions: ["FAKE_SUPPLIER"],
    }
  }

  async search(q: SliceQuery, ctx: CallContext): Promise<NormalisedOffer[]> {
    await sleep(150 + (hash32(JSON.stringify(q.slices)) % 900))
    const fetchedAt = new Date()
    const matches = (t: OfferTemplate, origin: string, dest: string) =>
      this.airports(origin, ctx).includes(t.legs[0]!.from) && this.airports(dest, ctx).includes(t.legs[t.legs.length - 1]!.to) && t.legs.length - 1 <= q.maxConnections
    const candidates = q.slices.map((s) => TEMPLATES.map((t, i) => (matches(t, s.origin, s.destination) ? i : -1)).filter((i) => i >= 0))
    const out: NormalisedOffer[] = []
    const combine = (idx: number, acc: number[]) => {
      if (idx === candidates.length) {
        const o = this.build(acc, q.slices.map((s) => s.date), q, ctx, fetchedAt)
        if (o) out.push(o)
        return
      }
      for (const c of candidates[idx]!) combine(idx + 1, [...acc, c])
    }
    combine(0, [])
    if (out.length === 0) throw new SupplierError("NO_AVAILABILITY", "No fake availability")
    return out.slice(0, 40)
  }

  async price(ref: OfferRef, ctx: CallContext): Promise<NormalisedOffer> {
    await sleep(120)
    const id = JSON.parse(Buffer.from(ref.providerOfferId.replace(/^fake_/, ""), "base64url").toString()) as FakeId
    if (Date.now() - Date.parse(id.f) > OFFER_TTL_MS) throw new SupplierError("OFFER_EXPIRED", "Fake offer expired")
    const q: SliceQuery = { slices: id.d.map((d) => ({ origin: "", destination: "", date: d })), passengers: id.p.split(",").map((type) => ({ type })), cabin: id.c, maxConnections: 3 }
    const rebuilt = this.build(id.t, id.d, q, ctx, new Date(id.f))
    if (!rebuilt) throw new SupplierError("OFFER_EXPIRED", "Fake offer no longer available")
    // One offer in six changes price on revalidation so the PRICE_CHANGED path can be exercised.
    const bump = hash32(ref.providerOfferId) % 6 === 0 ? 1.12 : 1
    const total = Math.round(rebuilt.price.total.amountMinor * bump)
    return { ...rebuilt, source: { ...rebuilt.source, rung: "PRICED_OFFER", fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") }, price: { ...rebuilt.price, total: { ...rebuilt.price.total, amountMinor: total } } }
  }

  /** Irregular, supplier-shaped cabin (row 13 missing, row 16 without seat B) — labelled FAKE, never shown in production. */
  async seatMap(ref: OfferRef): Promise<SeatMap[]> {
    const id = JSON.parse(Buffer.from(ref.providerOfferId.replace(/^fake_/, ""), "base64url").toString()) as FakeId
    const segs = id.t.flatMap((t) => TEMPLATES[t]!.legs)
    return segs.map((leg: LegTemplate, i) => {
      const rows = []
      for (let r = 11; r <= 30; r++) {
        if (r === 13) continue
        const seat = (l: string): SeatElement => {
          const h = hash32(`${ref.providerOfferId}${i}${r}${l}`)
          const exit = r === 14
          return { type: "seat", designator: `${r}${l}`, available: h % 4 !== 0, price: exit || r < 13 ? { amountMinor: exit ? 2800 : 1800, currency: "GBP" } : undefined, characteristics: [...(l === "A" || l === "F" ? ["WINDOW"] : []), ...(l === "C" || l === "D" ? ["AISLE"] : []), ...(exit ? ["EXIT_ROW", "EXTRA_LEGROOM"] : [])] }
        }
        const left = r === 16 ? [seat("A"), { type: "empty" as const }, seat("C")] : [seat("A"), seat("B"), seat("C")]
        rows.push({ sections: [{ elements: left }, { elements: [seat("D"), seat("E"), seat("F")] }] })
      }
      return { segmentRef: `${i}:${leg.carrier}${leg.number}`, source: { provider: "fake" as const, fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") }, cabins: [{ cabinClass: (id.c as never) ?? "ECONOMY", deck: 0 as const, wings: { firstRow: 14, lastRow: 22 }, rows }] }
    })
  }

  async healthCheck(): Promise<HealthResult> {
    return { ok: true, latencyMs: 1, detail: "FAKE adapter (local/test only)" }
  }
}

function nextDay(d: string) {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
