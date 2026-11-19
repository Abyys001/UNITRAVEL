import "reflect-metadata"

import cookieParser from "cookie-parser"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"

import { CatalogSearchResponse, DEFAULT_CATALOG_SETTINGS, DevAviationEdgeCoverage, DevAviationEdgeStatus, DevAviationEdgeTestResult, PublicItineraryDetail } from "@unitravel/contracts"

import { AppModule } from "../src/app.module"
import { resetEnvForTests } from "../src/core/env"
import { REDIS } from "../src/core/infra.module"
import { Queues } from "../src/core/queues"
import { CatalogWriteService } from "../src/modules/catalog/catalog-write.service"
import { ScheduleRefreshService } from "../src/modules/catalog/schedule-refresh.service"
import { COVERAGE_KEY, SCHEDULE_LOCK_KEY, SCHEDULE_STATE_KEY } from "../src/modules/suppliers/aviation-edge/aviation-edge.service"
import { type Catalog, cleanupTestData, inDays, makeCatalog, offer, seedTestRoutes, slotId, TEST_AIRPORTS } from "./catalog-harness"
import { DEMO_TOTP, DEV_HOST, dbQuery, Session, totp, useApi } from "./client"

/**
 * ADR-0036 end to end, in-process: the real Nest application (api role), the real database and Redis, queues faked. Aviation Edge is a `fetch`
 * double (no live key exists, and nothing here can reach aviation-edge.com); the key is a throwaway that must not appear in any response, ledger
 * row, runtime state, event or audit entry. Test data: made-up watchlist routes TBZ→SAW, SAW→MAN and combined TBZ→MAN, removed afterwards.
 */
const KEY = "ae_test_key_0123456789"
const NEW_KEY = "ae_test_key_rotated_9876"
const ID = "aviation-edge"
const D = (n: number) => inDays(n)
const TEST_SETTINGS = { ...DEFAULT_CATALOG_SETTINGS, connections: { ...DEFAULT_CATALOG_SETTINGS.connections, hubs: [{ iata: "SAW", enabled: true }], pairs: [{ from: "TBZ", via: "SAW", to: "MAN", enabled: true }] } }
const priorSignIn = process.env.TEST_SIGN_IN
const since = new Date(Date.now() - 1000)

let app: INestApplication
let harness: Catalog
let redis: import("ioredis").Redis
let ids: Record<string, string>
let dev: Session
let tick: ScheduleRefreshService["tick"]
let writePriced: CatalogWriteService
let originalSettings: { value: unknown } | undefined
let originalRow: { enabled: boolean } | undefined
const bodies: unknown[] = []

// ---- an Aviation Edge double ----
interface Spec { dep: string; arr: string; carrier?: string; number: string; depTerminal?: string; aircraft?: string }
const FLIGHTS: Record<string, Spec[]> = {
  "TBZ-SAW": [
    { dep: "08:00", arr: "10:00", number: "1979", depTerminal: "1", aircraft: "A321" },
    { dep: "14:00", arr: "16:05", number: "1981" },
    { dep: "09:30", arr: "11:40", carrier: "W5", number: "1141" }, // Iranian carrier: policy drops it
  ],
  "SAW-MAN": [{ dep: "15:00", arr: "18:30", carrier: "PC", number: "1260", aircraft: "A320" }],
}
const aeRow = (from: string, to: string, s: Spec) => ({
  weekday: "3",
  departure: { iataCode: from, icaoCode: "XXXX", terminal: s.depTerminal ?? "", gate: "G7", scheduledTime: s.dep },
  arrival: { iataCode: to, icaoCode: "YYYY", terminal: "", gate: "", scheduledTime: s.arr },
  aircraft: { modelCode: s.aircraft ?? "", modelText: s.aircraft ?? "" },
  airline: { name: "Test Air", iataCode: s.carrier ?? "TK", icaoCode: "TST" },
  flight: { number: s.number, iataNumber: `${s.carrier ?? "TK"}${s.number}`, icaoNumber: `TST${s.number}` },
})

interface Fake { calls: URL[]; status: number; body: unknown; apiKey: string; spy: ReturnType<typeof vi.spyOn> }
let fake: Fake
function fakeAviationEdge(): Fake {
  const realFetch = globalThis.fetch
  const f: Fake = { calls: [], status: 200, body: undefined, apiKey: KEY, spy: undefined as never }
  f.spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const u = new URL(String(input))
    // The in-process API and the test client share `fetch`: only Aviation Edge is faked.
    if (u.hostname !== "aviation-edge.com") return realFetch(input, init)
    f.calls.push(u)
    if (f.status !== 200) return new Response("{}", { status: f.status })
    if (u.searchParams.get("key") !== f.apiKey) return new Response(JSON.stringify({ error: "Your API key is not valid" }), { status: 401 })
    if (f.body !== undefined) return new Response(JSON.stringify(f.body), { status: 200 })
    const from = u.searchParams.get("iataCode")!
    const to = u.searchParams.get("arr_iataCode")
    if (!to) return new Response(JSON.stringify(Object.entries(FLIGHTS).filter(([k]) => k.startsWith(from)).flatMap(([k, l]) => l.map((s) => aeRow(from, k.split("-")[1]!, s)))), { status: 200 })
    const list = FLIGHTS[`${from}-${to}`]
    return new Response(JSON.stringify(list ? list.map((s) => aeRow(from, to, s)) : { error: "No Record Found", success: false }), { status: 200 })
  }) as never
  return f
}

const fakeQueue = { add: async () => undefined, upsertJobScheduler: async () => undefined, removeJobScheduler: async () => undefined, getJobScheduler: async () => undefined }
const fakeQueues = { get: () => fakeQueue, all: () => [], onModuleDestroy: async () => undefined }

const search = async (from: string, to: string, date: string) => {
  const r = await new Session("WEB").get(`/v1/flights/search?from=${from}&to=${to}&date=${date}`)
  bodies.push(r.body)
  return r
}
const ledger = (purpose?: string) => dbQuery<{ credits: number; purpose: string; status: string; error: string | null }>(`select credits, purpose, status, error from provider_usage_ledger where provider = 'aviation-edge' and created_at >= $1 ${purpose ? "and purpose = $2" : ""} order by created_at`, purpose ? [since, purpose] : [since])
const view = async () => (await dev.get(`/v1/dev/providers/${ID}`)).body
const setEnabled = async (enabled: boolean) => expect((await dev.patch(`/v1/dev/providers/${ID}`, { enabled })).status).toBe(200)
/** Clears the pacer state and makes slots due: all of them, or only the first one (so a retry's 2 s pause is paid once). */
const resetPacer = async (only?: "one", keepState = false) => {
  await redis.del(SCHEDULE_LOCK_KEY, ...(keepState ? [] : [SCHEDULE_STATE_KEY]))
  const routes = [ids.a!, ids.b!]
  if (only) {
    await dbQuery("update catalog_schedule_slots set next_due_at = now() + interval '1 day' where slot_id in (select id from catalog_slots where route_id = any($1::uuid[]))", [routes])
    await dbQuery("update catalog_schedule_slots set next_due_at = now() - interval '1 minute' where slot_id = $1::uuid", [await slotId(ids.a!, D(8))])
  } else {
    await dbQuery("update catalog_schedule_slots set next_due_at = now() - interval '1 minute' where slot_id in (select id from catalog_slots where route_id = any($1::uuid[]))", [routes])
  }
}
const countRows = async (route: "a" | "b" | "combined", date: string, current = true) =>
  dbQuery<{ identity_key: string; self_transfer: boolean; compliance_review: boolean }>(`select identity_key, self_transfer, compliance_review from flight_schedules where slot_id = $1 ${current ? "and is_current" : ""} order by identity_key`, [await slotId(ids[route]!, date)])

beforeAll(async () => {
  process.env.TEST_SIGN_IN = "on"
  resetEnvForTests()
  originalSettings = (await dbQuery<{ value: unknown }>("select value from settings where key = 'catalog'"))[0]
  originalRow = (await dbQuery<{ enabled: boolean }>("select enabled from providers where id = $1", [ID]))[0]
  await dbQuery("insert into settings (key, value) values ('catalog', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(TEST_SETTINGS)])
  harness = await makeCatalog()
  ids = await seedTestRoutes(harness, 14) // parks the real watchlist routes, so the tick can only ever ask about the made-up ones
  const mod = await Test.createTestingModule({ imports: [AppModule.forRole("api")] }).overrideProvider(Queues).useValue(fakeQueues).compile()
  app = mod.createNestApplication()
  app.use(cookieParser())
  app.getHttpAdapter().getInstance().set("trust proxy", "loopback")
  await app.init()
  await app.listen(0)
  useApi((await app.getUrl()).replace("[::1]", "localhost"))
  redis = app.get(REDIS)
  const refresh = app.get(ScheduleRefreshService)
  tick = (...a) => refresh.tick(...a)
  writePriced = app.get(CatalogWriteService)
  // ADR-0012 email sign-in, then the demo TOTP, so the session has a fresh second factor (step-up) without the SMS pipeline.
  dev = new Session("CONSOLE", DEV_HOST)
  expect((await dev.post("/v1/auth/test-sign-in", { email: "dev@unitravel.example", deviceId: dev.deviceId, client: "CONSOLE" })).status).toBe(200)
  expect((await dev.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: totp(DEMO_TOTP) })).status).toBe(200)
  fake = fakeAviationEdge()
  await dbQuery("delete from provider_credentials where provider_id = $1", [ID])
  await dbQuery("update providers set enabled = false where id = $1", [ID])
  await redis.del(SCHEDULE_STATE_KEY, SCHEDULE_LOCK_KEY, COVERAGE_KEY)
}, 180_000)

afterAll(async () => {
  vi.restoreAllMocks()
  if (priorSignIn === undefined) delete process.env.TEST_SIGN_IN
  else process.env.TEST_SIGN_IN = priorSignIn
  resetEnvForTests()
  useApi()
  await app?.close()
  await dbQuery("delete from provider_credentials where provider_id = $1", [ID])
  await dbQuery("update providers set enabled = $2 where id = $1", [ID, originalRow?.enabled ?? false])
  await dbQuery("delete from flight_schedules where origin = any($1) and destination = any($1)", [TEST_AIRPORTS])
  await dbQuery("delete from provider_usage_ledger where provider = 'aviation-edge' and created_at >= $1", [since])
  await cleanupTestData(since)
  await harness?.close()
  await dbQuery("delete from settings where key = 'catalog'")
  if (originalSettings) await dbQuery("insert into settings (key, value) values ('catalog', $1)", [JSON.stringify(originalSettings.value)])
  const r = new (await import("ioredis")).Redis(process.env.REDIS_URL ?? "redis://localhost:6390")
  await r.del(SCHEDULE_STATE_KEY, SCHEDULE_LOCK_KEY, COVERAGE_KEY)
  r.disconnect()
}, 60_000)

describe("the key in the Developer Panel (E10)", () => {
  it("is stored encrypted, shown masked, and never echoed", async () => {
    const put = await dev.put(`/v1/dev/providers/${ID}/credentials`, { values: { apiKey: KEY } })
    expect(put.status).toBe(200)
    expect(put.body.credentials).toMatchObject({ set: true, last4: KEY.slice(-4), invalidAt: null })
    expect(JSON.stringify(put.body)).not.toContain(KEY)
    const [row] = await dbQuery<{ ciphertext: string }>("select ciphertext from provider_credentials where provider_id = $1", [ID])
    expect(row!.ciphertext).not.toBe(KEY)
    expect(row!.ciphertext).not.toContain(KEY)
    const got = await dev.get(`/v1/dev/providers/${ID}`)
    expect(got.body.credentials).toMatchObject({ set: true, last4: KEY.slice(-4) })
    expect(JSON.stringify(got.body)).not.toContain(KEY)
    const [audit] = await dbQuery<{ after: unknown }>("select after from audit_log where action = 'provider.credentials_rotated' and entity_id = $1 order by occurred_at desc limit 1", [ID])
    expect(JSON.stringify(audit)).not.toContain(KEY)
  })

  it("the generic test route does not 500 for a provider that has its own page", async () => {
    const r = await dev.post(`/v1/dev/providers/flightapi/test`)
    expect(r.status).toBe(400)
  })
})

describe("test connection", () => {
  it("makes one IKA→IST call for today + 8 days, books one call and marks the credential tested", async () => {
    FLIGHTS["IKA-IST"] = [{ dep: "02:55", arr: "05:20", number: "879", depTerminal: "1" }, { dep: "11:00", arr: "13:25", carrier: "PC", number: "1" }]
    const before = fake.calls.length
    const r = await dev.post(`/v1/dev/providers/${ID}/test`)
    expect(r.status).toBe(200)
    const body = DevAviationEdgeTestResult.parse(r.body)
    expect(body).toMatchObject({ ok: true, rows: 2, carriers: ["PC", "TK"], sampleFlight: "TK879", detail: null, probe: { from: "IKA", to: "IST", date: D(8) } })
    expect(fake.calls.length - before).toBe(1)
    expect(fake.calls.at(-1)!.searchParams.get("arr_iataCode")).toBe("IST")
    expect(JSON.stringify(r.body)).not.toContain(KEY)
    expect((await ledger("smoke")).map((l) => l.credits)).toEqual([1])
    expect((await view()).credentials.testedAt).toBeTruthy()
  })

  it("a 401 answers ok:false with AUTH and marks the credential invalid", async () => {
    fake.apiKey = "someone-elses-key"
    const r = await dev.post(`/v1/dev/providers/${ID}/test`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: false, detail: "AUTH", rows: 0 })
    expect(JSON.stringify(r.body)).not.toContain(KEY)
    expect((await view()).credentials.invalidAt).toBeTruthy()
    expect((await ledger("smoke")).at(-1)).toMatchObject({ credits: 0, status: "FAILED" })
  })

  it("replacing the key clears the flag", async () => {
    fake.apiKey = NEW_KEY
    expect((await dev.put(`/v1/dev/providers/${ID}/credentials`, { values: { apiKey: NEW_KEY } })).status).toBe(200)
    expect((await view()).credentials).toMatchObject({ invalidAt: null, last4: NEW_KEY.slice(-4) })
  })
})

describe("the pacer", () => {
  it("does nothing while the provider is disabled, and keeps the credential", async () => {
    await setEnabled(false)
    const before = fake.calls.length
    expect(await tick()).toEqual({ skipped: "DISABLED" })
    expect(fake.calls.length).toBe(before)
    expect((await view()).credentials.set).toBe(true)
    expect((await dev.get(`/v1/dev/providers/${ID}/status`)).body).toBeDefined()
  })

  it("a tick fills the due DIRECT slots 7-60 days out, one call each, and books the calls it sent", async () => {
    await setEnabled(true)
    await resetPacer()
    const before = fake.calls.length
    const out = await tick()
    const sent = fake.calls.slice(before)
    // 8 dates (days 7..14) on each of the two direct routes; the combined route is never called.
    expect(out).toMatchObject({ slots: 16, ok: 16, failed: 0, calls: 16 })
    expect(sent).toHaveLength(16)
    expect(sent.every((u) => u.searchParams.get("type") === "departure" && /^(TBZ|SAW)$/.test(u.searchParams.get("iataCode")!))).toBe(true)
    expect(sent.every((u) => !(u.searchParams.get("arr_iataCode") === "MAN" && u.searchParams.get("iataCode") === "TBZ"))).toBe(true)
    const refresh = await ledger("refresh")
    expect(refresh.at(-1)).toMatchObject({ credits: 16, status: "SUCCEEDED" })
    // The schedule rows: TK1979 and TK1981 stay; W5 (an Iranian carrier) is dropped by policy.
    expect((await countRows("a", D(8))).map((r) => r.identity_key)).toEqual([`TK1979|${D(8)}T08:00`, `TK1981|${D(8)}T14:00`])
    expect((await countRows("b", D(8))).map((r) => r.identity_key)).toEqual([`PC1260|${D(8)}T15:00`])
    // The Iran lane is on REVIEW in the policy data (FLIGHT:IR:*), so these rows are flagged.
    expect((await countRows("a", D(8))).every((r) => r.compliance_review)).toBe(true)
    // Schedule rows never reach flight_results (rule 3).
    const [res] = await dbQuery<{ n: string }>("select count(*) n from flight_results where origin = any($1) and destination = any($1)", [TEST_AIRPORTS])
    expect(Number(res!.n)).toBe(0)
  })

  it("builds the schedule self-transfer TBZ→SAW→MAN from the two feeders", async () => {
    const rows = await countRows("combined", D(8))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ identity_key: `TK1979|${D(8)}T08:00>PC1260|${D(8)}T15:00`, self_transfer: true })
  })

  it("is not due again right after a tick", async () => {
    const before = fake.calls.length
    expect(await tick()).toMatchObject({ skipped: "NOTHING_DUE" })
    expect(fake.calls.length).toBe(before)
  })
})

describe("customers read the stored schedule", () => {
  it("/v1/flights/search shows SCHEDULE items with no price or currency, and spends no Aviation Edge call", async () => {
    const before = fake.calls.length
    const r = await search("TBZ", "SAW", D(8))
    expect(r.status).toBe(200)
    const body = CatalogSearchResponse.parse(r.body)
    expect(body.state).toBe("RESULTS")
    expect(body.results.map((x) => x.flightNumbers[0])).toEqual(["TK1979", "TK1981"])
    expect(body.results.every((x) => x.basis === "SCHEDULE")).toBe(true)
    expect(JSON.stringify(r.body)).not.toMatch(/amount|currency|"price"|fare|baggage|gate|G7|icao|XXXX|provider/i)
    expect(fake.calls.length).toBe(before)
  })

  it("the schedule self-transfer is searchable on the combined route", async () => {
    const body = CatalogSearchResponse.parse((await search("TBZ", "MAN", D(8))).body)
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({ selfTransfer: true, stops: 1, basis: "SCHEDULE", flightNumbers: ["TK1979", "PC1260"] })
  })

  it("results/:id resolves a schedule id (current rows only), with the terminal and aircraft AE gave", async () => {
    const first = CatalogSearchResponse.parse((await search("TBZ", "SAW", D(8))).body).results[0]!
    const r = await new Session("WEB").get(`/v1/flights/results/${first.id}`)
    expect(r.status).toBe(200)
    const d = PublicItineraryDetail.parse(r.body)
    expect(d).toMatchObject({ basis: "SCHEDULE", isCurrent: true })
    expect(d.legs[0]).toMatchObject({ flightNumber: "TK1979", aircraft: "A321", from: { terminal: "1" } })
    await dbQuery("update flight_schedules set is_current = false where id = $1", [first.id])
    expect((await new Session("WEB").get(`/v1/flights/results/${first.id}`)).status).toBe(404)
    await dbQuery("update flight_schedules set is_current = true where id = $1", [first.id])
  })

  it("a priced itinerary with the same flights and departure wins; the others stay, and the priced legs take AE's terminal and aircraft on read", async () => {
    const slot = (await slotId(ids.a!, D(9)))!
    // The priced source lists TK1979 at 08:00 (no terminal; its aircraft name differs) and nothing else.
    const priced = offer({ from: "TBZ", to: "SAW", date: D(9), dep: "08:00", arr: "10:00", number: "1979", minor: 23100 })
    priced.slices[0]!.segments[0]!.aircraft = undefined
    await writePriced.writeSlot({ slotId: slot, offers: [priced], fetchedAt: new Date(), notices: [] })
    const body = CatalogSearchResponse.parse((await search("TBZ", "SAW", D(9))).body)
    expect(body.results.map((x) => [x.flightNumbers[0], x.basis])).toEqual([["TK1979", "OFFER"], ["TK1981", "SCHEDULE"]])
    expect(JSON.stringify(body)).not.toMatch(/amount|currency|"price"/i)
    const d = PublicItineraryDetail.parse((await new Session("WEB").get(`/v1/flights/results/${body.results[0]!.id}`)).body)
    expect(d.basis).toBe("OFFER")
    expect(d.legs[0]).toMatchObject({ aircraft: "A321", from: { terminal: "1" } })
    // Nothing is written back to the priced row.
    const [stored] = await dbQuery<{ detail: { legs: { aircraft?: string; from: { terminal?: string } }[] } }>("select detail from flight_results where slot_id = $1", [slot])
    expect(stored!.detail.legs[0]!.from.terminal).toBeUndefined()
  })

  it("the slot is RESULTS when only the schedule layer has rows, EMPTY when neither does", async () => {
    expect(CatalogSearchResponse.parse((await search("TBZ", "SAW", D(10))).body).state).toBe("RESULTS")
    expect(CatalogSearchResponse.parse((await search("TBZ", "SAW", D(3))).body).state).toBe("EMPTY")
  })
})

describe("failures", () => {
  it("a 429 stops the tick, books no call, and pauses the pacer", async () => {
    await resetPacer("one")
    fake.status = 429
    const before = (await ledger("refresh")).length
    const out = await tick()
    expect(out).toMatchObject({ ok: 0, failed: 1, fatal: "RATE_LIMITED" })
    const rows = await ledger("refresh")
    expect(rows.length).toBe(before + 1)
    expect(rows.at(-1)).toMatchObject({ credits: 0, status: "FAILED" })
    const status = DevAviationEdgeStatus.parse((await dev.get(`/v1/dev/providers/${ID}/status`)).body)
    expect(status.pause).toBe("RATE_LIMITED")
    fake.status = 200
    expect(await tick()).toEqual({ skipped: "RATE_LIMITED" })
  })

  it("a 401 marks the credential invalid and the pacer stays stopped until a new key is entered", async () => {
    await resetPacer("one")
    fake.apiKey = "rotated-away"
    expect(await tick()).toMatchObject({ fatal: "AUTH" })
    expect((await view()).credentials.invalidAt).toBeTruthy()
    expect(await tick()).toEqual({ skipped: "AUTH" })
    fake.apiKey = NEW_KEY
    expect((await dev.put(`/v1/dev/providers/${ID}/credentials`, { values: { apiKey: NEW_KEY } })).status).toBe(200)
    await resetPacer("one")
    expect(await tick()).toMatchObject({ failed: 0 })
  })

  it("three failed ticks in a row open the circuit", async () => {
    await redis.del(SCHEDULE_STATE_KEY)
    fake.status = 503
    try {
      for (let i = 0; i < 3; i++) {
        await resetPacer("one", true)
        expect(await tick()).toMatchObject({ ok: 0 })
      }
      const status = DevAviationEdgeStatus.parse((await dev.get(`/v1/dev/providers/${ID}/status`)).body)
      expect(status.pause).toBe("CIRCUIT")
      expect(await tick()).toEqual({ skipped: "CIRCUIT" })
    } finally {
      fake.status = 200
      await redis.del(SCHEDULE_STATE_KEY)
    }
  })

  it("'No Record Found' is an empty slot, not an error", async () => {
    await resetPacer("one")
    fake.body = { error: "No Record Found", success: false }
    const out = await tick()
    expect(out).toMatchObject({ failed: 0 })
    expect((await countRows("a", D(8))).length).toBe(0) // all retired
    expect((await dbQuery<{ status: string }>("select status from catalog_schedule_slots where slot_id = $1", [await slotId(ids.a!, D(8))]))[0]!.status).toBe("EMPTY")
    fake.body = undefined
  })
})

describe("coverage probe and status", () => {
  it("makes ten departure calls without a destination filter, stores the result, audits it, and shows it in the status", async () => {
    FLIGHTS["IKA-IST"] = [{ dep: "02:55", arr: "05:20", number: "879" }]
    FLIGHTS["IST-LHR"] = [{ dep: "09:00", arr: "11:10", number: "1971" }, { dep: "10:00", arr: "12:10", carrier: "BA", number: "675" }]
    await redis.del(SCHEDULE_STATE_KEY, SCHEDULE_LOCK_KEY)
    const before = fake.calls.length
    const r = await dev.post(`/v1/dev/providers/${ID}/coverage`)
    expect(r.status).toBe(200)
    const body = DevAviationEdgeCoverage.parse(r.body)
    const sent = fake.calls.slice(before)
    expect(sent.map((u) => u.searchParams.get("iataCode"))).toEqual(["IKA", "IST", "SAW", "DXB", "DOH", "LHR", "LGW", "FRA", "CDG", "AMS"])
    expect(sent.every((u) => !u.searchParams.has("arr_iataCode") && u.searchParams.get("date") === D(8))).toBe(true)
    expect(body.callsUsed).toBe(10)
    expect(body.airports.find((a) => a.iata === "IST")).toMatchObject({ departures: 2, carriers: ["BA", "TK"], destinations: 1, error: null })
    expect(body.airports.find((a) => a.iata === "DXB")).toMatchObject({ departures: 0, error: null })
    expect(JSON.stringify(r.body)).not.toContain(KEY)
    expect((await ledger("smoke")).at(-1)).toMatchObject({ credits: 10 })
    const [audit] = await dbQuery<{ after: unknown }>("select after from audit_log where action = 'provider.coverage_probed' and entity_id = $1 order by occurred_at desc limit 1", [ID])
    expect(audit).toBeDefined()
    expect(JSON.stringify(audit)).not.toContain(KEY)
    const status = DevAviationEdgeStatus.parse((await dev.get(`/v1/dev/providers/${ID}/status`)).body)
    expect(status.lastCoverage?.airports).toHaveLength(10)
    expect(status).toMatchObject({ pause: "NONE", monthlyCalls: 30_000, reserveCalls: 500 })
    expect(status.callsUsedThisMonth).toBeGreaterThan(0)
    expect(status.slotsWithSchedules).toBeGreaterThan(0)
  })

  it("nothing a customer, the ledger, the pacer state, the events or the audit log holds contains the key", async () => {
    const dump = JSON.stringify([
      bodies, await ledger(), await redis.get(SCHEDULE_STATE_KEY), await redis.get(COVERAGE_KEY),
      await dbQuery("select payload from outbox_events where created_at >= $1", [since]), await dbQuery("select before, after from audit_log where occurred_at >= $1", [since]),
      await dbQuery("select notices, last_error, payload from catalog_schedule_slots"), await dbQuery("select detail, provider_data from flight_schedules where origin = any($1)", [TEST_AIRPORTS]),
    ])
    expect(dump).not.toContain(KEY)
    expect(dump).not.toContain(NEW_KEY)
  })

  it("an unprivileged caller cannot reach the three routes", async () => {
    const anon = new Session("CONSOLE", "dev.localhost:4200")
    for (const [m, p] of [["POST", `/v1/dev/providers/${ID}/test`], ["POST", `/v1/dev/providers/${ID}/coverage`], ["GET", `/v1/dev/providers/${ID}/status`]] as const) {
      expect([401, 403], `${m} ${p}`).toContain((await anon.req(m, p, m === "POST" ? {} : undefined)).status)
    }
  })
})
