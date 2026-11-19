import { describe, expect, it } from "vitest"

import { makeSegment } from "./factory"
import { segmentsVerdict } from "./filter"
import { scheduleBudget, type ScheduleSlotState, selectScheduleSlots } from "./schedule-pacer"
import type { CarrierPolicy, ReferenceLookup } from "./types"

const NOW = new Date("2026-11-10T08:00:00Z")
const W = { minDaysAhead: 7, maxDaysAhead: 60 }
const slot = (id: string, date: string, over: Partial<ScheduleSlotState> = {}): ScheduleSlotState => ({ id, routeKind: "DIRECT", departureDate: date, lastFetchedAt: null, nextDueAt: null, ...over })

describe("selectScheduleSlots (ADR-0036 E5)", () => {
  it("keeps DIRECT slots inside the window only", () => {
    const out = selectScheduleSlots([slot("near", "2026-11-14"), slot("min", "2026-11-17"), slot("max", "2027-01-09"), slot("far", "2027-01-10"), slot("comb", "2026-11-20", { routeKind: "COMBINED" })], W, NOW, 10)
    expect(out.map((s) => s.id)).toEqual(["min", "max"])
  })

  it("skips a slot that is not yet due", () => {
    const fresh = slot("fresh", "2026-11-20", { lastFetchedAt: new Date("2026-11-09T00:00:00Z"), nextDueAt: new Date("2026-11-12T00:00:00Z") })
    const due = slot("due", "2026-11-21", { lastFetchedAt: new Date("2026-11-01T00:00:00Z"), nextDueAt: new Date("2026-11-04T00:00:00Z") })
    expect(selectScheduleSlots([fresh, due], W, NOW, 10).map((s) => s.id)).toEqual(["due"])
  })

  it("orders never-fetched first (nearer date first), then the oldest fetch", () => {
    const old = slot("old", "2026-11-18", { lastFetchedAt: new Date("2026-10-01T00:00:00Z"), nextDueAt: new Date("2026-10-04T00:00:00Z") })
    const older = slot("older", "2026-11-30", { lastFetchedAt: new Date("2026-09-01T00:00:00Z"), nextDueAt: new Date("2026-09-04T00:00:00Z") })
    const never2 = slot("never-far", "2026-12-20")
    const never1 = slot("never-near", "2026-11-19")
    expect(selectScheduleSlots([old, never2, older, never1], W, NOW, 10).map((s) => s.id)).toEqual(["never-near", "never-far", "older", "old"])
  })

  it("caps at the limit", () => {
    expect(selectScheduleSlots([slot("a", "2026-11-20"), slot("b", "2026-11-21"), slot("c", "2026-11-22")], W, NOW, 2)).toHaveLength(2)
    expect(selectScheduleSlots([slot("a", "2026-11-20")], W, NOW, 0)).toEqual([])
  })
})

describe("scheduleBudget (ADR-0036 E6)", () => {
  it("shares (monthly - reserve - used) over the 4-hour ticks left in the UTC month", () => {
    // 2026-11-10T08:00Z to 2026-12-01T00:00Z = 496 h = 124 ticks.
    const b = scheduleBudget({ monthlyCalls: 30_000, reserveCalls: 500, usedCalls: 1_000, maxSlotsPerRun: 1_000, now: NOW })
    expect(b.ticksLeft).toBe(124)
    expect(b.availableCalls).toBe(28_500)
    expect(b.slotsAllowed).toBe(Math.floor(28_500 / 124))
    expect(b.monthEnd.toISOString()).toBe("2026-12-01T00:00:00.000Z")
  })

  it("is capped by maxSlotsPerRun and pauses when nothing is left", () => {
    expect(scheduleBudget({ monthlyCalls: 30_000, reserveCalls: 500, usedCalls: 0, maxSlotsPerRun: 50, now: NOW }).slotsAllowed).toBe(50)
    const spent = scheduleBudget({ monthlyCalls: 1_000, reserveCalls: 500, usedCalls: 600, maxSlotsPerRun: 50, now: NOW })
    expect(spent).toMatchObject({ availableCalls: 0, slotsAllowed: 0, paused: true })
  })

  it("has one tick left on the last hours of the month", () => {
    expect(scheduleBudget({ monthlyCalls: 100, reserveCalls: 0, usedCalls: 0, maxSlotsPerRun: 500, now: new Date("2026-11-30T23:00:00Z") })).toMatchObject({ ticksLeft: 1, slotsAllowed: 100 })
  })
})

describe("segmentsVerdict (ADR-0036 E9)", () => {
  const AIRPORTS: Record<string, { country: string; tz: string }> = { IKA: { country: "IR", tz: "Asia/Tehran" }, IST: { country: "TR", tz: "Europe/Istanbul" }, LHR: { country: "GB", tz: "Europe/London" } }
  const ref: ReferenceLookup = { airport: (i) => (AIRPORTS[i] ? ({ iata: i, nameEn: i, nameFa: i, cityCode: null, regions: [], ...AIRPORTS[i]! }) : undefined), cityAirports: () => [] }
  const policy = (over: Partial<CarrierPolicy> = {}): CarrierPolicy => ({ blockedCarriers: new Set(), reviewCarriers: new Set(), blockedAirports: new Set(), reviewAirports: new Set(), ...over })
  const seg = (carrier: string, from = "IST", to = "LHR") => makeSegment({ carrier, number: "1", from, to, dep: "2026-11-20T10:00", arr: "2026-11-20T12:00", fromTz: AIRPORTS[from]!.tz, toTz: AIRPORTS[to]!.tz })

  it("blocks a blocked marketing carrier, operating carrier or airport", () => {
    expect(segmentsVerdict([seg("IR")], policy({ blockedCarriers: new Set(["IR"]) }), ref)).toBe("BLOCK")
    expect(segmentsVerdict([{ ...seg("TK"), operating: { carrier: "W5" } }], policy({ blockedCarriers: new Set(["W5"]) }), ref)).toBe("BLOCK")
    expect(segmentsVerdict([seg("TK")], policy({ blockedAirports: new Set(["LHR"]) }), ref)).toBe("BLOCK")
  })

  it("applies lane policies: BLOCK wins over REVIEW", () => {
    expect(segmentsVerdict([seg("TK", "IKA", "IST")], policy({ reviewLanes: new Set(["IR:*"]) }), ref)).toBe("REVIEW")
    expect(segmentsVerdict([seg("TK", "IKA", "IST")], policy({ reviewLanes: new Set(["IR:*"]), blockedLanes: new Set(["IR:*"]) }), ref)).toBe("BLOCK")
    expect(segmentsVerdict([seg("TK")], policy({ reviewLanes: new Set(["IR:*"]) }), ref)).toBeNull()
  })
})
