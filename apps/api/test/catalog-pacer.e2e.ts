import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { cleanupTestData, type Catalog, fakeApify, inDays, makeCatalog, offer, row, seedTestRoutes, slotId } from "./catalog-harness"
import { dbQuery } from "./client"
import { LIMITS_RESPONSE } from "./fixtures/apify/google-flights"
import { startApifyMock } from "./fixtures/apify/mock-server"
import { LOCK_KEY } from "../src/modules/catalog/catalog-refresh.service"

/**
 * ADR-0034 pacer runner against the real database and Redis, with Apify replaced by a fake `fetch` (or the repo's local Apify mock server).
 * Covers the lock, the request the actor receives, filing the dataset by echoed route and date, partial datasets and the whole failure
 * matrix of spec §9. Nothing here can reach api.apify.com: the client refuses the production host under NODE_ENV=test unless fetch is a double.
 */
let c: Catalog
let ids: Record<string, string>
let apify: ReturnType<typeof fakeApify>

const D = inDays(2)
const ledger = () => dbQuery<any>("select * from provider_usage_ledger where created_at >= $1 order by created_at", [c.since])
const runsTable = () => dbQuery<any>("select * from provider_runs where created_at >= $1 and pool = 'catalog' order by created_at", [c.since])
const collectJob = () => c.jobs.filter((j) => j.name === "catalog.refresh.collect").at(-1)!
const lock = () => c.redis.get(LOCK_KEY)
/** One flight row per requested route, on the requested date. */
const everyRoute = (per = 1) => (routes: { origin: string; destination: string; departureDate: string }[]) => routes.flatMap((r) => Array.from({ length: per }, (_, i) => row({ from: r.origin, to: r.destination, date: r.departureDate, number: `${1000 + i}`, price: 100 + i })))
const slotsOf = (routeId: string) => dbQuery<any>("select * from catalog_slots where route_id = $1 order by departure_date", [routeId])

beforeAll(async () => {
  c = await makeCatalog()
  ids = await seedTestRoutes(c)
})
afterAll(async () => {
  await cleanupTestData(c.since)
  await c.close()
})
beforeEach(async () => {
  apify = fakeApify({ usage: 0.42, endInDays: 20 })
  apify.state.dataset = everyRoute()
  await dbQuery("delete from flight_results where origin = any($1) and destination = any($1)", [["TBZ", "SAW", "MAN"]])
  await dbQuery("delete from catalog_public_snapshots where slot_id in (select id from catalog_slots where route_id = any($1))", [Object.values(ids)])
  await dbQuery("update catalog_slots set last_fetched_at = null, status = 'NEVER', last_result_count = 0, recent_counts = '{}', consecutive_empty = 0, consecutive_errors = 0, last_error_at = null, demand_score = 0, version = 0, next_due_at = now() where route_id = any($1)", [Object.values(ids)])
  await dbQuery("delete from provider_usage_ledger where created_at >= $1", [c.since])
  await dbQuery("delete from provider_runs where created_at >= $1 and pool = 'catalog'", [c.since])
  await c.redis.del(LOCK_KEY)
  c.cfg.stateData = { pause: null, failedTicks: 0, lastTick: null, schemaAlert: null, cycle: null, currentRun: null, retry: null }
  c.cfg.settings = { ...c.cfg.settings, paused: false, costCorrection: 1 }
  c.credential.invalid = false
  c.jobs.length = 0
  c.events.length = 0
  c.suppliers.markCredentialInvalid.mockClear()
})
afterEach(() => apify.restore())

describe("a tick starts one capped, cost-controlled run under the lock", () => {
  it("sends the input the brief specifies, with the token only in the Authorization header", async () => {
    const out = await c.refresh.tick({})
    expect(out).toMatchObject({ started: true })
    expect(apify.state.posts).toHaveLength(1)
    const { url, body } = apify.state.posts[0]!
    expect(url).toMatch(/\/acts\/lergassy~google-flights-scraper\/runs\?build=0\.1\.167&maxTotalChargeUsd=0\.\d{4}$/)
    expect(body).toMatchObject({
      sortBy: "best", currency: "USD", market: "GB", adults: 1, cabinClass: "economy", includePriceInsights: true, includeSearchSummary: false, includeRunSummary: true,
      kayakWhenGoogleEmpty: false, fillMissingPricesFromKayak: false, resolveBookingOptions: false, resolveReturnFlights: false, exploreAnywhere: false, calendarDays: 0,
    })
    expect(body.maxResults).toBeGreaterThan(0)
    expect(body.routes.length).toBeGreaterThan(0)
    expect(body.routes.every((r: any) => !("returnDate" in r))).toBe(true)
    // One maxResults group per run: IKA-style routes with different limits never share a run.
    const pairs = new Set(body.routes.map((r: any) => `${r.origin}-${r.destination}`))
    expect(pairs.has("IKA-IST") && pairs.has("IST-LHR")).toBe(false)
    expect(JSON.stringify(apify.state.posts)).not.toContain("tok_test_secret")
    expect(JSON.stringify(c.jobs)).not.toContain("tok_test_secret")

    const [l] = await ledger()
    expect(l).toMatchObject({ purpose: "refresh", status: "RUNNING", apify_run_id: "run1", max_results: body.maxResults })
    expect(Number(l.max_charge_usd)).toBeGreaterThan(0.001)
    expect(l.slot_ids).toHaveLength(body.routes.length)
    expect((await runsTable())[0]).toMatchObject({ pool: "catalog", purpose: "CATALOG", status: "RUNNING", external_run_id: "run1" })
    expect(await lock()).toBeTruthy()
    expect(collectJob().opts).toMatchObject({ delay: 15_000 })
    expect(JSON.stringify(await runsTable())).not.toContain("tok_test_secret")
  })

  it("while the lock is held a second tick starts nothing", async () => {
    await c.refresh.tick({})
    expect(await c.refresh.tick({})).toEqual({ skipped: "LOCKED" })
    expect(apify.state.posts).toHaveLength(1)
    await c.redis.del(LOCK_KEY)
    await c.redis.set(LOCK_KEY, "someone-else", "PX", 60_000)
    apify.state.posts.length = 0
    expect(await c.refresh.tick({})).toEqual({ skipped: "LOCKED" })
    expect(apify.state.posts).toHaveLength(0)
  })

  it("a lock owned by another run is never released or renewed by this one", async () => {
    await c.redis.set(LOCK_KEY, "owner-1", "PX", 60_000)
    await c.refresh.releaseLock("not-the-owner")
    expect(await lock()).toBe("owner-1")
    await c.refresh.releaseLock("owner-1")
    expect(await lock()).toBeNull()
  })

  it("manual pause, an empty watchlist and a catch-up right after a tick start nothing", async () => {
    c.cfg.settings = { ...c.cfg.settings, paused: true }
    expect(await c.refresh.tick({})).toEqual({ skipped: "PAUSED" })
    c.cfg.settings = { ...c.cfg.settings, paused: false }
    await c.refresh.tick({})
    await c.redis.del(LOCK_KEY)
    apify.state.posts.length = 0
    expect(await c.refresh.tick({ catchup: true })).toEqual({ skipped: "RECENT_TICK" })
    expect(apify.state.posts).toHaveLength(0)
  })

  it("spends no more than available / ticks left: the charge cap never exceeds what refreshes may spend, and the plan fits the tick budget", async () => {
    apify.state.limits = { usage: 3.5, endInDays: 2 } // 4.05 − 3.5 = 0.55 left for 12 ticks
    await c.refresh.tick({})
    const [l] = await ledger()
    expect(Number(l.est_cost_usd)).toBeLessThanOrEqual(0.55 / 12 + 1e-9)
    expect(Number(l.max_charge_usd)).toBeLessThanOrEqual(0.55 + 1e-9)
  })
})

describe("collecting the dataset", () => {
  it("files rows under the slot of their echoed route and date, writes snapshots, closes the ledger and releases the lock", async () => {
    apify.state.dataset = (routes) => [
      ...everyRoute(2)(routes),
      row({ from: "TBZ", to: "SAW", date: inDays(40), number: "9999" }), // not requested: reported, never stored
      { type: "notice", message: "Fewer results than requested" },
    ]
    await c.refresh.tick({})
    const posted = apify.state.posts[0]!.body.routes as { origin: string; destination: string; departureDate: string }[]
    const out = await c.refresh.collect(collectJob().data as never)
    expect(out).toMatchObject({ partial: false, written: posted.length, skipped: 0 })
    const [l] = await ledger()
    expect(l).toMatchObject({ status: "SUCCEEDED", rows_billed: posted.length * 2 + 1 })
    expect(Number(l.est_cost_usd)).toBeCloseTo((posted.length * 2 + 1) * 0.001 + 0.001, 6)
    expect(await lock()).toBeNull()
    expect((await runsTable())[0]).toMatchObject({ status: "SUCCEEDED" })
    expect((await runsTable())[0].notices.some((n: string) => n.startsWith("UNREQUESTED_ROUTE"))).toBe(true)
    for (const r of posted) {
      const slot = (await slotId(r.origin === "TBZ" ? ids.a! : ids.b!, r.departureDate))!
      const snap = (await dbQuery<any>("select version, payload from catalog_public_snapshots where slot_id = $1", [slot]))[0]
      expect(snap, `${r.origin}-${r.destination} ${r.departureDate}`).toBeTruthy()
      expect(snap.payload).toHaveLength(2)
    }
    expect(c.cfg.stateData.failedTicks).toBe(0)
    expect(c.cfg.stateData.currentRun).toBeNull()
  })

  it("a requested route-date with no rows is stored as an empty slot (free, but it takes time) and backs off", async () => {
    apify.state.dataset = (routes) => everyRoute()(routes).slice(1)
    await c.refresh.tick({})
    const posted = apify.state.posts[0]!.body.routes as { origin: string; destination: string; departureDate: string }[]
    await c.refresh.collect(collectJob().data as never)
    const first = posted[0]!
    const slot = (await dbQuery<any>("select * from catalog_slots where id = $1", [(await slotId(first.origin === "TBZ" ? ids.a! : ids.b!, first.departureDate))!]))[0]
    expect(slot).toMatchObject({ status: "EMPTY", consecutive_empty: 1, last_result_count: 0 })
  })

  it("a partial dataset (the run stopped at its charge cap) is stored; slots with no rows stay due", async () => {
    apify.state.runStatus = "ABORTED"
    apify.state.dataset = (routes) => everyRoute()(routes).slice(0, 2)
    await c.refresh.tick({})
    const posted = apify.state.posts[0]!.body.routes as { origin: string; destination: string; departureDate: string }[]
    expect(posted.length).toBeGreaterThan(2)
    const out = await c.refresh.collect(collectJob().data as never)
    expect(out).toMatchObject({ partial: true, written: 2, skipped: posted.length - 2 })
    const [l] = await ledger()
    expect(l.status).toBe("PARTIAL")
    expect((await runsTable())[0].notices).toContain("PARTIAL_DATASET")
    const never = [...(await slotsOf(ids.a!)), ...(await slotsOf(ids.b!))].filter((s) => s.status === "NEVER")
    expect(never.length).toBeGreaterThanOrEqual(posted.length - 2)
    // The unfilled ones are picked by the next tick (nothing about them was recorded as empty).
    expect([...(await slotsOf(ids.a!)), ...(await slotsOf(ids.b!))].filter((s) => s.consecutive_empty > 0)).toEqual([])
  })

  it("an error row for a route marks that slot ERROR instead of empty", async () => {
    apify.state.dataset = (routes) => [...everyRoute()(routes.slice(1)), { type: "error", message: `Route ${routes[0]!.origin}-${routes[0]!.destination}: lookup failed` }]
    await c.refresh.tick({})
    await c.refresh.collect(collectJob().data as never)
    const errored = [...(await slotsOf(ids.a!)), ...(await slotsOf(ids.b!))].filter((s) => s.consecutive_errors > 0)
    expect(errored.length).toBeGreaterThanOrEqual(1)
    expect(errored[0]).toMatchObject({ last_error: expect.stringContaining("lookup failed") })
  })

  it("keeps polling every 15 s while the actor runs, and times out after 10 minutes", async () => {
    apify.state.runStatus = "RUNNING"
    await c.refresh.tick({})
    expect(await c.refresh.collect(collectJob().data as never)).toEqual({ polling: true })
    const next = collectJob()
    expect(next.data).toMatchObject({ attempt: 2 })
    expect(next.opts).toMatchObject({ delay: 15_000 })
    expect(await lock()).toBeTruthy()
    await dbQuery("update provider_usage_ledger set started_at = now() - interval '11 minutes' where created_at >= $1", [c.since])
    expect(await c.refresh.collect(next.data as never)).toEqual({ failed: "TRANSIENT" })
    expect((await ledger())[0]).toMatchObject({ status: "TIMED-OUT" })
    expect(await lock()).toBeNull()
  })

  it("the lock is renewed by each collect", async () => {
    apify.state.runStatus = "RUNNING"
    await c.refresh.tick({})
    await c.redis.pexpire(LOCK_KEY, 5_000)
    await c.refresh.collect(collectJob().data as never)
    expect(await c.redis.pttl(LOCK_KEY)).toBeGreaterThan(60_000)
  })

  it("end to end through the repo's Apify mock server (local HTTP stand-in for the Apify API)", async () => {
    apify.restore()
    const mock = await startApifyMock(0, "tok_test_secret")
    const real = globalThis.fetch
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((u, i) => (String(u).startsWith("https://api.apify.com/v2") ? (real as any)(String(u).replace("https://api.apify.com/v2", mock.url), i) : (real as any)(u, i)))
    try {
      c.cfg.stateData.cycle = null
      expect(await c.refresh.tick({})).toMatchObject({ started: true })
      const out = await c.refresh.collect(collectJob().data as never)
      expect(out).toMatchObject({ partial: false, skipped: 0 })
      expect(mock.calls.some((x) => x.method === "POST")).toBe(true)
      expect((await ledger())[0].status).toBe("SUCCEEDED")
      expect(LIMITS_RESPONSE.data.limits.maxMonthlyUsageUsd).toBe(5)
    } finally {
      spy.mockRestore()
      await mock.close()
    }
  })
})

describe("failure matrix (spec §9)", () => {
  it("401/403 at start: the credential is marked invalid, refreshes pause, developers are alerted, nothing is retried; replacing the credential resumes", async () => {
    apify.state.startError = { status: 401, body: { error: { type: "user-or-token-not-found" } } }
    const out = await c.refresh.tick({})
    expect(out).toMatchObject({ started: false, failure: "AUTH" })
    expect(c.suppliers.markCredentialInvalid).toHaveBeenCalledWith("apify-google-flights")
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "AUTH", until: null })
    expect(c.events).toContainEqual(expect.objectContaining({ eventType: "provider.health_changed", payload: expect.objectContaining({ circuit: "AUTH" }) }))
    expect(c.jobs.filter((j) => j.name === "catalog.refresh.tick")).toEqual([])
    expect(await lock()).toBeNull()
    expect((await ledger())[0]).toMatchObject({ status: "FAILED" })
    // Still invalid: no call at all.
    apify.state.posts.length = 0
    apify.state.calls.length = 0
    expect(await c.refresh.tick({})).toEqual({ skipped: "AUTH" })
    expect(apify.state.calls).toEqual([])
    // The credential is replaced in the Developer Panel: the next tick resumes by itself.
    c.credential.invalid = false
    apify.state.startError = null
    expect(await c.refresh.tick({})).toMatchObject({ started: true })
    expect(c.cfg.stateData.pause).toBeNull()
  })

  it("403 while collecting is handled the same way", async () => {
    await c.refresh.tick({})
    apify.state.statusError = 403
    expect(await c.refresh.collect(collectJob().data as never)).toEqual({ failed: "AUTH" })
    expect(c.cfg.stateData.pause?.reason).toBe("AUTH")
    expect(await lock()).toBeNull()
  })

  it("5xx at start: retried once after 10 minutes with the same slots, then left due; a second failure counts as one failed tick", async () => {
    apify.state.startError = { status: 503 }
    expect(await c.refresh.tick({})).toMatchObject({ started: false, failure: "TRANSIENT" })
    const retry = c.jobs.find((j) => j.name === "catalog.refresh.tick")!
    expect(retry.opts).toMatchObject({ delay: 600_000 })
    const data = retry.data as { retry: { ledgerId: string; slotIds: string[] } }
    expect(data.retry.slotIds.length).toBeGreaterThan(0)
    expect(c.cfg.stateData.failedTicks).toBe(0)
    expect(await lock()).toBeNull()
    // The retry takes the same slots and fails again: the tick is over, the slots stay due.
    c.jobs.length = 0
    expect(await c.refresh.tick(data)).toMatchObject({ started: false })
    expect(c.jobs.filter((j) => j.name === "catalog.refresh.tick")).toEqual([])
    expect(c.cfg.stateData.failedTicks).toBe(1)
    expect(c.cfg.stateData.retry).toBeNull()
    expect((await slotsOf(ids.a!)).every((s) => s.last_fetched_at === null)).toBe(true)
    // …and a good tick afterwards picks them up and resets the count.
    apify.state.startError = null
    await c.refresh.tick({})
    await c.refresh.collect(collectJob().data as never)
    expect(c.cfg.stateData.failedTicks).toBe(0)
  })

  it("a FAILED run: the start fee is booked, the slots stay due, the same slots are retried once", async () => {
    apify.state.runStatus = "FAILED"
    await c.refresh.tick({})
    const planned = (await ledger())[0].slot_ids as string[]
    expect(await c.refresh.collect(collectJob().data as never)).toEqual({ failed: "TRANSIENT" })
    expect((await ledger())[0]).toMatchObject({ status: "FAILED" })
    expect(Number((await ledger())[0].est_cost_usd)).toBeCloseTo(0.001, 6)
    expect(await lock()).toBeNull()
    const retry = c.jobs.find((j) => j.name === "catalog.refresh.tick")!
    expect((retry.data as any).retry.slotIds).toEqual(planned)
    expect(retry.opts).toMatchObject({ delay: 600_000 })
  })

  it("a circuit opens after 3 failed ticks in a row: paused 2 h, developers alerted, resumes by itself", async () => {
    apify.state.startError = { status: 500 }
    for (let i = 0; i < 3; i++) {
      // A retry tick that fails is a failed tick.
      await c.refresh.tick({ retry: { ledgerId: `00000000-0000-4000-8000-00000000000${i}`, slotIds: [] } })
    }
    // retry with no slot ids selects by the empty list; use the real path instead.
    c.cfg.stateData.failedTicks = 0
    for (let i = 0; i < 3; i++) {
      await c.refresh.tick({})
      const retry = c.jobs.filter((j) => j.name === "catalog.refresh.tick").at(-1)
      await c.refresh.tick(retry?.data as never)
    }
    expect(c.cfg.stateData.failedTicks).toBe(3)
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "CIRCUIT" })
    const until = Date.parse(c.cfg.stateData.pause!.until!)
    expect(until - Date.now()).toBeGreaterThan(1.9 * 3_600_000)
    expect(until - Date.now()).toBeLessThanOrEqual(2 * 3_600_000)
    expect(c.events.filter((e) => e.payload.circuit === "CIRCUIT")).toHaveLength(1)
    expect(await c.refresh.tick({})).toEqual({ skipped: "CIRCUIT" })
    // Two hours later the pause is over and the tick runs.
    c.cfg.stateData.pause = { ...c.cfg.stateData.pause!, until: new Date(Date.now() - 1000).toISOString() }
    apify.state.startError = null
    expect(await c.refresh.tick({})).toMatchObject({ started: true })
    expect(c.cfg.stateData.pause).toBeNull()
    expect(c.cfg.stateData.failedTicks).toBe(0)
  })

  it("budget exhausted: no run, paused until the billing cycle ends, resumes by itself once that time has passed", async () => {
    apify.state.limits = { usage: 4.9, endInDays: 3 }
    const out = await c.refresh.tick({})
    expect(out).toEqual({ skipped: "BUDGET" })
    expect(apify.state.posts).toEqual([])
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "BUDGET" })
    const until = Date.parse(c.cfg.stateData.pause!.until!)
    expect(Math.abs(until - (Date.now() + 3 * 86_400_000))).toBeLessThan(60_000)
    expect(c.events.some((e) => e.payload.circuit === "BUDGET")).toBe(true)
    expect(await c.refresh.tick({})).toEqual({ skipped: "BUDGET" })
    // The new cycle begins: Apify reports fresh usage; the pause lapses on its own.
    c.cfg.stateData.pause = { ...c.cfg.stateData.pause!, until: new Date(Date.now() - 1000).toISOString() }
    c.cfg.stateData.cycle = null
    apify.state.limits = { usage: 0.1, endInDays: 30 }
    expect(await c.refresh.tick({})).toMatchObject({ started: true })
  })

  it("402 usage-limit answer from Apify at start pauses until the cycle ends", async () => {
    apify.state.startError = { status: 402, body: { error: { type: "monthly-usage-limit-exceeded", message: "usage limit" } } }
    expect(await c.refresh.tick({})).toMatchObject({ started: false, failure: "BUDGET" })
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "BUDGET" })
    expect(c.jobs.filter((j) => j.name === "catalog.refresh.tick")).toEqual([])
  })

  it("when /users/me/limits is unavailable the ledger × cost correction is used: spend is never assumed to be zero", async () => {
    apify.state.limitsError = 500
    // The dev database is shared: real cost rows may already be in this cycle, so measure from a baseline.
    const base = (await c.budget.spend(c.cfg.settings, { force: true })).ledgerUsd
    await dbQuery("insert into provider_usage_ledger (id, provider, purpose, max_results, est_cost_usd, actual_cost_usd, status, started_at) values (gen_random_uuid(), 'apify-google-flights', 'refresh', 3, 2.0, 2.0, 'SUCCEEDED', now() - interval '1 day')")
    c.cfg.settings = { ...c.cfg.settings, costCorrection: 2 }
    const s = await c.budget.spend(c.cfg.settings, { force: true })
    expect(s.spentSource).toBe("ledger")
    expect(s.ledgerUsd).toBeCloseTo(base + 2, 6)
    expect(s.spentUsd).toBeCloseTo((base + 2) * 2, 6)
    // 4.05 − 4.00 leaves 0.05, then the budget runs out: the tick plans nothing larger than that.
    const out = await c.refresh.tick({})
    expect(["BUDGET", "NOTHING_DUE"].includes((out as any).skipped) || (out as any).started === true).toBe(true)
    if ((out as any).started) expect(Number((await ledger()).at(-1).max_charge_usd)).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  it("Apify's reading is topped up with runs the ledger knows about but Apify has not billed yet", async () => {
    apify.state.limits = { usage: 1 }
    await c.budget.spend(c.cfg.settings, { force: true })
    await dbQuery("insert into provider_usage_ledger (id, provider, purpose, max_results, est_cost_usd, status, started_at) values (gen_random_uuid(), 'apify-google-flights', 'refresh', 3, 0.5, 'SUCCEEDED', now() + interval '1 second')")
    const s = await c.budget.spend(c.cfg.settings)
    expect(s.spentSource).toBe("apify")
    expect(s.spentUsd).toBeCloseTo(1.5, 6)
  })
})

describe("admin runs draw on the reserve and take the same lock", () => {
  async function seedResult() {
    const slot = (await slotId(ids.a!, D))!
    await c.write.writeSlot({ slotId: slot, offers: [offer({ from: "TBZ", to: "SAW", date: D, dep: "08:40", arr: "10:55", number: "1000", minor: 23_100 })], fetchedAt: new Date(Date.now() - 3_600_000), notices: [] })
    const [r] = await dbQuery<{ id: string }>("select id from flight_results where slot_id = $1", [slot])
    return { slot, resultId: r!.id }
  }

  it("quote → confirm: a one-use token, a ledger row on the reserve, the slot's own limit; a second confirm and a busy lock are refused", async () => {
    const { slot } = await seedResult()
    const q = await c.refresh.quoteSlotRefresh(slot, "u1")
    expect(q).toMatchObject({ slotId: slot, estimatedUsd: 0.004 })
    expect(q.reserveLeftUsd).toBeGreaterThan(0.7)
    await expect(c.refresh.confirmSlotRefresh(slot, q.confirmToken, "someone-else")).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    const start = await c.refresh.confirmSlotRefresh(slot, q.confirmToken, "u1")
    expect(start.status).toBe("PENDING")
    expect(apify.state.posts).toHaveLength(1)
    expect(apify.state.posts[0]!.body).toMatchObject({ maxResults: 3, routes: [{ origin: "TBZ", destination: "SAW", departureDate: D }] })
    expect((await ledger())[0]).toMatchObject({ purpose: "admin_revalidate", status: "RUNNING" })
    await expect(c.refresh.confirmSlotRefresh(slot, q.confirmToken, "u1")).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    const q2 = await c.refresh.quoteSlotRefresh(slot, "u1")
    await expect(c.refresh.confirmSlotRefresh(slot, q2.confirmToken, "u1")).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
    expect(apify.state.posts).toHaveLength(1)
    // Collected: the slot is refreshed like any other and the lock is released.
    await c.refresh.collect(collectJob().data as never)
    expect(await lock()).toBeNull()
    expect((await dbQuery<any>("select version from catalog_slots where id = $1", [slot]))[0].version).toBe(2)
  })

  it("is refused when the reserve cannot cover it, and never starts a run", async () => {
    const { slot } = await seedResult()
    await dbQuery("insert into provider_usage_ledger (id, provider, purpose, max_results, est_cost_usd, status, started_at) values (gen_random_uuid(), 'apify-google-flights', 'admin_search', 3, 0.75, 'SUCCEEDED', now())")
    await expect(c.refresh.quoteSlotRefresh(slot, "u1")).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(apify.state.posts).toEqual([])
  })

  it("a combined slot is not refreshed directly: its legs are", async () => {
    const comb = (await slotId(ids.combined!, D))!
    await expect(c.refresh.quoteSlotRefresh(comb, "u1")).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
  })

  it("revalidating a result: one run for its route-date with revalidateMaxResults, matched by identity key, price change reported, written back to the slot", async () => {
    const { slot, resultId } = await seedResult()
    apify.state.dataset = () => [row({ from: "TBZ", to: "SAW", date: D, number: "1000", price: 260 })]
    const start = await c.refresh.revalidateResult(resultId)
    expect(apify.state.posts[0]!.body.maxResults).toBe(30)
    expect(await c.refresh.revalidateStatus(start.jobId)).toEqual({ jobId: start.jobId, status: "PENDING" })
    await c.refresh.collect(collectJob().data as never)
    const done = await c.refresh.revalidateStatus(start.jobId)
    expect(done.status).toBe("DONE")
    expect(done.result).toMatchObject({ stillListed: true, priceChanged: true, old: { amountMinor: 23_100, currency: "USD" }, new: { amountMinor: 26_000, currency: "USD" } })
    expect((await dbQuery<any>("select previous_amount_minor from flight_result_pricing where result_id = $1", [resultId]))[0].previous_amount_minor).toBe("23100")
    expect((await dbQuery<any>("select version from catalog_slots where id = $1", [slot]))[0].version).toBe(2)
  })

  it("a revalidated flight that has vanished is reported as no longer listed", async () => {
    const { resultId } = await seedResult()
    apify.state.dataset = () => [row({ from: "TBZ", to: "SAW", date: D, number: "2222" })]
    const start = await c.refresh.revalidateResult(resultId)
    await c.refresh.collect(collectJob().data as never)
    expect((await c.refresh.revalidateStatus(start.jobId)).result).toMatchObject({ stillListed: false, priceChanged: false, new: null })
  })

  it("a self-transfer result is revalidated through both of its legs in one run", async () => {
    const a = (await slotId(ids.a!, D))!
    const b = (await slotId(ids.b!, D))!
    await c.write.writeSlot({ slotId: a, offers: [offer({ from: "TBZ", to: "SAW", date: D, dep: "08:00", arr: "11:30", number: "1" })], fetchedAt: new Date(), notices: [] })
    await c.write.writeSlot({ slotId: b, offers: [offer({ from: "SAW", to: "MAN", date: D, dep: "16:30", arr: "18:45", number: "2" })], fetchedAt: new Date(), notices: [] })
    const comb = (await slotId(ids.combined!, D))!
    const [res] = await dbQuery<{ id: string }>("select id from flight_results where slot_id = $1 and is_current", [comb])
    await c.refresh.revalidateResult(res!.id)
    expect(apify.state.posts[0]!.body.routes).toHaveLength(2)
    expect(Number((await ledger())[0].max_charge_usd)).toBeCloseTo(0.001 + 2 * 30 * 0.001, 3)
  })
})

describe("daily and hourly jobs", () => {
  it("slots.roll creates today..today+horizon for each enabled route once, and deletes past slots (their results stay as history)", async () => {
    const first = await slotsOf(ids.a!)
    expect(first).toHaveLength(15)
    await dbQuery("insert into catalog_slots (id, route_id, departure_date, next_due_at) values (gen_random_uuid(), $1, current_date - 1, now())", [ids.a])
    const old = (await slotId(ids.a!, inDays(-1)))!
    await dbQuery("insert into flight_results (id, slot_id, origin, destination, departure_date, identity_key, detail) values (gen_random_uuid(), $1, 'TBZ', 'SAW', current_date - 1, 'old', '{}')", [old])
    expect(await c.refresh.rollSlots(new Date(), Object.values(ids))).toEqual({ created: 0, deleted: 1 })
    expect(await slotsOf(ids.a!)).toHaveLength(15)
    expect((await dbQuery<any>("select slot_id from flight_results where identity_key = 'old'"))[0].slot_id).toBeNull()
  })

  it("demand.fold decays every slot by one hour, adds the counters, resolves city codes, and credits a combined route's feeders; untracked pairs go to the board", async () => {
    const a = (await slotId(ids.a!, D))!
    const b = (await slotId(ids.b!, D))!
    await dbQuery("update catalog_slots set demand_score = 10 where id = $1", [a])
    await c.redis.set(`demand:TBZ:SAW:${D}`, "5")
    await c.redis.set(`demand:TBZ:MAN:${D}`, "4") // the combined route: its feeders are what the pacer refreshes
    await c.redis.set(`demand:ZZY:ZZX:${D}`, "3")
    await c.redis.del("demand:untracked")
    const out = await c.refresh.foldDemand()
    // Other counters may sit in the shared Redis; ours are at least these three.
    expect(out.keys).toBeGreaterThanOrEqual(3)
    expect(out.untracked).toBeGreaterThanOrEqual(1)
    const half = 0.5 ** (1 / (7 * 24))
    const score = async (id: string) => Number((await dbQuery<any>("select demand_score from catalog_slots where id = $1", [id]))[0].demand_score)
    expect(await score(a)).toBeCloseTo(10 * half + 5 + 4, 3)
    expect(await score(b)).toBeCloseTo(4, 3)
    expect(await c.redis.zscore("demand:untracked", "ZZY-ZZX")).toBeTruthy()
    expect(await c.redis.get(`demand:TBZ:SAW:${D}`)).toBeNull()
    await c.redis.del("demand:untracked")
  })

  it("a submitted request adds +5 demand for its route and first date; the fold then credits the right routes", async () => {
    await c.redis.del(`demand:TBZ:MAN:${D}`)
    expect(await c.refresh.countRequest({ payload: { route: { from: "TBZ", to: "MAN", date: D } } })).toEqual({ bumped: true })
    expect(await c.refresh.countRequest({ payload: {} })).toEqual({ bumped: false })
    expect(Number(await c.redis.get(`demand:TBZ:MAN:${D}`))).toBe(5)
    await c.refresh.foldDemand()
    expect(Number((await dbQuery<any>("select demand_score from catalog_slots where id = $1", [(await slotId(ids.a!, D))!]))[0].demand_score)).toBeCloseTo(5, 3)
  })

  it("reconcile raises the estimate factor when Apify reports more than 10% over the ledger, and leaves it alone otherwise", async () => {
    await dbQuery("insert into provider_usage_ledger (id, provider, purpose, max_results, est_cost_usd, status, started_at) values (gen_random_uuid(), 'apify-google-flights', 'refresh', 3, 1.0, 'SUCCEEDED', now())")
    apify.state.limits = { usage: 1.05 }
    const quiet = await c.refresh.reconcile() as { ledgerUsd: number; costCorrection: number }
    expect(quiet.costCorrection).toBe(1)
    c.cfg.stateData.cycle = null
    apify.state.limits = { usage: 1.5 }
    const raised = await c.refresh.reconcile() as { ledgerUsd: number; costCorrection: number }
    expect(raised.costCorrection).toBeCloseTo(1.5 / raised.ledgerUsd, 5)
    expect(c.cfg.settings.costCorrection).toBe(raised.costCorrection)
  })

  it("schema.check alerts when the default build moved or a cost field is missing, and stays quiet otherwise", async () => {
    expect(await c.refresh.schemaCheck()).toMatchObject({ problems: [] })
    expect(c.cfg.stateData.schemaAlert).toBeNull()
    apify.state.build = { ...apify.state.build, buildNumber: "0.1.168" }
    await c.refresh.schemaCheck()
    expect(c.cfg.stateData.schemaAlert).toMatch(/0\.1\.168.*pinned 0\.1\.167/)
    expect(c.events.filter((e) => e.payload.circuit === "SCHEMA")).toHaveLength(1)
    apify.state.build = { buildNumber: "0.1.167", fields: ["kayakWhenGoogleEmpty", "fillMissingPricesFromKayak", "resolveReturnFlights"] }
    await c.refresh.schemaCheck()
    expect(c.cfg.stateData.schemaAlert).toMatch(/resolveBookingOptions/)
    apify.state.build = { buildNumber: "0.1.167", fields: ["kayakWhenGoogleEmpty", "fillMissingPricesFromKayak", "resolveBookingOptions", "resolveReturnFlights"] }
    await c.refresh.schemaCheck()
    expect(c.cfg.stateData.schemaAlert).toBeNull()
  })

  it("slot_updated asks the website to purge `catalog` and `slot:<id>` with the shared secret; a failure is never fatal; unset means skipped", async () => {
    apify.restore()
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))
    try {
      expect(await c.refresh.purgeWeb("slot-1", {})).toEqual({ purged: false })
      expect(spy).not.toHaveBeenCalled()
      const target = { WEB_REVALIDATE_URL: "http://localhost:4000/api/revalidate", WEB_REVALIDATE_SECRET: "s".repeat(24) }
      expect(await c.refresh.purgeWeb("slot-1", target)).toEqual({ purged: true })
      const [url, init] = spy.mock.calls[0]!
      expect(String(url)).toBe(target.WEB_REVALIDATE_URL)
      expect((init!.headers as Record<string, string>)["x-revalidate-secret"]).toBe(target.WEB_REVALIDATE_SECRET)
      expect(JSON.parse(init!.body as string)).toEqual({ tags: ["catalog", "slot:slot-1"] })
      spy.mockRejectedValueOnce(new Error("down"))
      expect(await c.refresh.purgeWeb("slot-1", target)).toEqual({ purged: false })
      spy.mockResolvedValueOnce(new Response("no", { status: 401 }))
      expect(await c.refresh.purgeWeb("slot-1", target)).toEqual({ purged: false })
    } finally {
      spy.mockRestore()
    }
  })
})
