import type { Place } from "@unitravel/contracts"

import { addDays } from "./time"
import type { EngineContext, Plan, PlannedCall, ProviderPlanInfo, ReferenceLookup } from "./types"

/** City codes expand to their airports server-side (ch. 11.3); an airport stays itself. */
export function expandPlace(place: Place, ref: ReferenceLookup): string[] {
  if ("airport" in place) return [place.airport]
  const airports = ref.cityAirports(place.city)
  return airports.length > 0 ? airports : [place.city]
}

export function placeCode(place: Place): string {
  return "airport" in place ? place.airport : place.city
}

export function placeCountry(place: Place, ref: ReferenceLookup): string | undefined {
  const first = expandPlace(place, ref)[0]
  return first ? ref.airport(first)?.country : undefined
}

export function placeRegions(place: Place, ref: ReferenceLookup): string[] {
  const regions = new Set<string>()
  for (const a of expandPlace(place, ref)) for (const r of ref.airport(a)?.regions ?? []) regions.add(r)
  return [...regions]
}

/** ± N days → dates, central date first, capped (ch. 22.4 step 1). */
export function flexDates(date: string, flexDays: number, cap: number): { date: string; offset: number }[] {
  const out = [{ date, offset: 0 }]
  for (let d = 1; d <= flexDays; d++) {
    out.push({ date: addDays(date, -d), offset: -d }, { date: addDays(date, d), offset: d })
  }
  return out.slice(0, cap)
}

export function hubCandidates(ctx: EngineContext, fromRegions: string[], toRegions: string[], exclude: string[]): { iata: string; weight: number }[] {
  const best = new Map<string, number>()
  for (const table of ctx.hubs.hubs) {
    if (!fromRegions.includes(table.fromRegion) || !toRegions.includes(table.toRegion)) continue
    for (const c of table.candidates) {
      if (!c.active || exclude.includes(c.iata) || ctx.policy.blockedAirports.has(c.iata)) continue
      best.set(c.iata, Math.max(best.get(c.iata) ?? 0, c.weight))
    }
  }
  return [...best.entries()].map(([iata, weight]) => ({ iata, weight })).sort((a, b) => b.weight - a.weight)
}

/**
 * Step 2 — choose strategies and the calls to make, in priority order, within the per-search budget. Through searches
 * always; self-transfer when allowed and the route has hubs; gateway starts when the origin country is restricted.
 */
export function plan(ctx: EngineContext, providers: ProviderPlanInfo[]): Plan {
  const { query, rules, reference: ref } = ctx
  const notes: string[] = []
  const searchable = providers.filter((p) => p.budgetRemaining > 0)
  if (searchable.length < providers.length) notes.push("A source reached its daily budget and was skipped")
  const lowBudget = searchable.some((p) => p.budgetRemaining < 50)

  const multiCity = query.tripType === "MULTI_CITY"
  const selfTransfer = ctx.flags.selfTransfer && query.preferences.allowSelfTransfer && !multiCity
  const originCountry = placeCountry(query.slices[0]!.from, ref)
  const restricted = ctx.hubs.restrictedOrigins.find((r) => r.country === originCountry)
  const gatewayDefault = restricted !== undefined
  const gateway = ctx.flags.gateways && !multiCity && restricted !== undefined && (query.preferences.includeGateways ?? gatewayDefault)

  let maxHubs = rules.limits.maxHubs
  let flexCap = rules.limits.maxFlexDates
  if (lowBudget) { maxHubs = Math.max(1, Math.floor(maxHubs / 2)); flexCap = Math.min(flexCap, 3); notes.push("Fewer hubs searched to stay within supplier budgets") }

  const calls: PlannedCall[] = []
  const add = (c: Omit<PlannedCall, "key">) => {
    const key = `${c.provider}|${c.kind}|${c.slices.map((s) => `${s.origin}-${s.destination}-${s.date}`).join("+")}`
    if (!calls.some((x) => x.key === key)) calls.push({ ...c, key })
  }
  const code = (p: Place, provider: ProviderPlanInfo) => (provider.supportsCityCodes ? [placeCode(p)] : expandPlace(p, ref))

  // Wave 1: through searches. Return/open-jaw trips are also searched as one round-trip call (single ticket both ways).
  const centralDates = query.slices.map((s) => s.date)
  for (const p of searchable) {
    if (query.slices.length > 1) {
      add({ wave: 1, kind: "THROUGH", provider: p.id, sliceIndex: -1, dateOffset: 0, slices: query.slices.map((s, i) => ({ origin: code(s.from, p)[0]!, destination: code(s.to, p)[0]!, date: centralDates[i]! })) })
    }
    if (!multiCity) {
      query.slices.forEach((s, i) => {
        for (const o of code(s.from, p)) for (const d of code(s.to, p)) add({ wave: 1, kind: "THROUGH", provider: p.id, sliceIndex: i, dateOffset: 0, slices: [{ origin: o, destination: d, date: s.date }] })
      })
    }
  }

  const hubsUsed = new Set<string>()
  const gatewaysUsed: { iata: string; dayOffset: number }[] = []

  // Wave 3 (planned before hub legs so gateway starts survive a tight budget): gateway G → D on date + offset.
  if (gateway && restricted) {
    for (const g of restricted.gateways.filter((x) => x.active && !ctx.policy.blockedAirports.has(x.iata))) {
      gatewaysUsed.push({ iata: g.iata, dayOffset: g.dayOffset })
      const gw = { iata: g.iata, dayOffset: g.dayOffset, country: ref.airport(g.iata)?.country ?? "" }
      const s0 = query.slices[0]!
      const date = addDays(s0.date, g.dayOffset)
      for (const p of searchable) for (const d of code(s0.to, p)) add({ wave: 3, kind: "GATEWAY_THROUGH", provider: p.id, sliceIndex: 0, dateOffset: 0, gateway: gw, slices: [{ origin: g.iata, destination: d, date }] })
    }
  }

  // Wave 2: self-transfer hub legs O → H (date) and H → D (date, date + 1).
  if (selfTransfer) {
    query.slices.forEach((s, i) => {
      const from = placeRegions(s.from, ref)
      const to = placeRegions(s.to, ref)
      const exclude = [...expandPlace(s.from, ref), ...expandPlace(s.to, ref)]
      const hubs = hubCandidates(ctx, from, to, exclude).slice(0, maxHubs)
      for (const h of hubs) {
        hubsUsed.add(h.iata)
        for (const p of searchable) {
          for (const o of code(s.from, p)) add({ wave: 2, kind: "LEG_TO_HUB", provider: p.id, sliceIndex: i, hub: h.iata, dateOffset: 0, slices: [{ origin: o, destination: h.iata, date: s.date }] })
          for (const off of [0, 1]) for (const d of code(s.to, p)) add({ wave: 2, kind: "LEG_FROM_HUB", provider: p.id, sliceIndex: i, hub: h.iata, dateOffset: off, slices: [{ origin: h.iata, destination: d, date: addDays(s.date, off) }] })
        }
      }
    })
    // Gateway self-transfers via the gateway region's hubs (worked example: VAN → IST + IST → LHR).
    if (gateway && restricted) {
      const s0 = query.slices[0]!
      for (const g of gatewaysUsed) {
        const gRegions = ref.airport(g.iata)?.regions ?? []
        const hubs = hubCandidates(ctx, gRegions, placeRegions(s0.to, ref), [g.iata, ...expandPlace(s0.to, ref)]).slice(0, 1)
        const gw = { iata: g.iata, dayOffset: g.dayOffset, country: ref.airport(g.iata)?.country ?? "" }
        const date = addDays(s0.date, g.dayOffset)
        for (const h of hubs) for (const p of searchable) {
          add({ wave: 3, kind: "GATEWAY_LEG_TO_HUB", provider: p.id, sliceIndex: 0, hub: h.iata, gateway: gw, dateOffset: 0, slices: [{ origin: g.iata, destination: h.iata, date }] })
          for (const d of code(s0.to, p)) add({ wave: 3, kind: "GATEWAY_LEG_FROM_HUB", provider: p.id, sliceIndex: 0, hub: h.iata, gateway: gw, dateOffset: 0, slices: [{ origin: h.iata, destination: d, date }] })
        }
      }
    }
  }

  // Flexible dates for through searches come last; they are the first thing dropped under budget pressure.
  if (!multiCity) {
    query.slices.forEach((s, i) => {
      for (const fd of flexDates(s.date, s.flexDays, flexCap).slice(1)) {
        for (const p of searchable) for (const o of code(s.from, p)) for (const d of code(s.to, p)) add({ wave: 1, kind: "THROUGH", provider: p.id, sliceIndex: i, dateOffset: fd.offset, slices: [{ origin: o, destination: d, date: fd.date }] })
      }
    })
  }

  const budget = rules.limits.maxSupplierCalls
  const perProvider = new Map<string, number>()
  const kept: PlannedCall[] = []
  let dropped = 0
  for (const c of calls) {
    const p = searchable.find((x) => x.id === c.provider)!
    const used = perProvider.get(c.provider) ?? 0
    if (kept.length >= budget || used >= p.budgetRemaining) { dropped++; continue }
    perProvider.set(c.provider, used + 1)
    kept.push(c)
  }
  if (dropped > 0) notes.push(`${dropped} lower-priority searches skipped to stay within the call budget`)

  return { calls: kept, strategies: { through: true, selfTransfer, gateway }, hubs: [...hubsUsed], gateways: gatewaysUsed, notes, droppedForBudget: dropped }
}
