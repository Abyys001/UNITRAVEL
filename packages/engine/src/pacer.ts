import type { CatalogConnectionRules, CatalogSettings, CatalogTier, EngineRules, SlotStatus } from "@unitravel/contracts"

// ADR-0034: the dollar pacer. Pure functions so the 30-day cycle simulation runs as a unit test (spec §4, §10.2).

export const APIFY_ROW_USD = 0.001
export const APIFY_START_USD = 0.001
const HOUR = 3_600_000

const ceil3 = (n: number) => Math.ceil(n * 1000 - 1e-9) / 1000
const floor3 = (n: number) => Math.floor(n * 1000 + 1e-9) / 1000

export function daysOut(departureDate: string, now: Date): number {
  const dep = Date.parse(`${departureDate}T00:00:00Z`)
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((dep - today) / 86_400_000)
}

export function tierFor(days: number, tiers: readonly CatalogTier[]): CatalogTier {
  const sorted = [...tiers].sort((a, b) => a.maxDaysOut - b.maxDaysOut)
  return sorted.find((t) => days <= t.maxDaysOut) ?? sorted[sorted.length - 1]!
}

/** Empty results are free but still take run time: after `emptyBackoffAfter` empties in a row the interval doubles per step, up to ×max. */
export function backoffFactor(consecutiveEmpty: number, s: Pick<CatalogSettings, "emptyBackoffAfter" | "emptyBackoffMax">): number {
  if (consecutiveEmpty < s.emptyBackoffAfter) return 1
  return Math.min(s.emptyBackoffMax, 2 ** (consecutiveEmpty - s.emptyBackoffAfter + 1))
}

export interface PacerSlot {
  id: string
  routeId: string
  departureDate: string
  lastFetchedAt: Date | null
  /** Most recent first; at most three are used. */
  recentCounts: number[]
  consecutiveEmpty: number
  consecutiveErrors: number
  lastErrorAt: Date | null
  demandScore: number
}

export interface PacerRoute { id: string; enabled: boolean; maxResults: number | null; priorityWeight: number }

export function intervalHours(slot: Pick<PacerSlot, "departureDate" | "consecutiveEmpty">, s: CatalogSettings, now: Date): number {
  return tierFor(daysOut(slot.departureDate, now), s.tiers).intervalHours * backoffFactor(slot.consecutiveEmpty, s)
}

export function nextDueAt(slot: Pick<PacerSlot, "departureDate" | "consecutiveEmpty" | "lastFetchedAt">, s: CatalogSettings, now: Date): Date {
  if (!slot.lastFetchedAt) return now
  return new Date(slot.lastFetchedAt.getTime() + intervalHours(slot, s, now) * HOUR)
}

/** Spec §4.3: FRESH < interval ≤ AGING < 3× interval ≤ STALE; EMPTY and ERROR come from the last answer. */
export function slotStatus(slot: Pick<PacerSlot, "departureDate" | "lastFetchedAt" | "recentCounts" | "consecutiveErrors" | "consecutiveEmpty">, s: CatalogSettings, now: Date): SlotStatus {
  if (slot.consecutiveErrors > 0 && slot.recentCounts.length === 0) return "ERROR"
  if (!slot.lastFetchedAt) return slot.consecutiveErrors > 0 ? "ERROR" : "NEVER"
  if (slot.recentCounts[0] === 0) return "EMPTY"
  const age = (now.getTime() - slot.lastFetchedAt.getTime()) / HOUR
  const interval = tierFor(daysOut(slot.departureDate, now), s.tiers).intervalHours
  if (age < interval) return "FRESH"
  return age < 3 * interval ? "AGING" : "STALE"
}

export interface BudgetInput {
  settings: CatalogSettings
  /** Everything Apify charged this cycle (refresh and admin), from /users/me/limits or the ledger × cost_correction. */
  spentUsd: number
  /** The admin part of `spentUsd`, from our ledger. */
  adminSpentUsd: number
  cycleEnd: Date
  now: Date
}

export interface TickBudget {
  hoursLeft: number
  ticksLeft: number
  reserveReleased: boolean
  /** What refreshes may still spend this cycle. */
  availableUsd: number
  tickBudgetUsd: number
  /** What admin revalidation and staff search may still spend. */
  adminAvailableUsd: number
  paused: boolean
}

/**
 * Spec §4.2, with one correction: admin spend is drawn from the reserve first, so it is not subtracted twice.
 * Before the release window refreshes can never reach the reserve; inside it the unused reserve is spendable,
 * because Apify credit does not roll over.
 */
export function tickBudget(i: BudgetInput): TickBudget {
  const s = i.settings
  const tickHours = 24 / s.refreshTicksPerDay
  const hoursLeft = Math.max(1, (i.cycleEnd.getTime() - i.now.getTime()) / HOUR)
  const ticksLeft = Math.max(1, Math.floor(hoursLeft / tickHours))
  const reserveReleased = hoursLeft <= s.releaseReserveHours
  const reserveLeft = Math.max(0, s.adminReserveUsd - i.adminSpentUsd)
  const head = s.monthlyBudgetUsd - s.safetyMarginUsd - i.spentUsd
  const availableUsd = Math.max(0, head - (reserveReleased ? 0 : reserveLeft))
  const adminAvailableUsd = Math.max(0, Math.min(reserveLeft, head))
  return { hoursLeft, ticksLeft, reserveReleased, availableUsd, tickBudgetUsd: availableUsd / ticksLeft, adminAvailableUsd, paused: availableUsd <= 0 }
}

export function expectedRows(slot: Pick<PacerSlot, "recentCounts">, maxResults: number): number {
  const recent = slot.recentCounts.slice(0, 3)
  if (recent.length === 0) return maxResults
  return Math.min(maxResults, recent.reduce((a, b) => a + b, 0) / recent.length)
}

export interface SlotCandidate { slot: PacerSlot; maxResults: number; priority: number; overdue: number; estUsd: number }

/** Spec §4.4 priority. Returns null for a slot inside the floor, in error skip, or on a disabled route. */
export function candidate(slot: PacerSlot, route: PacerRoute, s: CatalogSettings, now: Date): SlotCandidate | null {
  if (!route.enabled) return null
  if (daysOut(slot.departureDate, now) < 0) return null
  if (slot.lastFetchedAt && now.getTime() - slot.lastFetchedAt.getTime() < s.minRefreshIntervalHours * HOUR) return null
  if (slot.consecutiveErrors >= s.errorSkipAfter && slot.lastErrorAt && now.getTime() - slot.lastErrorAt.getTime() < s.errorSkipHours * HOUR) return null
  const tier = tierFor(daysOut(slot.departureDate, now), s.tiers)
  const overdue = slot.lastFetchedAt ? (now.getTime() - slot.lastFetchedAt.getTime()) / HOUR / intervalHours(slot, s, now) : 10
  const demandBoost = Math.min(2, slot.demandScore / 10)
  const maxResults = route.maxResults ?? s.defaultMaxResults
  return {
    slot, maxResults, overdue,
    priority: overdue * tier.weight * route.priorityWeight * (1 + demandBoost),
    estUsd: expectedRows(slot, maxResults) * APIFY_ROW_USD * s.costCorrection,
  }
}

export interface RunPlan {
  maxResults: number
  slots: PacerSlot[]
  estUsd: number
  /** Sent as `maxTotalChargeUsd`; never above what refreshes may still spend. */
  maxTotalChargeUsd: number
}

/**
 * Picks one run for this tick. `maxResults` is a run-level actor field (F3), so the run takes the group of the
 * highest-priority slot; slots of other groups wait for a later tick.
 */
export function selectRun(slots: readonly PacerSlot[], routes: ReadonlyMap<string, PacerRoute>, s: CatalogSettings, b: TickBudget, now: Date): RunPlan | null {
  if (s.paused || b.paused) return null
  const lenient = b.hoursLeft <= Math.max(48, s.releaseReserveHours)
  const minOverdue = lenient ? 0.5 : 1
  const all = slots.flatMap((sl) => {
    const r = routes.get(sl.routeId)
    const c = r ? candidate(sl, r, s, now) : null
    return c && c.overdue >= minOverdue ? [c] : []
  }).sort((a, b) => b.priority - a.priority || a.slot.departureDate.localeCompare(b.slot.departureDate))
  if (all.length === 0) return null
  const group = all[0]!.maxResults
  const startUsd = APIFY_START_USD * s.costCorrection
  const picked: SlotCandidate[] = []
  let est = startUsd
  for (const c of all) {
    if (c.maxResults !== group || picked.length >= s.maxSlotsPerRun) continue
    if (est + c.estUsd > b.tickBudgetUsd) continue
    picked.push(c)
    est += c.estUsd
  }
  if (picked.length === 0) return null
  const cap = Math.min(ceil3(est * 1.15), floor3(b.availableUsd))
  if (cap < APIFY_START_USD + APIFY_ROW_USD) return null
  return { maxResults: group, slots: picked.map((c) => c.slot), estUsd: est, maxTotalChargeUsd: cap }
}

/** Charge cap for one admin run (revalidate or "refresh now"), or null when the reserve cannot cover it. */
export function adminRunCap(routes: number, maxResults: number, b: TickBudget, s: CatalogSettings): { estUsd: number; maxTotalChargeUsd: number } | null {
  const estUsd = (APIFY_START_USD + routes * maxResults * APIFY_ROW_USD) * s.costCorrection
  const cap = ceil3(estUsd)
  return cap <= floor3(b.adminAvailableUsd) ? { estUsd, maxTotalChargeUsd: cap } : null
}

/** Decayed demand (spec §4.4): half-life in days, folded hourly. */
export function foldDemand(score: number, add: number, hoursSince: number, halfLifeDays: number): number {
  return score * 0.5 ** (hoursSince / (halfLifeDays * 24)) + add
}

/** Budget calculator (spec §7.3): the cost of hitting every tier target with full result pages. */
export function estimateMonthly(routes: readonly { horizonDays: number; maxResults: number | null; enabled: boolean }[], s: CatalogSettings) {
  let refreshesPerDay = 0
  let rowsPerDay = 0
  for (const r of routes.filter((x) => x.enabled)) {
    for (let d = 0; d < r.horizonDays; d++) {
      const per = 24 / Math.max(tierFor(d, s.tiers).intervalHours, s.minRefreshIntervalHours)
      refreshesPerDay += per
      rowsPerDay += per * (r.maxResults ?? s.defaultMaxResults)
    }
  }
  const runsPerDay = Math.min(s.refreshTicksPerDay, Math.ceil(refreshesPerDay))
  const monthlyUsd = (rowsPerDay * APIFY_ROW_USD + runsPerDay * APIFY_START_USD) * 30 * s.costCorrection
  const spendableUsd = s.monthlyBudgetUsd - s.safetyMarginUsd - s.adminReserveUsd
  return { rowsPerDay, runsPerDay, monthlyUsd, spendableUsd, overBudget: monthlyUsd > spendableUsd }
}

/** Engine rules for write-time self-transfer joins: the catalog's connection settings replace the global connection fields. */
export function catalogEngineRules(base: EngineRules, c: CatalogConnectionRules): EngineRules {
  return {
    ...base,
    global: {
      ...base.global,
      selfTransferMinMin: c.minLayoverMin,
      maxLayoverMin: c.maxLayoverMin,
      allowOvernight: c.allowOvernight,
      maxOvernightMin: c.allowOvernight ? c.maxLayoverMin : 0,
      airportChanges: c.sameAirport ? [] : base.global.airportChanges,
    },
    // Overrides keep everything else (a `blocked` airport stays blocked) but cannot widen or narrow the owner's catalog window.
    overrides: base.overrides.map((o) => {
      const { selfTransferMinMin: _a, maxLayoverMin: _b, allowOvernight: _c, maxOvernightMin: _d, ...fields } = o.fields
      return { ...o, fields }
    }),
  }
}
