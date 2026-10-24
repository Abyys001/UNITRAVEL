import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { DEFAULT_ENGINE_RULES, DEFAULT_HUBS, type NormalisedOffer, type SearchQuery, SearchQuery as SearchQuerySchema } from "@unitravel/contracts"

import { assemble, dedupeOffers } from "./assemble"
import { joinAtHub } from "./build"
import { localToUtc, makeOffer } from "./factory"
import { plan } from "./plan"
import { RuleResolver } from "./rules"
import { byCost, scoreAll } from "./score"
import type { AirportRef, CollectedCall, EngineContext, PlannedCall, ReferenceLookup } from "./types"

const AIRPORTS: AirportRef[] = [
  ["IKA", "IR", "Asia/Tehran", "THR", ["IR"]], ["THR", "IR", "Asia/Tehran", "THR", ["IR"]], ["TBZ", "IR", "Asia/Tehran", null, ["IR"]],
  ["VAN", "TR", "Europe/Istanbul", null, ["TR"]], ["ERZ", "TR", "Europe/Istanbul", null, ["TR"]], ["IST", "TR", "Europe/Istanbul", "IST", ["TR"]],
  ["SAW", "TR", "Europe/Istanbul", "IST", ["TR"]], ["EVN", "AM", "Asia/Yerevan", null, ["AM"]], ["MCT", "OM", "Asia/Muscat", null, ["OM", "GULF"]],
  ["NJF", "IQ", "Asia/Baghdad", null, ["IQ"]], ["LHR", "GB", "Europe/London", "LON", ["GB", "UK", "EUROPE"]], ["LGW", "GB", "Europe/London", "LON", ["GB", "UK", "EUROPE"]],
  ["LTN", "GB", "Europe/London", "LON", ["GB", "UK", "EUROPE"]], ["STN", "GB", "Europe/London", "LON", ["GB", "UK", "EUROPE"]],
  ["VIE", "AT", "Europe/Vienna", null, ["AT", "EUROPE"]],
].map(([iata, country, tz, cityCode, regions]) => ({ iata: iata as string, country: country as string, tz: tz as string, cityCode: cityCode as string | null, regions: regions as string[], nameEn: iata as string, nameFa: iata as string }))

const ref: ReferenceLookup = {
  airport: (i) => AIRPORTS.find((a) => a.iata === i),
  cityAirports: (c) => AIRPORTS.filter((a) => a.cityCode === c).map((a) => a.iata),
}
const TZ = (i: string) => ref.airport(i)!.tz

function ctx(query: Partial<SearchQuery> = {}, policyBlocked: string[] = ["IR", "W5"]): EngineContext {
  const q = SearchQuerySchema.parse({
    tripType: "ONE_WAY",
    slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-11-14" }],
    passengers: [{ type: "ADT" }],
    ...query,
  })
  return {
    query: q, rules: DEFAULT_ENGINE_RULES, hubs: DEFAULT_HUBS, ruleVersion: 1, flags: { selfTransfer: true, gateways: true }, locale: "en",
    now: new Date("2026-10-22T09:00:00Z"), reference: ref,
    policy: { blockedCarriers: new Set(policyBlocked), reviewCarriers: new Set(), blockedAirports: new Set(), reviewAirports: new Set() },
  }
}

const seg = (carrier: string, number: string, from: string, to: string, dep: string, arr: string, t: [string?, string?] = ["1", "1"]) =>
  ({ carrier, number, from, to, dep, arr, fromTz: TZ(from), toTz: TZ(to), terminals: t as [string | undefined, string | undefined] })
const fetchedAt = "2026-10-22T09:38:11Z"

const call = (p: Partial<PlannedCall> & Pick<PlannedCall, "kind">): PlannedCall => ({ key: Math.random().toString(), wave: 1, provider: "fake", sliceIndex: 0, slices: [], dateOffset: 0, ...p })

describe("worked example — Tehran to London (ch. 22.11)", () => {
  const c = ctx()
  it("plans through, hub legs via the active IR→EUROPE hubs (IST inactive) and gateways with a one-day offset", () => {
    const p = plan(c, [{ id: "fake", priority: 1, budgetRemaining: 1000, supportsCityCodes: true }, { id: "duffel", priority: 2, budgetRemaining: 1000, supportsCityCodes: true }])
    expect(p.strategies).toEqual({ through: true, selfTransfer: true, gateway: true })
    expect(p.hubs.sort()).toEqual(["MCT", "NJF"])
    expect(p.gateways.map((g) => g.iata).sort()).toEqual(["ERZ", "EVN", "VAN"])
    const gw = p.calls.filter((x) => x.kind === "GATEWAY_THROUGH")
    expect(gw.every((x) => x.slices[0]!.date === "2026-11-15")).toBe(true)
    expect(p.calls.length).toBeLessThanOrEqual(24)
  })

  it("hides Iranian carriers, builds the VAN→IST + IST→LHR self-transfer with flags and ranks the single ticket first", () => {
    const blocked = makeOffer({ provider: "fake", id: "ir1", slices: [[seg("IR", "711", "IKA", "LHR", "2026-11-14T08:00", "2026-11-14T11:30")]], totalMinor: 30000, fetchedAt })
    const vanIst = makeOffer({ provider: "fake", id: "a1", slices: [[seg("TK", "2721", "VAN", "IST", "2026-11-15T07:10", "2026-11-15T09:00")]], totalMinor: 9000, fetchedAt, checkedBags: { status: "UNKNOWN" } })
    const istLhr = makeOffer({ provider: "fake", id: "b1", slices: [[seg("BA", "675", "IST", "LHR", "2026-11-15T13:50", "2026-11-15T15:35", ["1", "5"])]], totalMinor: 32200, fetchedAt, checkedBags: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } } })
    const through = makeOffer({ provider: "fake", id: "t1", slices: [[seg("TK", "2721", "VAN", "IST", "2026-11-15T07:10", "2026-11-15T09:00"), seg("TK", "1971", "IST", "LHR", "2026-11-15T11:00", "2026-11-15T13:05", ["1", "2"])]], totalMinor: 45500, fetchedAt })
    const gwInfo = { iata: "VAN", dayOffset: 1, country: "TR" }
    const collected: CollectedCall[] = [
      { call: call({ kind: "THROUGH" }), offers: [blocked] },
      { call: call({ kind: "GATEWAY_THROUGH", wave: 3, gateway: gwInfo }), offers: [through] },
      { call: call({ kind: "GATEWAY_LEG_TO_HUB", wave: 3, gateway: gwInfo, hub: "IST" }), offers: [vanIst] },
      { call: call({ kind: "GATEWAY_LEG_FROM_HUB", wave: 3, gateway: gwInfo, hub: "IST" }), offers: [istLhr] },
    ]
    const r = assemble(c, collected, new Map([["fake", 1]]))
    expect(r.stats.removedByPolicy).toBe(1)
    expect(r.notices).toContain("POLICY_HIDDEN")
    expect(r.results.some((x) => x.carriers.includes("IR"))).toBe(false)
    const st = r.results.find((x) => x.ticketing === "SEPARATE_TICKETS")!
    expect(st.construction).toBe("GATEWAY")
    expect(st.price.total.amountMinor).toBe(41200)
    expect(st.connections[0]).toMatchObject({ at: "IST", layoverMin: 290, requiredMin: 180, inPreferredWindow: true, protected: false })
    expect(st.connections[0]!.flags).toEqual(expect.arrayContaining(["SEPARATE_TICKETS", "ENTRY_REQUIRED"]))
    expect(st.explain.risk).toBe(0.4)
    expect(st.explain.layoverFit).toBe(0)
    expect(st.gateway).toMatchObject({ iata: "VAN", dayOffset: 1 })
    expect(st.baggage[0]!.checked.status).toBe("UNKNOWN")
    const best = r.results.filter((x) => x.tabs.includes("BEST"))
    expect(best[0]!.ticketing).toBe("SINGLE_TICKET") // 455 ≤ 412 × 1.15
    expect(r.results.find((x) => x.tabs.includes("CHEAPEST") && x.price.total.amountMinor === 41200)).toBeTruthy()
  })
})

// ----- property tests (ch. 32.2) -----
const hubTimes = fc.record({
  arrMin: fc.integer({ min: 0, max: 48 * 60 }),
  gapMin: fc.integer({ min: -60, max: 24 * 60 }),
  hub: fc.constantFrom("IST", "MCT", "VIE", "LHR"),
  day: fc.constantFrom("2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25", "2026-11-14"),
})
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16)

function legPair(t: { arrMin: number; gapMin: number; hub: string; day: string }) {
  const base = Date.parse(`${t.day}T00:00:00Z`)
  const arrUtc = base + t.arrMin * 60000
  const depUtc = arrUtc + t.gapMin * 60000
  const tz = TZ(t.hub)
  const toLocal = (ms: number) => { const iso = new Date(ms).toISOString(); return iso && fmtLocal(iso, tz) }
  const a = makeOffer({ provider: "fake", id: `a${t.arrMin}`, slices: [[{ carrier: "PC", number: "1", from: "EVN", to: t.hub, dep: toLocal(arrUtc - 3 * 3600000)!.replace(/.$/, "0"), arr: toLocal(arrUtc)!, fromTz: TZ("EVN"), toTz: tz }]], totalMinor: 100, fetchedAt })
  const b = makeOffer({ provider: "fake", id: `b${t.gapMin}`, slices: [[{ carrier: "W6", number: "2", from: t.hub, to: "LTN", dep: toLocal(depUtc)!, arr: toLocal(depUtc + 4 * 3600000)!, fromTz: tz, toTz: TZ("LTN") }]], totalMinor: 100, fetchedAt })
  return { a, b }
}
function fmtLocal(utcIso: string, tz: string) {
  const ms = Date.parse(utcIso)
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms))
  return parts.replace(" ", "T")
}

describe("engine invariants (property)", () => {
  const rules = new RuleResolver(DEFAULT_ENGINE_RULES)
  it("every self-transfer layover is ≥ the resolved minimum and ≤ the maximum, across time zones and DST changes", () => {
    fc.assert(fc.property(hubTimes, (t) => {
      const { a, b } = legPair(t)
      for (const s of joinAtHub([a], [b], rules, false, 0)) {
        const arr = s.components[0]!.slices[0]!.segments[0]!.arrival.utc
        const dep = s.components[1]!.slices[0]!.segments[0]!.departure.utc
        const lay = (Date.parse(dep) - Date.parse(arr)) / 60000
        const r = rules.forConnection({ at: t.hub })
        expect(lay).toBeGreaterThanOrEqual(r.selfTransferMinMin)
        expect(lay).toBeLessThanOrEqual(r.maxLayoverMin)
      }
    }), { numRuns: 2000 })
  })

  const carriers = ["IR", "W5", "TK", "BA", "W6", "PC", "OS", "QR", "EP", "IA"]
  const arbOffer = fc.record({ m: fc.constantFrom(...carriers), o: fc.constantFrom(...carriers), price: fc.integer({ min: 5000, max: 90000 }), h: fc.integer({ min: 0, max: 20 }) })
    .map(({ m, o, price, h }) => makeOffer({ provider: "fake", id: `${m}${o}${price}${h}`, slices: [[{ carrier: m, operating: o, number: String(100 + h), from: "IST", to: "LHR", dep: `2026-11-14T${String(h).padStart(2, "0")}:00`, arr: `2026-11-14T${String(h + 3).padStart(2, "0")}:30`, fromTz: TZ("IST"), toTz: TZ("LHR"), terminals: ["1", "2"] }]], totalMinor: price, fetchedAt }))

  it("no returned itinerary contains a blocked carrier, marketing or operating", () => {
    fc.assert(fc.property(fc.array(arbOffer, { maxLength: 30 }), fc.subarray(carriers), (offers, blocked) => {
      const c = ctx({ slices: [{ from: { airport: "IST" }, to: { city: "LON" }, date: "2026-11-14", flexDays: 0 }] }, blocked)
      const r = assemble(c, [{ call: call({ kind: "THROUGH" }), offers }], new Map())
      for (const it of r.results) for (const comp of it.components) for (const s of comp.slices) for (const sg of s.segments) {
        expect(blocked).not.toContain(sg.marketing.carrier)
        expect(blocked).not.toContain(sg.operating.carrier)
      }
    }), { numRuns: 500 })
  })

  it("price is not a ranking input: changing any price never changes a score or the BEST order (ADR-0004)", () => {
    fc.assert(fc.property(fc.array(arbOffer, { minLength: 2, maxLength: 10 }), fc.integer({ min: 1, max: 500000 }), (offers, bump) => {
      const c = ctx({ slices: [{ from: { airport: "IST" }, to: { city: "LON" }, date: "2026-11-14", flexDays: 0 }] }, [])
      const r = assemble(c, [{ call: call({ kind: "THROUGH" }), offers }], new Map())
      if (r.results.length < 2) return
      const items = r.results.map(({ tabs: _t, score: _s, explain: _e, ...rest }) => rest)
      const before = scoreAll(items, DEFAULT_ENGINE_RULES.weights, [240, 360], 2, new Map())
      const bumped = items.map((x, i) => ({ ...x, price: { ...x.price, total: { ...x.price.total, amountMinor: x.price.total.amountMinor + bump * (i + 1) } } }))
      const after = scoreAll(bumped, DEFAULT_ENGINE_RULES.weights, [240, 360], 2, new Map())
      expect(after.map((x) => x.score)).toEqual(before.map((x) => x.score))
      expect([...after].sort(byCost).map((x) => x.id)).toEqual([...before].sort(byCost).map((x) => x.id))
      const offersRepriced = offers.map((o) => ({ ...o, price: { ...o.price, total: { ...o.price.total, amountMinor: o.price.total.amountMinor + bump } } }))
      const r2 = assemble(c, [{ call: call({ kind: "THROUGH" }), offers: offersRepriced }], new Map())
      const best = (x: typeof r) => x.results.filter((i) => i.tabs.includes("BEST")).map((i) => i.id)
      expect(best(r2)).toEqual(best(r))
    }), { numRuns: 300 })
  })

  it("deduplication is idempotent and order-independent", () => {
    fc.assert(fc.property(fc.array(arbOffer, { maxLength: 25 }), (offers) => {
      const dupes: NormalisedOffer[] = [...offers, ...offers.map((o) => ({ ...o, source: { ...o.source, provider: "duffel" as const, providerOfferId: o.source.providerOfferId + "d" } }))]
      const prio = new Map([["fake", 1], ["duffel", 2]])
      const once = dedupeOffers(dupes, prio)
      expect(dedupeOffers(once, prio)).toEqual(once)
      expect(dedupeOffers([...dupes].reverse(), prio)).toEqual(once)
    }), { numRuns: 300 })
  })

  it("converts local times with DST correctly", () => {
    expect(localToUtc("2026-03-29T02:30", "Europe/London")).toBe("2026-03-29T01:30:00Z")
    expect(localToUtc("2026-11-14T07:10", "Europe/Istanbul")).toBe("2026-11-14T04:10:00Z")
    expect(fmt(Date.parse("2026-11-14T04:10:00Z"))).toBe("2026-11-14T04:10")
  })
})
