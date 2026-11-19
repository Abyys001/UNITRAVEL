import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { Segment } from "@unitravel/contracts"

import { reference } from "../../../../../test/fixtures/apify/helpers"
import { clock, normaliseSchedule, type ScheduleContext } from "./normalise"

// Rows in the documented flightsFuture shape (aviation-edge.com, 10 Nov 2026). No live key exists, so these are hand-made, not observed.
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "ika-ist.json"), "utf8")) as unknown[]
const ctx: ScheduleContext = { reference, origin: "IKA", destination: "IST", date: "2026-11-18" }

describe("Aviation Edge future schedule to flights (ADR-0036)", () => {
  const out = normaliseSchedule(fixture, ctx)
  const by = (key: string) => out.flights.find((f) => f.identityKey === key)

  it("builds valid segments keyed by flight number and local departure", () => {
    for (const f of out.flights) expect(() => Segment.parse(f.segment)).not.toThrow()
    expect(out.flights.map((f) => f.identityKey)).toEqual(["TK879|2026-11-18T02:55", "PC1|2026-11-18T08:00", "W51141|2026-11-18T12:00", "TK881|2026-11-18T23:30"])
  })

  it("reads HH:MM in the airport zone and derives the UTC instant", () => {
    const s = by("TK879|2026-11-18T02:55")!.segment
    // Tehran is UTC+3:30 (no DST since 2022); Istanbul UTC+3.
    expect(s.departure).toEqual({ local: "2026-11-18T02:55", utc: "2026-11-17T23:25:00Z", tz: "Asia/Tehran" })
    expect(s.arrival).toEqual({ local: "2026-11-18T05:20", utc: "2026-11-18T02:20:00Z", tz: "Europe/Istanbul" })
  })

  it("moves an arrival that is not after the departure to the next day", () => {
    const s = by("TK881|2026-11-18T23:30")!.segment
    expect(s.arrival.local).toBe("2026-11-19T02:10")
    expect(Date.parse(s.arrival.utc) - Date.parse(s.departure.utc)).toBe(190 * 60_000)
  })

  it("drops a row whose duration would be 20 h or more, with a notice", () => {
    expect(out.flights.some((f) => f.identityKey.startsWith("TK883"))).toBe(false)
    expect(out.notices).toContain("DURATION_IMPLAUSIBLE TK883")
  })

  it("keeps terminal and aircraft only when present", () => {
    const full = by("TK879|2026-11-18T02:55")!.segment
    expect(full.origin.terminal).toBe("1")
    expect(full.destination.terminal).toBe("I")
    expect(full.aircraft).toBe("A321")
    const bare = by("PC1|2026-11-18T08:00")!.segment
    expect(bare.origin).toEqual({ iata: "IKA" })
    expect(bare.destination).toEqual({ iata: "IST" })
    // modelText empty, modelCode "A321" is the fallback; a row with neither has no key at all.
    expect(by("TK881|2026-11-18T23:30")!.segment.aircraft).toBe("A320")
  })

  it("keeps the predicted gate and ICAO codes for staff only", () => {
    const f = by("TK879|2026-11-18T02:55")!
    expect(f.providerData).toMatchObject({ departureGate: "G12", departureIcao: "OIIE", arrivalIcao: "LTFM", airlineIcao: "THY" })
    expect(JSON.stringify(f.segment)).not.toContain("G12")
  })

  it("dedupes, drops other routes, bad numbers and malformed rows, each with a notice", () => {
    expect(out.flights.filter((f) => f.identityKey.startsWith("TK879"))).toHaveLength(1)
    expect(out.notices).toContain("DUPLICATE_ROW 1")
    expect(out.notices).toContain("UNREQUESTED_ROUTE IKA-SAW")
    expect(out.notices.some((n) => n.startsWith("MALFORMED_ROW TKABCDE") || n === "MALFORMED_ROW TK?")).toBe(true)
    expect(out.notices).toContain("MALFORMED_ROW 1")
  })

  it("drops a row for an airport without a time zone", () => {
    const unknown = normaliseSchedule(fixture.slice(0, 1), { ...ctx, origin: "IKA", destination: "ZZZ" })
    expect(unknown.flights).toEqual([])
    const rows = [{ ...(fixture[0] as object), arrival: { ...((fixture[0] as { arrival: object }).arrival), iataCode: "ZZZ" } }]
    expect(normaliseSchedule(rows, { ...ctx, destination: "ZZZ" }).notices).toContain("UNKNOWN_AIRPORT ZZZ")
  })

  it("returns nothing for an empty list", () => {
    expect(normaliseSchedule([], ctx)).toEqual({ flights: [], notices: [] })
  })

  it("accepts HH:MM:SS and ISO timestamps with either T", () => {
    expect(["06:05", "06:05:30", "2026-11-18T06:05:00", "2026-11-18t06:05:00Z", "2026-11-18 06:05"].map(clock)).toEqual(Array(5).fill("06:05"))
    expect(["", "25:00", "6:05 pm", "noon"].map(clock)).toEqual([undefined, undefined, undefined, undefined])
  })
})
