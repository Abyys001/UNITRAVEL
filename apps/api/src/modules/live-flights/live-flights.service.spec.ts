import { LiveFlightItem, LiveFlightsQuery } from "@unitravel/contracts"
import { describe, expect, it } from "vitest"

import { AREAS, buildView, regionOf, toLiveItem } from "./live-flights.service"

const NOW = Date.parse("2026-11-01T16:00:00Z")
const raw = (over: Record<string, unknown> = {}) => ({ hex: "4baa01", flight: "THY1234 ", t: "A321", category: "A3", lat: 41, lon: 29, alt_baro: 35000, gs: 451.6, seen_pos: 2, ...over })
const q = (o: Record<string, unknown> = {}) => LiveFlightsQuery.parse(o)

describe("live flights (ADR-0027)", () => {
  it("maps an airline flight to a strict item with no price, route or position", () => {
    const item = toLiveItem(raw(), NOW)!
    expect(LiveFlightItem.strict().safeParse(item).success).toBe(true)
    expect(item).toMatchObject({ label: "LIVE_POSITION", callsign: "THY1234", region: "TURKEY", altitudeFt: 35000, groundSpeedKt: 452, seenAt: "2026-11-01T15:59:58.000Z" })
  })

  it.each([
    ["private registration as callsign", { flight: "GABCD" }],
    ["no callsign", { flight: undefined }],
    ["light aircraft", { category: "A1" }],
    ["helicopter", { category: "A7" }],
    ["military", { dbFlags: 1 }],
    ["privacy address", { dbFlags: 4 }],
    ["owner-restricted", { dbFlags: 8 }],
    ["on the ground", { alt_baro: "ground" }],
    ["no position", { lat: undefined }],
    ["non-ICAO address", { hex: "~abc123" }],
    ["outside every region", { lat: 40, lon: -74 }],
    ["malformed", { lat: "41" }],
  ])("drops %s", (_name, over) => {
    expect(toLiveItem(raw(over), NOW)).toBeNull()
  })

  it("assigns the smaller regions before Europe", () => {
    expect(regionOf(25.2, 55.3)).toBe("UAE")
    expect(regionOf(41, 29)).toBe("TURKEY")
    expect(regionOf(35.7, 51.4)).toBe("IRAN")
    expect(regionOf(51.5, -0.5)).toBe("EUROPE")
    expect(regionOf(40, -74)).toBeNull()
  })

  it("every area centre sits in or near a region", () => {
    for (const [lat, lon] of AREAS) expect(regionOf(lat, lon) ?? regionOf(lat + 4, lon)).not.toBeNull()
  })

  it("keeps the newest report of an aircraft seen by two areas, filters, and counts regions before filtering", () => {
    const older = toLiveItem(raw({ seen_pos: 30 }), NOW)!
    const newer = toLiveItem(raw({ seen_pos: 1 }), NOW)!
    const eu = toLiveItem(raw({ hex: "400001", flight: "BAW12", lat: 51.5, lon: -0.5 }), NOW)!
    const snaps = [{ fetchedAt: "2026-11-01T15:58:00Z", items: [older, eu] }, { fetchedAt: "2026-11-01T16:00:00Z", items: [newer] }]

    const all = buildView(snaps, q())
    expect(all).toMatchObject({ total: 2, regions: { TURKEY: 1, EUROPE: 1, UAE: 0, IRAN: 0 }, updatedAt: "2026-11-01T16:00:00Z", notice: null })
    expect(all.items.map((i) => i.callsign)).toEqual(["BAW12", "THY1234"])
    expect(all.items[1]!.seenAt).toBe(newer.seenAt)

    expect(buildView(snaps, q({ region: "TURKEY" })).items.map((i) => i.callsign)).toEqual(["THY1234"])
    const byCallsign = buildView(snaps, q({ q: "baw" }))
    expect(byCallsign.items.map((i) => i.callsign)).toEqual(["BAW12"])
    expect(byCallsign.regions.TURKEY).toBe(1)
    expect(buildView(snaps, q({ limit: 1 }))).toMatchObject({ total: 2, items: [{ callsign: "BAW12" }] })
  })

  it("says NO_DATA rather than inventing anything when nothing is held", () => {
    expect(buildView([], q())).toMatchObject({ items: [], total: 0, updatedAt: null, notice: "NO_DATA" })
  })
})
