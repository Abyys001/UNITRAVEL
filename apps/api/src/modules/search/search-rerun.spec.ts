import { describe, expect, it, vi } from "vitest"

import { DEFAULT_ENGINE_RULES, DEFAULT_HUBS, type Itinerary, SearchQuery } from "@unitravel/contracts"
import { searchResults, searches } from "@unitravel/db"

import { IKA_IST, MIXED_DATASET } from "../../../test/fixtures/apify/google-flights"
import { FakeRedis, reference } from "../../../test/fixtures/apify/helpers"
import { SupplierError } from "../suppliers/adapter"
import { normaliseRows } from "../suppliers/adapters/apify/normalise"
import { SearchService } from "./search.service"

const ID = "apify-google-flights"
const SEARCH_ID = "0192f3c0-0000-7000-8000-000000000001"
const query = SearchQuery.parse({ tripType: "ONE_WAY", slices: [{ from: { airport: "IST" }, to: { airport: "LHR" }, date: "2026-12-10" }], passengers: [{ type: "ADT" }] })
const offers = normaliseRows(MIXED_DATASET, { reference, fetchedAt: new Date(), ttlSeconds: 10800 }).offers.filter((o) => o.slices[0]!.origin === "IST")

function build(searchBehaviour: () => Promise<{ ok: true; value: typeof offers; meta: { durationMs: number } } | { ok: false; error: SupplierError; meta: { durationMs: number } }>, opts: { query?: SearchQuery; blockedCarriers?: string[] } = {}) {
  const row = { id: SEARCH_ID, query: opts.query ?? query, status: "RUNNING" as string, locale: "en", ruleVersion: 1, hubsVersion: 1, engineVersion: "t", expiresAt: new Date(Date.now() + 30 * 60_000), userId: null }
  const redis = new FakeRedis()
  const writes: { op: string; table: unknown; values?: unknown }[] = []
  const tx = {
    delete: (t: unknown) => ({ where: async () => void writes.push({ op: "delete", table: t }) }),
    update: (t: unknown) => ({ set: (v: Record<string, unknown>) => ({ where: async () => { writes.push({ op: "update", table: t, values: v }); Object.assign(row, v) } }) }),
    insert: (t: unknown) => ({ values: async (v: unknown) => void writes.push({ op: "insert", table: t, values: v }) }),
  }
  const db = { select: () => ({ from: () => ({ where: async () => [row] }) }), transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) }
  const jobs: { name: string; data: unknown; opts: unknown }[] = []
  const suppliers = {
    searchable: async () => [{ row: { id: ID, priority: 9 }, budgetRemaining: 10, cityCodes: false }],
    shadowProviders: async () => [], search: vi.fn(searchBehaviour),
  }
  const svc = new SearchService(
    db as never, redis as never, { get: () => ({ add: async (name: string, data: unknown, opts: unknown) => void jobs.push({ name, data, opts }) }) } as never,
    { register: vi.fn() } as never, { get: (d: string) => (d === "ENGINE_RULES" ? DEFAULT_ENGINE_RULES : DEFAULT_HUBS), version: () => 1, flag: () => false } as never,
    { lookup: () => reference, airport: reference.airport } as never,
    { carrierPolicy: async () => ({ blockedCarriers: new Set(opts.blockedCarriers ?? []), reviewCarriers: new Set(), blockedAirports: new Set(), reviewAirports: new Set() }) } as never,
    suppliers as never, { setSearchPort: vi.fn() } as never, {} as never,
  )
  const state = (): { status: string; version: number; notices: string[] } => JSON.parse(redis.kv.get(`search:${SEARCH_ID}:state`) ?? "{}")
  return { svc, row, redis, writes, jobs, suppliers, state }
}
const pending = async () => ({ ok: false as const, error: new SupplierError("SUPPLIER_PENDING", "later"), meta: { durationMs: 1 } })
const ok = async () => ({ ok: true as const, value: offers, meta: { durationMs: 1 } })

describe("search.execute is re-entrant (ADR-0029)", () => {
  it("a pending source completes the search with SOURCE_PENDING, not as a failure", async () => {
    const { svc, state, row } = build(pending)
    await svc.execute(SEARCH_ID)
    expect(row.status).toBe("COMPLETE")
    expect(state().notices).toContain("SOURCE_PENDING")
    expect(state().status).toBe("COMPLETE")
  })

  it("a finished search is not run again by a plain job, but is by a re-run", async () => {
    const { svc, suppliers, row } = build(pending)
    await svc.execute(SEARCH_ID)
    const calls = suppliers.search.mock.calls.length
    await svc.execute(SEARCH_ID)
    expect(suppliers.search.mock.calls.length).toBe(calls)
    expect(row.status).toBe("COMPLETE")
    await svc.execute(SEARCH_ID, { rerun: true })
    expect(suppliers.search.mock.calls.length).toBeGreaterThan(calls)
  })

  it("the re-run reloads state, bumps the version, replaces stored results and drops the pending notice", async () => {
    let answer = pending
    const { svc, state, writes, redis } = build(() => answer())
    await svc.execute(SEARCH_ID)
    const before = state()
    expect(JSON.parse(redis.kv.get(`search:${SEARCH_ID}:results:v${before.version}`)!)).toHaveLength(0)

    answer = ok as never
    await svc.execute(SEARCH_ID, { rerun: true })
    const after = state()
    expect(after.version).toBeGreaterThan(before.version)
    expect(after.notices).not.toContain("SOURCE_PENDING")
    expect(after.status).toBe("COMPLETE")
    const results = JSON.parse(redis.kv.get(`search:${SEARCH_ID}:results:v${after.version}`)!) as Itinerary[]
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.components[0]!.source).toMatchObject({ provider: ID, confidence: "INDICATIVE" })
    // Stored results of the earlier run are removed before the new ones are inserted, so itinerary keys never collide.
    const ops = writes.map((w) => `${w.op}:${w.table === searchResults ? "results" : w.table === searches ? "searches" : "?"}`)
    expect(ops.slice(-3)).toEqual(["delete:results", "update:searches", "insert:results"])
    expect(redis.published.some(([, m]) => JSON.parse(m).event === "done")).toBe(true)
  })

  it("an expired search is not re-run", async () => {
    const { svc, row, suppliers } = build(pending)
    await svc.execute(SEARCH_ID)
    const calls = suppliers.search.mock.calls.length
    row.expiresAt = new Date(Date.now() - 1000)
    await svc.execute(SEARCH_ID, { rerun: true })
    expect(suppliers.search.mock.calls.length).toBe(calls)
  })

  it("two runs of one search never overlap: a re-run that finds the lock queues itself again", async () => {
    const { svc, redis, jobs, suppliers } = build(pending)
    await redis.set(`search:${SEARCH_ID}:exec`, "1", "PX", 60000, "NX")
    await svc.execute(SEARCH_ID, { rerun: true })
    expect(suppliers.search).not.toHaveBeenCalled()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ data: { searchId: SEARCH_ID, rerun: true }, opts: { delay: 3000 } })
  })

  it("an exhausted indicative budget is shown as SOURCE_BUDGET without failing the search", async () => {
    const { svc, state } = build(async () => ({ ok: false as const, error: new SupplierError("SUPPLIER_RATE_LIMITED", "budget"), meta: { durationMs: 1 } }))
    await svc.execute(SEARCH_ID)
    expect(state().notices).toContain("SOURCE_BUDGET")
  })
})

describe("revalidate (ADR-0029)", () => {
  const itinerary = (provider: string, price: boolean) => ({ itinerary: { components: [{ source: { provider, rung: "CACHED_OFFER", providerOfferId: "x", fetchedAt: "2026-11-03T10:00:00Z" }, price: { total: { amountMinor: 100, currency: "GBP" } } }], price: { total: { amountMinor: 100, currency: "GBP" } } } as never, price })

  it("an indicative component is not repriced: NOT_REVALIDATABLE, no supplier call, nothing blocks", async () => {
    const b = build(pending)
    const priceCall = vi.fn()
    Object.assign(b.suppliers, { row: async () => ({ capabilities: { price: false } }), price: priceCall })
    const r = await b.svc.revalidate(itinerary(ID, false).itinerary, "r")
    expect(r.outcome).toBe("NOT_REVALIDATABLE")
    expect(priceCall).not.toHaveBeenCalled()
  })

  it("a priceable component is still revalidated as before", async () => {
    const b = build(pending)
    const priced = { source: { provider: "duffel", rung: "PRICED_OFFER", providerOfferId: "x", fetchedAt: "2026-11-03T10:00:00Z" }, price: { total: { amountMinor: 100, currency: "GBP" } } }
    Object.assign(b.suppliers, { row: async () => ({ capabilities: { price: true } }), price: async () => ({ ok: true, value: priced }) })
    expect((await b.svc.revalidate(itinerary("duffel", true).itinerary, "r")).outcome).toBe("CONFIRMED")
  })
})

describe("Iran lanes (ADR-0029 A10)", () => {
  // The seeded carrier policy (packages/db/src/seed/index.ts, D-01): carriers registered in Iran are BLOCKED. No AIRPORT policy is seeded.
  const SEEDED_BLOCKED_CARRIERS = ["IR", "W5", "EP", "QB", "ZV", "I3"]
  const iranQuery = SearchQuery.parse({ tripType: "ONE_WAY", slices: [{ from: { airport: "IKA" }, to: { airport: "IST" }, date: "2026-12-10" }], passengers: [{ type: "ADT" }] })
  const ikaOffers = normaliseRows([IKA_IST, { ...IKA_IST, flightNumbers: ["W5101"], legs: [{ ...IKA_IST.legs[0]!, flightNumber: "W5101", airlineCode: "W5", airline: "Mahan Air" }] }], { reference, fetchedAt: new Date(), ttlSeconds: 10800 }).offers
  const run = async () => {
    const { svc, redis, state } = build(async () => ({ ok: true as const, value: ikaOffers, meta: { durationMs: 1 } }), { query: iranQuery, blockedCarriers: SEEDED_BLOCKED_CARRIERS })
    await svc.execute(SEARCH_ID)
    return JSON.parse(redis.kv.get(`search:${SEARCH_ID}:results:v${state().version}`)!) as Itinerary[]
  }

  it("control: an Iranian carrier on the lane is removed by the seeded carrier policy", async () => {
    const carriers = (await run()).flatMap((it) => it.carriers)
    expect(carriers).not.toContain("W5")
  })

  // BLOCKED pending owner/counsel: the seeded policies do not remove a non-Iranian carrier (TK) flying out of Iran. The only
  // Iran lane policy, LANE `IR:*`, is REVIEW and is read by cargo and service-availability code, not by the flight engine.
  // Rule 5: policy is data, so no override is hard-coded here. Run this test (change `it.skip` to `it`) once the owner
  // decides how Iran-origin flights must be handled; as of 2 Nov 2026 it fails with `expected [ 'TK' ] to deeply equal []`.
  it.skip("an Iran-origin search (IKA to IST) yields no customer results under the seeded policies", async () => {
    expect((await run()).flatMap((it) => it.carriers)).toEqual([])
  })
})
