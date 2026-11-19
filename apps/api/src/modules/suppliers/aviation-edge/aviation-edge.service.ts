import { Inject, Injectable } from "@nestjs/common"
import { and, eq, gte, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { AVIATION_EDGE_COVERAGE_AIRPORTS, type DevAviationEdgeCoverage, type DevAviationEdgeStatus, type DevAviationEdgeTestResult } from "@unitravel/contracts"
import { type Db, flightSchedules, providerUsageLedger } from "@unitravel/db"
import { scheduleBudget } from "@unitravel/engine"

import { AppError } from "../../../core/errors"
import { DB, REDIS, UnitOfWork } from "../../../core/infra.module"
import { AuditService } from "../../audit/audit.service"
import { CatalogBudgetService } from "../../catalog/catalog-budget.service"
import { CatalogSettingsService } from "../../catalog/catalog-settings.service"
import { SupplierError } from "../adapter"
import { AVIATION_EDGE_PROVIDER_ID as ID, AviationEdgeClient } from "../adapters/aviation-edge/client"
import { SuppliersService } from "../suppliers.service"

/** Redis keys of the schedule layer (ADR-0036). The lock is held by the tick in `ScheduleRefreshService`. */
export const SCHEDULE_LOCK_KEY = "catalog:schedule:lock"
export const SCHEDULE_STATE_KEY = "catalog:schedule:state"
export const COVERAGE_KEY = "aviation-edge:coverage:last"

const DAY = 86_400_000
export const PROBE_DAYS_AHEAD = 8

export type SchedulePause = DevAviationEdgeStatus["pause"]
/** What survives between ticks. Pauses that follow from the credential or the provider row are derived, never stored. */
export interface ScheduleState {
  pause: { reason: "RATE_LIMITED" | "CIRCUIT"; until: string; at: string; detail?: string } | null
  failedTicks: number
  lastTickAt: string | null
}
const EMPTY: ScheduleState = { pause: null, failedTicks: 0, lastTickAt: null }

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
export const probeDate = (now = new Date()) => isoDate(new Date(now.getTime() + PROBE_DAYS_AHEAD * DAY))

/** A short, key-free word for what went wrong (shown to staff and stored with a ledger row). */
export function failureWord(err: unknown): string {
  if (!(err instanceof SupplierError)) return "UNAVAILABLE"
  switch (err.code) {
    case "SUPPLIER_AUTH": return "AUTH"
    case "SUPPLIER_RATE_LIMITED": return "RATE_LIMITED"
    case "SUPPLIER_TIMEOUT": return "TIMEOUT"
    case "SUPPLIER_UNKNOWN": return "BAD_RESPONSE"
    case "SUPPLIER_BAD_REQUEST": return "BAD_REQUEST"
    default: return "UNAVAILABLE"
  }
}

/** Whether Aviation Edge counted the failed call: a timeout or a 200 with a bad body yes; a refused or unreached call no (DOCUMENTED: failed calls are not counted). */
export const billedOnFailure = (err: unknown) => err instanceof SupplierError && err.raw === "billed"

const rowsOf = (rows: unknown[]) => rows.filter((r): r is Record<string, any> => !!r && typeof r === "object")

/**
 * ADR-0036: everything the Developer Panel and the pacer share about Aviation Edge. The key is read from the encrypted credential store on
 * every use (no environment variable) and never leaves this class except into the client.
 */
@Injectable()
export class AviationEdgeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly suppliers: SuppliersService,
    private readonly cfg: CatalogSettingsService,
    private readonly budget: CatalogBudgetService,
    private readonly audit: AuditService,
  ) {}

  async key(): Promise<string | null> {
    return (await this.suppliers.credentials(ID))?.apiKey ?? null
  }

  // ---------------- budget ----------------

  /** Calls booked this calendar month (UTC): ticks, tests and probes together. A batch in flight counts at what it announced. */
  async callsThisMonth(now = new Date()): Promise<number> {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const [r] = await this.db.select({ n: sql<string>`coalesce(sum(${providerUsageLedger.credits}), 0)` }).from(providerUsageLedger).where(and(eq(providerUsageLedger.provider, ID), gte(providerUsageLedger.startedAt, since)))
    return Number(r?.n ?? 0)
  }

  // ---------------- runtime state (Redis) ----------------

  async state(): Promise<ScheduleState> {
    try {
      const raw = await this.redis.get(SCHEDULE_STATE_KEY)
      return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<ScheduleState>) } : { ...EMPTY }
    } catch {
      return { ...EMPTY }
    }
  }

  async updateState(fn: (s: ScheduleState) => Partial<ScheduleState>): Promise<ScheduleState> {
    const next = { ...(await this.state()), ...fn(await this.state()) }
    await this.redis.set(SCHEDULE_STATE_KEY, JSON.stringify(next))
    return next
  }

  /**
   * Why the pacer is not running, if it is not. Derived on every call: the provider switch, the credential and its flag, then a stored
   * RATE_LIMITED or CIRCUIT pause. A stored pause ends at its time, or at once when the key was replaced after it began.
   * A spent budget is not stored: it is computed from the ledger.
   */
  async pause(now = new Date()): Promise<SchedulePause> {
    const row = await this.suppliers.row(ID)
    if (!row?.enabled) return "DISABLED"
    const meta = await this.suppliers.credentialMeta(ID)
    if (!meta) return "NO_KEY"
    if (meta.invalidAt) return "AUTH"
    const { pause } = await this.state()
    if (pause && Date.parse(pause.until) > now.getTime() && Date.parse(pause.at) >= meta.rotatedAt.getTime()) return pause.reason
    const s = await this.cfg.get()
    const b = scheduleBudget({ monthlyCalls: s.aviationEdgeMonthlyCalls, reserveCalls: s.aviationEdgeReserveCalls, usedCalls: await this.callsThisMonth(now), maxSlotsPerRun: s.maxSlotsPerRun, now })
    return b.paused ? "BUDGET" : "NONE"
  }

  // ---------------- staff actions ----------------

  /** One call, IKA→IST, today + 8 days. Books one call in the ledger, marks the credential tested, and flags a rejected key. */
  async test(now = new Date()): Promise<DevAviationEdgeTestResult> {
    const key = await this.key()
    if (!key) throw new AppError("VALIDATION_FAILED", "The Aviation Edge key is not set; enter it first", [{ path: "credentials", code: "NOT_SET" }])
    const probe = { from: "IKA", to: "IST", date: probeDate(now) }
    const ledgerId = await this.budget.openLedger({ provider: ID, purpose: "smoke", slotIds: [], maxResults: 0, estCostUsd: 0, maxChargeUsd: 0, credits: 1, meta: { kind: "test", ...probe } })
    const started = Date.now()
    const testedAt = new Date()
    try {
      const rows = rowsOf(await new AviationEdgeClient(key).futureSchedule({ type: "departure", iataCode: probe.from, arrIata: probe.to, date: probe.date }))
      await this.budget.closeLedger({ id: ledgerId }, { status: "SUCCEEDED", rowsBilled: rows.length, credits: 1 })
      await this.suppliers.markTested(ID, testedAt)
      return {
        ok: true, latencyMs: Date.now() - started, probe, rows: rows.length,
        carriers: [...new Set(rows.map((r) => String(r.airline?.iataCode ?? "")).filter(Boolean))].sort(), sampleFlight: rows.length ? String(rows[0]!.flight?.iataNumber ?? "") || null : null,
        detail: rows.length ? null : "NO_RECORD: the key works, but Aviation Edge listed no flights for this route and date", testedAt: testedAt.toISOString(),
      }
    } catch (err) {
      const word = failureWord(err)
      await this.budget.closeLedger({ id: ledgerId }, { status: "FAILED", credits: billedOnFailure(err) ? 1 : 0, error: word })
      await this.suppliers.markTested(ID, testedAt)
      if (word === "AUTH") await this.suppliers.markCredentialInvalid(ID)
      return { ok: false, latencyMs: Date.now() - started, probe, rows: 0, carriers: [], sampleFlight: null, detail: word, testedAt: testedAt.toISOString() }
    }
  }

  /** Ten departure calls (no destination filter), one per priority airport, for today + 8 days. Staff-triggered only; draws on the reserve. */
  async coverage(actor: { userId: string; ip?: string }, requestId?: string, now = new Date()): Promise<DevAviationEdgeCoverage> {
    const key = await this.key()
    if (!key) throw new AppError("VALIDATION_FAILED", "The Aviation Edge key is not set; enter it first", [{ path: "credentials", code: "NOT_SET" }])
    const date = probeDate(now)
    const airports = AVIATION_EDGE_COVERAGE_AIRPORTS
    const ledgerId = await this.budget.openLedger({ provider: ID, purpose: "smoke", slotIds: [], maxResults: 0, estCostUsd: 0, maxChargeUsd: 0, credits: airports.length, meta: { kind: "coverage", date } })
    const client = new AviationEdgeClient(key)
    const out: DevAviationEdgeCoverage["airports"] = []
    let credits = 0
    let stop: string | null = null
    for (const iata of airports) {
      if (stop) { out.push({ iata, departures: null, carriers: [], destinations: 0, error: `NOT_RUN: ${stop}` }); continue }
      try {
        const rows = rowsOf(await client.futureSchedule({ type: "departure", iataCode: iata, date }))
        credits++
        out.push({
          iata, departures: rows.length, carriers: [...new Set(rows.map((r) => String(r.airline?.iataCode ?? "")).filter(Boolean))].sort().slice(0, 40),
          destinations: new Set(rows.map((r) => String(r.arrival?.iataCode ?? "")).filter(Boolean)).size, error: null,
        })
      } catch (err) {
        const word = failureWord(err)
        if (billedOnFailure(err)) credits++
        out.push({ iata, departures: null, carriers: [], destinations: 0, error: word })
        if (word === "AUTH" || word === "RATE_LIMITED") stop = word
        if (word === "AUTH") await this.suppliers.markCredentialInvalid(ID)
      }
    }
    await this.budget.closeLedger({ id: ledgerId }, { status: out.every((a) => a.error) ? "FAILED" : out.some((a) => a.error) ? "PARTIAL" : "SUCCEEDED", credits, error: stop })
    const result: DevAviationEdgeCoverage = { date, airports: out, callsUsed: credits, ranAt: new Date().toISOString(), ranBy: actor.userId }
    await this.redis.set(COVERAGE_KEY, JSON.stringify(result))
    await this.uow.run((tx) => this.audit.record(tx, {
      actorUserId: actor.userId, actorKind: "STAFF", action: "provider.coverage_probed", entityType: "provider", entityId: ID, ip: actor.ip, requestId,
      after: { date, calls: credits, airports: out.map((a) => ({ iata: a.iata, departures: a.departures, error: a.error })) },
    }))
    return result
  }

  async lastCoverage(): Promise<DevAviationEdgeCoverage | null> {
    try {
      const raw = await this.redis.get(COVERAGE_KEY)
      return raw ? (JSON.parse(raw) as DevAviationEdgeCoverage) : null
    } catch {
      return null
    }
  }

  async status(now = new Date()): Promise<DevAviationEdgeStatus> {
    const s = await this.cfg.get()
    const [counts] = await this.db.select({
      slots: sql<string>`count(distinct ${flightSchedules.slotId})`, current: sql<string>`count(*)`,
    }).from(flightSchedules).where(and(eq(flightSchedules.provider, ID), eq(flightSchedules.isCurrent, true)))
    return {
      callsUsedThisMonth: await this.callsThisMonth(now), monthlyCalls: s.aviationEdgeMonthlyCalls, reserveCalls: s.aviationEdgeReserveCalls, pause: await this.pause(now),
      lastTickAt: (await this.state()).lastTickAt, slotsWithSchedules: Number(counts?.slots ?? 0), schedulesCurrent: Number(counts?.current ?? 0), lastCoverage: await this.lastCoverage(),
    }
  }
}
