import { createHash } from "node:crypto"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { desc, eq } from "drizzle-orm"
import type { Redis } from "ioredis"

import { type DevApifyTestResult, type Itinerary, type Money, type NormalisedOffer, type ProviderRunView, ProviderMetering, type ProviderUsageView, type RecheckResult, type RecheckStart, type RecheckStatus, type SearchQuery } from "@unitravel/contracts"
import { type Db, providerRuns } from "@unitravel/db"

import { AppError } from "../../../core/errors"
import { DB, REDIS } from "../../../core/infra.module"
import { Queues } from "../../../core/queues"
import { ObjectStorage } from "../../../core/storage"
import { WorkerRegistry } from "../../../core/workers"
import { ReferenceService } from "../../reference/reference.service"
import { type CallContext, type SliceQuery, SupplierError } from "../adapter"
import { ApifyGoogleFlightsAdapter } from "../adapters/apify/apify.adapter"
import { ApifyClient, type ApifyInput, type ApifyRoute } from "../adapters/apify/client"
import { normaliseRows } from "../adapters/apify/normalise"
import { SuppliersService } from "../suppliers.service"

export const APIFY_ID = "apify-google-flights" as const
type Pool = "customer" | "prewarm" | "staff"
type RunRow = typeof providerRuns.$inferSelect

/** $0.001 per row and, from 4 Nov 2026, $0.001 per run start (DOCUMENTED, actor README). */
const ROW_USD = 0.001
const RUN_START_USD = 0.001
const RUN_DEADLINE_MS = 300_000
const NEGATIVE_TTL_S = 300
const MAX_RERUNS = 3

const HOUR_MS = 3600_000
/** ADR-0032 B3: never warm more often than this, whatever the pool allows. */
export const MIN_WARM_INTERVAL_MS = 6 * HOUR_MS

/** Worst-case cost of one batched popular-route warm: every route at `maxResultsPrewarm` rows plus one run start. */
export const prewarmCostUsd = (routes: number, m: Pick<ProviderMetering, "maxResultsPrewarm">) => usd(routes * m.maxResultsPrewarm * ROW_USD + RUN_START_USD)

/**
 * ADR-0032 B3: interval = 30 days / ⌊prewarm pool / cost per warm⌋, rounded up to the hour, at least 6 h. A pool that cannot
 * pay for one warm a month gives null (do not schedule).
 */
export function prewarmIntervalMs(routes: number, m: Pick<ProviderMetering, "maxResultsPrewarm" | "monthlyBudgetUsd" | "poolSplit">): number | null {
  if (routes < 1) return null
  const warms = Math.floor(usd(m.monthlyBudgetUsd * m.poolSplit.prewarm) / prewarmCostUsd(routes, m) + 1e-9)
  if (warms < 1) return null
  return Math.max(MIN_WARM_INTERVAL_MS, Math.ceil((30 * 24 * HOUR_MS) / warms / HOUR_MS) * HOUR_MS)
}

/** One leg the actor is asked for; everything except the route is shared by the legs of one run. */
export interface LegSpec {
  route: ApifyRoute
  shared: Omit<ApifyInput, "routes" | "maxResults">
}

const CABIN_OUT: Record<string, ApifyInput["cabinClass"]> = { ECONOMY: "economy", PREMIUM_ECONOMY: "premium_economy", BUSINESS: "business", FIRST: "first" }
const sha = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 24)
const usd = (n: number) => Math.round(n * 1e6) / 1e6
const month = () => new Date().toISOString().slice(0, 7)
const hourSlot = () => new Date().toISOString().slice(0, 13).replace(/\D/g, "")

/**
 * ADR-0029 A6: cache → single-flight lock → budget guard → run, all for a slow, pay-per-row source. A search never waits
 * for Apify: a cache miss queues a run and answers SUPPLIER_PENDING; when the run is collected the waiting searches are
 * run again and find the data in the cache (including an empty result, so "no flights" is not paid for twice).
 */
@Injectable()
export class FlightDataService implements OnModuleInit {
  private readonly log = new Logger("FlightData")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
    private readonly suppliers: SuppliersService,
    private readonly reference: ReferenceService,
    private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit() {
    this.suppliers.registerAdapter(new ApifyGoogleFlightsAdapter(this), () => this.customerRunsAffordable())
    this.workers.registerJob("maintenance", "flights.apify.start", (job) => this.startSearchRuns((job.data as { searchId: string }).searchId))
    this.workers.registerJob("maintenance", "flights.apify.collect", (job) => this.collect(job.data as { runId: string; attempt: number }))
    this.workers.registerJob("maintenance", "flights.apify.reconcile", () => this.reconcile())
    await this.queues.get("maintenance").upsertJobScheduler("flights-apify-reconcile-daily", { every: 24 * 3600_000 }, { name: "flights.apify.reconcile" }).catch(() => undefined)
  }

  // ---------------- configuration ----------------

  async metering(): Promise<ProviderMetering> {
    return ProviderMetering.parse((await this.suppliers.row(APIFY_ID))?.metering ?? {})
  }

  private legKey(spec: LegSpec) {
    return `apify:leg:${sha([spec.route, spec.shared])}`
  }

  private specFor(route: ApifyRoute, passengers: { type: string }[], cabin: string, maxStops: number, m: ProviderMetering): LegSpec {
    const count = (...t: string[]) => passengers.filter((p) => t.includes(p.type)).length
    return {
      route,
      shared: {
        sortBy: "best", currency: m.currency, market: m.market,
        adults: count("ADT", "YTH", "STU"), children: count("CHD"), infantsInSeat: count("INS"), infantsOnLap: count("INF"),
        cabinClass: CABIN_OUT[cabin] ?? "economy", maxStops: maxStops >= 0 && maxStops <= 2 ? (maxStops as 0 | 1 | 2) : "any",
        excludeAirlines: m.excludeAirlines.length ? [...m.excludeAirlines].sort() : undefined,
      },
    }
  }

  // ---------------- the adapter side: read the cache or queue a run ----------------

  async lookup(q: SliceQuery, ctx: CallContext): Promise<NormalisedOffer[]> {
    // Return flights are fetched as separate one-way legs by the engine's own planning; a multi-slice call is not served.
    if (q.slices.length !== 1) throw new SupplierError("NO_AVAILABILITY", "The indicative source serves one-way legs only")
    const m = await this.metering()
    const s = q.slices[0]!
    const spec = this.specFor({ origin: s.origin, destination: s.destination, departureDate: s.date }, q.passengers, q.cabin, q.maxConnections, m)
    const key = this.legKey(spec)
    const cached = await this.redis.get(`${key}:data`)
    if (cached) return (JSON.parse(cached) as { offers: NormalisedOffer[] }).offers
    const neg = await this.redis.get(`${key}:neg`)
    if (neg) throw new SupplierError((JSON.parse(neg) as { code: SupplierError["code"] }).code, "The indicative source has no data for this leg right now")
    const searchId = ctx.searchId
    if (!searchId) throw new SupplierError("SUPPLIER_UNAVAILABLE", "The indicative source is only searched on behalf of a search")
    // Popular-route listing searches read what the batched warm fetched and never start a paid customer run (ADR-0032 B3).
    if (await this.redis.exists(`search:${searchId}:cache-only`)) throw new SupplierError("NO_AVAILABILITY", "Cache-only search: no indicative data for this leg")
    const pending = `apify:pending:${searchId}`
    const member = JSON.stringify(spec)
    if ((await this.redis.scard(pending)) >= m.maxLegsPerSearch && !(await this.redis.sismember(pending, member))) throw new SupplierError("NO_AVAILABILITY", "Per-search cap on indicative legs reached")
    await this.redis.sadd(pending, member)
    await this.redis.sadd(`${key}:waiters`, searchId)
    await this.redis.expire(pending, 3600)
    await this.redis.expire(`${key}:waiters`, 3600)
    if ((await this.redis.set(`apify:start:${searchId}`, "1", "PX", 600_000, "NX")) === "OK") {
      await this.queues.get("maintenance").add("flights.apify.start", { searchId }, { delay: 300, jobId: `apify-start-${searchId}-${Date.now()}` })
    }
    throw new SupplierError("SUPPLIER_PENDING", "The indicative source is being fetched; the search will be updated")
  }

  // ---------------- budget ----------------

  private ledgerKey(pool: Pool | "total") {
    return `apify:ledger:${month()}:${pool}`
  }

  private async spent(pool: Pool | "total") {
    return Number((await this.redis.get(this.ledgerKey(pool))) ?? 0)
  }

  private caps(m: ProviderMetering, pool: Pool) {
    // Customers and prewarm never spend into the staff reserve; staff may use the whole month.
    return { pool: usd(m.monthlyBudgetUsd * m.poolSplit[pool]), total: usd(pool === "staff" ? m.monthlyBudgetUsd : m.monthlyBudgetUsd - m.staffReserveUsd) }
  }

  /** Reserves the worst-case cost of a run. Increments first and rolls back on overrun, so concurrent callers cannot overspend. */
  async reserve(pool: Pool, cost: number, m: ProviderMetering): Promise<boolean> {
    const c = this.caps(m, pool)
    const inPool = Number(await this.redis.incrbyfloat(this.ledgerKey(pool), cost))
    const inTotal = Number(await this.redis.incrbyfloat(this.ledgerKey("total"), cost))
    if (inPool > c.pool + 1e-9 || inTotal > c.total + 1e-9) {
      await this.redis.incrbyfloat(this.ledgerKey(pool), -cost)
      await this.redis.incrbyfloat(this.ledgerKey("total"), -cost)
      return false
    }
    for (const k of [this.ledgerKey(pool), this.ledgerKey("total")]) await this.redis.expire(k, 40 * 86400)
    return true
  }

  private async adjust(pool: Pool, delta: number) {
    if (Math.abs(delta) < 1e-9) return
    await this.redis.incrbyfloat(this.ledgerKey(pool), delta)
    await this.redis.incrbyfloat(this.ledgerKey("total"), delta)
  }

  private runCost(routes: number, maxResults: number) {
    return usd(routes * maxResults * ROW_USD + RUN_START_USD)
  }

  /** How many typical customer runs the customer pool can still pay for; the engine planner drops calls beyond this. */
  private async customerRunsAffordable(): Promise<number> {
    const m = await this.metering()
    const c = this.caps(m, "customer")
    const room = Math.min(c.pool - (await this.spent("customer")), c.total - (await this.spent("total")))
    return Math.max(0, Math.floor(room / this.runCost(1, m.maxResultsCustomer)))
  }

  private async hourlyRuns() {
    return Number((await this.redis.get(`apify:runs:${hourSlot()}`)) ?? 0)
  }

  // ---------------- start job ----------------

  /** Worker job: one run per search (per distinct passenger/cabin signature) for every leg that is not cached or in flight. */
  async startSearchRuns(searchId: string): Promise<{ runs: number; skipped: number }> {
    const pending = `apify:pending:${searchId}`
    const specs = (await this.redis.smembers(pending)).map((x) => JSON.parse(x) as LegSpec)
    await this.redis.del(pending, `apify:start:${searchId}`)
    if (!specs.length) return { runs: 0, skipped: 0 }
    const m = await this.metering()
    const row = await this.suppliers.row(APIFY_ID)
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    const refused = !row || !token ? "SUPPLIER_AUTH" : (await this.suppliers.credentialInvalid(APIFY_ID)) ? "SUPPLIER_AUTH" : null
    const todo: LegSpec[] = []
    const wakeNow: string[] = []
    for (const spec of specs) {
      const key = this.legKey(spec)
      if (refused) { await this.setNegative(key, refused); wakeNow.push(key); continue }
      if ((await this.redis.exists(`${key}:data`)) || (await this.redis.exists(`${key}:neg`))) { wakeNow.push(key); continue }
      // Single-flight: the first search to take the lock starts the run; the others stay in the waiter set and are woken by its collect job.
      if ((await this.redis.set(`${key}:lock`, searchId, "PX", RUN_DEADLINE_MS + 60_000, "NX")) !== "OK") continue
      todo.push(spec)
    }
    const groups = new Map<string, LegSpec[]>()
    for (const s of todo) groups.set(sha(s.shared), [...(groups.get(sha(s.shared)) ?? []), s])
    let runs = 0
    for (const group of groups.values()) if (await this.launch(group, "customer", "SEARCH", m, token!, searchId)) runs++
    if (wakeNow.length) await this.wake(wakeNow, `s${Date.now()}`)
    return { runs, skipped: specs.length - todo.length }
  }

  /** Creates the run row, enforces the guards and starts the actor. Returns false when the run was declined or failed to start. */
  private async launch(legs: LegSpec[], pool: Pool, purpose: "SEARCH" | "RECHECK" | "PREWARM", m: ProviderMetering, token: string, searchId: string | null, result?: Record<string, unknown>): Promise<{ id: string } | null> {
    const maxResults = pool === "staff" ? m.maxResultsStaff : pool === "prewarm" ? m.maxResultsPrewarm : m.maxResultsCustomer
    const input: ApifyInput = { routes: legs.map((l) => l.route), maxResults, ...legs[0]!.shared }
    const cost = this.runCost(legs.length, maxResults)
    const legKeys = legs.map((l) => this.legKey(l))
    const base = { providerId: APIFY_ID, pool, purpose, searchId, routes: input.routes, input: input as unknown as Record<string, unknown>, legKeys, result: result ?? null }
    let decline: string | null = null
    if (pool === "customer") {
      const used = Number(await this.redis.incr(`apify:runs:${hourSlot()}`))
      await this.redis.expire(`apify:runs:${hourSlot()}`, 2 * 3600)
      if (used > m.customerRunsPerHour) { await this.redis.decr(`apify:runs:${hourSlot()}`); decline = "HOURLY_CAP" }
    }
    if (!decline && !(await this.reserve(pool, cost, m))) decline = "POOL_EMPTY"
    if (decline) {
      await this.db.insert(providerRuns).values({ ...base, status: "DECLINED", errors: [decline], finishedAt: new Date() })
      await this.release(legKeys, purpose === "SEARCH" ? "SUPPLIER_RATE_LIMITED" : null)
      return null
    }
    const [run] = await this.db.insert(providerRuns).values({ ...base, status: "QUEUED", reservedUsd: String(cost) }).returning()
    try {
      const started = await new ApifyClient(token).startRun(input, cost)
      await this.db.update(providerRuns).set({ externalRunId: started.id, status: "RUNNING", startedAt: new Date() }).where(eq(providerRuns.id, run!.id))
      await this.queues.get("maintenance").add("flights.apify.collect", { runId: run!.id, attempt: 1 }, { delay: 4000, jobId: `apify-collect-${run!.id}-1` })
      return { id: run!.id }
    } catch (err) {
      const e = err instanceof SupplierError ? err : new SupplierError("SUPPLIER_UNKNOWN", String(err))
      if (e.code === "SUPPLIER_AUTH") await this.suppliers.markCredentialInvalid(APIFY_ID)
      await this.adjust(pool, -cost)
      await this.db.update(providerRuns).set({ status: "FAILED", errors: [`${e.code}: ${e.message}`], finishedAt: new Date(), reservedUsd: "0" }).where(eq(providerRuns.id, run!.id))
      await this.release(legKeys, purpose === "SEARCH" ? e.code : null)
      return null
    }
  }

  private async setNegative(key: string, code: SupplierError["code"]) {
    await this.redis.set(`${key}:neg`, JSON.stringify({ code }), "EX", NEGATIVE_TTL_S)
  }

  /** Drops the single-flight locks and remembers the failure briefly, so woken searches do not start the same run again. */
  private async release(keys: string[], code: SupplierError["code"] | null) {
    for (const key of keys) {
      if (code) await this.setNegative(key, code)
      await this.redis.del(`${key}:lock`)
    }
    await this.wake(keys, `f${Date.now()}`)
  }

  /** Re-runs every search that was waiting for these legs. */
  private async wake(keys: string[], tag: string, filter: (searchId: string) => boolean = () => true) {
    const ids = new Set<string>()
    for (const key of keys) {
      for (const id of await this.redis.smembers(`${key}:waiters`)) if (filter(id)) ids.add(id)
      await this.redis.del(`${key}:waiters`)
    }
    for (const id of ids) await this.rerun(id, tag)
  }

  private async rerun(searchId: string, tag: string) {
    // A search that keeps missing data is not re-run forever.
    const n = await this.redis.incr(`apify:reruns:${searchId}`)
    await this.redis.expire(`apify:reruns:${searchId}`, 3600)
    if (n > MAX_RERUNS) return
    await this.queues.get("search.execute").add("search", { searchId, rerun: true }, { jobId: `search-${searchId}-apify-${tag}` })
  }

  // ---------------- collect job ----------------

  /** Worker job: one poll step; re-queues itself while the actor runs (the maintenance queue has concurrency 1, so it never blocks). */
  async collect(data: { runId: string; attempt: number }) {
    const [run] = await this.db.select().from(providerRuns).where(eq(providerRuns.id, data.runId))
    if (!run || run.status !== "RUNNING" || !run.externalRunId) return { skipped: true }
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    if (!token) return this.fail(run, "FAILED", "SUPPLIER_AUTH", "credential missing")
    const client = new ApifyClient(token)
    try {
      const st = await client.runStatus(run.externalRunId)
      if (st.status === "READY" || st.status === "RUNNING") {
        if (Date.now() - (run.startedAt?.getTime() ?? Date.now()) > RUN_DEADLINE_MS) return this.fail(run, "TIMED-OUT", "SUPPLIER_TIMEOUT", "no result within 300 s")
        const delay = Math.min(15_000, Math.round(2000 * 1.5 ** data.attempt))
        await this.queues.get("maintenance").add("flights.apify.collect", { runId: run.id, attempt: data.attempt + 1 }, { delay, jobId: `apify-collect-${run.id}-${data.attempt + 1}` })
        return { polling: true }
      }
      if (st.status !== "SUCCEEDED") return this.fail(run, st.status, "SUPPLIER_UNAVAILABLE", `run ${st.status}`)
      return this.succeed(run, await client.items(st.defaultDatasetId))
    } catch (err) {
      const e = err instanceof SupplierError ? err : new SupplierError("SUPPLIER_UNKNOWN", String(err))
      if (e.code === "SUPPLIER_AUTH") await this.suppliers.markCredentialInvalid(APIFY_ID)
      // A transient poll error is retried until the run deadline; anything else ends the run.
      const transient = e.code === "SUPPLIER_TIMEOUT" || e.code === "SUPPLIER_UNAVAILABLE"
      if (transient && Date.now() - (run.startedAt?.getTime() ?? Date.now()) < RUN_DEADLINE_MS) {
        await this.queues.get("maintenance").add("flights.apify.collect", { runId: run.id, attempt: data.attempt + 1 }, { delay: 5000, jobId: `apify-collect-${run.id}-${data.attempt + 1}` })
        return { retrying: true }
      }
      return this.fail(run, "FAILED", e.code, e.message)
    }
  }

  private async fail(run: RunRow, status: "FAILED" | "TIMED-OUT" | "ABORTED", code: SupplierError["code"], message: string) {
    // The run start fee is charged even when the run fails; rows already produced are billed too but unknown, so only the fee is assumed.
    await this.adjust(run.pool, RUN_START_USD - Number(run.reservedUsd))
    await this.db.update(providerRuns).set({ status, errors: [...run.errors, `${code}: ${message}`], estimatedUsd: String(RUN_START_USD), finishedAt: new Date() }).where(eq(providerRuns.id, run.id))
    if (run.purpose === "RECHECK") await this.db.update(providerRuns).set({ result: { ...(run.result ?? {}), error: message } }).where(eq(providerRuns.id, run.id))
    // A failed staff recheck must not hide the route from customers.
    await this.release(run.legKeys, run.purpose === "SEARCH" ? code : null)
    return { failed: code }
  }

  private async succeed(run: RunRow, items: Record<string, unknown>[]) {
    const m = await this.metering()
    const fetchedAt = new Date()
    const payloadKey = `${fetchedAt.toISOString().slice(0, 10)}/${APIFY_ID}/${run.id}.json.gz`
    void this.storage.putCallPayload(payloadKey, items)
    const normalised = normaliseRows(items, { reference: this.reference.lookup(), fetchedAt, ttlSeconds: m.cacheTtlSeconds })
    const routes = run.routes
    const perLeg = routes.map(() => [] as NormalisedOffer[])
    for (const o of normalised.offers) {
      const seg = o.slices[0]!
      const i = routes.findIndex((r) => r.origin === (o.slices[0]!.segments[0]!.origin.iata) && r.destination === seg.destination && r.departureDate === seg.segments[0]!.departure.local.slice(0, 10))
      if (i >= 0) perLeg[i]!.push(o)
      else normalised.notices.push(`UNREQUESTED_ROUTE ${seg.origin}-${seg.destination}`)
    }
    // Every requested leg is cached, an empty result included, so a route without flights is not paid for again (ADR-0029 A6).
    for (const [i, key] of run.legKeys.entries()) await this.redis.set(`${key}:data`, JSON.stringify({ fetchedAt: fetchedAt.toISOString(), offers: perLeg[i] }), "EX", m.cacheTtlSeconds)
    const billable = items.filter((r) => r.type !== "notice" && r.type !== "error").length
    const cost = usd(billable * ROW_USD + RUN_START_USD)
    await this.adjust(run.pool, cost - Number(run.reservedUsd))
    // The itinerary id stays on the row so the status poll can check that the job belongs to the itinerary asked about.
    const result = run.purpose === "RECHECK" ? { ...this.recheckResult(run, perLeg.flat(), fetchedAt), itineraryId: (run.result as { itineraryId: string }).itineraryId } : run.result
    await this.db.update(providerRuns).set({ status: "SUCCEEDED", rows: billable, estimatedUsd: String(cost), notices: normalised.notices, errors: normalised.errors, payloadKey, result, finishedAt: fetchedAt }).where(eq(providerRuns.id, run.id))
    await this.release(run.legKeys, null)
    // The listings worker turns the warmed legs into stored, requestable search results (ADR-0032 B3, B5).
    if (run.purpose === "PREWARM") await this.queues.get("maintenance").add("listings.prewarmed", { routes }, { jobId: `listings-prewarmed-${run.id}` })
    return { rows: billable, offers: normalised.offers.length }
  }

  // ---------------- popular-route warm (ADR-0032 B3) ----------------

  /**
   * One prewarm-pool run for every leg that is neither cached nor in flight. Legs already cached are returned so the caller
   * can list them straight away; the rest are announced by `listings.prewarmed` when the run is collected.
   */
  async prewarm(routes: ApifyRoute[], q: Pick<SliceQuery, "passengers" | "cabin" | "maxConnections">): Promise<{ runId: string | null; cached: ApifyRoute[]; reason?: "CREDENTIAL" | "IN_FLIGHT" | "DECLINED" }> {
    const m = await this.metering()
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    if (!token || (await this.suppliers.credentialInvalid(APIFY_ID))) return { runId: null, cached: [], reason: "CREDENTIAL" }
    const cached: ApifyRoute[] = []
    const todo: LegSpec[] = []
    for (const route of routes) {
      const spec = this.specFor(route, q.passengers, q.cabin, q.maxConnections, m)
      const key = this.legKey(spec)
      if (await this.redis.exists(`${key}:data`)) { cached.push(route); continue }
      if ((await this.redis.set(`${key}:lock`, "prewarm", "PX", RUN_DEADLINE_MS + 60_000, "NX")) !== "OK") continue
      todo.push(spec)
    }
    if (!todo.length) return { runId: null, cached, reason: cached.length ? undefined : "IN_FLIGHT" }
    const started = await this.launch(todo, "prewarm", "PREWARM", m, token, null)
    return started ? { runId: started.id, cached } : { runId: null, cached, reason: "DECLINED" }
  }

  // ---------------- staff recheck (ADR-0029 A7) ----------------

  /** Starts a staff-pool run for the indicative components of an itinerary; the console polls `recheckStatus`. */
  async startRecheck(itinerary: Itinerary, query: SearchQuery): Promise<RecheckStart> {
    const comps = itinerary.components.filter((c) => c.source.provider === APIFY_ID)
    if (!comps.length) throw new AppError("VALIDATION_FAILED", "This itinerary has no indicative component to recheck")
    const m = await this.metering()
    if (await this.suppliers.credentialInvalid(APIFY_ID)) throw new AppError("SUPPLIER_UNAVAILABLE", "The Apify credential was rejected; replace it in the Developer Panel")
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    if (!token) throw new AppError("SUPPLIER_UNAVAILABLE", "The Apify credential is not set")
    const legs = comps.map((c) => {
      const s = c.slices[0]!
      return this.specFor({ origin: s.origin, destination: s.destination, departureDate: s.segments[0]!.departure.local.slice(0, 10) }, query.passengers, query.cabin, 3, m)
    })
    const keys = legs.map((l) => this.legKey(l))
    for (const k of keys) if ((await this.redis.set(`${k}:lock`, "recheck", "PX", RUN_DEADLINE_MS + 60_000, "NX")) !== "OK") throw new AppError("VERSION_CONFLICT", "A run for this route is already in progress; try again in a minute")
    const result = { itineraryId: itinerary.id, components: comps.map((c) => ({ providerOfferId: c.source.providerOfferId, old: c.price.total })) }
    const started = await this.launch(legs, "staff", "RECHECK", m, token, null, result)
    if (!started) throw new AppError("RATE_LIMITED", "The staff budget for this month is used up")
    return { jobId: started.id, status: "PENDING" }
  }

  private recheckResult(run: RunRow, offers: NormalisedOffer[], fetchedAt: Date): RecheckResult {
    const comps = (run.result as { components: { providerOfferId: string; old: Money }[] }).components
    const parts = comps.map((c) => {
      const found = offers.find((o) => o.source.providerOfferId === c.providerOfferId)
      return { providerOfferId: c.providerOfferId, stillListed: !!found, old: c.old, new: found?.price.total ?? null }
    })
    const stillListed = parts.every((p) => p.stillListed)
    const cur = parts[0]!.old.currency
    const sum = (xs: (Money | null)[]) => (xs.every((x): x is Money => !!x && x.currency === cur) ? { amountMinor: xs.reduce((s, x) => s + x.amountMinor, 0), currency: cur } : null)
    const oldTotal = sum(parts.map((p) => p.old))
    const newTotal = stillListed ? sum(parts.map((p) => p.new)) : null
    return { stillListed, priceChanged: !!oldTotal && !!newTotal && oldTotal.amountMinor !== newTotal.amountMinor, old: oldTotal, new: newTotal, fetchedAt: fetchedAt.toISOString(), components: parts }
  }

  async recheckStatus(itineraryId: string, jobId: string): Promise<RecheckStatus> {
    const [run] = await this.db.select().from(providerRuns).where(eq(providerRuns.id, jobId))
    const meta = run?.result as { itineraryId?: string; error?: string } | null
    if (!run || run.purpose !== "RECHECK" || meta?.itineraryId !== itineraryId) throw new AppError("NOT_FOUND")
    if (run.status === "QUEUED" || run.status === "RUNNING") return { jobId, status: "PENDING" }
    if (run.status === "SUCCEEDED") {
      const { itineraryId: _owner, ...result } = run.result as unknown as RecheckResult & { itineraryId: string }
      return { jobId, status: "DONE", result }
    }
    return { jobId, status: "FAILED", error: meta?.error ?? run.errors[0] ?? run.status }
  }

  // ---------------- developer panel ----------------

  async runs(limit: number): Promise<ProviderRunView[]> {
    const rows = await this.db.select().from(providerRuns).where(eq(providerRuns.providerId, APIFY_ID)).orderBy(desc(providerRuns.createdAt)).limit(limit)
    return rows.map((r) => ({
      id: r.id, provider: APIFY_ID, externalRunId: r.externalRunId, pool: r.pool, purpose: r.purpose, searchId: r.searchId, routes: r.routes as ProviderRunView["routes"], status: r.status,
      rows: r.rows, estimatedUsd: Number(r.estimatedUsd), notices: r.notices, errors: r.errors, startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    }))
  }

  async usage(): Promise<ProviderUsageView> {
    const m = await this.metering()
    const meta = await this.suppliers.credentialMeta(APIFY_ID)
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    let apify: ProviderUsageView["apify"] = null
    let apifyError: string | null = null
    if (token && !meta?.invalidAt) {
      try {
        const l = await new ApifyClient(token).limits()
        apify = { cycle: l.cycle, maxMonthlyUsageUsd: l.maxMonthlyUsageUsd, monthlyUsageUsd: l.monthlyUsageUsd }
      } catch (e) {
        apifyError = e instanceof SupplierError ? e.code : "SUPPLIER_UNKNOWN"
        if (e instanceof SupplierError && e.code === "SUPPLIER_AUTH") await this.suppliers.markCredentialInvalid(APIFY_ID)
      }
    }
    const pool = async (p: Pool) => {
      const budgetUsd = this.caps(m, p).pool
      const spentUsd = usd(await this.spent(p))
      return { budgetUsd, spentUsd, remainingUsd: usd(Math.max(0, budgetUsd - spentUsd)) }
    }
    const customer = await pool("customer")
    const reconciled = await this.redis.get("apify:reconciled")
    const invalidAt = (await this.suppliers.credentialMeta(APIFY_ID))?.invalidAt ?? null
    return {
      provider: APIFY_ID, month: month(), credential: { set: !!meta, invalidAt: invalidAt?.toISOString() ?? null }, apify, apifyError,
      ledger: { budgetUsd: m.monthlyBudgetUsd, staffReserveUsd: m.staffReserveUsd, totalSpentUsd: usd(await this.spent("total")), pools: { customer, prewarm: await pool("prewarm"), staff: await pool("staff") }, customerRunsThisHour: await this.hourlyRuns(), customerRunsPerHour: m.customerRunsPerHour },
      banner: !meta ? "CREDENTIAL_MISSING" : invalidAt ? "CREDENTIAL_INVALID" : customer.remainingUsd < this.runCost(1, m.maxResultsCustomer) ? "CUSTOMER_POOL_EMPTY" : "NONE",
      reconciledAt: reconciled ? (JSON.parse(reconciled) as { at: string }).at : null,
    }
  }

  /**
   * ADR-0032 B2 "Test connection": Apify's free `/users/me/limits` with the stored token. A 401/403 marks the credential invalid
   * like any other call and answers SUPPLIER_AUTH. `/limits` carries no plan name, so `plan` stays null (UNKNOWN).
   */
  async testConnection(): Promise<DevApifyTestResult> {
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    if (!token) throw new AppError("NOT_CONFIGURED", "The Apify credential is not set")
    const testedAt = new Date()
    try {
      const l = await new ApifyClient(token).limits()
      await this.suppliers.markTested(APIFY_ID, testedAt)
      return { plan: null, monthlyUsageUsd: l.monthlyUsageUsd, monthlyLimitUsd: l.maxMonthlyUsageUsd, cycleStart: l.cycle, cycleEnd: l.cycleEnd, testedAt: testedAt.toISOString() }
    } catch (e) {
      await this.suppliers.markTested(APIFY_ID, testedAt)
      const err = e instanceof SupplierError ? e : new SupplierError("SUPPLIER_UNKNOWN", "Apify test failed")
      if (err.code === "SUPPLIER_AUTH") {
        await this.suppliers.markCredentialInvalid(APIFY_ID)
        throw new AppError("SUPPLIER_AUTH", "Apify rejected the stored token; replace it")
      }
      throw new AppError("SUPPLIER_UNAVAILABLE", `Apify test failed: ${err.code}`)
    }
  }

  /** Daily: Apify's own usage is the floor of our ledger, so an estimate that drifted low cannot hide real spend. */
  async reconcile() {
    const token = (await this.suppliers.credentials(APIFY_ID))?.token
    if (!token || (await this.suppliers.credentialInvalid(APIFY_ID))) return { skipped: true }
    const l = await new ApifyClient(token).limits()
    const ours = await this.spent("total")
    if (l.monthlyUsageUsd !== null && l.monthlyUsageUsd > ours) await this.redis.incrbyfloat(this.ledgerKey("total"), l.monthlyUsageUsd - ours)
    await this.redis.set("apify:reconciled", JSON.stringify({ at: new Date().toISOString(), apifyUsd: l.monthlyUsageUsd, ledgerUsd: ours }), "EX", 40 * 86400)
    return { apifyUsd: l.monthlyUsageUsd, ledgerUsd: ours }
  }
}
