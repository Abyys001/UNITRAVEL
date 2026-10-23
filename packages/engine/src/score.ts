import type { Itinerary, RiskFlag, ScoreExplain, ScoringWeights } from "@unitravel/contracts"

import { localHour } from "./time"

/** Ch. 22.6 risk points: separate tickets 3, airport change 3, overnight 2, tight 2, terminal change 1, unknown 1, entry 1. */
export const RISK_POINTS: Record<RiskFlag, number> = {
  SEPARATE_TICKETS: 3, AIRPORT_CHANGE: 3, OVERNIGHT: 2, TIGHT: 2, TERMINAL_CHANGE: 1, TERMINAL_UNKNOWN: 1, ENTRY_REQUIRED: 1,
}

type Unscored = Omit<Itinerary, "tabs" | "score" | "explain">

export function riskComponent(it: Unscored): number {
  // Points are summed per distinct flag on the journey (the worked example: SEPARATE_TICKETS + ENTRY_REQUIRED = 0.4).
  const pts = it.riskFlags.reduce((s, f) => s + RISK_POINTS[f], 0)
  return Math.min(1, pts / 10)
}

export function layoverFit(it: Unscored, window: [number, number]): number {
  let worst = 0
  for (const c of it.connections) {
    if (c.layoverMin < window[0]) worst = Math.max(worst, window[0] - c.layoverMin)
    else if (c.layoverMin > window[1]) worst = Math.max(worst, c.layoverMin - window[1])
  }
  return Math.min(1, worst / 180)
}

export function timeOfDay(it: Unscored): number {
  const segs = it.components.flatMap((c) => c.slices.flatMap((s) => s.segments))
  const first = segs.reduce((a, b) => (a.departure.utc < b.departure.utc ? a : b))
  const last = segs.reduce((a, b) => (a.arrival.utc > b.arrival.utc ? a : b))
  let v = 0
  if (localHour(first.departure.local) < 5) v += 0.5
  if (localHour(last.arrival.local) < 5) v += 0.5
  return v
}

const norm = (v: number, min: number, max: number) => (max === min ? 0 : (v - min) / (max - min))

/**
 * cost = 0.35·price + 0.20·duration + 0.15·layoverFit + 0.20·risk + 0.05·stops + 0.05·timeOfDay (weights configurable);
 * preferred carriers subtract up to 0.05. Component values are kept so the console can explain a ranking.
 */
export function scoreAll(items: Unscored[], weights: ScoringWeights, window: [number, number], maxStops: number, preferred: Map<string, number>): (Unscored & { score: number; explain: ScoreExplain })[] {
  if (items.length === 0) return []
  const prices = items.map((i) => i.price.total.amountMinor)
  const durations = items.map((i) => i.durationMin)
  const [pMin, pMax, dMin, dMax] = [Math.min(...prices), Math.max(...prices), Math.min(...durations), Math.max(...durations)]
  return items.map((it) => {
    const explain: ScoreExplain = {
      price: round(norm(it.price.total.amountMinor, pMin, pMax)),
      duration: round(norm(it.durationMin, dMin, dMax)),
      layoverFit: round(layoverFit(it, window)),
      risk: round(riskComponent(it)),
      stops: round(maxStops === 0 ? 0 : Math.min(1, it.connections.length / Math.max(1, maxStops * Math.max(1, it.components[0]!.slices.length)))),
      timeOfDay: timeOfDay(it),
      preferredCarrierBonus: Math.max(0, ...it.carriers.map((c) => preferred.get(c) ?? 0)),
    }
    const score = weights.price * explain.price + weights.duration * explain.duration + weights.layoverFit * explain.layoverFit
      + weights.risk * explain.risk + weights.stops * explain.stops + weights.timeOfDay * explain.timeOfDay - explain.preferredCarrierBonus
    return { ...it, score: round(score, 4), explain }
  })
}

function round(v: number, d = 3): number {
  const f = 10 ** d
  return Math.round(v * f) / f
}

/** Ties are broken by price, then duration (ch. 22.6). */
export function byCost(a: { score: number; price: { total: { amountMinor: number } }; durationMin: number }, b: typeof a): number {
  return a.score - b.score || a.price.total.amountMinor - b.price.total.amountMinor || a.durationMin - b.durationMin
}
