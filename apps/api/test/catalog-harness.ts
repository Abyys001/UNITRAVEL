import { Redis } from "ioredis"
import { vi } from "vitest"

import { type CatalogSettings, DEFAULT_CATALOG_SETTINGS, DEFAULT_ENGINE_RULES, DEFAULT_HUBS, type NormalisedOffer } from "@unitravel/contracts"
import { createDb } from "@unitravel/db"
import { makeOffer } from "@unitravel/engine"

import { UnitOfWork } from "../src/core/infra.module"
import { CatalogBudgetService } from "../src/modules/catalog/catalog-budget.service"
import { CatalogRefreshService, LOCK_KEY } from "../src/modules/catalog/catalog-refresh.service"
import type { CatalogRuntimeState } from "../src/modules/catalog/catalog-settings.service"
import { CatalogWriteService } from "../src/modules/catalog/catalog-write.service"
import { ReferenceService } from "../src/modules/reference/reference.service"
import { dbQuery } from "./client"

/**
 * Real Postgres and Redis (the local dev stack), with every collaborator that could reach the outside world replaced: Apify is a fake
 * `fetch`, queues record their jobs, the outbox records its events, and the settings live in memory so the shared `settings` rows are untouched.
 * Test data uses made-up watchlist routes (TBZ→SAW→MAN, combined TBZ→MAN) and is removed afterwards.
 */
export const DB_URL = process.env.DATABASE_URL ?? "postgres://app_rw:app_rw_dev@localhost:5462/unitravel"
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6390"
export const TEST_PAIR = { a: ["TBZ", "SAW"], b: ["SAW", "MAN"], combined: ["TBZ", "MAN"] } as const
export const TEST_AIRPORTS = ["TBZ", "SAW", "MAN"]

export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000))

export class MemorySettings {
  settings: CatalogSettings
  stateData: CatalogRuntimeState = { pause: null, failedTicks: 0, lastTick: null, schemaAlert: null, cycle: null, currentRun: null, retry: null }
  constructor(patch: Partial<CatalogSettings> = {}) {
    this.settings = { ...DEFAULT_CATALOG_SETTINGS, connections: { ...DEFAULT_CATALOG_SETTINGS.connections, pairs: [{ from: "TBZ", via: "SAW", to: "MAN", enabled: true }], hubs: [{ iata: "SAW", enabled: true }, { iata: "IST", enabled: false }] }, ...patch }
  }
  async get() { return this.settings }
  async patch(p: Partial<CatalogSettings>) { this.settings = { ...this.settings, ...p }; return this.settings }
  async state() { return structuredClone(this.stateData) }
  async updateState(fn: (s: CatalogRuntimeState) => Partial<CatalogRuntimeState>) { this.stateData = { ...this.stateData, ...fn(this.stateData) }; return structuredClone(this.stateData) }
}

export interface Job { queue: string; name: string; data: Record<string, unknown>; opts: Record<string, unknown> }

export async function makeCatalog(opts: { settings?: Partial<CatalogSettings>; token?: string | null; invalid?: boolean; role?: "api" | "worker"; policy?: Partial<{ blockedCarriers: string[]; reviewLanes: string[]; blockedLanes: string[] }> } = {}) {
  const { db, pool } = createDb(DB_URL)
  const redis = new Redis(REDIS_URL)
  const cfg = new MemorySettings(opts.settings)
  const jobs: Job[] = []
  const events: { eventType: string; payload: Record<string, unknown> }[] = []
  const queues = { get: (queue: string) => ({
    add: async (name: string, data: Record<string, unknown>, o: Record<string, unknown> = {}) => void jobs.push({ queue, name, data, opts: o }),
    upsertJobScheduler: async () => undefined, removeJobScheduler: async () => undefined, getJobScheduler: async () => undefined,
  }) }
  const credential = { token: opts.token === undefined ? "tok_test_secret" : opts.token, invalid: !!opts.invalid }
  const suppliers = {
    credentials: async () => (credential.token ? { token: credential.token } : null), credentialInvalid: async () => credential.invalid,
    markCredentialInvalid: vi.fn(async () => { credential.invalid = true }), markTested: vi.fn(),
  }
  const policy = {
    blockedCarriers: new Set(opts.policy?.blockedCarriers ?? []), reviewCarriers: new Set<string>(), blockedAirports: new Set<string>(), reviewAirports: new Set<string>(),
    blockedLanes: new Set(opts.policy?.blockedLanes ?? []), reviewLanes: new Set(opts.policy?.reviewLanes ?? []),
  }
  const compliance = { carrierPolicy: async () => policy, invalidatePolicyCache: () => undefined }
  const config = { get: (k: string) => (k === "ENGINE_RULES" ? DEFAULT_ENGINE_RULES : DEFAULT_HUBS), version: () => 1 }
  const outbox = { add: async (_tx: unknown, ...es: { eventType: string; payload: Record<string, unknown> }[]) => void events.push(...es) }
  const reference = new ReferenceService(db)
  await reference.reload()
  const uow = new UnitOfWork(db)
  const budget = new CatalogBudgetService(db, cfg as never, suppliers as never)
  const write = new CatalogWriteService(db, redis, uow, cfg as never, reference, compliance as never, config as never, outbox as never)
  const refresh = new CatalogRefreshService(db, redis, opts.role ?? "api", queues as never, { registerJob: vi.fn() } as never, cfg as never, budget, write, suppliers as never, reference, compliance as never, outbox as never, { putCallPayload: async () => undefined } as never)
  const since = new Date(Date.now() - 1000)
  return {
    db, redis, cfg, jobs, events, suppliers, credential, policy, budget, write, refresh, reference, since,
    close: async () => { await redis.del(LOCK_KEY); redis.disconnect(); await pool.end() },
  }
}
export type Catalog = Awaited<ReturnType<typeof makeCatalog>>

/** Creates the test watchlist (two direct feeders and the combined route) with slots for today..today+horizon. */
/** Real watchlist routes switched off for the duration of a test file, restored by `cleanupTestData`. */
let parkedRealRoutes: string[] = []

export async function seedTestRoutes(c: Catalog, horizon = 14) {
  await cleanupTestData()
  // Ticks pick every enabled route. Parking the real ones keeps fake rows out of real slots, and keeps a real worker tick
  // (shared dev database) from writing ledger rows inside the window the cleanup deletes.
  const parked = await dbQuery<{ id: string }>("update flight_watchlist_routes set enabled = false where enabled and not (origin = any($1) and destination = any($1)) returning id", [TEST_AIRPORTS])
  parkedRealRoutes = [...parkedRealRoutes, ...parked.map((r) => r.id)]
  const ids: Record<string, string> = {}
  for (const [key, [o, d], kind, via, max] of [["a", TEST_PAIR.a, "DIRECT", null, 3], ["b", TEST_PAIR.b, "DIRECT", null, 5], ["combined", TEST_PAIR.combined, "COMBINED", "SAW", null]] as const) {
    const [r] = await dbQuery<{ id: string }>("insert into flight_watchlist_routes (id, origin, destination, kind, via_hub, horizon_days, max_results) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) returning id", [o, d, kind, via, horizon, max])
    ids[key] = r!.id
  }
  // Only the test routes: the seeded real watchlist must not get slots from a test.
  await c.refresh.rollSlots(new Date(), Object.values(ids))
  return ids
}

export async function slotId(routeId: string, date: string) {
  return (await dbQuery<{ id: string }>("select id from catalog_slots where route_id = $1 and departure_date = $2", [routeId, date]))[0]?.id
}

export async function cleanupTestData(since?: Date) {
  const routes = await dbQuery<{ id: string }>("select id from flight_watchlist_routes where origin = any($1) and destination = any($1)", [TEST_AIRPORTS])
  const slots = routes.length ? await dbQuery<{ id: string }>("select id from catalog_slots where route_id = any($1)", [routes.map((r) => r.id)]) : []
  if (slots.length) {
    const r = new Redis(REDIS_URL)
    for (const s of slots) { const keys = await r.keys(`cat:${s.id}:*`); if (keys.length) await r.del(...keys) }
    for (const rt of routes) { const keys = await r.keys(`cat:*${rt.id}*`); if (keys.length) await r.del(...keys) }
    r.disconnect()
  }
  await dbQuery("delete from flight_results where origin = any($1) and destination = any($1)", [TEST_AIRPORTS])
  await dbQuery("delete from flight_watchlist_routes where origin = any($1) and destination = any($1)", [TEST_AIRPORTS])
  if (since) {
    // Admin route edits roll slots for every enabled route, including the seeded real ones; a test leaves none of them behind.
    await dbQuery("delete from catalog_slots where created_at >= $1 and last_fetched_at is null", [since])
    await dbQuery("delete from outbox_events where event_type like 'catalog.%' and created_at >= $1", [since])
    // Only cost rows that touched a test slot: real ledger rows must survive the billing cycle (owner, 4 Nov 2026).
    const testSlots = slots.map((x) => x.id)
    const gone = await dbQuery<{ provider_run_id: string | null }>("delete from provider_usage_ledger where created_at >= $1 and slot_ids && $2::uuid[] returning provider_run_id", [since, testSlots])
    const runs = gone.flatMap((g) => (g.provider_run_id ? [g.provider_run_id] : []))
    if (runs.length) await dbQuery("delete from provider_runs where id = any($1)", [runs])
  }
  if (parkedRealRoutes.length) {
    await dbQuery("update flight_watchlist_routes set enabled = true where id = any($1)", [parkedRealRoutes])
    parkedRealRoutes = []
  }
}

// ---------------- offers and Apify rows ----------------

const TZ: Record<string, string> = { TBZ: "Asia/Tehran", SAW: "Europe/Istanbul", MAN: "Europe/London", IKA: "Asia/Tehran", IST: "Europe/Istanbul", LHR: "Europe/London" }

export function offer(o: { from: string; to: string; date: string; dep: string; arr: string; carrier?: string; number?: string; minor?: number; cabin?: string; fetchedAt?: Date; arrDate?: string }): NormalisedOffer {
  const carrier = o.carrier ?? "TK"
  const number = o.number ?? "1979"
  const dep = `${o.date}T${o.dep}`
  return makeOffer({
    provider: "apify-google-flights", id: `${carrier}${number}|${dep}|${o.cabin ?? "economy"}`, fetchedAt: (o.fetchedAt ?? new Date()).toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    totalMinor: o.minor ?? 23100, currency: "USD", rung: "CACHED_OFFER",
    slices: [[{ carrier, number, from: o.from, to: o.to, dep, arr: `${o.arrDate ?? o.date}T${o.arr}`, fromTz: TZ[o.from]!, toTz: TZ[o.to]!, aircraft: "Airbus A321" }]],
  })
}

/** A `flight` row as the actor returns it (SYNTHETIC; shaped like test/fixtures/apify DIRECT). */
export function row(o: { from: string; to: string; date: string; dep?: string; arr?: string; carrier?: string; number?: string; price?: number }) {
  const carrier = o.carrier ?? "TK"
  const number = o.number ?? "1979"
  const departAt = `${o.date}T${o.dep ?? "08:40"}`
  const arriveAt = `${o.date}T${o.arr ?? "10:55"}`
  return {
    type: "flight", origin: o.from, destination: o.to, departureDate: o.date, cabinClass: "economy", airline: "Test Air", airlineCodes: [carrier], flightNumbers: [`${carrier}${number}`], stops: 0, layovers: [],
    departAirport: o.from, departAt, arriveAt, totalDurationMinutes: 135, price: o.price ?? 231, currency: "USD", priceUnavailable: false, priceLevel: "low", typicalPriceLow: 200, typicalPriceHigh: 300,
    legs: [{ flightNumber: `${carrier}${number}`, airline: "Test Air", airlineCode: carrier, operatedBy: null, from: o.from, to: o.to, departAt, arriveAt, durationMinutes: 135, aircraft: "Airbus A321" }],
    bookingToken: "SYNTHETIC-TOKEN", googleFlightsUrl: "https://www.google.com/travel/flights?synthetic=1",
  }
}

// ---------------- a fake Apify ----------------

export interface FakeRun { status: string; items: unknown[]; usageTotalUsd?: number }
export function fakeApify(limits: { usage: number; cap?: number; endInDays?: number } = { usage: 0 }) {
  const state = {
    runs: new Map<string, FakeRun>(), seq: 0, posts: [] as { url: string; body: Record<string, any> }[], calls: [] as string[],
    startError: null as null | { status: number; body?: unknown }, runStatus: "SUCCEEDED", limitsError: null as null | number, limits,
    /** Builds the dataset for a started run. */
    dataset: (_routes: { origin: string; destination: string; departureDate: string }[]) => [] as unknown[],
    statusError: null as null | number,
    /** The actor's default build, for the weekly schema check. */
    build: { buildNumber: "0.1.167", fields: ["kayakWhenGoogleEmpty", "fillMissingPricesFromKayak", "resolveBookingOptions", "resolveReturnFlights", "maxResults"] },
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname.replace(/^\/v2/, "")
    state.calls.push(`${init?.method ?? "GET"} ${path}`)
    if ((init?.headers as Record<string, string> | undefined)?.authorization !== "Bearer tok_test_secret") return json({ error: { type: "user-or-token-not-found", message: "x" } }, 401)
    if (path === "/users/me/limits") {
      if (state.limitsError) return json({ error: { type: "x" } }, state.limitsError)
      const end = new Date(Date.now() + (state.limits.endInDays ?? 20) * 86_400_000)
      const start = new Date(end.getTime() - 30 * 86_400_000)
      return json({ data: { monthlyUsageCycle: { startAt: start.toISOString(), endAt: end.toISOString() }, limits: { maxMonthlyUsageUsd: state.limits.cap ?? 5 }, current: { monthlyUsageUsd: state.limits.usage } } })
    }
    if (path.endsWith("/builds/default")) return json({ data: { buildNumber: state.build.buildNumber, actorDefinition: { input: { properties: Object.fromEntries(state.build.fields.map((f) => [f, { default: false }])) } } } })
    if (init?.method === "POST" && /^\/acts\/[^/]+\/runs$/.test(path)) {
      if (state.startError) return json(state.startError.body ?? { error: { type: "server-error" } }, state.startError.status)
      const body = JSON.parse(String(init.body)) as { routes: { origin: string; destination: string; departureDate: string }[] }
      state.posts.push({ url, body })
      const id = `run${++state.seq}`
      state.runs.set(id, { status: state.runStatus, items: state.dataset(body.routes) })
      return json({ data: { id, defaultDatasetId: `ds${id}`, status: "READY" } }, 201)
    }
    const run = /^\/actor-runs\/([^/]+)$/.exec(path)
    if (run) {
      if (state.statusError) return json({ error: { type: "x" } }, state.statusError)
      const r = state.runs.get(run[1]!)
      return r ? json({ data: { id: run[1], defaultDatasetId: `ds${run[1]}`, status: r.status, ...(r.usageTotalUsd !== undefined ? { usageTotalUsd: r.usageTotalUsd } : {}) } }) : json({ error: { type: "record-not-found" } }, 404)
    }
    const ds = /^\/datasets\/ds([^/]+)\/items$/.exec(path)
    if (ds) return json(state.runs.get(ds[1]!)?.items ?? [])
    throw new Error(`fake Apify: unexpected ${init?.method ?? "GET"} ${url}`)
  })
  return { state, spy, restore: () => spy.mockRestore() }
}
