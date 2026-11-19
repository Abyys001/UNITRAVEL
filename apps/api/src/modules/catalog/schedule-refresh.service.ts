import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import type { Job } from "bullmq"
import { and, eq, gte, lte } from "drizzle-orm"
import type { Redis } from "ioredis"

import { catalogScheduleSlots, catalogSlots, type Db, flightWatchlistRoutes } from "@unitravel/db"
import { SCHEDULE_TICK_HOURS, scheduleBudget, type ScheduleSlotState, selectScheduleSlots } from "@unitravel/engine"

import { randomToken } from "../../core/crypto"
import { DB, REDIS } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { PROCESS_ROLE, type ProcessRole, WorkerRegistry } from "../../core/workers"
import { ReferenceService } from "../reference/reference.service"
import { AVIATION_EDGE_PROVIDER_ID as ID, AviationEdgeClient } from "../suppliers/adapters/aviation-edge/client"
import { normaliseSchedule } from "../suppliers/adapters/aviation-edge/normalise"
import { AviationEdgeService, billedOnFailure, failureWord, SCHEDULE_LOCK_KEY } from "../suppliers/aviation-edge/aviation-edge.service"
import { SuppliersService } from "../suppliers/suppliers.service"
import { CatalogBudgetService } from "./catalog-budget.service"
import { CatalogSettingsService } from "./catalog-settings.service"
import { ScheduleWriteService } from "./schedule-write.service"

export const SCHEDULE_JOBS = { tick: "catalog.schedule.tick" } as const
const HOUR = 3_600_000
const LOCK_TTL_MS = 30 * 60_000
const RATE_LIMIT_PAUSE_MS = HOUR
/** Three failed ticks in a row pause the pacer for this long; the next tick after it runs, and a success clears the count. */
const CIRCUIT_AFTER = 3
const CIRCUIT_PAUSE_MS = 2 * HOUR
const STREAK_LIMIT = 3
const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

/**
 * ADR-0036 E5-E7: the schedule pacer. A tick every 4 hours fills watched DIRECT slots 7-60 days out with one Aviation Edge call each, within the
 * month's call budget. It never touches the priced catalog tick or its lock (`catalog:refresh:lock`); its own lock is `catalog:schedule:lock`.
 * The key is read from the credential store on every tick.
 */
@Injectable()
export class ScheduleRefreshService implements OnModuleInit {
  private readonly log = new Logger("ScheduleRefresh")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PROCESS_ROLE) private readonly role: ProcessRole,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
    private readonly cfg: CatalogSettingsService,
    private readonly budget: CatalogBudgetService,
    private readonly ae: AviationEdgeService,
    private readonly suppliers: SuppliersService,
    private readonly write: ScheduleWriteService,
    private readonly reference: ReferenceService,
  ) {}

  async onModuleInit() {
    this.workers.registerJob("catalog", SCHEDULE_JOBS.tick, (j: Job) => this.tick(j.data as { catchup?: boolean }))
    await this.queues.get("catalog").upsertJobScheduler("catalog-schedule-tick", { every: SCHEDULE_TICK_HOURS * HOUR }, { name: SCHEDULE_JOBS.tick, data: {} })
      .catch((err) => this.log.warn({ err: String(err) }, "schedule tick not registered"))
    // Worker start: one catch-up tick, which the lock and the 4-hour floor keep from doubling a tick that just ran.
    if (this.role === "worker") await this.queues.get("catalog").add(SCHEDULE_JOBS.tick, { catchup: true }, { jobId: `catalog-schedule-boot-${Date.now()}`, delay: 10_000 }).catch(() => undefined)
  }

  private async takeLock(token: string) {
    return (await this.redis.set(SCHEDULE_LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX")) === "OK"
  }

  private async renewLock(token: string) {
    if ((await this.redis.get(SCHEDULE_LOCK_KEY)) === token) await this.redis.pexpire(SCHEDULE_LOCK_KEY, LOCK_TTL_MS)
  }

  private async releaseLock(token: string) {
    await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, SCHEDULE_LOCK_KEY, token)
  }

  async tick(data: { catchup?: boolean } = {}, now = new Date()): Promise<Record<string, unknown>> {
    const pause = await this.ae.pause(now)
    // BUDGET is derived below too, so it can report its numbers.
    if (pause !== "NONE" && pause !== "BUDGET") return { skipped: pause }
    const state = await this.ae.state()
    if (data.catchup && state.lastTickAt && now.getTime() - Date.parse(state.lastTickAt) < SCHEDULE_TICK_HOURS * HOUR) return { skipped: "RECENT_TICK" }
    const lock = randomToken(12)
    if (!(await this.takeLock(lock))) return { skipped: "LOCKED" }
    try {
      const key = await this.ae.key()
      if (!key) return { skipped: "NO_KEY" }
      const s = await this.cfg.get()
      const used = await this.ae.callsThisMonth(now)
      const b = scheduleBudget({ monthlyCalls: s.aviationEdgeMonthlyCalls, reserveCalls: s.aviationEdgeReserveCalls, usedCalls: used, maxSlotsPerRun: s.maxSlotsPerRun, now })
      await this.ae.updateState(() => ({ lastTickAt: now.toISOString() }))
      if (b.paused) return { skipped: "BUDGET", used }
      const due = selectScheduleSlots(await this.slotStates(s.aviationEdgeMinDaysAhead, s.aviationEdgeMaxDaysAhead, now), { minDaysAhead: s.aviationEdgeMinDaysAhead, maxDaysAhead: s.aviationEdgeMaxDaysAhead }, now, b.slotsAllowed)
      if (!due.length) return { skipped: "NOTHING_DUE", slotsAllowed: b.slotsAllowed }
      return await this.run(key, due.map((d) => d.id), now, lock)
    } finally {
      await this.releaseLock(lock)
    }
  }

  /** Direct slots in the window with their schedule state, creating the missing `catalog_schedule_slots` rows first. */
  private async slotStates(minDays: number, maxDays: number, now: Date): Promise<ScheduleSlotState[]> {
    const rows = await this.db.select({ id: catalogSlots.id, date: catalogSlots.departureDate, kind: flightWatchlistRoutes.kind, last: catalogScheduleSlots.lastFetchedAt, due: catalogScheduleSlots.nextDueAt, has: catalogScheduleSlots.slotId })
      .from(catalogSlots)
      .innerJoin(flightWatchlistRoutes, eq(flightWatchlistRoutes.id, catalogSlots.routeId))
      .leftJoin(catalogScheduleSlots, eq(catalogScheduleSlots.slotId, catalogSlots.id))
      .where(and(eq(flightWatchlistRoutes.enabled, true), eq(flightWatchlistRoutes.kind, "DIRECT"), gte(catalogSlots.departureDate, isoDate(addDays(now, minDays))), lte(catalogSlots.departureDate, isoDate(addDays(now, maxDays)))))
    const missing = rows.filter((r) => !r.has)
    if (missing.length) await this.db.insert(catalogScheduleSlots).values(missing.map((r) => ({ slotId: r.id, provider: ID, nextDueAt: now }))).onConflictDoNothing()
    return rows.map((r) => ({ id: r.id, routeKind: r.kind, departureDate: r.date, lastFetchedAt: r.last ?? null, nextDueAt: r.has ? r.due : now }))
  }

  /** One ledger row per tick, opened before the first call so the calls count while it runs. Calls go out one at a time. */
  private async run(key: string, slotIds: string[], now: Date, lock: string): Promise<Record<string, unknown>> {
    const jobs = await this.jobsFor(slotIds)
    const ledgerId = await this.budget.openLedger({ provider: ID, purpose: "refresh", slotIds, maxResults: 0, estCostUsd: 0, maxChargeUsd: 0, credits: jobs.length })
    const sum = { ok: 0, failed: 0, billed: 0, rows: 0, fatal: null as "AUTH" | "RATE_LIMITED" | null, error: null as string | null }
    let streak = 0
    const client = new AviationEdgeClient(key)
    const fetchedAt = new Date()
    try {
      for (const job of jobs) {
        // Three failures in a row mean an outage: the rest of the tick would only repeat them (and book timeouts).
        if (sum.fatal || streak >= STREAK_LIMIT) break
        try {
          const raw = await client.futureSchedule({ type: "departure", iataCode: job.origin, arrIata: job.destination, date: job.date })
          sum.billed++
          const norm = normaliseSchedule(raw, { reference: this.reference.lookup(), origin: job.origin, destination: job.destination, date: job.date })
          sum.ok++
          streak = 0
          sum.rows += norm.flights.length
          await this.write.writeScheduleSlot({ slotId: job.slotId, flights: norm.flights, fetchedAt, notices: norm.notices }).catch((err) => this.log.error({ slot: job.slotId, err: String(err) }, "schedule write failed; the slot stays due"))
        } catch (err) {
          const word = failureWord(err)
          sum.failed++
          streak++
          sum.error ??= word
          if (billedOnFailure(err)) sum.billed++
          if (word === "AUTH" || word === "RATE_LIMITED") sum.fatal = word
          else await this.write.writeScheduleSlot({ slotId: job.slotId, flights: [], fetchedAt, notices: [], errored: word }).catch(() => undefined)
        }
        await this.renewLock(lock)
      }
    } catch (err) {
      await this.budget.closeLedger({ id: ledgerId }, { status: "FAILED", credits: sum.billed, error: String(err).slice(0, 300) })
      throw err
    }
    const status = sum.failed === 0 && sum.ok === jobs.length ? "SUCCEEDED" : sum.ok ? "PARTIAL" : "FAILED"
    await this.budget.closeLedger({ id: ledgerId }, { status, rowsBilled: sum.rows, credits: sum.billed, error: sum.error })
    await this.afterRun(sum, now)
    this.log.log({ ledger: ledgerId, ok: sum.ok, failed: sum.failed, calls: sum.billed, flights: sum.rows, fatal: sum.fatal }, "schedule tick done")
    return { slots: jobs.length, ok: sum.ok, failed: sum.failed, calls: sum.billed, fatal: sum.fatal }
  }

  private async jobsFor(slotIds: string[]) {
    const out: { slotId: string; date: string; origin: string; destination: string }[] = []
    for (const slotId of slotIds) {
      const [r] = await this.db.select({ date: catalogSlots.departureDate, origin: flightWatchlistRoutes.origin, destination: flightWatchlistRoutes.destination }).from(catalogSlots)
        .innerJoin(flightWatchlistRoutes, eq(flightWatchlistRoutes.id, catalogSlots.routeId)).where(eq(catalogSlots.id, slotId))
      if (r) out.push({ slotId, ...r })
    }
    return out
  }

  /** AUTH marks the credential (which stops the pacer until a new key is entered); RATE_LIMITED pauses for an hour; three failed ticks in a row open the circuit. */
  private async afterRun(sum: { ok: number; failed: number; fatal: "AUTH" | "RATE_LIMITED" | null; error: string | null }, now: Date) {
    if (sum.fatal === "AUTH") {
      await this.suppliers.markCredentialInvalid(ID)
      return
    }
    if (sum.fatal === "RATE_LIMITED") {
      await this.ae.updateState(() => ({ pause: { reason: "RATE_LIMITED", until: new Date(now.getTime() + RATE_LIMIT_PAUSE_MS).toISOString(), at: now.toISOString(), detail: "Aviation Edge answered 429 or a quota message" } }))
      return
    }
    if (sum.ok === 0 && sum.failed > 0) {
      const st = await this.ae.updateState((cur) => ({ failedTicks: cur.failedTicks + 1 }))
      if (st.failedTicks >= CIRCUIT_AFTER) await this.ae.updateState(() => ({ pause: { reason: "CIRCUIT", until: new Date(now.getTime() + CIRCUIT_PAUSE_MS).toISOString(), at: now.toISOString(), detail: `${st.failedTicks} ticks failed in a row (${sum.error ?? "no detail"})` } }))
      return
    }
    if (sum.ok > 0) await this.ae.updateState(() => ({ failedTicks: 0, pause: null }))
  }
}

