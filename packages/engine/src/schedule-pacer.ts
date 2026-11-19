import { daysOut } from "./pacer"

const HOUR = 3_600_000
/** ADR-0036 E5: the schedule tick runs every 4 hours. */
export const SCHEDULE_TICK_HOURS = 4

/** A catalog slot with its schedule-layer state (`catalog_schedule_slots`); both fetch fields are null before the first call. */
export interface ScheduleSlotState {
  id: string
  /** DIRECT routes only: a combined route is never called (its self-transfers are built from the hub slots). */
  routeKind: "DIRECT" | "COMBINED"
  departureDate: string
  lastFetchedAt: Date | null
  nextDueAt: Date | null
}

export interface ScheduleWindow { minDaysAhead: number; maxDaysAhead: number }

/**
 * ADR-0036 E5: the slots to ask Aviation Edge about now. Only DIRECT slots inside `[minDaysAhead, maxDaysAhead]` days out and due
 * (never fetched, or `nextDueAt` passed). Most urgent first: no schedule yet, then the oldest fetch; the nearer date breaks ties.
 */
export function selectScheduleSlots(slots: readonly ScheduleSlotState[], w: ScheduleWindow, now: Date, limit: number): ScheduleSlotState[] {
  if (limit <= 0) return []
  return slots
    .filter((s) => {
      if (s.routeKind !== "DIRECT") return false
      const d = daysOut(s.departureDate, now)
      if (d < w.minDaysAhead || d > w.maxDaysAhead) return false
      return !s.lastFetchedAt || !s.nextDueAt || s.nextDueAt.getTime() <= now.getTime()
    })
    .sort((a, b) => {
      if (!a.lastFetchedAt !== !b.lastFetchedAt) return a.lastFetchedAt ? 1 : -1
      const byFetch = (a.lastFetchedAt?.getTime() ?? 0) - (b.lastFetchedAt?.getTime() ?? 0)
      return byFetch || a.departureDate.localeCompare(b.departureDate) || a.id.localeCompare(b.id)
    })
    .slice(0, limit)
}

export interface ScheduleBudgetInput {
  monthlyCalls: number
  reserveCalls: number
  /** Calls booked this calendar month (UTC), refresh, tests and probes together. */
  usedCalls: number
  maxSlotsPerRun: number
  now: Date
}

export interface ScheduleBudget { monthEnd: Date; ticksLeft: number; availableCalls: number; slotsAllowed: number; paused: boolean }

/** `(monthly - reserve - used) / ticks left in the UTC month`, capped by `maxSlotsPerRun`; one call per slot. */
export function scheduleBudget(i: ScheduleBudgetInput): ScheduleBudget {
  const monthEnd = new Date(Date.UTC(i.now.getUTCFullYear(), i.now.getUTCMonth() + 1, 1))
  const hoursLeft = Math.max(1, (monthEnd.getTime() - i.now.getTime()) / HOUR)
  const ticksLeft = Math.max(1, Math.ceil(hoursLeft / SCHEDULE_TICK_HOURS))
  const availableCalls = Math.max(0, i.monthlyCalls - i.reserveCalls - i.usedCalls)
  const slotsAllowed = Math.min(i.maxSlotsPerRun, Math.floor(availableCalls / ticksLeft + 1e-9))
  return { monthEnd, ticksLeft, availableCalls, slotsAllowed, paused: availableCalls < 1 }
}
