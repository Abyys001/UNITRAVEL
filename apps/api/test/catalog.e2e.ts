import "reflect-metadata"

import cookieParser from "cookie-parser"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { Test } from "@nestjs/testing"
import type { INestApplication } from "@nestjs/common"

import { CatalogCoverage, CatalogSearchResponse, CatalogUsage, DEFAULT_CATALOG_SETTINGS, PublicItineraryDetail } from "@unitravel/contracts"

import { AppModule } from "../src/app.module"
import { resetEnvForTests } from "../src/core/env"
import { REDIS } from "../src/core/infra.module"
import { Queues } from "../src/core/queues"
import { CatalogRefreshService } from "../src/modules/catalog/catalog-refresh.service"
import { CatalogWriteService } from "../src/modules/catalog/catalog-write.service"
import { FlightDataService } from "../src/modules/suppliers/apify/flight-data.service"
import { ApifyClient } from "../src/modules/suppliers/adapters/apify/client"
import { FlightapiClient } from "../src/modules/suppliers/adapters/flightapi/client"
import { SuppliersService } from "../src/modules/suppliers/suppliers.service"
import { cleanupTestData, inDays, offer, slotId, TEST_AIRPORTS } from "./catalog-harness"
import { ADMIN_HOST, dbQuery, Session, useApi } from "./client"

/**
 * ADR-0034 end to end, in-process: the real Nest application (api role) on a random port, the real database and Redis, queues faked so
 * nothing is enqueued for the shared worker. Customer endpoints are exercised in every state with the Apify client and the supplier
 * gateway replaced by spies that fail the test if they are ever called. Admin routes are exercised through real staff sessions
 * (ADR-0012 test sign-in). Test data: made-up watchlist routes TBZ→SAW, SAW→MAN and combined TBZ→MAN, removed afterwards.
 */

// ADR-0012 email sign-in lets the tests open staff sessions without the SMS pipeline. The environment is cached per process, so it is re-read.
const priorSignIn = process.env.TEST_SIGN_IN

let app: INestApplication
let redis: import("ioredis").Redis
let write: CatalogWriteService
let originalSettings: { value: unknown } | undefined
let routeIds: Record<string, string> = {}
const since = new Date(Date.now() - 1000)
const bodies: unknown[] = []

const D = (n: number) => inDays(n)
const TEST_SETTINGS = { ...DEFAULT_CATALOG_SETTINGS, connections: { ...DEFAULT_CATALOG_SETTINGS.connections, hubs: [{ iata: "SAW", enabled: true }], pairs: [{ from: "TBZ", via: "SAW", to: "MAN", enabled: true }] } }

const fakeQueue = { add: async () => undefined, upsertJobScheduler: async () => undefined, removeJobScheduler: async () => undefined, getJobScheduler: async () => undefined }
const fakeQueues = { get: () => fakeQueue, all: () => [], onModuleDestroy: async () => undefined }

// ---- spies that fail the test when a provider is reached ----
const trap = (what: string) => () => { throw new Error(`${what} was called from a customer path`) }
const providerSpies = () => [
  ...(["startRun", "runStatus", "items", "limits", "defaultBuild", "setMonthlyCap"] as const).map((m) => vi.spyOn(ApifyClient.prototype, m).mockImplementation(trap(`ApifyClient.${m}`) as never)),
  vi.spyOn(FlightapiClient.prototype, "onewayTrip").mockImplementation(trap("FlightapiClient.onewayTrip") as never),
  vi.spyOn(SuppliersService.prototype, "search").mockImplementation(trap("SuppliersService.search") as never),
  vi.spyOn(SuppliersService.prototype, "call").mockImplementation(trap("SuppliersService.call") as never),
  vi.spyOn(FlightDataService.prototype, "lookup").mockImplementation(trap("FlightDataService.lookup") as never),
]

const get = async (path: string, headers: Record<string, string> = {}, s = new Session("WEB")) => {
  const r = await s.get(path, headers)
  bodies.push(r.body)
  return r
}
const search = (from: string, to: string, date: string, extra = "", headers: Record<string, string> = {}) => get(`/v1/flights/search?from=${from}&to=${to}&date=${date}${extra}`, headers)

beforeAll(async () => {
  process.env.TEST_SIGN_IN = "on"
  resetEnvForTests()
  // Settings: the test pair, restoring whatever was there afterwards.
  originalSettings = (await dbQuery<{ value: unknown }>("select value from settings where key = 'catalog'"))[0]
  await dbQuery("insert into settings (key, value) values ('catalog', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(TEST_SETTINGS)])
  await cleanupTestData()
  for (const [key, [o, d], kind, via, max] of [["a", ["TBZ", "SAW"], "DIRECT", null, 3], ["b", ["SAW", "MAN"], "DIRECT", null, 5], ["combined", ["TBZ", "MAN"], "COMBINED", "SAW", null]] as const) {
    routeIds[key] = (await dbQuery<{ id: string }>("insert into flight_watchlist_routes (id, origin, destination, kind, via_hub, horizon_days, max_results) values (gen_random_uuid(), $1, $2, $3, $4, 14, $5) returning id", [o, d, kind, via, max]))[0]!.id
  }
  const mod = await Test.createTestingModule({ imports: [AppModule.forRole("api")] }).overrideProvider(Queues).useValue(fakeQueues).compile()
  app = mod.createNestApplication()
  app.use(cookieParser())
  app.getHttpAdapter().getInstance().set("trust proxy", "loopback")
  await app.init()
  await app.listen(0)
  useApi((await app.getUrl()).replace("[::1]", "localhost"))
  redis = app.get(REDIS)
  write = app.get(CatalogWriteService)
  await app.get(CatalogRefreshService).rollSlots(new Date(), Object.values(routeIds))
}, 120_000)

afterAll(async () => {
  if (priorSignIn === undefined) delete process.env.TEST_SIGN_IN
  else process.env.TEST_SIGN_IN = priorSignIn
  resetEnvForTests()
  useApi()
  vi.restoreAllMocks()
  await app?.close()
  await cleanupTestData(since)
  await dbQuery("delete from settings where key = 'catalog'")
  if (originalSettings) await dbQuery("insert into settings (key, value) values ('catalog', $1)", [JSON.stringify(originalSettings.value)])
  const r = new (await import("ioredis")).Redis(process.env.REDIS_URL ?? "redis://localhost:6390")
  await r.del("catalog:refresh:lock")
  for (const k of await r.keys("demand:*")) if (TEST_AIRPORTS.some((a) => k.includes(a)) || k.includes("MHD")) await r.del(k)
  r.disconnect()
})

const put = async (route: "a" | "b", date: string, offers: ReturnType<typeof offer>[], fetchedAt = new Date()) => write.writeSlot({ slotId: (await slotId(routeIds[route]!, date))!, offers, fetchedAt, notices: [] })
const tb = (date: string, dep: string, arr: string, o: { number?: string; minor?: number } = {}) => offer({ from: "TBZ", to: "SAW", date, dep, arr, number: o.number ?? dep.replace(":", ""), minor: o.minor })
const sm = (date: string, dep: string, arr: string, o: { number?: string } = {}) => offer({ from: "SAW", to: "MAN", date, dep, arr, number: o.number ?? dep.replace(":", "") })

describe("customer endpoints: stored snapshots only, never a provider", () => {
  const spies: ReturnType<typeof providerSpies> = []
  beforeAll(async () => {
    spies.push(...providerSpies())
    await put("a", D(3), [tb(D(3), "08:00", "11:30", { number: "100" }), tb(D(3), "14:00", "17:30", { number: "200" })])
    await put("b", D(3), [sm(D(3), "16:30", "18:45", { number: "300" })])
    await put("a", D(1), [tb(D(1), "08:00", "11:30", { number: "111" })], new Date(Date.now() - 30 * 3_600_000)) // tier 0: stale after 24 h
    await put("a", D(5), [tb(D(5), "09:00", "12:30", { number: "555" })], new Date(Date.now() - 8 * 86_400_000)) // older than hide_after_days
    await put("a", D(6), []) // Apify answered, nothing listed
    await put("a", D(8), [tb(D(8), "09:00", "12:30", { number: "888" })])
  })
  afterAll(() => { for (const s of spies) s.mockClear() })

  it("RESULTS: flights, no price anywhere, the exact cache headers and an ETag", async () => {
    const r = await search("TBZ", "SAW", D(3))
    expect(r.status).toBe(200)
    expect(r.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=900")
    expect(r.headers.get("etag")).toBeTruthy()
    const body = CatalogSearchResponse.parse(r.body)
    expect(body).toMatchObject({ tracked: true, state: "RESULTS", origin: "TBZ", destination: "SAW", date: D(3), partyNote: false })
    expect(body.results.map((x) => x.flightNumbers[0])).toEqual(["TK100", "TK200"])
    expect(body.fetchedAt).toBeTruthy()
    expect(body.results.every((x) => !x.selfTransfer && x.complianceReview)).toBe(true) // the Iran lane is on REVIEW (FLIGHT:IR:*)
    expect(body.dates).toHaveLength(1)
  })

  it("answers If-None-Match with 304, and a new write changes the ETag", async () => {
    const first = await search("TBZ", "SAW", D(3))
    const etag = first.headers.get("etag")!
    const again = await search("TBZ", "SAW", D(3), "", { "if-none-match": etag })
    expect(again.status).toBe(304)
    expect(again.body).toBeFalsy()
    expect(again.headers.get("etag")).toBe(etag)
    await put("a", D(3), [tb(D(3), "08:00", "11:30", { number: "100" }), tb(D(3), "14:00", "17:30", { number: "200" })])
    const after = await search("TBZ", "SAW", D(3), "", { "if-none-match": etag })
    expect(after.status).toBe(200)
    expect(after.headers.get("etag")).not.toBe(etag)
  })

  it("a self-transfer comes with its layover and the separate-tickets flag; only the pairing inside the 4–6 h window is listed", async () => {
    const r = await search("TBZ", "MAN", D(3))
    const body = CatalogSearchResponse.parse(r.body)
    expect(body.state).toBe("RESULTS")
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({ origin: "TBZ", destination: "MAN", selfTransfer: true, stops: 1, layovers: [{ at: "SAW" }], complianceReview: true })
    expect(body.results[0]!.riskFlags).toContain("SEPARATE_TICKETS")
    expect(body.results[0]!.layovers[0]!.minutes).toBe(300) // 11:30 in, 16:30 out; the 17:30 arrival cannot make that flight
  })

  it("STALE: older than 3× its tier interval, still shown, flagged", async () => {
    const body = CatalogSearchResponse.parse((await search("TBZ", "SAW", D(1))).body)
    expect(body.state).toBe("STALE")
    expect(body.results).toHaveLength(1)
    expect(Date.now() - Date.parse(body.fetchedAt!)).toBeGreaterThan(24 * 3_600_000)
  })

  it("EMPTY: nothing listed, listed too long ago, or no slot at all; nearby dates that do have flights are offered", async () => {
    for (const date of [D(6), D(5), D(60)]) {
      const body = CatalogSearchResponse.parse((await search("TBZ", "SAW", date)).body)
      expect(body, date).toMatchObject({ tracked: true, state: "EMPTY", results: [] })
      expect(body.nearbyDates).toEqual(expect.arrayContaining([D(3), D(8)]))
      expect(body.nearbyDates).not.toContain(date)
      expect(body.nearbyDates).not.toContain(D(5)) // hidden: too old
    }
  })

  it("flex returns the requested date and its neighbours, grouped by date", async () => {
    const body = CatalogSearchResponse.parse((await search("TBZ", "SAW", D(4), "&flex=2")).body)
    expect(body.dates.map((d) => d.date)).toEqual([D(2), D(3), D(4), D(5), D(6)])
    expect(body.dates.find((d) => d.date === D(3))).toMatchObject({ state: "RESULTS" })
    expect(body.dates.find((d) => d.date === D(5))).toMatchObject({ state: "EMPTY" })
    expect(body.state).toBe("EMPTY")
  })

  it("other cabins and party sizes still get the catalog's flights, with the note that the team confirms", async () => {
    for (const extra of ["&cabin=business", "&adults=3"]) {
      const body = CatalogSearchResponse.parse((await search("TBZ", "SAW", D(3), extra)).body)
      expect(body).toMatchObject({ state: "RESULTS", partyNote: true })
      expect(body.results.length).toBeGreaterThan(0)
    }
  })

  it("NOT_TRACKED: an untracked route is an honest answer, never an error, and counts as demand for that pair", async () => {
    const r = await search("MHD", "FRA", D(3))
    expect(r.status).toBe(200)
    expect(CatalogSearchResponse.parse(r.body)).toMatchObject({ tracked: false, state: "NOT_TRACKED", results: [], dates: [], nearbyDates: [] })
    expect(Number(await redis.get(`demand:MHD:FRA:${D(3)}`))).toBe(1)
  })

  it("demand: +1 per view, once per visitor per hour; only a hash is kept, with a one-hour expiry", async () => {
    const key = `demand:TBZ:SAW:${D(8)}`
    await redis.del(key)
    const one = new Session("WEB")
    await get(`/v1/flights/search?from=TBZ&to=SAW&date=${D(8)}`, {}, one)
    await get(`/v1/flights/search?from=TBZ&to=SAW&date=${D(8)}`, {}, one)
    expect(Number(await redis.get(key))).toBe(1)
    await get(`/v1/flights/search?from=TBZ&to=SAW&date=${D(8)}`, { "user-agent": "another-visitor" }, new Session("WEB"))
    expect(Number(await redis.get(key))).toBe(2)
    const seen = await redis.keys("demand:seen:*")
    expect(seen.length).toBeGreaterThan(0)
    for (const k of seen.slice(0, 5)) {
      expect(k).toMatch(/^demand:seen:[0-9a-f]{32}:/)
      expect(await redis.ttl(k)).toBeLessThanOrEqual(3600)
      expect(k).not.toMatch(/10\.\d+\.\d+\.\d+|127\.0\.0\.1|another-visitor/)
    }
  })

  it("Redis down: served from the snapshot table; Postgres down: served from Redis; both down: UNAVAILABLE and not cacheable", async () => {
    const { DB } = await import("../src/core/infra.module")
    const db = app.get(DB)
    const mget = vi.spyOn(redis, "mget").mockRejectedValue(new Error("redis down"))
    try {
      const fromPg = CatalogSearchResponse.parse((await search("TBZ", "SAW", D(8))).body)
      expect(fromPg.state).toBe("RESULTS")
    } finally {
      mget.mockRestore()
    }
    // Warm Redis, then lose Postgres.
    await search("TBZ", "SAW", D(8))
    const select = vi.spyOn(db, "select").mockImplementation(() => { throw new Error("pg down") })
    try {
      expect(CatalogSearchResponse.parse((await search("TBZ", "SAW", D(8))).body).state).toBe("RESULTS")
      const m2 = vi.spyOn(redis, "mget").mockRejectedValue(new Error("redis down"))
      try {
        const r = await search("TBZ", "SAW", D(8))
        expect(r.status).toBe(200)
        expect(CatalogSearchResponse.parse(r.body)).toMatchObject({ state: "UNAVAILABLE", results: [] })
        expect(r.headers.get("cache-control")).toBe("no-store")
      } finally {
        m2.mockRestore()
      }
    } finally {
      select.mockRestore()
    }
  })

  it("a result's detail: legs and times from the stored copy, no price, a 404 for an unknown id, 400 for a malformed one", async () => {
    const list = CatalogSearchResponse.parse((await search("TBZ", "MAN", D(3))).body)
    const id = list.results[0]!.id
    const r = await get(`/v1/flights/results/${id}`)
    expect(r.status).toBe(200)
    expect(r.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=900")
    const d = PublicItineraryDetail.strict().parse(r.body)
    expect(d).toMatchObject({ id, selfTransfer: true, isCurrent: true })
    expect(d.legs).toHaveLength(2)
    expect(d.legs[0]).toMatchObject({ from: { iata: "TBZ" }, to: { iata: "SAW" } })
    expect((await get("/v1/flights/results/00000000-0000-4000-8000-000000000000")).status).toBe(404)
    expect((await get("/v1/flights/results/not-a-uuid")).status).toBe(400)
  })

  it("the tracked routes list is cached for an hour and lists self-transfer routes as such", async () => {
    const r = await get("/v1/flights/routes")
    expect(r.status).toBe(200)
    expect(r.headers.get("cache-control")).toContain("max-age=3600")
    expect(r.body.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "TBZ", destination: "SAW", selfTransfer: false }), expect.objectContaining({ origin: "TBZ", destination: "MAN", selfTransfer: true }),
    ]))
  })

  it("popular-route cards read the same snapshots: price-free, no stored search behind them, nothing hidden or departed", async () => {
    const r = await get("/v1/listings/flights?from=TBZ&to=SAW")
    expect(r.status).toBe(200)
    expect(r.body.notice).toBeNull()
    const dates = r.body.items.map((i: { departureDate: string }) => i.departureDate)
    expect(dates).toEqual(expect.arrayContaining([D(1), D(3), D(8)]))
    expect(dates).not.toContain(D(5)) // listed more than hide_after_days ago
    for (const i of r.body.items) expect(i).toMatchObject({ label: "CACHED_OFFER", origin: "TBZ", destination: "SAW", offerRef: null, fetchedAt: expect.any(String) })
    expect((await get("/v1/listings/flights?from=MHD&to=FRA")).body).toEqual({ items: [], notice: "NO_SOURCES" })
  })

  it("no body, snapshot row or cached blob carries an amount, currency, fare, booking token, Google link or provider field", async () => {
    const FARE = /amount|price|currency|\bUSD\b|\bGBP\b|fare|baggage|bookingToken|googleFlights|providerData|"provider"|"total"|23100/i
    expect(bodies.length).toBeGreaterThan(10)
    expect(JSON.stringify(bodies)).not.toMatch(FARE)
    const rows = await dbQuery<{ payload: unknown }>("select payload from catalog_public_snapshots where slot_id in (select id from catalog_slots where route_id = any($1))", [Object.values(routeIds)])
    expect(rows.length).toBeGreaterThan(3)
    expect(JSON.stringify(rows)).not.toMatch(FARE)
    for (const k of (await redis.keys("cat:*:v*")).slice(0, 40)) expect(await redis.get(k)).not.toMatch(FARE)
    // The same results do carry a price on the staff side (not a customer table).
    expect(Number((await dbQuery<{ n: string }>("select count(*) n from flight_result_pricing p join flight_results r on r.id = p.result_id where r.origin = 'TBZ'"))[0]!.n)).toBeGreaterThan(0)
  })

  it("through all of the above, nothing reached Apify or the supplier gateway", () => {
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })
})

describe("the customer fan-out is gone", () => {
  it("POST/GET /v1/flight-searches need a staff session: anonymous 401, customer 403", async () => {
    const anon = new Session("WEB")
    expect((await anon.post("/v1/flight-searches", { tripType: "ONE_WAY", slices: [{ from: { airport: "IST" }, to: { airport: "LHR" }, date: D(10) }], passengers: [{ type: "ADT" }] })).status).toBe(401)
    expect((await anon.get("/v1/flight-searches/00000000-0000-4000-8000-000000000000")).status).toBe(401)
    expect((await anon.get("/v1/flight-searches/00000000-0000-4000-8000-000000000000/events")).status).toBe(401)
    const cust = new Session("WEB")
    expect((await cust.post("/v1/auth/test-sign-in", { email: `e2e-${Date.now()}@test.example`, deviceId: cust.deviceId, client: "WEB" })).status).toBe(200)
    expect((await cust.post("/v1/flight-searches", { tripType: "ONE_WAY", slices: [{ from: { airport: "IST" }, to: { airport: "LHR" }, date: D(10) }], passengers: [{ type: "ADT" }] })).status).toBe(403)
    expect((await cust.get("/v1/flight-searches/00000000-0000-4000-8000-000000000000")).status).toBe(403)
  })
})

describe("admin API", () => {
  let admin: Session, dev: Session, cargo: Session, compliance: Session, cust: Session
  const login = async (email: string) => {
    const s = new Session("CONSOLE", ADMIN_HOST)
    const r = await s.post("/v1/auth/test-sign-in", { email, deviceId: s.deviceId, client: "CONSOLE" })
    if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${JSON.stringify(r.body)}`)
    return s
  }
  beforeAll(async () => {
    vi.restoreAllMocks()
    ;[admin, dev, cargo, compliance] = await Promise.all([login("sara@unitravel.example"), login("dev@unitravel.example"), login("cargo@unitravel.example"), login("compliance@unitravel.example")])
    cust = new Session("WEB")
    await cust.post("/v1/auth/test-sign-in", { email: `e2e-cust-${Date.now()}@test.example`, deviceId: cust.deviceId, client: "WEB" })
    // The Apify client is never real here: free reads answer from a stub, and the one paid call is a stub too.
    vi.spyOn(SuppliersService.prototype, "credentials").mockResolvedValue({ token: "tok_test_secret" })
    vi.spyOn(SuppliersService.prototype, "credentialInvalid").mockResolvedValue(false)
    vi.spyOn(ApifyClient.prototype, "limits").mockResolvedValue({ cycle: new Date(Date.now() - 10 * 86_400_000).toISOString(), cycleEnd: new Date(Date.now() + 20 * 86_400_000).toISOString(), maxMonthlyUsageUsd: 5, monthlyUsageUsd: 0.42 })
  })

  it("catalog.read: admin and developer; cargo, compliance, customers and anonymous callers are refused", async () => {
    for (const path of ["usage", "coverage", "settings", "routes"]) {
      expect((await new Session("WEB").get(`/v1/admin/catalog/${path}`)).status, path).toBe(401)
      expect((await cust.get(`/v1/admin/catalog/${path}`)).status, path).toBe(403)
      expect((await cargo.get(`/v1/admin/catalog/${path}`)).status, path).toBe(403)
      expect((await compliance.get(`/v1/admin/catalog/${path}`)).status, path).toBe(403)
      expect((await admin.get(`/v1/admin/catalog/${path}`)).status, path).toBe(200)
      expect((await dev.get(`/v1/admin/catalog/${path}`)).status, path).toBe(200)
    }
  })

  it("usage: cycle from Apify's reading, budget arithmetic, reserve and projection", async () => {
    const u = CatalogUsage.parse((await admin.get("/v1/admin/catalog/usage")).body)
    expect(u).toMatchObject({ spentSource: "apify", spentUsd: 0.42, budgetUsd: 5, accountCapUsd: 5, paused: false, reserveReleased: false })
    expect(u.availableUsd).toBeCloseTo(5 - 0.2 - 0.75 - 0.42, 6)
    expect(u.reserveLeftUsd).toBeCloseTo(0.75, 6)
    expect(Date.parse(u.cycleEnd!) - Date.now()).toBeGreaterThan(19 * 86_400_000)
  })

  it("coverage: a strip of slots per route with live status, and a setup warning only when the Iran lane policy is missing", async () => {
    const c = CatalogCoverage.parse((await admin.get("/v1/admin/catalog/coverage")).body)
    const a = c.routes.find((r) => r.route.origin === "TBZ" && r.route.destination === "SAW")!
    expect(a.slots).toHaveLength(15)
    expect(a.slots.find((s) => s.date === D(3))).toMatchObject({ status: "FRESH", resultCount: 2, tier: "T1" })
    expect(a.slots.find((s) => s.date === D(1))).toMatchObject({ status: "STALE" })
    expect(a.slots.find((s) => s.date === D(6))).toMatchObject({ status: "EMPTY" })
    expect(c.warnings ?? []).toEqual([]) // FLIGHT:IR:* is seeded locally
  })

  it("settings: audited patch (catalog.manage), validation, the budget calculator and its no-save preview", async () => {
    const before = (await admin.get("/v1/admin/catalog/settings")).body
    expect(before.estimate.overBudget).toEqual(expect.any(Boolean))
    expect(before.estimate.spendableUsd).toBeCloseTo(4.05, 6)
    expect((await cargo.patch("/v1/admin/catalog/settings", { monthlyBudgetUsd: 6 })).status).toBe(403)
    expect((await admin.patch("/v1/admin/catalog/settings", { connections: { ...before.settings.connections, minLayoverMin: 400, maxLayoverMin: 300 } })).status).toBe(400)
    expect((await admin.patch("/v1/admin/catalog/settings", { monthlyBudgetUsd: -1 })).status).toBe(400)
    const preview = await admin.post("/v1/admin/catalog/estimate", { monthlyBudgetUsd: 1, adminReserveUsd: 0.1 })
    expect(preview.body.spendableUsd).toBeCloseTo(0.7, 6)
    expect((await admin.get("/v1/admin/catalog/settings")).body.settings.monthlyBudgetUsd).toBe(5)
    const patched = await admin.patch("/v1/admin/catalog/settings", { safetyMarginUsd: 0.3 })
    expect(patched.status).toBe(200)
    expect(patched.body.settings.safetyMarginUsd).toBe(0.3)
    const audit = await dbQuery<any>("select action, actor_kind, before, after from audit_log where action = 'catalog.settings_changed' order by id desc limit 1")
    expect(audit[0]).toMatchObject({ actor_kind: "STAFF", before: { safetyMarginUsd: 0.2 }, after: { safetyMarginUsd: 0.3 } })
    await admin.patch("/v1/admin/catalog/settings", { safetyMarginUsd: 0.2 })
  })

  it("watchlist: list, add (duplicates refused), edit; pause and resume", async () => {
    const list = (await admin.get("/v1/admin/catalog/routes")).body.routes as any[]
    expect(list.map((r) => `${r.origin}-${r.destination}-${r.kind}`)).toEqual(expect.arrayContaining(["TBZ-SAW-DIRECT", "SAW-MAN-DIRECT", "TBZ-MAN-COMBINED"]))
    expect((await admin.post("/v1/admin/catalog/routes", { origin: "TBZ", destination: "SAW" })).status).toBe(400)
    expect((await admin.post("/v1/admin/catalog/routes", { origin: "TBZ", destination: "TBZ" })).status).toBe(400)
    expect((await cargo.post("/v1/admin/catalog/routes", { origin: "TBZ", destination: "AMS" })).status).toBe(403)
    const r = list.find((x) => x.origin === "SAW" && x.destination === "MAN")
    const edited = await admin.patch(`/v1/admin/catalog/routes/${r.id}`, { maxResults: 7, priorityWeight: 2 })
    expect(edited.body).toMatchObject({ maxResults: 7, priorityWeight: 2 })
    await admin.patch(`/v1/admin/catalog/routes/${r.id}`, { maxResults: 5, priorityWeight: 1 })
    expect((await admin.patch("/v1/admin/catalog/routes/00000000-0000-4000-8000-000000000000", { enabled: false })).status).toBe(404)

    const paused = await dev.post("/v1/admin/catalog/pause", {})
    expect(paused.body).toMatchObject({ paused: true, pauseReason: "MANUAL" })
    const resumed = await dev.post("/v1/admin/catalog/resume", {})
    expect(resumed.body).toMatchObject({ paused: false, pauseReason: null })
    expect((await cargo.post("/v1/admin/catalog/pause", {})).status).toBe(403)
  })

  it("a slot's results show the fare and its movement to staff only", async () => {
    const slot = (await slotId(routeIds.a!, D(3)))!
    const r = await admin.get(`/v1/admin/catalog/slots/${slot}/results`)
    expect(r.status).toBe(200)
    expect(r.body.results[0]).toMatchObject({ isCurrent: true, price: { amountMinor: 23_100, currency: "USD" } })
    expect((await cust.get(`/v1/admin/catalog/slots/${slot}/results`)).status).toBe(403)
  })

  it("refresh a slot now: quote spends nothing; confirm needs the token, catalog.manage and a fresh second factor; one run at a time", async () => {
    const slot = (await slotId(routeIds.a!, D(2)))!
    const start = vi.spyOn(ApifyClient.prototype, "startRun").mockResolvedValue({ id: "runAdmin1", defaultDatasetId: "dsAdmin1", status: "READY" })
    try {
      expect((await cargo.post(`/v1/admin/catalog/slots/${slot}/refresh/quote`, {})).status).toBe(403)
      const q = await admin.post(`/v1/admin/catalog/slots/${slot}/refresh/quote`, {})
      expect(q.status).toBe(200)
      expect(q.body).toMatchObject({ slotId: slot, estimatedUsd: 0.004 })
      expect(start).not.toHaveBeenCalled()
      expect((await admin.post(`/v1/admin/catalog/slots/${slot}/refresh`, { confirmToken: "x".repeat(24) })).status).toBe(400)
      expect((await cust.post(`/v1/admin/catalog/slots/${slot}/refresh`, { confirmToken: q.body.confirmToken })).status).toBe(403)
      const go = await admin.post(`/v1/admin/catalog/slots/${slot}/refresh`, { confirmToken: q.body.confirmToken })
      expect(go.status).toBe(202)
      expect(go.body).toMatchObject({ status: "PENDING" })
      expect(start).toHaveBeenCalledTimes(1)
      expect(start.mock.calls[0]![1]).toBeCloseTo(0.004, 3)
      const ledger = await dbQuery<any>("select purpose, status, apify_run_id from provider_usage_ledger where id = $1", [go.body.jobId])
      expect(ledger[0]).toMatchObject({ purpose: "admin_revalidate", status: "RUNNING", apify_run_id: "runAdmin1" })
      expect((await admin.get(`/v1/admin/catalog/jobs/${go.body.jobId}`)).body).toEqual({ jobId: go.body.jobId, status: "PENDING" })
      // The lock is held by that run: a second one is refused, not queued behind it.
      const q2 = await admin.post(`/v1/admin/catalog/slots/${slot}/refresh/quote`, {})
      expect((await admin.post(`/v1/admin/catalog/slots/${slot}/refresh`, { confirmToken: q2.body.confirmToken })).status).toBe(409)
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      start.mockRestore()
      await redis.del("catalog:refresh:lock")
    }
  })

  it("revalidate a result: catalog.manage with step-up; the existing recheck route accepts a catalog result id too", async () => {
    const slot = (await slotId(routeIds.a!, D(3)))!
    const [res] = await dbQuery<{ id: string }>("select id from flight_results where slot_id = $1 and is_current limit 1", [slot])
    const start = vi.spyOn(ApifyClient.prototype, "startRun").mockResolvedValue({ id: "runAdmin2", defaultDatasetId: "dsAdmin2", status: "READY" })
    try {
      expect((await cargo.post(`/v1/admin/catalog/results/${res!.id}/revalidate`, {})).status).toBe(403)
      const r = await dev.post(`/v1/admin/catalog/results/${res!.id}/revalidate`, {})
      expect(r.status).toBe(202)
      expect(start.mock.calls[0]![0]).toMatchObject({ maxResults: 30, routes: [{ origin: "TBZ", destination: "SAW", departureDate: D(3) }] })
      await redis.del("catalog:refresh:lock")
      // admin holds pricing.read.internal + catalog.manage, so the legacy recheck URL works for a catalog id
      const legacy = await admin.post(`/v1/admin/itineraries/${res!.id}/recheck`, {})
      expect(legacy.status).toBe(202)
      expect(legacy.body.status).toBe("PENDING")
      expect((await admin.get(`/v1/admin/itineraries/${res!.id}/recheck/${legacy.body.jobId}`)).body.status).toBe("PENDING")
      // an unknown result is a 404, not a spend
      await redis.del("catalog:refresh:lock")
      const calls = start.mock.calls.length
      expect((await dev.post("/v1/admin/catalog/results/00000000-0000-4000-8000-000000000000/revalidate", {})).status).toBe(404)
      expect(start.mock.calls.length).toBe(calls)
    } finally {
      start.mockRestore()
      await redis.del("catalog:refresh:lock")
    }
  })

  it("Developer Panel: apify test reads the free limits; apply-cap needs provider.config.write and sets the cap to the budget, audited", async () => {
    const t = await dev.post("/v1/admin/integrations/apify/test", {})
    expect(t.status).toBe(200)
    expect(t.body).toMatchObject({ ok: true, monthlyUsageUsd: 0.42, maxMonthlyUsageUsd: 5 })
    expect(JSON.stringify(t.body)).not.toContain("tok_test_secret")
    expect((await cargo.post("/v1/admin/integrations/apify/test", {})).status).toBe(403)
    // The cap call itself is stubbed: nothing here may reach Apify.
    const cap = vi.spyOn(ApifyClient.prototype, "setMonthlyCap").mockResolvedValue(undefined)
    try {
      expect((await admin.post("/v1/admin/integrations/apify/apply-cap", {})).status).toBe(403)
      expect((await new Session("WEB").post("/v1/admin/integrations/apify/apply-cap", {})).status).toBe(401)
      expect(cap).not.toHaveBeenCalled()
      const r = await dev.post("/v1/admin/integrations/apify/apply-cap", {})
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ ok: true, maxMonthlyUsageUsd: 5 })
      expect(cap).toHaveBeenCalledWith(5)
      const audit = await dbQuery<any>("select actor_kind, after from audit_log where action = 'catalog.apify_cap_applied' order by id desc limit 1")
      expect(audit[0]).toMatchObject({ actor_kind: "STAFF", after: { maxMonthlyUsageUsd: 5 } })
    } finally {
      cap.mockRestore()
    }
  })
})
