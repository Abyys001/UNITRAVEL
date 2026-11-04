import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { type CatalogSettings, DEFAULT_CATALOG_SETTINGS, DEFAULT_ENGINE_RULES } from "@unitravel/contracts"

import { joinAtHub } from "./build"
import { makeOffer } from "./factory"
import {
  APIFY_ROW_USD, APIFY_START_USD, adminRunCap, backoffFactor, catalogEngineRules, estimateMonthly, foldDemand, type PacerRoute, type PacerSlot,
  selectRun, slotStatus, tickBudget, tierFor,
} from "./pacer"
import { RuleResolver } from "./rules"

const S: CatalogSettings = DEFAULT_CATALOG_SETTINGS
const HOUR = 3_600_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

describe("tiers and back-off", () => {
  it("maps days out to the brief's tiers (0–2 / 3–7 / 8–14)", () => {
    expect(tierFor(0, S.tiers).intervalHours).toBe(8)
    expect(tierFor(2, S.tiers).intervalHours).toBe(8)
    expect(tierFor(3, S.tiers).intervalHours).toBe(24)
    expect(tierFor(7, S.tiers).intervalHours).toBe(24)
    expect(tierFor(8, S.tiers).intervalHours).toBe(72)
    expect(tierFor(14, S.tiers).intervalHours).toBe(72)
  })
  it("doubles after 2 empties, capped at ×8", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => backoffFactor(n, S))).toEqual([1, 1, 2, 4, 8, 8, 8])
  })
  it("derives FRESH / AGING / STALE / EMPTY / NEVER", () => {
    const now = new Date("2026-11-04T12:00:00Z")
    const base = { departureDate: "2026-11-05", recentCounts: [3], consecutiveErrors: 0, consecutiveEmpty: 0 }
    expect(slotStatus({ ...base, lastFetchedAt: null, recentCounts: [] }, S, now)).toBe("NEVER")
    expect(slotStatus({ ...base, lastFetchedAt: new Date(now.getTime() - 2 * HOUR) }, S, now)).toBe("FRESH")
    expect(slotStatus({ ...base, lastFetchedAt: new Date(now.getTime() - 10 * HOUR) }, S, now)).toBe("AGING")
    expect(slotStatus({ ...base, lastFetchedAt: new Date(now.getTime() - 30 * HOUR) }, S, now)).toBe("STALE")
    expect(slotStatus({ ...base, lastFetchedAt: now, recentCounts: [0] }, S, now)).toBe("EMPTY")
  })
})

describe("tick budget", () => {
  const cycleEnd = new Date("2026-12-01T00:00:00Z")
  it("keeps the admin reserve and the safety margin out of refresh spend", () => {
    const b = tickBudget({ settings: S, spentUsd: 1, adminSpentUsd: 0, cycleEnd, now: new Date("2026-11-11T00:00:00Z") })
    expect(b.availableUsd).toBeCloseTo(5 - 0.2 - 0.75 - 1)
    expect(b.ticksLeft).toBe(120)
    expect(b.adminAvailableUsd).toBeCloseTo(0.75)
  })
  it("draws admin spend from the reserve first, not twice", () => {
    const b = tickBudget({ settings: S, spentUsd: 1.3, adminSpentUsd: 0.3, cycleEnd, now: new Date("2026-11-11T00:00:00Z") })
    expect(b.availableUsd).toBeCloseTo(5 - 0.2 - 0.45 - 1.3)
    expect(b.adminAvailableUsd).toBeCloseTo(0.45)
  })
  it("releases the unused reserve in the last 12 h", () => {
    const b = tickBudget({ settings: S, spentUsd: 3.5, adminSpentUsd: 0.1, cycleEnd, now: new Date("2026-11-30T13:00:00Z") })
    expect(b.reserveReleased).toBe(true)
    expect(b.availableUsd).toBeCloseTo(5 - 0.2 - 3.5)
  })
  it("pauses when nothing is left", () => {
    const b = tickBudget({ settings: S, spentUsd: 4.2, adminSpentUsd: 0, cycleEnd, now: new Date("2026-11-20T00:00:00Z") })
    expect(b.paused).toBe(true)
    expect(selectRun([], new Map(), S, b, new Date())).toBeNull()
  })
  it("refuses an admin run the reserve cannot cover", () => {
    const b = tickBudget({ settings: S, spentUsd: 1, adminSpentUsd: 0.74, cycleEnd, now: new Date("2026-11-11T00:00:00Z") })
    expect(adminRunCap(1, 30, b, S)).toBeNull()
    expect(adminRunCap(1, 5, tickBudget({ settings: S, spentUsd: 1, adminSpentUsd: 0, cycleEnd, now: new Date("2026-11-11T00:00:00Z") }), S)).toEqual({ estUsd: 0.006, maxTotalChargeUsd: 0.006 })
  })
})

describe("run selection", () => {
  const now = new Date("2026-11-04T12:00:00Z")
  const routes = new Map<string, PacerRoute>([["a", { id: "a", enabled: true, maxResults: 3, priorityWeight: 1 }], ["b", { id: "b", enabled: true, maxResults: 5, priorityWeight: 1 }]])
  const slot = (id: string, routeId: string, date: string, last: Date | null): PacerSlot => ({ id, routeId, departureDate: date, lastFetchedAt: last, recentCounts: [], consecutiveEmpty: 0, consecutiveErrors: 0, lastErrorAt: null, demandScore: 0 })
  const b = tickBudget({ settings: S, spentUsd: 0, adminSpentUsd: 0, cycleEnd: new Date("2026-12-01T00:00:00Z"), now })

  it("puts only one maxResults group in a run, because maxResults is run-level", () => {
    const plan = selectRun([slot("1", "a", "2026-11-05", null), slot("2", "b", "2026-11-05", null), slot("3", "a", "2026-11-06", null)], routes, S, b, now)!
    expect(new Set(plan.slots.map((s) => s.routeId)).size).toBe(1)
    expect(plan.maxTotalChargeUsd).toBeGreaterThanOrEqual(plan.estUsd)
  })
  it("never picks a slot inside the 4 h floor", () => {
    expect(selectRun([slot("1", "a", "2026-11-05", new Date(now.getTime() - 3 * HOUR))], routes, S, b, now)).toBeNull()
  })
  it("skips disabled routes and past dates", () => {
    const off = new Map(routes)
    off.set("a", { ...routes.get("a")!, enabled: false })
    expect(selectRun([slot("1", "a", "2026-11-05", null)], off, S, b, now)).toBeNull()
    expect(selectRun([slot("1", "b", "2026-11-01", null)], routes, S, b, now)).toBeNull()
  })
  it("prefers demand when overdue is equal", () => {
    const quiet = slot("q", "b", "2026-11-05", null)
    const hot = { ...slot("h", "b", "2026-11-06", null), demandScore: 20 }
    const tight = { ...b, tickBudgetUsd: APIFY_START_USD + 5 * APIFY_ROW_USD }
    expect(selectRun([quiet, hot], routes, S, tight, now)!.slots.map((s) => s.id)).toEqual(["h"])
  })
})

describe("budget calculator", () => {
  it("prices the brief's watchlist close to what refreshes may spend", () => {
    const e = estimateMonthly([{ horizonDays: 14, maxResults: 3, enabled: true }, { horizonDays: 14, maxResults: 5, enabled: true }], S)
    expect(e.spendableUsd).toBeCloseTo(4.05)
    expect(e.monthlyUsd).toBeGreaterThan(3.5)
    expect(e.monthlyUsd).toBeLessThan(4.5)
  })
  it("decays demand with a 7-day half-life", () => {
    expect(foldDemand(10, 0, 7 * 24, 7)).toBeCloseTo(5)
    expect(foldDemand(0, 5, 1, 7)).toBe(5)
  })
})

/** Spec §10.2: a full 30-day cycle with random result counts, empty routes, admin spend and failed runs. */
function simulate(seed: number, S: CatalogSettings = DEFAULT_CATALOG_SETTINGS, failRate = 0.08) {
  let r = seed >>> 0 || 1
  const rand = () => ((r = (r * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32)
  const start = new Date("2026-11-04T00:00:00Z")
  const cycleEnd = addDays(start, 30)
  const routes = new Map<string, PacerRoute>([["ika-ist", { id: "ika-ist", enabled: true, maxResults: 3, priorityWeight: 1 }], ["ist-lhr", { id: "ist-lhr", enabled: true, maxResults: 5, priorityWeight: 1 }]])
  const slots = new Map<string, PacerSlot>()
  const fetches = new Map<string, number[]>()
  let refreshSpent = 0
  let adminSpent = 0
  let maxRefreshBeforeRelease = 0
  let maxT0Age = 0
  const tickMs = (24 / S.refreshTicksPerDay) * HOUR
  for (let t = start.getTime(); t < cycleEnd.getTime(); t += tickMs) {
    const now = new Date(t)
    for (const route of routes.values()) {
      for (let d = 0; d < 14; d++) {
        const date = iso(addDays(now, d))
        const id = `${route.id}:${date}`
        if (!slots.has(id)) slots.set(id, { id, routeId: route.id, departureDate: date, lastFetchedAt: null, recentCounts: [], consecutiveEmpty: 0, consecutiveErrors: 0, lastErrorAt: null, demandScore: rand() * 15 })
      }
    }
    for (const [id, s] of slots) if (s.departureDate < iso(now)) slots.delete(id)
    // Occasional admin revalidation, only when the reserve allows it.
    if (rand() < 0.03) {
      const b0 = tickBudget({ settings: S, spentUsd: refreshSpent + adminSpent, adminSpentUsd: adminSpent, cycleEnd, now })
      const cap = adminRunCap(1, S.revalidateMaxResults, b0, S)
      if (cap) adminSpent += APIFY_START_USD + Math.floor(rand() * S.revalidateMaxResults) * APIFY_ROW_USD
    }
    const b = tickBudget({ settings: S, spentUsd: refreshSpent + adminSpent, adminSpentUsd: adminSpent, cycleEnd, now })
    const plan = selectRun([...slots.values()], routes, S, b, now)
    if (plan) {
      const failed = rand() < failRate
      let rows = 0
      if (!failed) {
        for (const s of plan.slots) {
          const n = s.routeId === "ika-ist" ? (rand() < 0.6 ? 0 : Math.floor(rand() * (plan.maxResults + 1))) : 1 + Math.floor(rand() * plan.maxResults)
          rows += n
          fetches.set(s.id, [...(fetches.get(s.id) ?? []), t])
          s.lastFetchedAt = now
          s.recentCounts = [n, ...s.recentCounts].slice(0, 3)
          s.consecutiveEmpty = n === 0 ? s.consecutiveEmpty + 1 : 0
          s.consecutiveErrors = 0
        }
      } else {
        for (const s of plan.slots) Object.assign(s, { consecutiveErrors: s.consecutiveErrors + 1, lastErrorAt: now })
      }
      // The actor stops at maxTotalChargeUsd.
      refreshSpent += Math.min(plan.maxTotalChargeUsd, APIFY_START_USD + rows * APIFY_ROW_USD)
    }
    if (!b.reserveReleased) maxRefreshBeforeRelease = Math.max(maxRefreshBeforeRelease, refreshSpent)
    if (t > start.getTime() + 2 * 86_400_000) {
      for (const s of slots.values()) {
        if (s.routeId !== "ist-lhr" || tierFor(Math.round((Date.parse(s.departureDate) - Date.parse(iso(now))) / 86_400_000), S.tiers).name !== "T0" || !s.lastFetchedAt) continue
        maxT0Age = Math.max(maxT0Age, (t - s.lastFetchedAt.getTime()) / HOUR)
      }
    }
  }
  const floorViolations = [...fetches.values()].filter((ts) => ts.some((x, i) => i > 0 && x - ts[i - 1]! < S.minRefreshIntervalHours * HOUR)).length
  return { refreshSpent, adminSpent, total: refreshSpent + adminSpent, maxRefreshBeforeRelease, floorViolations, maxT0Age }
}

describe("30-day cycle simulation (spec §10.2)", () => {
  it("never overspends, never touches the reserve early and respects the floor, for any seed", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), (seed) => {
      const r = simulate(seed)
      expect(r.total).toBeLessThanOrEqual(S.monthlyBudgetUsd - S.safetyMarginUsd + 1e-9)
      expect(r.maxRefreshBeforeRelease).toBeLessThanOrEqual(S.monthlyBudgetUsd - S.safetyMarginUsd - S.adminReserveUsd + 1e-9)
      expect(r.floorViolations).toBe(0)
    }), { numRuns: 25 })
  })
  it("keeps the busiest tier (0–2 days) within 3× its target when the budget allows", () => {
    const roomy = { ...S, monthlyBudgetUsd: 10 }
    const r = simulate(42, roomy, 0)
    expect(r.maxT0Age).toBeLessThanOrEqual(3 * 8)
    expect(simulate(42).refreshSpent).toBeGreaterThan(1)
  })
})

describe("write-time self-transfer rules", () => {
  const fetchedAt = "2026-11-04T09:00:00Z"
  const TZ = (a: string) => (a === "IKA" ? "Asia/Tehran" : a === "LHR" ? "Europe/London" : "Europe/Istanbul")
  const seg = (carrier: string, number: string, from: string, to: string, dep: string, arr: string) =>
    ({ carrier, number, from, to, dep, arr, fromTz: TZ(from), toTz: TZ(to), terminals: ["1", "1"] as [string, string] })
  const a = makeOffer({ provider: "fake", id: "a", slices: [[seg("TK", "879", "IKA", "IST", "2026-11-10T06:00", "2026-11-10T09:00")]], totalMinor: 1, fetchedAt })
  const lhr = (id: string, dep: string, arr: string) => makeOffer({ provider: "fake", id, slices: [[seg("TK", id, "IST", "LHR", dep, arr)]], totalMinor: 1, fetchedAt })
  const rules = new RuleResolver(catalogEngineRules(DEFAULT_ENGINE_RULES, S.connections))

  it("joins only within the 4–6 h window and refuses overnight by default", () => {
    const legs = [lhr("1971", "2026-11-10T12:00", "2026-11-10T14:00"), lhr("1983", "2026-11-10T13:30", "2026-11-10T15:30"), lhr("1985", "2026-11-10T16:30", "2026-11-10T18:30"), lhr("1987", "2026-11-11T02:00", "2026-11-11T04:00")]
    const joined = joinAtHub([a], legs, rules, false, 0)
    expect(joined.map((j) => j.components[1]!.slices[0]!.segments[0]!.marketing.flightNumber)).toEqual(["1983"])
  })
  it("honours an admin-widened window", () => {
    const wide = new RuleResolver(catalogEngineRules(DEFAULT_ENGINE_RULES, { ...S.connections, maxLayoverMin: 8 * 60 }))
    const joined = joinAtHub([a], [lhr("1985", "2026-11-10T16:30", "2026-11-10T18:30")], wide, false, 0)
    expect(joined).toHaveLength(1)
  })
})
