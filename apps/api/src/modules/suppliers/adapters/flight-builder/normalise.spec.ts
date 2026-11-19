import { describe, expect, it } from "vitest"

import { FlightBuilderCaptureInput } from "@unitravel/contracts"

import { FlightBuilderInputError, identityOf, normalise } from "./normalise"

const TZ: Record<string, string> = { IST: "Europe/Istanbul", LHR: "Europe/London", IKA: "Asia/Tehran", SAW: "Europe/Istanbul" }
const reference = { airport: (i: string) => (TZ[i] ? { iata: i, country: "XX", tz: TZ[i]!, cityCode: null, regions: [], nameEn: i, nameFa: i } : undefined), cityAirports: () => [] as string[] }
const ctx = { reference, confirmedBy: "staff-1", now: new Date("2026-11-19T10:00:00Z") }

const known = { status: "KNOWN" as const, value: { pieces: 1, kgPerPiece: 23 } }
const bag = (segmentIndex: number, checked: object = known) => ({ segmentIndex, passengerType: "ADT", checked, cabin: { status: "UNKNOWN" } })
const fare = (over: Record<string, unknown> = {}) => ({
  cabin: "ECONOMY", bookingClasses: ["Y"], seats: ["9"], fareBasis: [], fareType: "PUB", totalMinor: 30000, currency: "EUR",
  baggage: [bag(0)], change: { state: "UNKNOWN" }, refund: { state: "NOT_ALLOWED" }, ...over,
})
const seg = { carrier: "TK", flightNumber: "1999", from: "IST", to: "LHR", departLocal: "2026-11-25T08:00", arriveLocal: "2026-11-25T10:00" }
const input = (over: Record<string, unknown> = {}) =>
  FlightBuilderCaptureInput.parse({ observedAt: "2026-11-19T09:00:00Z", segments: [seg], fares: [fare()], ...over })

describe("flight-builder normalise (ADR-0037)", () => {
  it("one segment: zones from reference data, UTC from local time, rep fare is the cheapest", () => {
    const out = normalise(input({ fares: [fare({ totalMinor: 50000, bookingClasses: ["J"], cabin: "BUSINESS" }), fare({ totalMinor: 30000 })] }), ctx)
    const s = out.offer.slices[0]!.segments[0]!
    expect(s.departure).toMatchObject({ tz: "Europe/Istanbul", utc: "2026-11-25T05:00:00Z" })
    expect(s.arrival).toMatchObject({ tz: "Europe/London", utc: "2026-11-25T10:00:00Z" })
    expect(out.offer.slices[0]!.durationMin).toBe(300)
    expect(out.offer.price.total).toEqual({ amountMinor: 30000, currency: "EUR" })
    expect(out.offer.source).toMatchObject({ provider: "flight-builder", rung: "MANUAL", fake: false })
    expect(out.fares.map((f) => f.position)).toEqual([0, 1])
    expect(out.identityKey).toBe("fb:TK1999:2026-11-25")
  })

  it("multi-segment: booking class and baggage map per segment; a disconnected or overlapping connection is rejected", () => {
    const two = [seg, { carrier: "TK", flightNumber: "1971", from: "LHR", to: "IKA", departLocal: "2026-11-25T14:00", arriveLocal: "2026-11-25T23:30" }]
    const noBag = { status: "KNOWN", value: { pieces: 0 } }
    const out = normalise(input({ segments: two, fares: [fare({ bookingClasses: ["Y", "B"], seats: ["4", "9"], baggage: [bag(0), bag(1, noBag)], fareBasis: ["YOW", "BOW"] })] }), ctx)
    const segs = out.offer.slices[0]!.segments
    expect(segs.map((x) => x.bookingClass)).toEqual(["Y", "B"])
    expect(segs.map((x) => x.fareBasis)).toEqual(["YOW", "BOW"])
    expect(out.offer.baggage.map((b) => [b.segmentIndex, b.checked])).toEqual([[0, known], [1, noBag]])
    expect(identityOf({ segments: input({ segments: two, fares: [fare({ bookingClasses: ["Y", "B"], seats: ["4", "9"], baggage: [bag(0), bag(1)] })] }).segments })).toBe("fb:TK1999,TK1971:2026-11-25")
    const apart = [seg, { ...two[1]!, from: "SAW" }]
    expect(() => normalise(input({ segments: apart, fares: [fare({ bookingClasses: ["Y", "B"], seats: ["4", "9"], baggage: [bag(0), bag(1)] })] }), ctx)).toThrow(FlightBuilderInputError)
    const early = [seg, { ...two[1]!, departLocal: "2026-11-25T09:00", arriveLocal: "2026-11-25T20:00" }]
    expect(() => normalise(input({ segments: early, fares: [fare({ bookingClasses: ["Y", "B"], seats: ["4", "9"], baggage: [bag(0), bag(1)] })] }), ctx)).toThrow(/before the previous/)
  })

  it("seats stay raw: '9' is kept as written, never turned into a count", () => {
    const out = normalise(input({ fares: [fare({ seats: ["9"] })] }), ctx)
    expect(out.fares[0]!.seatsRaw).toEqual(["9"])
  })

  it("conditions are tri-state and a penalty appears only for the staff-entered amount", () => {
    const out = normalise(input({ fares: [fare({ change: { state: "KNOWN_ALLOWED", penaltyMinor: 7500 }, refund: { state: "UNKNOWN" } })] }), ctx)
    expect(out.offer.conditions.change).toEqual({ status: "KNOWN", value: { allowed: true, penalty: { amountMinor: 7500, currency: "EUR" } } })
    expect(out.offer.conditions.refund).toEqual({ status: "UNKNOWN" })
    const notAllowed = normalise(input(), ctx)
    expect(notAllowed.offer.conditions.change).toEqual({ status: "UNKNOWN" })
    expect(notAllowed.offer.conditions.refund).toEqual({ status: "KNOWN", value: { allowed: false } })
    expect(out.fares[0]!.conditions).toMatchObject({ confirmedBy: "staff-1", confirmedAt: "2026-11-19T10:00:00.000Z" })
  })

  it("currency and the ticketing deadline pass through; brand and unknown fare type stay unknown", () => {
    const out = normalise(input({ fares: [fare({ currency: "USD", ticketingDeadline: "2026-11-22", fareType: "OTHER", fareTypeRaw: "XYZ" })] }), ctx)
    expect(out.offer.price.total.currency).toBe("USD")
    expect(out.fares[0]).toMatchObject({ ticketingDeadline: "2026-11-22", fareType: "OTHER", fareTypeRaw: "XYZ", currency: "USD" })
    expect(out.offer.brand).toEqual({ status: "UNKNOWN" })
  })

  it("never fills in what it does not know: unknown airport, wrong zone, impossible times and a bad baggage index are input errors", () => {
    expect(() => normalise(input({ segments: [{ ...seg, to: "ZZZ" }] }), ctx)).toThrow(/Unknown airport/)
    expect(() => normalise(input({ segments: [{ ...seg, departTz: "Asia/Tehran" }] }), ctx)).toThrow(/not Asia\/Tehran/)
    expect(() => normalise(input({ segments: [{ ...seg, arriveLocal: "2026-11-25T03:00" }] }), ctx)).toThrow(/after departure/)
    expect(() => normalise(input({ fares: [fare({ baggage: [bag(3)] })] }), ctx)).toThrow(/No such segment/)
  })
})
