import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProviderMetering } from "@unitravel/contracts"

import { LIMITS_RESPONSE, MIXED_DATASET, RUNNING_RESPONSE, START_RESPONSE, SUCCEEDED_RESPONSE, TOKEN_INVALID } from "../../../../test/fixtures/apify/google-flights"
import { FakeRedis, reference } from "../../../../test/fixtures/apify/helpers"
import type { CallContext, SliceQuery } from "../adapter"
import { FlightDataService } from "./flight-data.service"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const q: SliceQuery = { slices: [{ origin: "IST", destination: "LHR", date: "2026-12-10" }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", maxConnections: 1 }
const ctxFor = (searchId?: string) => ({ searchId } as CallContext)

function harness(metering: Partial<ProviderMetering> = {}, opts: { invalid?: boolean; token?: string | null } = {}) {
  const redis = new FakeRedis()
  const jobs: { queue: string; name: string; data: Record<string, unknown>; opts: Record<string, unknown> }[] = []
  const queues = { get: (queue: string) => ({ add: async (name: string, data: Record<string, unknown>, o: Record<string, unknown>) => void jobs.push({ queue, name, data, opts: o }), upsertJobScheduler: async () => undefined }) }
  const runs: Record<string, unknown>[] = []
  // `where(eq(id, ...))` is opaque here, so updates and reads act on the most recent run: every test uses one run at a time.
  const db = {
    insert: () => ({ values: (v: Record<string, unknown>) => {
      const row = { id: `00000000-0000-7000-8000-00000000000${runs.length + 1}`, externalRunId: null, rows: 0, estimatedUsd: "0", reservedUsd: "0", notices: [], errors: [], result: null, startedAt: null, finishedAt: null, createdAt: new Date(), status: "QUEUED", ...v }
      runs.push(row)
      return Object.assign(Promise.resolve([row]), { returning: async () => [row] })
    } }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void Object.assign(runs.at(-1)!, v) }) }),
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve(runs.slice(-1)), { orderBy: () => ({ limit: async () => [...runs].reverse() }) }) }) }),
  }
  const row = { id: "apify-google-flights", metering: { ...ProviderMetering.parse({}), ...metering } }
  const suppliers = {
    registerAdapter: vi.fn(), row: async () => row, credentials: async () => (opts.token === null ? null : { token: "tok_secret" }),
    credentialInvalid: async () => !!opts.invalid, markCredentialInvalid: vi.fn(), markTested: vi.fn(), credentialMeta: async () => ({ rotatedAt: new Date(), rotatedBy: null, invalidAt: null }),
  }
  const svc = new FlightDataService(db as never, redis as never, queues as never, { registerJob: vi.fn() } as never, suppliers as never, { lookup: () => reference } as never, { putCallPayload: async () => undefined } as never)
  return { svc, redis, jobs, runs, suppliers }
}

/** Routes the three Apify endpoints the service uses. */
function mockApify(dataset: unknown[] = MIXED_DATASET, status = SUCCEEDED_RESPONSE) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url)
    if (init?.method === "POST" && u.includes("/runs")) return json(START_RESPONSE, 201)
    if (u.includes("/actor-runs/")) return json(status)
    if (u.includes("/items")) return json(dataset)
    throw new Error(`unexpected ${u}`)
  })
}
const posts = (spy: ReturnType<typeof mockApify>) => spy.mock.calls.filter(([, i]) => i?.method === "POST")
const searchRuns = (jobs: ReturnType<typeof harness>["jobs"]) => jobs.filter((j) => j.queue === "search.execute")

describe("FlightDataService (ADR-0029 A6)", () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => vi.restoreAllMocks())

  it("answers SUPPLIER_PENDING on a miss and queues exactly one start job per search", async () => {
    const { svc, jobs, redis } = harness()
    await expect(svc.lookup(q, ctxFor("s1"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await expect(svc.lookup({ ...q, slices: [{ origin: "VAN", destination: "LHR", date: "2026-12-10" }] }, ctxFor("s1"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    expect(jobs.filter((j) => j.name === "flights.apify.start")).toHaveLength(1)
    expect(jobs[0]!.data).toEqual({ searchId: "s1" })
    expect(await redis.scard("apify:pending:s1")).toBe(2)
  })

  it("never calls Apify during a lookup", async () => {
    const spy = mockApify()
    await expect(harness().svc.lookup(q, ctxFor("s1"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    expect(spy).not.toHaveBeenCalled()
  })

  it("caps the legs one search can bill (maxLegsPerSearch)", async () => {
    const { svc } = harness({ maxLegsPerSearch: 1 })
    await expect(svc.lookup(q, ctxFor("s1"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await expect(svc.lookup({ ...q, slices: [{ origin: "VAN", destination: "LHR", date: "2026-12-10" }] }, ctxFor("s1"))).rejects.toMatchObject({ code: "NO_AVAILABILITY" })
  })

  it("serves only multi-search one-way legs and refuses a lookup with no search behind it", async () => {
    const { svc } = harness()
    await expect(svc.lookup({ ...q, slices: [...q.slices, ...q.slices] }, ctxFor("s1"))).rejects.toMatchObject({ code: "NO_AVAILABILITY" })
    await expect(svc.lookup(q, ctxFor())).rejects.toMatchObject({ code: "SUPPLIER_UNAVAILABLE" })
  })

  it("single-flight: two identical searches start one run, and its collect job wakes both", async () => {
    const spy = mockApify()
    const { svc, jobs, runs } = harness()
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await expect(svc.lookup(q, ctxFor("B"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await Promise.all([svc.startSearchRuns("A"), svc.startSearchRuns("B")])
    expect(posts(spy)).toHaveLength(1)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ pool: "customer", purpose: "SEARCH", status: "RUNNING", externalRunId: "runSYNTH0001" })
    // The run input: one route, always capped, KAYAK and booking options off.
    const [url, init] = posts(spy)[0]!
    expect(String(url)).toContain("maxTotalChargeUsd=0.0160")
    expect(JSON.parse(init!.body as string)).toMatchObject({ maxResults: 15, currency: "GBP", adults: 1, cabinClass: "economy", maxStops: 1, routes: [{ origin: "IST", destination: "LHR", departureDate: "2026-12-10" }] })
    expect(JSON.parse(init!.body as string)).not.toHaveProperty("resolveBookingOptions")
    expect(searchRuns(jobs)).toHaveLength(0)

    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    expect(runs[0]).toMatchObject({ status: "SUCCEEDED" })
    const woken = searchRuns(jobs)
    expect(woken.map((j) => j.data.searchId).sort()).toEqual(["A", "B"])
    expect(woken.every((j) => j.data.rerun === true && /^search-(A|B)-apify-/.test(j.opts.jobId as string))).toBe(true)
    // After the collect, both searches read the cache and no further run is paid for.
    await expect(svc.lookup(q, ctxFor("A"))).resolves.toHaveLength(1)
    expect(posts(spy)).toHaveLength(1)
  })

  it("single-flight at scale: 200 concurrent identical searches pay for one run; a cache hit pays for none", async () => {
    const spy = mockApify()
    const { svc, jobs, runs } = harness()
    const ids = Array.from({ length: 200 }, (_, i) => `S${i}`)
    const misses = await Promise.allSettled(ids.map((id) => svc.lookup(q, ctxFor(id))))
    expect(misses.every((r) => r.status === "rejected" && (r.reason as { code: string }).code === "SUPPLIER_PENDING")).toBe(true)
    // One start job per search (job id = search id, no network); the run itself is single-flight per cache key.
    expect(jobs.filter((j) => j.name === "flights.apify.start")).toHaveLength(200)
    await Promise.all(ids.map((id) => svc.startSearchRuns(id)))
    expect(posts(spy)).toHaveLength(1)
    expect(runs).toHaveLength(1)
    expect(JSON.parse(posts(spy)[0]![1]!.body as string)).toHaveProperty("maxResults", 15)

    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    expect(new Set(searchRuns(jobs).map((j) => j.data.searchId)).size).toBe(200)

    const startsBefore = jobs.filter((j) => j.name === "flights.apify.start").length
    const callsBefore = spy.mock.calls.length
    await expect(svc.lookup(q, ctxFor("late"))).resolves.toHaveLength(1)
    expect(spy.mock.calls.length).toBe(callsBefore)
    expect(jobs.filter((j) => j.name === "flights.apify.start")).toHaveLength(startsBefore)
  })

  it("batches the legs of one search into one run", async () => {
    const spy = mockApify()
    const { svc } = harness()
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await expect(svc.lookup({ ...q, slices: [{ origin: "VAN", destination: "LHR", date: "2026-12-10" }] }, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await svc.startSearchRuns("A")
    expect(posts(spy)).toHaveLength(1)
    expect(JSON.parse(posts(spy)[0]![1]!.body as string).routes).toHaveLength(2)
    expect(String(posts(spy)[0]![0])).toContain("maxTotalChargeUsd=0.0310")
  })

  it("caches the normalised rows and records the run: rows, estimated cost, notices, errors and the ledger", async () => {
    mockApify()
    const { svc, runs, redis } = harness()
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await svc.startSearchRuns("A")
    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    const offers = await svc.lookup(q, ctxFor("A"))
    expect(offers.map((o) => o.source.providerOfferId)).toEqual(["TK1979|2026-12-10T08:40|economy"])
    // 6 billable rows (4 flights, calendar_day, search) + the run fee; notice and error rows are free.
    expect(runs[0]).toMatchObject({ rows: 6, estimatedUsd: "0.007", errors: ["Route VAN-XXX: no results"] })
    expect((runs[0]!.notices as string[]).some((n) => n.startsWith("PRICE_UNAVAILABLE"))).toBe(true)
    expect(Number(redis.kv.get(`apify:ledger:${new Date().toISOString().slice(0, 7)}:customer`))).toBeCloseTo(0.007, 6)
  })

  it("negative cache: an empty result is cached, so a route with no flights is not paid for twice", async () => {
    const spy = mockApify([{ type: "notice", message: "No flights" }])
    const { svc, runs } = harness()
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await svc.startSearchRuns("A")
    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    await expect(svc.lookup(q, ctxFor("B"))).resolves.toEqual([])
    expect(posts(spy)).toHaveLength(1)
  })

  it("keeps polling while the actor runs, with a growing delay", async () => {
    mockApify(MIXED_DATASET, RUNNING_RESPONSE)
    const { svc, runs, jobs } = harness()
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await svc.startSearchRuns("A")
    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    const next = jobs.filter((j) => j.name === "flights.apify.collect").at(-1)!
    expect(next.data).toMatchObject({ attempt: 2 })
    expect(runs[0]!.status).toBe("RUNNING")
  })

  it("budget guard: the customer pool is a share of the month and is never overspent", async () => {
    mockApify()
    // $0.05 a month: customer pool 40% = $0.02, so one $0.016 run fits and the second is declined.
    const { svc, runs, jobs } = harness({ monthlyBudgetUsd: 0.05, staffReserveUsd: 0 })
    for (const id of ["A", "B"]) {
      await expect(svc.lookup({ ...q, slices: [{ origin: "IST", destination: "LHR", date: id === "A" ? "2026-12-10" : "2026-12-11" }] }, ctxFor(id))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
      await svc.startSearchRuns(id)
    }
    expect(runs.map((r) => r.status)).toEqual(["RUNNING", "DECLINED"])
    expect(runs[1]!.errors).toEqual(["POOL_EMPTY"])
    // The declined search is re-run and finds a negative marker, never a silent hang.
    expect(searchRuns(jobs).map((j) => j.data.searchId)).toEqual(["B"])
    await expect(svc.lookup({ ...q, slices: [{ origin: "IST", destination: "LHR", date: "2026-12-11" }] }, ctxFor("B"))).rejects.toMatchObject({ code: "SUPPLIER_RATE_LIMITED" })
  })

  it("staff reserve: customers cannot spend into it, staff can", async () => {
    const { svc } = harness({ monthlyBudgetUsd: 1, staffReserveUsd: 0.99 })
    const m = ProviderMetering.parse({ monthlyBudgetUsd: 1, staffReserveUsd: 0.99 })
    expect(await svc.reserve("customer", 0.016, m)).toBe(false)
    expect(await svc.reserve("staff", 0.016, m)).toBe(true)
    expect(await svc.reserve("prewarm", 0.016, m)).toBe(false)
  })

  it("hourly cap on customer runs", async () => {
    mockApify()
    const { svc, runs } = harness({ customerRunsPerHour: 1 })
    for (const [i, id] of ["A", "B"].entries()) {
      await expect(svc.lookup({ ...q, slices: [{ origin: "IST", destination: "LHR", date: `2026-12-1${i}` }] }, ctxFor(id))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
      await svc.startSearchRuns(id)
    }
    expect(runs.map((r) => r.status)).toEqual(["RUNNING", "DECLINED"])
    expect(runs[1]!.errors).toEqual(["HOURLY_CAP"])
  })

  it("a failed run leaves a short negative marker, wakes the waiters and charges only the start fee", async () => {
    mockApify(MIXED_DATASET, { data: { ...SUCCEEDED_RESPONSE.data, status: "FAILED" } })
    const { svc, runs, jobs, redis } = harness()
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
    await svc.startSearchRuns("A")
    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    expect(runs[0]).toMatchObject({ status: "FAILED", estimatedUsd: "0.001" })
    expect(searchRuns(jobs).map((j) => j.data.searchId)).toEqual(["A"])
    await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_UNAVAILABLE" })
    expect(Number(redis.kv.get(`apify:ledger:${new Date().toISOString().slice(0, 7)}:customer`))).toBeCloseTo(0.001, 6)
  })

  it("a search is re-run at most three times", async () => {
    mockApify(MIXED_DATASET, { data: { ...SUCCEEDED_RESPONSE.data, status: "FAILED" } })
    const { svc, runs, jobs } = harness()
    for (let i = 0; i < 5; i++) {
      await expect(svc.lookup({ ...q, slices: [{ origin: "IST", destination: "LHR", date: `2026-12-1${i}` }] }, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
      await svc.startSearchRuns("A")
      await svc.collect({ runId: runs.at(-1)!.id as string, attempt: 1 })
    }
    expect(searchRuns(jobs)).toHaveLength(3)
  })

  describe("rejected credential (ADR-0029 A8)", () => {
    it("start job: no call to Apify, the waiting search is woken with an auth failure", async () => {
      const spy = mockApify()
      const { svc, jobs, runs } = harness({}, { invalid: true })
      await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
      await svc.startSearchRuns("A")
      expect(spy).not.toHaveBeenCalled()
      expect(runs).toHaveLength(0)
      expect(searchRuns(jobs).map((j) => j.data.searchId)).toEqual(["A"])
      await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_AUTH" })
    })

    it("recheck is refused", async () => {
      const spy = mockApify()
      const { svc } = harness({}, { invalid: true })
      const it = { id: "itn", components: [{ source: { provider: "apify-google-flights", providerOfferId: "x" }, price: { total: { amountMinor: 1, currency: "GBP" } }, slices: [{ origin: "IST", destination: "LHR", segments: [{ departure: { local: "2026-12-10T08:40" } }] }] }] }
      await expect(svc.startRecheck(it as never, { passengers: [{ type: "ADT" }], cabin: "ECONOMY" } as never)).rejects.toMatchObject({ code: "SUPPLIER_UNAVAILABLE" })
      expect(spy).not.toHaveBeenCalled()
    })

    it("a 401 when starting a run marks the credential invalid and stops there", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { type: "user-or-token-not-found", message: "x" } }, 401))
      const { svc, suppliers, runs, jobs } = harness()
      await expect(svc.lookup(q, ctxFor("A"))).rejects.toMatchObject({ code: "SUPPLIER_PENDING" })
      await svc.startSearchRuns("A")
      expect(suppliers.markCredentialInvalid).toHaveBeenCalledWith("apify-google-flights")
      expect(runs[0]).toMatchObject({ status: "FAILED" })
      expect(searchRuns(jobs)).toHaveLength(1)
    })
  })

  describe("staff recheck (ADR-0029 A7)", () => {
    const comp = (price: number) => ({ source: { provider: "apify-google-flights", providerOfferId: "TK1979|2026-12-10T08:40|economy" }, price: { total: { amountMinor: price, currency: "GBP" } }, slices: [{ origin: "IST", destination: "LHR", segments: [{ departure: { local: "2026-12-10T08:40" } }] }] })
    const itinerary = (price: number) => ({ id: "itn_1", components: [comp(price)] }) as never
    const query = { passengers: [{ type: "ADT" }], cabin: "ECONOMY" } as never

    it("uses the staff pool with the staff maxResults and reports still listed, old and new price", async () => {
      const spy = mockApify()
      const { svc, runs } = harness()
      const start = await svc.startRecheck(itinerary(20000), query)
      expect(start.status).toBe("PENDING")
      expect(runs[0]).toMatchObject({ pool: "staff", purpose: "RECHECK" })
      expect(JSON.parse(posts(spy)[0]![1]!.body as string).maxResults).toBe(30)
      expect(await svc.recheckStatus("itn_1", start.jobId)).toEqual({ jobId: start.jobId, status: "PENDING" })
      await svc.collect({ runId: start.jobId, attempt: 1 })
      const done = await svc.recheckStatus("itn_1", start.jobId)
      expect(done.status).toBe("DONE")
      expect(done.result).toMatchObject({ stillListed: true, priceChanged: true, old: { amountMinor: 20000, currency: "GBP" }, new: { amountMinor: 23100, currency: "GBP" } })
      expect(typeof done.result!.fetchedAt).toBe("string")
    })

    it("reports an unchanged price and a vanished flight", async () => {
      mockApify()
      const same = harness()
      const a = await same.svc.startRecheck(itinerary(23100), query)
      await same.svc.collect({ runId: a.jobId, attempt: 1 })
      expect((await same.svc.recheckStatus("itn_1", a.jobId)).result).toMatchObject({ stillListed: true, priceChanged: false })

      vi.restoreAllMocks()
      mockApify([{ type: "notice", message: "none" }])
      const gone = harness()
      const b = await gone.svc.startRecheck(itinerary(23100), query)
      await gone.svc.collect({ runId: b.jobId, attempt: 1 })
      expect((await gone.svc.recheckStatus("itn_1", b.jobId)).result).toMatchObject({ stillListed: false, priceChanged: false, new: null })
    })

    it("does not leak a job to another itinerary", async () => {
      mockApify()
      const { svc } = harness()
      const start = await svc.startRecheck(itinerary(1), query)
      await expect(svc.recheckStatus("itn_other", start.jobId)).rejects.toMatchObject({ code: "NOT_FOUND" })
    })

    it("an itinerary without an indicative component has nothing to recheck", async () => {
      const { svc } = harness()
      await expect(svc.startRecheck({ id: "x", components: [{ source: { provider: "duffel" } }] } as never, query)).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    })

    it("a failed staff run does not hide the route from customers", async () => {
      mockApify(MIXED_DATASET, { data: { ...SUCCEEDED_RESPONSE.data, status: "FAILED" } })
      const { svc, redis } = harness()
      const start = await svc.startRecheck(itinerary(1), query)
      await svc.collect({ runId: start.jobId, attempt: 1 })
      expect((await svc.recheckStatus("itn_1", start.jobId)).status).toBe("FAILED")
      expect(redis.keys("apify:leg:").filter((k) => k.endsWith(":neg"))).toEqual([])
    })
  })

  it("the planner budget is the number of customer runs the pool can still pay for", async () => {
    const { svc, redis } = harness()
    const reg = vi.fn()
    ;(svc as unknown as { suppliers: { registerAdapter: typeof reg } }).suppliers.registerAdapter = reg
    await svc.onModuleInit()
    const budget = reg.mock.calls[0]![1] as () => Promise<number>
    expect(await budget()).toBe(Math.floor(2 / 0.016))
    redis.kv.set(`apify:ledger:${new Date().toISOString().slice(0, 7)}:customer`, "2")
    expect(await budget()).toBe(0)
  })
})

describe("popular-route warm and test connection (ADR-0032)", () => {
  afterEach(() => vi.restoreAllMocks())
  const routes = [{ origin: "IST", destination: "LHR", departureDate: "2026-12-10" }, { origin: "VAN", destination: "IST", departureDate: "2026-12-11" }]
  const pq = { passengers: [{ type: "ADT" as const }], cabin: "ECONOMY" as const, maxConnections: 1 }

  it("one batched prewarm-pool run for all routes with maxResultsPrewarm; collected legs announce listings.prewarmed", async () => {
    const spy = mockApify()
    const { svc, runs, jobs } = harness()
    const r = await svc.prewarm(routes, pq)
    expect(r.runId).toBeTruthy()
    expect(posts(spy)).toHaveLength(1)
    const body = JSON.parse(posts(spy)[0]![1]!.body as string) as { routes: unknown[]; maxResults: number }
    expect(body.routes).toHaveLength(2)
    expect(body.maxResults).toBe(10)
    expect(String(posts(spy)[0]![0])).toContain("maxTotalChargeUsd=0.0210")
    expect(runs[0]).toMatchObject({ pool: "prewarm", purpose: "PREWARM" })
    await svc.collect({ runId: runs[0]!.id as string, attempt: 1 })
    expect(jobs.filter((j) => j.name === "listings.prewarmed").map((j) => j.data)).toEqual([{ routes }])
    // The legs are cached now: a second warm pays for nothing and lists them straight away.
    const again = await svc.prewarm(routes, pq)
    expect(again).toMatchObject({ runId: null })
    expect(posts(spy)).toHaveLength(1)
  })

  it("a cache-only (listing) search never queues a paid run on a miss", async () => {
    const { svc, redis, jobs } = harness()
    await redis.set("search:L1:cache-only", "1")
    await expect(svc.lookup(q, ctxFor("L1"))).rejects.toMatchObject({ code: "NO_AVAILABILITY" })
    expect(jobs).toEqual([])
  })

  it("test connection reads /users/me/limits with the Bearer token", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(LIMITS_RESPONSE))
    const { svc, suppliers } = harness()
    const r = await svc.testConnection()
    expect(r).toMatchObject({ plan: null, monthlyUsageUsd: 0.42, monthlyLimitUsd: 5, cycleStart: "2026-11-01T00:00:00.000Z", cycleEnd: "2026-11-30T23:59:59.999Z" })
    expect(String(spy.mock.calls[0]![0])).toBe("https://api.apify.com/v2/users/me/limits")
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe("Bearer tok_secret")
    expect(suppliers.markTested).toHaveBeenCalled()
  })

  it.each([401, 403])("test connection: %i answers SUPPLIER_AUTH and marks the credential invalid", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(TOKEN_INVALID, status))
    const { svc, suppliers } = harness()
    await expect(svc.testConnection()).rejects.toMatchObject({ code: "SUPPLIER_AUTH" })
    expect(suppliers.markCredentialInvalid).toHaveBeenCalledWith("apify-google-flights")
  })

  it("test connection without a stored token is NOT_CONFIGURED and calls nothing", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
    await expect(harness({}, { token: null }).svc.testConnection()).rejects.toMatchObject({ code: "NOT_CONFIGURED" })
    expect(spy).not.toHaveBeenCalled()
  })
})
