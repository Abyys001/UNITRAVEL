import { createHash } from "node:crypto"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import type { Job } from "bullmq"
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import type { CatalogSettings, RecheckStart, RecheckStatus, UsagePurpose } from "@unitravel/contracts"
import { catalogSlots, type Db, flightResultLegs, flightResultPricing, flightResults, flightWatchlistRoutes, providerRuns, providerUsageLedger } from "@unitravel/db"
import { adminRunCap, APIFY_ROW_USD, APIFY_START_USD, FLIGHTAPI_CREDITS_PER_CALL, type PacerRoute, type PacerSlot, selectFlightapiSlots, selectRun } from "@unitravel/engine"

import { env } from "../../core/env"
import { AppError } from "../../core/errors"
import { randomToken } from "../../core/crypto"
import { DB, REDIS } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { ObjectStorage } from "../../core/storage"
import { PROCESS_ROLE, type ProcessRole, WorkerRegistry } from "../../core/workers"
import { ComplianceService } from "../compliance/compliance.service"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { SupplierError } from "../suppliers/adapter"
import { APIFY_ACTOR_BUILD, APIFY_COST_OFF_FIELDS, APIFY_PROVIDER_ID, ApifyClient, type ApifyInput, type ApifyRun } from "../suppliers/adapters/apify/client"
import { normaliseRows } from "../suppliers/adapters/apify/normalise"
import { FLIGHTAPI_PROVIDER_ID, FlightapiClient } from "../suppliers/adapters/flightapi/client"
import { normaliseResponse } from "../suppliers/adapters/flightapi/normalise"
import { SuppliersService } from "../suppliers/suppliers.service"
import { CatalogBudgetService } from "./catalog-budget.service"
import { bumpDemand, DEMAND_REQUEST } from "./catalog-read.service"
import { CatalogSettingsService, type PauseReason } from "./catalog-settings.service"
import { CatalogWriteService } from "./catalog-write.service"

export const LOCK_KEY = "catalog:refresh:lock"
const LOCK_TTL_MS = 15 * 60_000
const POLL_MS = 15_000
const RUN_DEADLINE_MS = 10 * 60_000
const RETRY_DELAY_MS = 10 * 60_000
const CIRCUIT_PAUSE_MS = 2 * 3_600_000
const CIRCUIT_AFTER = 3
const OFFER_TTL_S = 30 * 86_400
const DAY = 86_400_000

type RouteRow = typeof flightWatchlistRoutes.$inferSelect
type SlotRow = typeof catalogSlots.$inferSelect
type LedgerRow = typeof providerUsageLedger.$inferSelect

export const JOBS = {
  tick: "catalog.refresh.tick", collect: "catalog.refresh.collect", roll: "catalog.slots.roll", fold: "catalog.demand.fold", reconcile: "catalog.reconcile",
  schema: "catalog.schema.check", requestSubmitted: "flight_request.submitted", rebuild: "catalog.snapshots.rebuild", slotUpdated: "catalog.slot_updated", policyActivated: "compliance.policy_activated",
} as const

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
const usd = (n: number) => Math.round(n * 1e6) / 1e6
const fingerprint = (secret: string) => createHash("sha256").update(secret).digest("hex").slice(0, 16)

const toPacerSlot = (s: SlotRow): PacerSlot => ({
  id: s.id, routeId: s.routeId, departureDate: s.departureDate, lastFetchedAt: s.lastFetchedAt, recentCounts: s.recentCounts,
  consecutiveEmpty: s.consecutiveEmpty, consecutiveErrors: s.consecutiveErrors, lastErrorAt: s.lastErrorAt, demandScore: s.demandScore,
})

/** How a failed run is handled (spec §9). */
type Failure = "AUTH" | "BUDGET" | "TRANSIENT" | "OTHER"
const classify = (err: unknown): Failure => {
  const e = err instanceof SupplierError ? err : null
  if (e?.code === "SUPPLIER_AUTH") return "AUTH"
  // Apify answers 402 when the account's usage limit is reached; a plain 429 is a rate limit that passes.
  if (e?.code === "SUPPLIER_RATE_LIMITED") return /usage|limit|payment|credit/i.test(e.raw ?? "") ? "BUDGET" : "TRANSIENT"
  if (e && (e.code === "SUPPLIER_TIMEOUT" || e.code === "SUPPLIER_UNAVAILABLE")) return "TRANSIENT"
  return "OTHER"
}

/** One FlightAPI call: a slot's route and date. */
interface FlightapiJob { slotId: string; departureDate: string; origin: string; destination: string; maxResults: number }
type Meta = { resultId?: string; old?: { amountMinor: number; currency: string } | null }

interface RunSpec {
  purpose: UsagePurpose
  slots: Pick<SlotRow, "id" | "departureDate">[]
  routeOf: (slotId: string) => Pick<RouteRow, "origin" | "destination">
  maxResults: number
  estUsd: number
  maxTotalChargeUsd: number
  lock: string
  /** Stored on the run row; the revalidation status route reads it back. */
  meta?: Record<string, unknown>
  retryOf?: string
}

/**
 * ADR-0034: the pacer. One refresh run at a time under the Redis lock; each tick may spend `available / ticksLeft` of what is left of
 * the Apify billing cycle (see `tickBudget`). Admin runs (refresh now, revalidate) take the same lock and draw on the reserve.
 */
@Injectable()
export class CatalogRefreshService implements OnModuleInit {
  private readonly log = new Logger("CatalogRefresh")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PROCESS_ROLE) private readonly role: ProcessRole,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
    private readonly cfg: CatalogSettingsService,
    private readonly budget: CatalogBudgetService,
    private readonly write: CatalogWriteService,
    private readonly suppliers: SuppliersService,
    private readonly reference: ReferenceService,
    private readonly compliance: ComplianceService,
    private readonly outbox: OutboxService,
    private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit() {
    const reg = (name: string, fn: (job: Job) => Promise<unknown>) => this.workers.registerJob("catalog", name, fn)
    reg(JOBS.tick, (j) => this.tick(j.data as TickData))
    reg(JOBS.collect, (j) => this.collect(j.data as CollectData))
    reg(JOBS.roll, () => this.rollSlots())
    reg(JOBS.fold, () => this.foldDemand())
    reg(JOBS.reconcile, () => this.reconcile())
    reg(JOBS.schema, () => this.schemaCheck())
    reg(JOBS.rebuild, () => this.write.rebuildAll())
    reg(JOBS.policyActivated, () => this.write.rebuildAll())
    reg(JOBS.requestSubmitted, (j) => this.countRequest(j.data as { payload?: { route?: { from: string; to: string; date: string } } }))
    reg(JOBS.slotUpdated, (j) => this.purgeWeb(((j.data as { payload?: { slotId?: string } }).payload?.slotId) ?? ""))
    await this.schedule().catch((err) => this.log.warn({ err: String(err) }, "catalog schedulers not registered"))
    // Worker start: one catch-up tick (respects the lock, the floor and the one-tick budget) and a slot roll so a long outage leaves no gaps.
    if (this.role === "worker") {
      await this.queues.get("catalog").add(JOBS.roll, {}, { jobId: `catalog-roll-boot-${Date.now()}` }).catch(() => undefined)
      await this.queues.get("catalog").add(JOBS.tick, { catchup: true }, { jobId: `catalog-tick-boot-${Date.now()}`, delay: 5_000 }).catch(() => undefined)
    }
  }

  /** Re-registers the schedulers; called at start-up and when `refreshTicksPerDay` changes. */
  async schedule() {
    const s = await this.cfg.get()
    const q = this.queues.get("catalog")
    await q.upsertJobScheduler("catalog-refresh-tick", { every: Math.round(DAY / s.refreshTicksPerDay) }, { name: JOBS.tick, data: {} })
    await q.upsertJobScheduler("catalog-slots-roll", { every: DAY }, { name: JOBS.roll })
    await q.upsertJobScheduler("catalog-demand-fold", { every: 3_600_000 }, { name: JOBS.fold })
    await q.upsertJobScheduler("catalog-reconcile", { pattern: "0 3 * * *", tz: "UTC" }, { name: JOBS.reconcile })
    await q.upsertJobScheduler("catalog-schema-check", { pattern: "0 4 * * 1", tz: "UTC" }, { name: JOBS.schema })
  }

  // ---------------- lock ----------------

  async takeLock(token: string): Promise<boolean> {
    return (await this.redis.set(LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX")) === "OK"
  }

  async renewLock(token: string) {
    if ((await this.redis.get(LOCK_KEY)) === token) await this.redis.pexpire(LOCK_KEY, LOCK_TTL_MS)
  }

  async releaseLock(token: string) {
    // Compare-and-delete: a lock that expired and was taken by another run is never released by the first.
    await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK_KEY, token)
  }

  private async token(): Promise<string | null> {
    if (await this.suppliers.credentialInvalid(APIFY_PROVIDER_ID)) return null
    return (await this.suppliers.credentials(APIFY_PROVIDER_ID))?.token ?? null
  }

  /** ADR-0035: the FlightAPI key is an environment secret; it is never stored, logged or echoed. */
  protected flightapiKey(): string | null {
    return env().FLIGHTAPI_KEY ?? null
  }

  /** A pause for a rejected credential ends when the credential changes: Apify through the store, FlightAPI by the key's fingerprint. */
  private async authRecovered(s: CatalogSettings, pause: NonNullable<Awaited<ReturnType<CatalogSettingsService["state"]>>["pause"]>): Promise<boolean> {
    if (s.source !== "flightapi") return !!(await this.token())
    const key = this.flightapiKey()
    return !!key && fingerprint(key) !== pause.key
  }

  // ---------------- alerts and pauses ----------------

  /** Developers get the existing provider-health notification (`provider.health_changed`). */
  async alert(circuit: string, detail: string) {
    await this.outbox.add(this.db, { aggregateType: "provider", aggregateId: APIFY_PROVIDER_ID, eventType: "provider.health_changed", payload: { provider: "flight catalog", circuit, detail } })
  }

  private async pauseSystem(reason: PauseReason, until: Date | null, detail: string, key?: string) {
    const st = await this.cfg.state()
    const same = st.pause?.reason === reason
    await this.cfg.updateState(() => ({ pause: { reason, until: until?.toISOString() ?? null, at: new Date().toISOString(), detail, ...(key ? { key } : {}) } }))
    if (!same) await this.alert(reason, `Catalog refreshes paused (${reason}): ${detail}`)
    this.log.warn({ reason, until: until?.toISOString(), detail }, "catalog refreshes paused")
  }

  // ---------------- tick ----------------

  async tick(data: TickData = {}): Promise<Record<string, unknown>> {
    const s = await this.cfg.get()
    const now = new Date()
    const state = await this.cfg.state()
    if (s.paused) return { skipped: "PAUSED" }
    if (state.pause) {
      const ended = state.pause.reason === "AUTH" ? await this.authRecovered(s, state.pause) : !!state.pause.until && Date.parse(state.pause.until) <= now.getTime()
      if (!ended) return { skipped: state.pause.reason }
      await this.cfg.updateState(() => ({ pause: null, failedTicks: state.pause?.reason === "CIRCUIT" ? 0 : state.failedTicks }))
    }
    // A restart is not a reason to spend a second tick's budget (spec §9: no burst spending to "catch up").
    if (data.catchup && state.lastTick && now.getTime() - Date.parse(state.lastTick.at) < (DAY / s.refreshTicksPerDay)) return { skipped: "RECENT_TICK" }
    const lock = randomToken(12)
    if (!(await this.takeLock(lock))) return { skipped: "LOCKED" }
    let started = false
    try {
      await this.sweepStale()
      if (s.source === "flightapi") return await this.tickFlightapi(s, now, lock)
      const token = await this.token()
      if (!token) {
        await this.pauseSystem("AUTH", null, "the Apify credential is missing or was rejected")
        return { skipped: "AUTH" }
      }
      const { spend, budget } = await this.budget.budget(s, { now })
      this.log.log({ tickBudgetUsd: budget.tickBudgetUsd, availableUsd: budget.availableUsd, spentUsd: spend.spentUsd, spentSource: spend.spentSource, ticksLeft: budget.ticksLeft, reserveReleased: budget.reserveReleased, cycleEnd: spend.cycleEnd.toISOString() }, "catalog tick")
      if (budget.paused) {
        // Budget used: pause until the cycle that resets it begins; resumes by itself once that time passes.
        await this.pauseSystem("BUDGET", spend.cycleEnd, `budget used (spent ${spend.spentUsd.toFixed(3)} of ${s.monthlyBudgetUsd}); resumes ${spend.cycleEnd.toISOString()}`)
        await this.recordTick("BUDGET_EXHAUSTED", budget.tickBudgetUsd, 0)
        return { skipped: "BUDGET" }
      }
      const { slots, routes } = await this.dueSlots(now, data.retry?.slotIds)
      const plan = selectRun(slots, new Map(routes.map((r) => [r.id, { id: r.id, enabled: r.enabled, maxResults: r.maxResults, priorityWeight: r.priorityWeight } satisfies PacerRoute])), s, budget, now)
      if (!plan) {
        await this.recordTick("NOTHING_DUE", budget.tickBudgetUsd, 0)
        return { skipped: "NOTHING_DUE", tickBudgetUsd: budget.tickBudgetUsd }
      }
      const rowOf = new Map(slots.map((sl) => [sl.id, sl]))
      const routeOfSlot = (id: string) => routes.find((r) => r.id === rowOf.get(id)!.routeId)!
      const started_ = await this.startRun(token, s, {
        purpose: "refresh", slots: plan.slots.map((sl) => ({ id: sl.id, departureDate: sl.departureDate })), routeOf: routeOfSlot, maxResults: plan.maxResults,
        estUsd: plan.estUsd, maxTotalChargeUsd: plan.maxTotalChargeUsd, lock, retryOf: data.retry?.ledgerId,
      })
      started = started_.ok
      await this.recordTick(started_.ok ? "RUN_STARTED" : `START_FAILED:${started_.failure}`, budget.tickBudgetUsd, plan.slots.length)
      return { started: started_.ok, slots: plan.slots.length, estUsd: plan.estUsd, maxTotalChargeUsd: plan.maxTotalChargeUsd, ...(started_.ok ? {} : { failure: started_.failure }) }
    } finally {
      // A started run keeps the lock until its collect job ends it.
      if (!started) await this.releaseLock(lock)
    }
  }

  private async recordTick(outcome: string, tickBudgetUsd: number, slots: number) {
    await this.cfg.updateState(() => ({ lastTick: { at: new Date().toISOString(), outcome, tickBudgetUsd: usd(tickBudgetUsd), slots } }))
  }

  // ---------------- FlightAPI (ADR-0035) ----------------

  /** One tick on FlightAPI: its pro-rata share of this month's credits, in priority order, one call per slot. The caller owns the lock. */
  private async tickFlightapi(s: CatalogSettings, now: Date, lock: string): Promise<Record<string, unknown>> {
    const key = this.flightapiKey()
    if (!key) {
      await this.pauseSystem("AUTH", null, "FLIGHTAPI_KEY is not configured")
      return { skipped: "AUTH" }
    }
    const { used, budget } = await this.budget.credits(s, now)
    this.log.log({ creditsUsed: used, availableCredits: budget.availableCredits, slotsAllowed: budget.slotsAllowed, ticksLeft: budget.ticksLeft, reserveReleased: budget.reserveReleased }, "catalog tick (flightapi)")
    if (budget.paused) {
      await this.pauseSystem("BUDGET", budget.monthEnd, `credits used (${used} of ${s.flightapiMonthlyCredits}); resumes ${budget.monthEnd.toISOString()}`)
      await this.recordTick("BUDGET_EXHAUSTED", 0, 0)
      return { skipped: "BUDGET" }
    }
    const { slots, routes } = await this.dueSlots(now)
    const picked = selectFlightapiSlots(slots, new Map(routes.map((r) => [r.id, { id: r.id, enabled: r.enabled, maxResults: r.maxResults, priorityWeight: r.priorityWeight } satisfies PacerRoute])), s, budget, now)
    if (!picked.length) {
      await this.recordTick("NOTHING_DUE", 0, 0)
      return { skipped: "NOTHING_DUE", slotsAllowed: budget.slotsAllowed }
    }
    const routeOf = new Map(routes.map((r) => [r.id, r]))
    const jobs = picked.map((c): FlightapiJob => ({ slotId: c.slot.id, departureDate: c.slot.departureDate, origin: routeOf.get(c.slot.routeId)!.origin, destination: routeOf.get(c.slot.routeId)!.destination, maxResults: c.maxResults }))
    const run = await this.runCalls(key, s, jobs, "refresh", lock)
    const sum = await run.done
    if (sum.fatal === "AUTH") await this.pauseSystem("AUTH", null, "FlightAPI rejected the key (401/403); replace FLIGHTAPI_KEY", fingerprint(key))
    else if (sum.fatal === "BUDGET") await this.pauseSystem("BUDGET", budget.monthEnd, "FlightAPI reports no credits left (402)")
    else if (sum.ok === 0) {
      const st = await this.cfg.updateState((cur) => ({ failedTicks: cur.failedTicks + 1 }))
      if (st.failedTicks >= CIRCUIT_AFTER) await this.pauseSystem("CIRCUIT", new Date(Date.now() + CIRCUIT_PAUSE_MS), `${st.failedTicks} refresh ticks failed in a row (${sum.error ?? "no detail"})`)
    } else await this.cfg.updateState((cur) => ({ failedTicks: 0, ...(cur.pause?.reason === "CIRCUIT" ? { pause: null } : {}) }))
    await this.recordTick(sum.fatal ? `FAILED:${sum.fatal}` : sum.ok ? "RUN_DONE" : "FAILED:TRANSIENT", 0, jobs.length)
    return { slots: jobs.length, ok: sum.ok, failed: sum.failed, credits: sum.credits }
  }

  /**
   * One ledger row per batch (a tick, or one staff action), written before the first call so the credits count while it runs. Calls go out one slot at a time,
   * two at once at most; each answer is filed with `writeSlot` straight away. The ledger is returned as soon as it is open; `done` settles when the batch ends.
   */
  private async runCalls(key: string, s: CatalogSettings, jobs: FlightapiJob[], purpose: UsagePurpose, lock: string, meta?: Meta) {
    const ledgerId = await this.budget.openLedger({ provider: FLIGHTAPI_PROVIDER_ID, purpose, slotIds: jobs.map((j) => j.slotId), maxResults: Math.max(...jobs.map((j) => j.maxResults)), estCostUsd: 0, maxChargeUsd: 0, credits: jobs.length * FLIGHTAPI_CREDITS_PER_CALL, meta })
    const done = (async () => {
      try {
        return await this.execute(key, s, jobs, purpose, lock, ledgerId, meta)
      } catch (err) {
        await this.budget.closeLedger({ id: ledgerId }, { status: "FAILED", error: String(err).slice(0, 300) })
        throw err
      }
    })()
    return { ledgerId, done }
  }

  private async execute(key: string, s: CatalogSettings, jobs: FlightapiJob[], purpose: UsagePurpose, lock: string, ledgerId: string, meta?: Meta) {
    const client = new FlightapiClient(key)
    const sum = { ok: 0, failed: 0, billed: 0, rows: 0, fatal: null as "AUTH" | "BUDGET" | null, error: null as string | null, credits: 0 }
    const queue = [...jobs]
    const fetchedAt = new Date()
    const policy = await this.compliance.carrierPolicy()
    const worker = async () => {
      for (let job = queue.shift(); job && !sum.fatal; job = queue.shift()) {
        try {
          const raw = await client.onewayTrip({ from: job.origin, to: job.destination, date: job.departureDate, adults: 1, children: 0, infants: 0, cabin: "Economy", currency: s.currency })
          sum.billed++
          if (!raw || typeof raw !== "object" || !Array.isArray((raw as { itineraries?: unknown }).itineraries)) throw new SupplierError("SUPPLIER_UNKNOWN", "FlightAPI answered without an itineraries list")
          const norm = normaliseResponse(raw, { reference: this.reference.lookup(), fetchedAt, ttlSeconds: OFFER_TTL_S, currency: s.currency, cabin: "ECONOMY", from: job.origin, to: job.destination, date: job.departureDate, maxResults: job.maxResults })
          sum.ok++
          sum.rows += norm.offers.length
          await this.write.writeSlot({ slotId: job.slotId, offers: norm.offers, fetchedAt, notices: norm.notices }, policy).catch((err) => this.log.error({ slot: job.slotId, err: String(err) }, "slot write failed; it stays due"))
        } catch (err) {
          const kind = classify(err)
          const msg = err instanceof SupplierError ? `${err.code}: ${err.message}` : String(err)
          sum.failed++
          sum.error ??= msg
          // A call that was refused or never reached FlightAPI was not billed; one that timed out may have been.
          if (err instanceof SupplierError && err.code === "SUPPLIER_TIMEOUT") sum.billed++
          if (kind === "AUTH" || kind === "BUDGET") sum.fatal = kind
          // A request FlightAPI will keep refusing is marked on the slot, so the error skip stops asking every tick.
          if (kind === "OTHER") await this.write.writeSlot({ slotId: job.slotId, offers: [], fetchedAt, notices: [], errored: msg }, policy).catch(() => undefined)
        }
        await this.renewLock(lock)
      }
    }
    await Promise.all([worker(), worker()])
    sum.credits = sum.billed * FLIGHTAPI_CREDITS_PER_CALL
    const status = sum.failed === 0 && sum.ok === jobs.length ? "SUCCEEDED" : sum.ok ? "PARTIAL" : "FAILED"
    const result = purpose === "admin_revalidate" && meta ? await this.outcome(meta, fetchedAt) : null
    await this.budget.closeLedger({ id: ledgerId }, { status, rowsBilled: sum.rows, credits: sum.credits, error: sum.error?.slice(0, 300) ?? null, ...(result ? { meta: { ...meta, outcome: result } } : {}) })
    this.log.log({ ledger: ledgerId, purpose, ok: sum.ok, failed: sum.failed, credits: sum.credits, rows: sum.rows }, "catalog calls done")
    return sum
  }

  /** Enabled DIRECT routes' slots inside their horizon. Combined routes are never sent to Apify. */
  private async dueSlots(now: Date, only?: string[]) {
    const routes = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.enabled, true), eq(flightWatchlistRoutes.kind, "DIRECT")))
    if (!routes.length) return { slots: [] as PacerSlot[], routes }
    const rows = await this.db.select().from(catalogSlots).where(and(inArray(catalogSlots.routeId, routes.map((r) => r.id)), gte(catalogSlots.departureDate, isoDate(now)), only ? inArray(catalogSlots.id, only) : undefined)).orderBy(asc(catalogSlots.departureDate))
    const horizon = new Map(routes.map((r) => [r.id, isoDate(addDays(now, r.horizonDays))]))
    return { slots: rows.filter((r) => r.departureDate <= horizon.get(r.routeId)!).map(toPacerSlot), routes }
  }

  /** A run row stuck in RUNNING (worker died mid-run) would count at its charge cap forever; close it as timed out. */
  private async sweepStale() {
    const cutoff = new Date(Date.now() - 2 * RUN_DEADLINE_MS)
    // We hold the lock, so no FlightAPI batch can still be running: whatever is still RUNNING died with its worker. Its credits stay counted (the calls may have been billed).
    await this.db.update(providerUsageLedger).set({ status: "TIMED-OUT", finishedAt: new Date(), error: "the worker stopped before this batch finished" })
      .where(and(eq(providerUsageLedger.status, "RUNNING"), eq(providerUsageLedger.provider, FLIGHTAPI_PROVIDER_ID)))
    const stale = await this.db.select().from(providerUsageLedger).where(and(eq(providerUsageLedger.status, "RUNNING"), eq(providerUsageLedger.provider, APIFY_PROVIDER_ID), lt(providerUsageLedger.startedAt, cutoff)))
    for (const l of stale) {
      await this.budget.closeLedger({ id: l.id }, { status: "TIMED-OUT", estCostUsd: APIFY_START_USD, error: "no collect job finished this run" })
      if (l.providerRunId) await this.db.update(providerRuns).set({ status: "TIMED-OUT", finishedAt: new Date(), errors: ["no collect job finished this run"] }).where(eq(providerRuns.id, l.providerRunId))
    }
  }

  // ---------------- starting a run ----------------

  /** Writes the run and ledger rows, starts the actor asynchronously and queues the first collect. Releases nothing: the caller owns the lock. */
  private async startRun(token: string, s: CatalogSettings, spec: RunSpec): Promise<{ ok: true; ledgerId: string; runId: string } | { ok: false; failure: Failure }> {
    const routes = spec.slots.map((sl) => ({ origin: spec.routeOf(sl.id).origin, destination: spec.routeOf(sl.id).destination, departureDate: sl.departureDate }))
    // One adult, economy, one-way, best order (brief). The client forces the four cost fields off whatever is passed (ADR-0034 C4).
    const input: ApifyInput = {
      routes, maxResults: spec.maxResults, sortBy: "best", currency: s.currency, market: s.market, adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0,
      cabinClass: "economy", maxStops: "any", includePriceInsights: true, includeSearchSummary: false, includeRunSummary: true,
    }
    const [run] = await this.db.insert(providerRuns).values({
      providerId: APIFY_PROVIDER_ID, pool: "catalog", purpose: "CATALOG", routes, input: input as unknown as Record<string, unknown>, legKeys: [], status: "QUEUED",
      reservedUsd: String(spec.maxTotalChargeUsd), result: { ...(spec.meta ?? {}), ledgerPurpose: spec.purpose },
    }).returning()
    const ledgerId = await this.budget.openLedger({ purpose: spec.purpose, providerRunId: run!.id, slotIds: spec.slots.map((x) => x.id), maxResults: spec.maxResults, estCostUsd: spec.estUsd, maxChargeUsd: spec.maxTotalChargeUsd })
    try {
      const r = await new ApifyClient(token).startRun(input, spec.maxTotalChargeUsd)
      const startedAt = new Date()
      await this.db.update(providerRuns).set({ externalRunId: r.id, status: "RUNNING", startedAt }).where(eq(providerRuns.id, run!.id))
      await this.budget.closeLedger({ id: ledgerId }, { apifyRunId: r.id })
      await this.cfg.updateState(() => ({ currentRun: { ledgerId, startedAt: startedAt.toISOString() } }))
      await this.queues.get("catalog").add(JOBS.collect, { ledgerId, attempt: 1, lock: spec.lock, retryOf: spec.retryOf } satisfies CollectData, { delay: POLL_MS, jobId: `catalog-collect-${ledgerId}-1` })
      return { ok: true, ledgerId, runId: run!.id }
    } catch (err) {
      const kind = classify(err)
      const msg = err instanceof SupplierError ? `${err.code}: ${err.message}` : String(err)
      await this.db.update(providerRuns).set({ status: "FAILED", errors: [msg], finishedAt: new Date(), reservedUsd: "0" }).where(eq(providerRuns.id, run!.id))
      // Nothing was billed if the run never started.
      await this.budget.closeLedger({ id: ledgerId }, { status: "FAILED", estCostUsd: 0, error: msg })
      await this.onFailure(kind, { purpose: spec.purpose, slotIds: spec.slots.map((x) => x.id), ledgerId, retryOf: spec.retryOf }, msg)
      return { ok: false, failure: kind }
    }
  }

  /** The failure matrix (spec §9). The caller releases the lock. */
  private async onFailure(kind: Failure, run: { purpose: UsagePurpose; slotIds: string[]; ledgerId: string; retryOf?: string }, detail: string) {
    await this.cfg.updateState(() => ({ currentRun: null }))
    if (kind === "AUTH") {
      await this.suppliers.markCredentialInvalid(APIFY_PROVIDER_ID)
      await this.pauseSystem("AUTH", null, "Apify rejected the credential (401/403); replace it in the Developer Panel")
      return
    }
    if (kind === "BUDGET") {
      const { spend } = await this.budget.budget(undefined, { force: true })
      await this.pauseSystem("BUDGET", spend.cycleEnd, "Apify reports the account's usage limit reached")
      return
    }
    if (run.purpose !== "refresh") return
    if (kind === "TRANSIENT" && !run.retryOf) {
      // Retry once after 10 minutes with the same slots; then leave them due for the next tick.
      await this.cfg.updateState(() => ({ retry: { at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(), ledgerId: run.ledgerId, slotIds: run.slotIds } }))
      await this.queues.get("catalog").add(JOBS.tick, { retry: { ledgerId: run.ledgerId, slotIds: run.slotIds } } satisfies TickData, { delay: RETRY_DELAY_MS, jobId: `catalog-retry-${run.ledgerId}` })
      return
    }
    const st = await this.cfg.updateState((cur) => ({ failedTicks: cur.failedTicks + 1, retry: null }))
    if (st.failedTicks >= CIRCUIT_AFTER) await this.pauseSystem("CIRCUIT", new Date(Date.now() + CIRCUIT_PAUSE_MS), `${st.failedTicks} refresh ticks failed in a row (${detail})`)
  }

  // ---------------- collect ----------------

  async collect(d: CollectData): Promise<Record<string, unknown>> {
    const [led] = await this.db.select().from(providerUsageLedger).where(eq(providerUsageLedger.id, d.ledgerId))
    if (!led || led.status !== "RUNNING" || !led.apifyRunId) return { skipped: true }
    await this.renewLock(d.lock)
    const done = async (r: Record<string, unknown>) => { await this.releaseLock(d.lock); return r }
    const fail = async (kind: Failure, status: "FAILED" | "TIMED-OUT" | "ABORTED", msg: string) => {
      await this.failRun(led, status, msg)
      await this.onFailure(kind, { purpose: led.purpose, slotIds: led.slotIds, ledgerId: led.id, retryOf: d.retryOf }, msg)
      return done({ failed: kind })
    }
    const token = await this.token()
    if (!token) return fail("AUTH", "FAILED", "SUPPLIER_AUTH: credential missing")
    const client = new ApifyClient(token)
    const age = Date.now() - led.startedAt.getTime()
    try {
      const run = await client.runStatus(led.apifyRunId)
      if (run.status === "READY" || run.status === "RUNNING") {
        if (age > RUN_DEADLINE_MS) return fail("TRANSIENT", "TIMED-OUT", "no result within 10 minutes")
        await this.queues.get("catalog").add(JOBS.collect, { ...d, attempt: d.attempt + 1 } satisfies CollectData, { delay: POLL_MS, jobId: `catalog-collect-${led.id}-${d.attempt + 1}` })
        return { polling: true }
      }
      if (run.status === "FAILED" || run.status === "TIMED-OUT") return fail("TRANSIENT", run.status, `run ${run.status}`)
      // SUCCEEDED, or ABORTED when the charge cap stopped it: what came back is stored, the rest stays due.
      const items = await client.items(run.defaultDatasetId)
      return done(await this.process(led, run, items, run.status !== "SUCCEEDED", d))
    } catch (err) {
      const kind = classify(err)
      const msg = err instanceof SupplierError ? `${err.code}: ${err.message}` : String(err)
      if (kind === "TRANSIENT" && age < RUN_DEADLINE_MS) {
        await this.queues.get("catalog").add(JOBS.collect, { ...d, attempt: d.attempt + 1 } satisfies CollectData, { delay: POLL_MS, jobId: `catalog-collect-${led.id}-${d.attempt + 1}` })
        return { retrying: true }
      }
      return fail(kind === "TRANSIENT" ? "TRANSIENT" : kind, "FAILED", msg)
    }
  }

  private async failRun(led: LedgerRow, status: "FAILED" | "TIMED-OUT" | "ABORTED", msg: string) {
    // The start fee is charged even when the run fails; rows it already produced are unknown, so only the fee is assumed.
    await this.budget.closeLedger({ id: led.id }, { status, estCostUsd: APIFY_START_USD, error: msg.slice(0, 300) })
    if (led.providerRunId) await this.db.update(providerRuns).set({ status, errors: [msg], estimatedUsd: String(APIFY_START_USD), finishedAt: new Date() }).where(eq(providerRuns.id, led.providerRunId))
  }

  /** Files the dataset slot by slot. `partial`: slots with no rows are not written (they stay due) because the run may have stopped before reaching them. */
  private async process(led: LedgerRow, run: ApifyRun, items: Record<string, unknown>[], partialStatus: boolean, d: CollectData) {
    const fetchedAt = new Date()
    const billable = items.filter((r) => r.type !== "notice" && r.type !== "error").length
    const estUsd = usd(billable * APIFY_ROW_USD + APIFY_START_USD)
    // A run that reached its charge cap stopped early, whatever status Apify gave it.
    const partial = partialStatus || estUsd >= Number(led.maxChargeUsd) - 1e-6
    const payloadKey = `${fetchedAt.toISOString().slice(0, 10)}/${APIFY_PROVIDER_ID}/${led.providerRunId ?? led.id}.json.gz`
    void this.storage.putCallPayload(payloadKey, items)
    const norm = normaliseRows(items, { reference: this.reference.lookup(), fetchedAt, ttlSeconds: OFFER_TTL_S })
    const slots = led.slotIds.length ? await this.db.select({ slot: catalogSlots, route: flightWatchlistRoutes }).from(catalogSlots).innerJoin(flightWatchlistRoutes, eq(flightWatchlistRoutes.id, catalogSlots.routeId)).where(inArray(catalogSlots.id, led.slotIds)) : []
    const byKey = new Map(slots.map((x) => [`${x.route.origin}|${x.route.destination}|${x.slot.departureDate}`, x]))
    const offersBySlot = new Map<string, typeof norm.offers>()
    const unmatched: string[] = []
    for (const o of norm.offers) {
      const seg = o.slices[0]!.segments
      const hit = byKey.get(`${seg[0]!.origin.iata}|${seg[seg.length - 1]!.destination.iata}|${seg[0]!.departure.local.slice(0, 10)}`)
      if (hit) offersBySlot.set(hit.slot.id, [...(offersBySlot.get(hit.slot.id) ?? []), o])
      else unmatched.push(`UNREQUESTED_ROUTE ${seg[0]!.origin.iata}-${seg[seg.length - 1]!.destination.iata}`)
    }
    const policy = await this.compliance.carrierPolicy()
    let written = 0
    let skipped = 0
    for (const { slot, route } of slots) {
      const offers = offersBySlot.get(slot.id) ?? []
      const mentions = (m: string) => m.includes(`${route.origin}-${route.destination}`)
      const slotErrors = norm.errors.filter(mentions)
      if (!offers.length && partial) { skipped++; continue }
      try {
        const out = await this.write.writeSlot({
          slotId: slot.id, offers, fetchedAt, notices: [...norm.notices.filter(mentions), ...slotErrors],
          // Only error rows for this route and no flights: the slot is in error, not empty.
          errored: !offers.length && slotErrors.length ? slotErrors[0] : undefined,
        }, policy)
        if (out) written++
      } catch (err) {
        skipped++
        this.log.error({ slot: slot.id, err: String(err) }, "slot write failed; it stays due")
      }
    }
    const notices = [...norm.notices, ...unmatched, ...(partial ? ["PARTIAL_DATASET"] : [])]
    const result = led.purpose === "admin_revalidate" ? await this.revalidateOutcome(led, fetchedAt) : null
    const actual = typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null
    if (led.providerRunId) {
      const [pr] = await this.db.select({ result: providerRuns.result }).from(providerRuns).where(eq(providerRuns.id, led.providerRunId))
      await this.db.update(providerRuns).set({
        status: partialStatus ? "ABORTED" : "SUCCEEDED", rows: billable, estimatedUsd: String(estUsd), notices, errors: norm.errors, payloadKey, finishedAt: fetchedAt,
        result: { ...(pr?.result ?? {}), written, skipped, partial, ...(result ? { outcome: result } : {}) },
      }).where(eq(providerRuns.id, led.providerRunId))
    }
    await this.budget.closeLedger({ id: led.id }, { status: partial ? "PARTIAL" : "SUCCEEDED", rowsBilled: billable, estCostUsd: estUsd, actualCostUsd: actual })
    await this.cfg.updateState((cur) => ({ currentRun: null, retry: null, ...(led.purpose === "refresh" ? { failedTicks: 0 } : {}), ...(cur.pause?.reason === "CIRCUIT" && led.purpose === "refresh" ? { pause: null } : {}) }))
    this.log.log({ ledger: led.id, purpose: led.purpose, rows: billable, estUsd, actualUsd: actual, written, skipped, partial }, "catalog run collected")
    return { rows: billable, written, skipped, partial, estUsd }
  }

  // ---------------- admin runs: refresh a slot now, revalidate a result ----------------

  private async cap(routes: number, maxResults: number, s: CatalogSettings) {
    const { budget } = await this.budget.budget(s)
    const cap = adminRunCap(routes, maxResults, budget, s)
    if (!cap) throw new AppError("RATE_LIMITED", "The admin reserve for this billing cycle cannot cover this run")
    return { ...cap, reserveLeftUsd: usd(budget.adminAvailableUsd) }
  }

  private async slotWithRoute(slotId: string) {
    const [x] = await this.db.select({ slot: catalogSlots, route: flightWatchlistRoutes }).from(catalogSlots).innerJoin(flightWatchlistRoutes, eq(flightWatchlistRoutes.id, catalogSlots.routeId)).where(eq(catalogSlots.id, slotId))
    if (!x) throw new AppError("NOT_FOUND", "Slot not found")
    if (x.route.kind !== "DIRECT") throw new AppError("VALIDATION_FAILED", "A combined slot is built from its legs; refresh a leg instead")
    return x
  }

  /** Step 1 of "refresh this slot now": the cost, and a short-lived token the confirm call must present. */
  async quoteSlotRefresh(slotId: string, actorId: string) {
    const { route } = await this.slotWithRoute(slotId)
    const s = await this.cfg.get()
    const confirmToken = randomToken(24)
    if (s.source === "flightapi") {
      const c = await this.creditCap(1, s)
      await this.redis.set(`catalog:quote:${confirmToken}`, JSON.stringify({ slotId, actorId, credits: c.credits }), "EX", 300)
      return { slotId, estimatedUsd: 0, reserveLeftUsd: 0, estimatedCredits: c.credits, reserveLeftCredits: c.reserveLeft, confirmToken }
    }
    const c = await this.cap(1, route.maxResults ?? s.defaultMaxResults, s)
    await this.redis.set(`catalog:quote:${confirmToken}`, JSON.stringify({ slotId, actorId, maxTotalChargeUsd: c.maxTotalChargeUsd }), "EX", 300)
    return { slotId, estimatedUsd: usd(c.estUsd), reserveLeftUsd: c.reserveLeftUsd, confirmToken }
  }

  async confirmSlotRefresh(slotId: string, confirmToken: string, actorId: string): Promise<RecheckStart> {
    const key = `catalog:quote:${confirmToken}`
    const quote = JSON.parse((await this.redis.get(key)) ?? "null") as { slotId: string; actorId: string } | null
    if (!quote || quote.slotId !== slotId || quote.actorId !== actorId) throw new AppError("VALIDATION_FAILED", "The quote expired or does not match; request a new one", [{ path: "confirmToken", code: "INVALID" }])
    await this.redis.del(key)
    const { slot, route } = await this.slotWithRoute(slotId)
    const s = await this.cfg.get()
    const maxResults = route.maxResults ?? s.defaultMaxResults
    if (s.source === "flightapi") {
      await this.creditCap(1, s)
      return this.startFlightapiAdmin(s, [{ slotId: slot.id, departureDate: slot.departureDate, origin: route.origin, destination: route.destination, maxResults }], "admin_revalidate")
    }
    const c = await this.cap(1, maxResults, s)
    return this.startAdminRun(s, { purpose: "admin_revalidate", slots: [slot], routeOf: () => route, maxResults, estUsd: c.estUsd, maxTotalChargeUsd: c.maxTotalChargeUsd, lock: "" })
  }

  /** Staff calls draw on the reserve credits (ADR-0035); refuses before any call when the reserve cannot cover them. */
  private async creditCap(calls: number, s: CatalogSettings) {
    const { budget } = await this.budget.credits(s)
    const credits = calls * FLIGHTAPI_CREDITS_PER_CALL
    if (credits > budget.adminAvailableCredits) throw new AppError("RATE_LIMITED", "The admin reserve of FlightAPI credits for this month cannot cover this run")
    return { credits, reserveLeft: budget.adminAvailableCredits }
  }

  /** The calls run in the background under the lock; the returned id is the ledger row, which the status route reads. */
  private async startFlightapiAdmin(s: CatalogSettings, jobs: FlightapiJob[], purpose: UsagePurpose, meta?: Meta): Promise<RecheckStart> {
    const key = this.flightapiKey()
    if (!key) throw new AppError("SUPPLIER_UNAVAILABLE", "FLIGHTAPI_KEY is not set")
    const lock = randomToken(12)
    if (!(await this.takeLock(lock))) throw new AppError("VERSION_CONFLICT", "A refresh run is already in progress; try again in a minute")
    try {
      const run = await this.runCalls(key, s, jobs, purpose, lock, meta)
      void run.done.then(async (sum) => {
        if (sum.fatal === "AUTH") await this.pauseSystem("AUTH", null, "FlightAPI rejected the key (401/403); replace FLIGHTAPI_KEY", fingerprint(key))
        else if (sum.fatal === "BUDGET") await this.pauseSystem("BUDGET", (await this.budget.credits(s)).budget.monthEnd, "FlightAPI reports no credits left (402)")
      }).catch((err) => this.log.error({ err: String(err) }, "staff FlightAPI run failed")).finally(() => this.releaseLock(lock))
      return { jobId: run.ledgerId, status: "PENDING" }
    } catch (err) {
      await this.releaseLock(lock)
      throw err
    }
  }

  private async startAdminRun(s: CatalogSettings, spec: RunSpec): Promise<RecheckStart> {
    const token = await this.token()
    if (!token) throw new AppError("SUPPLIER_UNAVAILABLE", "The Apify credential is not set or was rejected; replace it in the Developer Panel")
    const lock = randomToken(12)
    if (!(await this.takeLock(lock))) throw new AppError("VERSION_CONFLICT", "A refresh run is already in progress; try again in a minute")
    const r = await this.startRun(token, s, { ...spec, lock })
    if (!r.ok) {
      await this.releaseLock(lock)
      throw new AppError(r.failure === "AUTH" ? "SUPPLIER_AUTH" : "SUPPLIER_UNAVAILABLE", "Apify did not start the run")
    }
    return { jobId: r.ledgerId, status: "PENDING" }
  }

  /**
   * Revalidates one catalog result now: one run for its route-date(s) with `revalidateMaxResults`, charged to the admin reserve, then
   * matched by identity key. The fresh rows are written back to the slot like any refresh (spec §7.5).
   */
  async revalidateResult(resultId: string): Promise<RecheckStart> {
    const [res] = await this.db.select({ id: flightResults.id, slotId: flightResults.slotId, identityKey: flightResults.identityKey, selfTransfer: flightResults.selfTransfer, isCurrent: flightResults.isCurrent }).from(flightResults).where(eq(flightResults.id, resultId))
    if (!res) throw new AppError("NOT_FOUND", "Result not found")
    const legIds = res.selfTransfer ? (await this.db.select({ leg: flightResultLegs.legResultId }).from(flightResultLegs).where(eq(flightResultLegs.resultId, res.id))).map((x) => x.leg) : [res.id]
    const legs = legIds.length ? await this.db.select({ id: flightResults.id, slotId: flightResults.slotId, identityKey: flightResults.identityKey }).from(flightResults).where(inArray(flightResults.id, legIds)) : []
    const slotIds = [...new Set(legs.map((l) => l.slotId).filter((x): x is string => !!x))]
    if (!slotIds.length) throw new AppError("VALIDATION_FAILED", "This result's departure date has passed; there is nothing to revalidate")
    const withRoutes = await Promise.all(slotIds.map((id) => this.slotWithRoute(id)))
    const s = await this.cfg.get()
    const [price] = await this.db.select().from(flightResultPricing).where(eq(flightResultPricing.resultId, res.id))
    const meta = { resultId: res.id, identityKey: res.identityKey, old: price ? { amountMinor: price.amountMinor, currency: price.currency } : null }
    if (s.source === "flightapi") {
      await this.creditCap(withRoutes.length, s)
      return this.startFlightapiAdmin(s, withRoutes.map((x) => ({ slotId: x.slot.id, departureDate: x.slot.departureDate, origin: x.route.origin, destination: x.route.destination, maxResults: s.revalidateMaxResults })), "admin_revalidate", meta)
    }
    const c = await this.cap(withRoutes.length, s.revalidateMaxResults, s)
    const byId = new Map(withRoutes.map((x) => [x.slot.id, x]))
    return this.startAdminRun(s, {
      purpose: "admin_revalidate", slots: withRoutes.map((x) => x.slot), routeOf: (id) => byId.get(id)!.route, maxResults: s.revalidateMaxResults, estUsd: c.estUsd, maxTotalChargeUsd: c.maxTotalChargeUsd, lock: "",
      meta,
    })
  }

  /** After the write-back: is the identity still listed, and at what price? */
  private async revalidateOutcome(led: LedgerRow, fetchedAt: Date) {
    if (!led.providerRunId) return null
    const [pr] = await this.db.select({ result: providerRuns.result }).from(providerRuns).where(eq(providerRuns.id, led.providerRunId))
    return this.outcome(pr?.result as Meta | null, fetchedAt)
  }

  private async outcome(meta: Meta | null, fetchedAt: Date) {
    if (!meta?.resultId) return null
    const [row] = await this.db.select({ isCurrent: flightResults.isCurrent }).from(flightResults).where(eq(flightResults.id, meta.resultId))
    const [price] = await this.db.select().from(flightResultPricing).where(eq(flightResultPricing.resultId, meta.resultId))
    const stillListed = !!row?.isCurrent
    const next = stillListed && price ? { amountMinor: price.amountMinor, currency: price.currency } : null
    return { stillListed, priceChanged: !!meta.old && !!next && meta.old.amountMinor !== next.amountMinor, old: meta.old ?? null, new: next, fetchedAt: fetchedAt.toISOString() }
  }

  async revalidateStatus(jobId: string): Promise<RecheckStatus> {
    const [led] = await this.db.select().from(providerUsageLedger).where(eq(providerUsageLedger.id, jobId))
    if (!led || led.purpose === "refresh") throw new AppError("NOT_FOUND")
    if (led.status === "RUNNING") return { jobId, status: "PENDING" }
    if (led.status === "SUCCEEDED" || led.status === "PARTIAL") {
      const [pr] = led.providerRunId ? await this.db.select({ result: providerRuns.result }).from(providerRuns).where(eq(providerRuns.id, led.providerRunId)) : []
      const o = ((pr?.result ?? led.meta) as { outcome?: { stillListed: boolean; priceChanged: boolean; old: { amountMinor: number; currency: string } | null; new: { amountMinor: number; currency: string } | null; fetchedAt: string } } | null)?.outcome
      // A slot refresh (no result behind it) has no price comparison; it is DONE with nothing to compare.
      return { jobId, status: "DONE", result: o ? { ...o, components: [] } : { stillListed: true, priceChanged: false, old: null, new: null, fetchedAt: (led.finishedAt ?? new Date()).toISOString(), components: [] } }
    }
    return { jobId, status: "FAILED", error: led.error ?? led.status }
  }

  // ---------------- daily and hourly jobs ----------------

  /** Slots for every date in each enabled route's horizon (today .. today + horizon); past slots are deleted, their results stay as history. */
  async rollSlots(now = new Date(), only?: string[]): Promise<{ created: number; deleted: number }> {
    const routes = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.enabled, true), only ? inArray(flightWatchlistRoutes.id, only) : undefined))
    const today = isoDate(now)
    let created = 0
    for (const r of routes) {
      const values = Array.from({ length: r.horizonDays + 1 }, (_, i) => ({ routeId: r.id, departureDate: isoDate(addDays(now, i)), nextDueAt: now }))
      created += (await this.db.insert(catalogSlots).values(values).onConflictDoNothing({ target: [catalogSlots.routeId, catalogSlots.departureDate] }).returning({ id: catalogSlots.id })).length
    }
    const gone = await this.db.delete(catalogSlots).where(lt(catalogSlots.departureDate, today)).returning({ id: catalogSlots.id })
    return { created, deleted: gone.length }
  }

  /** Hourly: decays every slot's demand by one hour of the half-life, then adds the counters collected by the read path (spec §4.4). */
  async foldDemand(): Promise<{ keys: number; untracked: number }> {
    const s = await this.cfg.get()
    const factor = 0.5 ** (1 / (s.demandHalfLifeDays * 24))
    await this.db.update(catalogSlots).set({ demandScore: sql`${catalogSlots.demandScore} * ${factor}` }).where(sql`${catalogSlots.demandScore} > 0.001`)
    const routes = await this.db.select().from(flightWatchlistRoutes)
    const ref = this.reference.lookup()
    let keys = 0
    let untracked = 0
    let cursor = "0"
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", "demand:*", "COUNT", 200)
      cursor = next
      for (const key of batch) {
        if (key === "demand:untracked") continue
        const n = Number(await this.redis.getdel(key))
        const m = /^demand:([A-Z0-9]{3}):([A-Z0-9]{3}):(\d{4}-\d{2}-\d{2})$/.exec(key)
        if (!m || !(n > 0)) continue
        keys++
        // Requests carry city codes (THR, LON); the read path carries watchlist airports. Both resolve to the routes they stand for.
        const from = new Set([m[1]!, ...ref.cityAirports(m[1]!)])
        const to = new Set([m[2]!, ...ref.cityAirports(m[2]!)])
        const matched = routes.filter((r) => from.has(r.origin) && to.has(r.destination))
        if (!matched.length) { await this.redis.zincrby("demand:untracked", n, `${m[1]}-${m[2]}`); untracked++; continue }
        for (const route of matched) await this.addDemand(route, m[3]!, n, s)
      }
    } while (cursor !== "0")
    // The untracked-pair board decays the same way.
    const board = await this.redis.zrange("demand:untracked", "0", "-1", "WITHSCORES")
    for (let i = 0; i < board.length; i += 2) {
      const next = Number(board[i + 1]) * factor
      if (next < 0.05) await this.redis.zrem("demand:untracked", board[i]!)
      else await this.redis.zadd("demand:untracked", next, board[i]!)
    }
    return { keys, untracked }
  }

  /** Demand on a combined route warms its feeders, which are what the pacer actually refreshes. */
  private async addDemand(route: RouteRow, date: string, n: number, s: CatalogSettings) {
    const bump = async (routeId: string, dates: string[]) => {
      if (dates.length) await this.db.update(catalogSlots).set({ demandScore: sql`${catalogSlots.demandScore} + ${n}` }).where(and(eq(catalogSlots.routeId, routeId), inArray(catalogSlots.departureDate, dates)))
    }
    if (route.kind === "DIRECT") return bump(route.id, [date])
    const pair = s.connections.pairs.find((p) => p.enabled && p.from === route.origin && p.to === route.destination)
    if (!pair) return
    const direct = await this.db.select().from(flightWatchlistRoutes).where(eq(flightWatchlistRoutes.kind, "DIRECT"))
    const a = direct.find((r) => r.origin === pair.from && r.destination === pair.via)
    const b = direct.find((r) => r.origin === pair.via && r.destination === pair.to)
    if (a) await bump(a.id, [date])
    if (b) await bump(b.id, s.connections.dayOffsets.map((o) => isoDate(addDays(new Date(`${date}T00:00:00Z`), o))))
  }

  /** 03:00 UTC: if Apify reports more spend than our ledger (> 10%), raise the per-row estimate factor (spec §4.6). */
  async reconcile(): Promise<Record<string, unknown>> {
    const s = await this.cfg.get()
    const token = await this.token()
    if (!token) return { skipped: "NO_CREDENTIAL" }
    const { spend } = await this.budget.budget(s, { force: true })
    if (spend.spentSource !== "apify") return { skipped: "APIFY_UNAVAILABLE" }
    // The ledger without the correction factor is the base the ratio is measured against.
    const raw = spend.ledgerUsd
    let costCorrection = s.costCorrection
    if (raw > 0 && spend.spentUsd > raw * 1.1) {
      costCorrection = Math.min(5, Math.max(s.costCorrection, usd(spend.spentUsd / raw)))
      if (costCorrection !== s.costCorrection) {
        await this.cfg.patch({ costCorrection }, null)
        this.log.warn({ apifyUsd: spend.spentUsd, ledgerUsd: raw, costCorrection }, "Apify reports more spend than the ledger; estimates raised")
      }
    }
    await this.redis.set("apify:reconciled", JSON.stringify({ at: new Date().toISOString(), apifyUsd: spend.spentUsd, ledgerUsd: raw }), "EX", 40 * 86400)
    return { apifyUsd: spend.spentUsd, ledgerUsd: raw, costCorrection }
  }

  /** Weekly and free: alerts when the actor's default build moved or a cost field we force off is missing from its input schema (ADR-0034 C5). */
  async schemaCheck(): Promise<Record<string, unknown>> {
    const token = await this.token()
    if (!token) return { skipped: "NO_CREDENTIAL" }
    const info = await new ApifyClient(token).defaultBuild()
    const missing = APIFY_COST_OFF_FIELDS.filter((f) => !(f in info.fields))
    const problems = [...(info.buildNumber !== APIFY_ACTOR_BUILD ? [`default build is ${info.buildNumber}, pinned ${APIFY_ACTOR_BUILD}`] : []), ...(missing.length ? [`input fields missing or renamed: ${missing.join(", ")}`] : [])]
    const alert = problems.length ? `Apify actor schema changed: ${problems.join("; ")}` : null
    const prev = (await this.cfg.state()).schemaAlert
    await this.cfg.updateState(() => ({ schemaAlert: alert }))
    if (alert && alert !== prev) await this.alert("SCHEMA", alert)
    return { buildNumber: info.buildNumber, problems }
  }

  /** `flight_request.submitted`: a request is the strongest demand signal (+5), resolved to routes by the hourly fold. */
  async countRequest(event: { payload?: { route?: { from: string; to: string; date: string } } }): Promise<{ bumped: boolean }> {
    const r = event.payload?.route
    if (!r) return { bumped: false }
    await bumpDemand(this.redis, r.from, r.to, r.date, DEMAND_REQUEST)
    return { bumped: true }
  }

  /** `catalog.slot_updated`: asks the website to purge the cached pages of the slot. Failure is logged and never fatal. */
  async purgeWeb(slotId: string, target: { WEB_REVALIDATE_URL?: string; WEB_REVALIDATE_SECRET?: string } = env()): Promise<{ purged: boolean }> {
    const { WEB_REVALIDATE_URL: url, WEB_REVALIDATE_SECRET: secret } = target
    if (!url || !secret || !slotId) return { purged: false }
    try {
      const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(5_000), headers: { "content-type": "application/json", "x-revalidate-secret": secret }, body: JSON.stringify({ tags: ["catalog", `slot:${slotId}`] }) })
      if (!res.ok) this.log.warn({ status: res.status }, "web revalidation refused")
      return { purged: res.ok }
    } catch (err) {
      this.log.warn({ err: (err as Error).name }, "web revalidation failed")
      return { purged: false }
    }
  }
}

export interface TickData { catchup?: boolean; retry?: { ledgerId: string; slotIds: string[] } }
export interface CollectData { ledgerId: string; attempt: number; lock: string; retryOf?: string }
