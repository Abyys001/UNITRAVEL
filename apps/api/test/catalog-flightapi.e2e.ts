import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { cleanupTestData, type Catalog, inDays, makeCatalog, offer, seedTestRoutes, slotId } from "./catalog-harness"
import { dbQuery } from "./client"
import { LOCK_KEY } from "../src/modules/catalog/catalog-refresh.service"

/**
 * ADR-0035: the pacer on FlightAPI, against the real database and Redis with `fetch` replaced by a double. The key is a throwaway;
 * nothing here can reach api.flightapi.io, and no test may find the key in a ledger row, the runtime state, a queued job or an event.
 */
const KEY = "fapi_test_key_0123456789"
const OTHER_KEY = "fapi_test_key_rotated_99"
let c: Catalog
let ids: Record<string, string>
let key = KEY
const D = inDays(2)

interface Fake { urls: string[]; inflight: number; maxInflight: number; status: number; itineraries: number[]; spy: ReturnType<typeof vi.spyOn> }
let fake: Fake

/** A Skyscanner-shaped body with one direct itinerary per price. */
function body(from: string, to: string, date: string, prices: number[]) {
  return {
    itineraries: prices.map((p, i) => ({ id: `it${i}`, leg_ids: [`leg${i}`], pricing_options: [{ price: { amount: p + 5 } }, { price: { amount: p } }] })),
    legs: prices.map((_, i) => ({ id: `leg${i}`, origin_place_id: 1, destination_place_id: 2, departure: `${date}T0${i + 1}:40:00`, arrival: `${date}T0${i + 3}:55:00`, segment_ids: [`seg${i}`], duration: 135, stop_count: 0, self_transfer: false })),
    segments: prices.map((_, i) => ({ id: `seg${i}`, origin_place_id: 1, destination_place_id: 2, departure: `${date}T0${i + 1}:40:00`, arrival: `${date}T0${i + 3}:55:00`, duration: 135, marketing_flight_number: String(1000 + i), marketing_carrier_id: -1, operating_carrier_id: -1 })),
    places: [{ id: 1, display_code: from, type: "Airport", name: from }, { id: 2, display_code: to, type: "Airport", name: to }],
    carriers: [{ id: -1, display_code: "TK", name: "Test Air" }],
  }
}

function fakeFlightapi(): Fake {
  const f: Fake = { urls: [], inflight: 0, maxInflight: 0, status: 200, itineraries: [300, 120, 250, 90, 400], spy: undefined as never }
  f.spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    f.urls.push(url)
    f.inflight++
    f.maxInflight = Math.max(f.maxInflight, f.inflight)
    await new Promise((r) => setTimeout(r, 15))
    f.inflight--
    const m = /\/onewaytrip\/([^/]+)\/([A-Z]{3})\/([A-Z]{3})\/(\d{4}-\d{2}-\d{2})\//.exec(url)
    if (!m) throw new Error(`fake FlightAPI: unexpected ${url}`)
    if (f.status !== 200) return new Response("{}", { status: f.status })
    if (m[1] !== key) return new Response("{}", { status: 401 })
    return new Response(JSON.stringify(body(m[2]!, m[3]!, m[4]!, f.itineraries)), { status: 200, headers: { "content-type": "application/json" } })
  }) as never
  return f
}

const ledger = () => dbQuery<any>("select * from provider_usage_ledger where created_at >= $1 and provider = 'flightapi' order by created_at", [c.since])
const lock = () => c.redis.get(LOCK_KEY)
const nothingLeaked = async () => {
  const dump = JSON.stringify([await ledger(), c.cfg.stateData, c.jobs, c.events])
  expect(dump).not.toContain(KEY)
  expect(dump).not.toContain(OTHER_KEY)
}

beforeAll(async () => {
  c = await makeCatalog()
  ids = await seedTestRoutes(c)
  vi.spyOn(c.refresh as never, "flightapiKey").mockImplementation((() => key) as never)
})
afterAll(async () => {
  await cleanupTestData(c.since)
  await c.close()
})
beforeEach(async () => {
  key = KEY
  fake = fakeFlightapi()
  await dbQuery("delete from flight_results where origin = any($1) and destination = any($1)", [["TBZ", "SAW", "MAN"]])
  await dbQuery("delete from catalog_public_snapshots where slot_id in (select id from catalog_slots where route_id = any($1))", [Object.values(ids)])
  await dbQuery("update catalog_slots set last_fetched_at = null, status = 'NEVER', last_result_count = 0, recent_counts = '{}', consecutive_empty = 0, consecutive_errors = 0, last_error_at = null, demand_score = 0, version = 0, next_due_at = now() where route_id = any($1)", [Object.values(ids)])
  await dbQuery("delete from provider_usage_ledger where created_at >= $1 and provider = 'flightapi'", [c.since])
  await c.redis.del(LOCK_KEY)
  c.cfg.stateData = { pause: null, failedTicks: 0, lastTick: null, schemaAlert: null, cycle: null, currentRun: null, retry: null }
  c.cfg.settings = { ...c.cfg.settings, paused: false, source: "flightapi", flightapiMonthlyCredits: 100_000, flightapiReserveCredits: 1_000, maxSlotsPerRun: 4 }
  c.jobs.length = 0
  c.events.length = 0
})
afterEach(() => fake.spy.mockRestore())

describe("a flightapi tick", () => {
  it("calls FlightAPI one slot at a time (two at once), files each answer through writeSlot, and ledgers the credits", async () => {
    const out = await c.refresh.tick({})
    expect(out).toMatchObject({ slots: 4, ok: 4, failed: 0, credits: 8 })
    expect(fake.urls).toHaveLength(4)
    expect(fake.urls.every((u) => u.startsWith("https://api.flightapi.io/onewaytrip/") && u.endsWith("/1/0/0/Economy/USD"))).toBe(true)
    expect(fake.maxInflight).toBe(2)
    const [l] = await ledger()
    expect(await ledger()).toHaveLength(1)
    expect(l).toMatchObject({ provider: "flightapi", purpose: "refresh", status: "SUCCEEDED", credits: 8 })
    expect(l.slot_ids).toHaveLength(4)
    const slots = await dbQuery<any>("select id, version, last_result_count from catalog_slots where id = any($1) and version > 0", [l.slot_ids])
    expect(slots).toHaveLength(4)
    // maxResults is the route's (3 for TBZ-SAW, 5 for SAW-MAN); the cheapest come first.
    const a = (await dbQuery<any>("select p.amount_minor from flight_results r join flight_result_pricing p on p.result_id = r.id join catalog_slots s on s.id = r.slot_id where s.route_id = $1 order by p.amount_minor", [ids.a]))
    expect(a.length).toBeGreaterThan(0)
    expect(a.length % 3).toBe(0)
    expect(Number(a[0].amount_minor)).toBe(9000)
    expect(c.cfg.stateData.lastTick).toMatchObject({ outcome: "RUN_DONE", slots: 4 })
    expect(await lock()).toBeNull()
    expect(c.events.some((e) => e.eventType === "catalog.slot_updated")).toBe(true)
    await nothingLeaked()
  })

  it("takes the lock: a second tick while it is held calls nothing", async () => {
    await c.redis.set(LOCK_KEY, "someone-else", "PX", 60_000)
    expect(await c.refresh.tick({})).toMatchObject({ skipped: "LOCKED" })
    expect(fake.urls).toEqual([])
    expect(await lock()).toBe("someone-else")
  })

  it("never draws more than its pro-rata share, and stops when the month's credits are used", async () => {
    const { budget } = await c.budget.credits(c.cfg.settings)
    c.cfg.settings = { ...c.cfg.settings, maxSlotsPerRun: 200, flightapiMonthlyCredits: 1_000, flightapiReserveCredits: 0 }
    const share = (await c.budget.credits(c.cfg.settings)).budget.slotsAllowed
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThanOrEqual(Math.floor(budget.availableCredits / 2))
    expect(await c.refresh.tick({})).toMatchObject({ slots: Math.min(share, 30) })
    // Everything used: the next tick pauses until the month turns over and calls nothing.
    c.cfg.settings = { ...c.cfg.settings, flightapiMonthlyCredits: (await c.budget.credits(c.cfg.settings)).used }
    fake.urls.length = 0
    await c.redis.del(LOCK_KEY)
    expect(await c.refresh.tick({})).toEqual({ skipped: "BUDGET" })
    expect(fake.urls).toEqual([])
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "BUDGET" })
    expect(Date.parse(c.cfg.stateData.pause!.until!)).toBeGreaterThan(Date.now())
  })
})

describe("failures", () => {
  it("401 pauses with AUTH, books no credits, and resumes only when the key changes", async () => {
    fake.status = 401
    const out = await c.refresh.tick({})
    expect(out).toMatchObject({ ok: 0 })
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "AUTH" })
    expect(c.cfg.stateData.pause!.key).toMatch(/^[0-9a-f]{16}$/)
    expect((await ledger())[0]).toMatchObject({ status: "FAILED", credits: 0 })
    expect(c.events.some((e) => e.eventType === "provider.health_changed")).toBe(true)
    await nothingLeaked()
    fake.urls.length = 0
    expect(await c.refresh.tick({})).toEqual({ skipped: "AUTH" })
    expect(fake.urls).toEqual([])
    key = OTHER_KEY
    fake.status = 200
    expect(await c.refresh.tick({})).toMatchObject({ ok: 4 })
    expect(c.cfg.stateData.pause).toBeNull()
  })

  it("402 pauses with BUDGET until the month turns over", async () => {
    fake.status = 402
    await c.refresh.tick({})
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "BUDGET" })
    expect((await ledger())[0]).toMatchObject({ status: "FAILED", credits: 0 })
  })

  it("a 429 or a 5xx leaves the slots due and counts a failed tick; three in a row open the circuit", async () => {
    fake.status = 429
    for (let i = 1; i <= 3; i++) {
      await c.redis.del(LOCK_KEY)
      await c.refresh.tick({})
      expect(c.cfg.stateData.failedTicks).toBe(i)
    }
    expect(c.cfg.stateData.pause).toMatchObject({ reason: "CIRCUIT" })
    expect((await dbQuery<any>("select count(*)::int as n from catalog_slots where route_id = any($1) and last_fetched_at is not null", [Object.values(ids)]))[0].n).toBe(0)
  })

  it("a refused request (400) marks the slot as an error instead of asking again every tick", async () => {
    fake.status = 400
    await c.refresh.tick({})
    expect((await dbQuery<any>("select count(*)::int as n from catalog_slots where route_id = any($1) and consecutive_errors = 1", [Object.values(ids)]))[0].n).toBe(4)
    expect(c.cfg.stateData.pause).toBeNull()
  })

  it("an empty answer is an empty slot (the empty streak and backoff apply), not an error", async () => {
    fake.itineraries = []
    await c.refresh.tick({})
    const rows = await dbQuery<any>("select consecutive_empty, consecutive_errors, status from catalog_slots where route_id = any($1) and last_fetched_at is not null", [[ids.a, ids.b]])
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.consecutive_empty === 1 && r.consecutive_errors === 0 && r.status === "EMPTY")).toBe(true)
  })
})

describe("staff refresh now and revalidate draw on the reserve credits", () => {
  const waitDone = async (jobId: string) => {
    for (let i = 0; i < 100; i++) {
      const st = await c.refresh.revalidateStatus(jobId)
      if (st.status !== "PENDING") return st
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error("the staff run did not finish")
  }

  it("quote → confirm: two credits from the reserve, the slot refreshed, the lock released", async () => {
    c.cfg.settings = { ...c.cfg.settings, flightapiReserveCredits: 10 }
    const slot = (await slotId(ids.a!, D))!
    const q = await c.refresh.quoteSlotRefresh(slot, "u1")
    expect(q).toMatchObject({ slotId: slot, estimatedCredits: 2, reserveLeftCredits: 10, estimatedUsd: 0 })
    const start = await c.refresh.confirmSlotRefresh(slot, q.confirmToken, "u1")
    expect(start.status).toBe("PENDING")
    expect(await waitDone(start.jobId)).toMatchObject({ status: "DONE" })
    expect(fake.urls).toHaveLength(1)
    expect((await ledger())[0]).toMatchObject({ purpose: "admin_revalidate", status: "SUCCEEDED", credits: 2 })
    expect((await dbQuery<any>("select version from catalog_slots where id = $1", [slot]))[0].version).toBe(1)
    for (let i = 0; i < 40 && (await lock()); i++) await new Promise((r) => setTimeout(r, 25))
    expect(await lock()).toBeNull()
    expect((await c.budget.credits(c.cfg.settings)).adminUsed).toBe(2)
    await nothingLeaked()
  })

  it("is refused when the reserve is spent, and calls nothing", async () => {
    c.cfg.settings = { ...c.cfg.settings, flightapiReserveCredits: 0 }
    const slot = (await slotId(ids.a!, D))!
    await expect(c.refresh.quoteSlotRefresh(slot, "u1")).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(fake.urls).toEqual([])
  })

  it("revalidating a result reports whether it is still listed and its new price", async () => {
    c.cfg.settings = { ...c.cfg.settings, flightapiReserveCredits: 10, revalidateMaxResults: 5 }
    const slot = (await slotId(ids.a!, D))!
    await c.write.writeSlot({ slotId: slot, offers: [offer({ from: "TBZ", to: "SAW", date: D, dep: "01:40", arr: "03:55", carrier: "TK", number: "1000", minor: 23_100 })], fetchedAt: new Date(Date.now() - 3_600_000), notices: [] })
    const [r] = await dbQuery<{ id: string }>("select id from flight_results where slot_id = $1", [slot])
    const start = await c.refresh.revalidateResult(r!.id)
    const done = await waitDone(start.jobId)
    expect(done).toMatchObject({ status: "DONE", result: { stillListed: true, priceChanged: true, old: { amountMinor: 23_100 } } })
    expect((done as any).result.new.amountMinor).toBe(30_000)
  })
})

describe("the Apify path is untouched when source=apify", () => {
  it("a tick with source=apify never calls FlightAPI", async () => {
    c.cfg.settings = { ...c.cfg.settings, source: "apify" }
    await c.refresh.tick({}).catch(() => undefined)
    expect(fake.urls.filter((u) => u.includes("flightapi"))).toEqual([])
  })
})
