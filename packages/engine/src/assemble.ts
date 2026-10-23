import type { Itinerary, NormalisedOffer, ResultTab } from "@unitravel/contracts"

import { buildItinerary, flightKey, joinAtHub, offerFlightKey, type SliceSolution } from "./build"
import { emptyStats, filterOffers } from "./filter"
import { RuleResolver } from "./rules"
import { byCost, scoreAll } from "./score"
import type { CollectedCall, EngineContext, FilterStats } from "./types"

export interface AssembleResult {
  results: Itinerary[]
  stats: FilterStats & { offersIn: number; candidates: number; itineraries: number; duplicatesRemoved: number }
  notices: string[]
}

/** Within a group of identical flights keep the lowest price; ties go to the higher-priority provider (ch. 21.7). */
export function dedupeOffers(offers: NormalisedOffer[], priority: Map<string, number>): NormalisedOffer[] {
  const best = new Map<string, NormalisedOffer>()
  for (const o of offers) {
    const k = offerFlightKey(o)
    const cur = best.get(k)
    if (!cur) { best.set(k, o); continue }
    const d = o.price.total.amountMinor - cur.price.total.amountMinor
    if (d < 0 || (d === 0 && (priority.get(o.source.provider) ?? 0) > (priority.get(cur.source.provider) ?? 0))) best.set(k, o)
  }
  // Deterministic order regardless of input order, so deduplication is order-independent.
  return [...best.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, o]) => o)
}

/**
 * Steps 4–8 of the pipeline as one pure function. The worker calls it after each wave with everything collected so
 * far and publishes the result (step 9). The Developer Panel simulator calls it with cached responses and draft rules.
 */
export function assemble(ctx: EngineContext, collected: CollectedCall[], providerPriority: Map<string, number>): AssembleResult {
  const rules = new RuleResolver(ctx.rules)
  const stats = { ...emptyStats(), offersIn: 0, candidates: 0, itineraries: 0, duplicatesRemoved: 0 }
  const maxPerLeg = ctx.rules.limits.maxOffersPerLeg
  const group = (pred: (c: CollectedCall) => boolean) => {
    const offers = collected.filter(pred).flatMap((c) => c.offers)
    stats.offersIn += offers.length
    const kept = dedupeOffers(filterOffers(offers, ctx.policy, ctx.reference, ctx.now, stats), providerPriority)
    return kept.sort((a, b) => a.price.total.amountMinor - b.price.total.amountMinor).slice(0, maxPerLeg)
  }

  const q = ctx.query
  const perSlice: SliceSolution[][] = q.slices.map(() => [])
  const multiSlice: SliceSolution[] = []

  for (const o of group((c) => c.call.kind === "THROUGH" && c.call.sliceIndex === -1)) {
    if (o.slices.length === q.slices.length) multiSlice.push({ sliceIndex: -1, components: [o], construction: "THROUGH" })
  }
  if (q.tripType !== "MULTI_CITY") {
    q.slices.forEach((_, i) => {
      for (const o of group((c) => c.call.kind === "THROUGH" && c.call.sliceIndex === i)) perSlice[i]!.push({ sliceIndex: i, components: [o], construction: "THROUGH" })
      const hubs = new Set(collected.filter((c) => c.call.sliceIndex === i && c.call.kind === "LEG_TO_HUB").map((c) => c.call.hub!))
      for (const h of hubs) {
        const a = group((c) => c.call.kind === "LEG_TO_HUB" && c.call.hub === h && c.call.sliceIndex === i)
        const b = group((c) => c.call.kind === "LEG_FROM_HUB" && c.call.hub === h && c.call.sliceIndex === i)
        perSlice[i]!.push(...joinAtHub(a, b, rules, q.preferences.allowAirportChange, i))
      }
    })
    const gateways = new Map(collected.filter((c) => c.call.gateway).map((c) => [c.call.gateway!.iata, c.call.gateway!]))
    for (const [iata, gw] of gateways) {
      for (const o of group((c) => c.call.kind === "GATEWAY_THROUGH" && c.call.gateway?.iata === iata)) perSlice[0]!.push({ sliceIndex: 0, components: [o], construction: "GATEWAY", gateway: gw })
      const hubs = new Set(collected.filter((c) => c.call.kind === "GATEWAY_LEG_TO_HUB" && c.call.gateway?.iata === iata).map((c) => c.call.hub!))
      for (const h of hubs) {
        const a = group((c) => c.call.kind === "GATEWAY_LEG_TO_HUB" && c.call.gateway?.iata === iata && c.call.hub === h)
        const b = group((c) => c.call.kind === "GATEWAY_LEG_FROM_HUB" && c.call.gateway?.iata === iata && c.call.hub === h)
        for (const s of joinAtHub(a, b, rules, q.preferences.allowAirportChange, 0)) perSlice[0]!.push({ ...s, construction: "GATEWAY", gateway: gw })
      }
    }
  }

  const built: ReturnType<typeof buildItinerary>[] = []
  for (const s of multiSlice) built.push(buildItinerary([s], ctx, rules))
  if (q.slices.length === 1) {
    for (const s of perSlice[0]!) built.push(buildItinerary([s], ctx, rules))
  } else if (q.tripType !== "MULTI_CITY") {
    // Return / open-jaw on separate tickets: rank each slice on its own, then combine the best few of each.
    const K = 6
    const ranked = perSlice.map((sols) => {
      const items = sols.map((s) => ({ s, b: buildItinerary([s], { ...ctx, query: { ...q, slices: [q.slices[s.sliceIndex]!] } }, rules) })).filter((x) => x.b)
      const scored = scoreAll(items.map((x) => x.b!.itinerary), ctx.rules.weights, ctx.rules.global.preferredLayover, q.preferences.maxStops, new Map())
      return scored.map((it, i) => ({ s: items[i]!.s, it })).sort((a, b) => byCost(a.it, b.it)).slice(0, K).map((x) => x.s)
    })
    const combine = (idx: number, acc: SliceSolution[]) => {
      if (idx === ranked.length) { built.push(buildItinerary(acc, ctx, rules)); return }
      for (const s of ranked[idx]!) combine(idx + 1, [...acc, s])
    }
    if (ranked.every((r) => r.length > 0)) combine(0, [])
  }
  stats.candidates = built.length

  let items = built.filter((b): b is NonNullable<typeof b> => b !== null)
  // Relative duration cap: drop journeys longer than maxDurationFactor × the fastest found (ch. 22.3).
  if (items.length > 0) {
    const fastest = Math.min(...items.map((b) => b.itinerary.durationMin))
    const factor = ctx.rules.global.maxDurationFactor
    items = items.filter((b) => b.itinerary.durationMin <= fastest * factor)
  }
  const byKey = new Map<string, (typeof items)[number]>()
  for (const b of items) {
    const cur = byKey.get(b.key)
    if (!cur || b.itinerary.price.total.amountMinor < cur.itinerary.price.total.amountMinor) byKey.set(b.key, b)
  }
  stats.duplicatesRemoved = items.length - byKey.size

  const origin = q.slices[0]!.from
  const dest = q.slices[0]!.to
  const weights = new RuleResolver(ctx.rules).weightsFor("airport" in origin ? origin.airport : origin.city, "airport" in dest ? dest.airport : dest.city)
  const window = q.preferences.preferredLayoverMin ?? ctx.rules.global.preferredLayover
  const preferred = new Map(ctx.rules.preferredCarriers.map((p) => [p.carrier, p.bonus]))
  const scored = scoreAll([...byKey.values()].map((b) => b.itinerary), weights, window, Math.min(q.preferences.maxStops, ctx.rules.global.maxStops) || 1, preferred).sort(byCost)

  const results = diversify(scored, ctx)
  stats.itineraries = results.length
  const notices: string[] = []
  if (stats.removedByPolicy > 0) notices.push("POLICY_HIDDEN")
  if (stats.reviewFlagged > 0) notices.push("POLICY_REVIEW")
  return { results, stats, notices }
}

type Scored = ReturnType<typeof scoreAll>[number]

/** Step 8 — diversity and tabs (ch. 22.7). */
export function diversify(sorted: Scored[], ctx: EngineContext): Itinerary[] {
  const { maxSameFirstFlight, maxSameLastFlight, maxResults, singleTicketPreferenceWithinPct } = ctx.rules.limits
  const firstCount = new Map<string, number>()
  const lastCount = new Map<string, number>()
  const kept: Scored[] = []
  for (const it of sorted) {
    const segs = it.components.flatMap((c) => c.slices.flatMap((s) => s.segments))
    const f = flightKey([segs[0]!])
    const l = flightKey([segs[segs.length - 1]!])
    if ((firstCount.get(f) ?? 0) >= maxSameFirstFlight || (lastCount.get(l) ?? 0) >= maxSameLastFlight) continue
    firstCount.set(f, (firstCount.get(f) ?? 0) + 1)
    lastCount.set(l, (lastCount.get(l) ?? 0) + 1)
    kept.push(it)
  }
  // Guarantee one of each construction type survives the cap.
  const capped = kept.slice(0, maxResults)
  for (const c of ["THROUGH", "SELF_TRANSFER", "GATEWAY"] as const) {
    if (!capped.some((x) => x.construction === c)) {
      const extra = kept.find((x) => x.construction === c)
      if (extra) capped.splice(Math.max(0, capped.length - 1), capped.length >= maxResults ? 1 : 0, extra)
    }
  }

  // BEST: by cost, single tickets lifted above separate tickets priced within N% (worked example ch. 22.11).
  const best = [...capped].sort(byCost)
  for (let i = 1; i < best.length; i++) {
    const it = best[i]!
    if (it.ticketing !== "SINGLE_TICKET") continue
    for (let j = 0; j < i; j++) {
      const above = best[j]!
      if (above.ticketing === "SEPARATE_TICKETS" && it.price.total.amountMinor <= above.price.total.amountMinor * (1 + singleTicketPreferenceWithinPct / 100)) {
        best.splice(i, 1); best.splice(j, 0, it); break
      }
    }
  }
  const tabs = new Map<string, Set<ResultTab>>()
  const tag = (list: Scored[], tab: ResultTab, n = 20) => list.slice(0, n).forEach((x) => tabs.set(x.id, (tabs.get(x.id) ?? new Set()).add(tab)))
  const bestTop = best.slice(0, 20)
  for (const c of ["THROUGH", "SELF_TRANSFER", "GATEWAY"] as const) {
    if (!bestTop.some((x) => x.construction === c)) { const e = best.find((x) => x.construction === c); if (e) bestTop.push(e) }
  }
  tag(bestTop, "BEST", bestTop.length)
  tag([...capped].sort((a, b) => a.price.total.amountMinor - b.price.total.amountMinor || a.durationMin - b.durationMin), "CHEAPEST")
  tag([...capped].sort((a, b) => a.durationMin - b.durationMin || a.price.total.amountMinor - b.price.total.amountMinor), "FASTEST")
  tag(capped.filter((x) => x.ticketing === "SINGLE_TICKET"), "SINGLE_TICKET", maxResults)
  const order = new Map(best.map((x, i) => [x.id, i]))
  return capped.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((x) => ({ ...x, tabs: [...(tabs.get(x.id) ?? [])] }))
}

/** Order results for one tab, as the API returns them. */
export function orderForTab(results: Itinerary[], tab: ResultTab): Itinerary[] {
  const inTab = results.filter((r) => r.tabs.includes(tab))
  if (tab === "CHEAPEST") return inTab.sort((a, b) => a.price.total.amountMinor - b.price.total.amountMinor || a.durationMin - b.durationMin)
  if (tab === "FASTEST") return inTab.sort((a, b) => a.durationMin - b.durationMin || a.price.total.amountMinor - b.price.total.amountMinor)
  return inTab
}
