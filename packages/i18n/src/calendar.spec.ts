import { describe, expect, it } from "vitest"

import { addDays, firstOfMonth, monthDays, monthWeeks, nightsBetween, shiftMonth, weekdaySample } from "./calendar"

describe("stay calendar", () => {
  it("counts nights across a month end", () => {
    expect(nightsBetween("2026-11-29", "2026-12-02")).toBe(3)
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  })

  it("finds Gregorian month boundaries", () => {
    expect(firstOfMonth("2026-12-15", "GREGORIAN")).toBe("2026-12-01")
    expect(monthDays("2028-02-10", "GREGORIAN")).toHaveLength(29)
    expect(shiftMonth("2026-12-15", 1, "GREGORIAN")).toBe("2027-01-01")
    expect(shiftMonth("2026-01-15", -1, "GREGORIAN")).toBe("2025-12-01")
  })

  it("finds Jalali month boundaries", () => {
    // 1 Farvardin 1405 is 21 March 2026; Farvardin has 31 days and Esfand 29 in a common year.
    expect(firstOfMonth("2026-03-25", "JALALI")).toBe("2026-03-21")
    expect(monthDays("2026-03-25", "JALALI")).toHaveLength(31)
    expect(shiftMonth("2026-03-25", 1, "JALALI")).toBe("2026-04-21")
    expect(shiftMonth("2026-03-25", -1, "JALALI")).toBe("2026-02-20")
    expect(monthDays("2026-03-01", "JALALI")).toHaveLength(29)
  })

  it("shifts by several months without drifting", () => {
    expect(shiftMonth(shiftMonth("2026-03-25", 12, "JALALI"), -12, "JALALI")).toBe("2026-03-21")
    expect(shiftMonth(shiftMonth("2026-03-25", 12, "GREGORIAN"), -12, "GREGORIAN")).toBe("2026-03-01")
  })

  it("lays months out from the right weekday", () => {
    // 1 Dec 2026 is a Tuesday: one blank in a Monday week. 1 Azar 1405 (22 Nov 2026) is a Sunday: one blank in a Saturday week.
    expect(monthWeeks("2026-12-10", "GREGORIAN")[0]!.slice(0, 2)).toEqual([null, "2026-12-01"])
    expect(monthWeeks("2026-12-10", "JALALI")[0]!.slice(0, 2)).toEqual([null, "2026-11-22"])
    for (const w of monthWeeks("2026-12-10", "JALALI")) expect(w).toHaveLength(7)
  })

  it("starts header weeks on Saturday (Jalali) and Monday (Gregorian)", () => {
    expect(new Date(`${weekdaySample("JALALI")[0]}T12:00:00Z`).getUTCDay()).toBe(6)
    expect(new Date(`${weekdaySample("GREGORIAN")[0]}T12:00:00Z`).getUTCDay()).toBe(1)
  })
})
