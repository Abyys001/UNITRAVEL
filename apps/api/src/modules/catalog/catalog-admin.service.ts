import { Inject, Injectable } from "@nestjs/common"
import type { z } from "zod"
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  AdminCatalogResult, type ApifyIntegrationTest, type BudgetEstimate, CatalogCoverage, CatalogSettings, type CatalogSettingsPatch, type CatalogSettingsResponse, type CatalogUsage, type WatchRoute, WatchRouteInput,
} from "@unitravel/contracts"
import { catalogSlots, type Db, flightResultPricing, flightResults, flightWatchlistRoutes, providerUsageLedger } from "@unitravel/db"
import { daysOut, estimateMonthly, slotStatus, tierFor } from "@unitravel/engine"

import { AppError } from "../../core/errors"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { SupplierError } from "../suppliers/adapter"
import { APIFY_PROVIDER_ID, ApifyClient } from "../suppliers/adapters/apify/client"
import { SuppliersService } from "../suppliers/suppliers.service"
import { CatalogBudgetService } from "./catalog-budget.service"
import { CatalogRefreshService } from "./catalog-refresh.service"
import { CatalogSettingsService } from "./catalog-settings.service"

type RouteRow = typeof flightWatchlistRoutes.$inferSelect
export interface AdminActor { userId: string; ip?: string }

const DAY = 86_400_000
const usd = (n: number) => Math.round(n * 1e6) / 1e6

const routeView = (r: RouteRow): WatchRoute => ({
  id: r.id, origin: r.origin, destination: r.destination, enabled: r.enabled, horizonDays: r.horizonDays, maxResults: r.maxResults, priorityWeight: r.priorityWeight, note: r.note, kind: r.kind,
})

/** Admin side of the catalog: usage, coverage, settings with the budget calculator, the watchlist, and the Apify integration checks. */
@Injectable()
export class CatalogAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly cfg: CatalogSettingsService,
    private readonly budget: CatalogBudgetService,
    private readonly refresh: CatalogRefreshService,
    private readonly suppliers: SuppliersService,
    private readonly compliance: ComplianceService,
    private readonly queues: Queues,
  ) {}

  // ---------------- usage ----------------

  async usage(now = new Date()): Promise<CatalogUsage> {
    const { spend, budget, settings: s } = await this.budget.budget(undefined, { now })
    const state = await this.cfg.state()
    const since = new Date(now.getTime() - 7 * DAY)
    const [week] = await this.db.select({ runs: sql<number>`count(*)::int`, rows: sql<number>`coalesce(sum(${providerUsageLedger.rowsBilled}), 0)::int`, cost: sql<string>`coalesce(sum(coalesce(${providerUsageLedger.actualCostUsd}, ${providerUsageLedger.estCostUsd})), 0)` })
      .from(providerUsageLedger).where(and(eq(providerUsageLedger.purpose, "refresh"), gte(providerUsageLedger.startedAt, since), inArray(providerUsageLedger.status, ["SUCCEEDED", "PARTIAL"])))
    // Days of history we actually have (the cycle may be younger than a week), so the average is not diluted.
    const days = Math.max(1, Math.min(7, (now.getTime() - spend.cycleStart.getTime()) / DAY))
    const dailyUsd = Number(week?.cost ?? 0) / days
    const daysLeft = Math.max(0, (spend.cycleEnd.getTime() - now.getTime()) / DAY)
    const projectedUsd = usd(spend.spentUsd + dailyUsd * s.costCorrection * daysLeft)
    const interval = DAY / s.refreshTicksPerDay
    const scheduled = await this.queues.get("catalog").getJobScheduler("catalog-refresh-tick").catch(() => undefined)
    const next = typeof scheduled?.next === "number" ? new Date(scheduled.next) : state.lastTick ? new Date(Date.parse(state.lastTick.at) + interval) : null
    const reserveLeft = Math.max(0, s.adminReserveUsd - spend.adminSpentUsd)
    return {
      cycleStart: spend.cycleStart.toISOString(), cycleEnd: spend.cycleEnd.toISOString(), spentUsd: spend.spentUsd, spentSource: spend.spentSource, ledgerUsd: spend.ledgerUsd,
      projectedUsd, budgetUsd: s.monthlyBudgetUsd, availableUsd: usd(budget.availableUsd), reserveLeftUsd: usd(reserveLeft), reserveReleased: budget.reserveReleased,
      rowsPerDay: Math.round((Number(week?.rows ?? 0) / days) * 10) / 10, runsPerDay: Math.round((Number(week?.runs ?? 0) / days) * 10) / 10, costCorrection: s.costCorrection,
      paused: s.paused || !!state.pause, pauseReason: s.paused ? "MANUAL" : state.pause ? `${state.pause.reason}${state.pause.detail ? `: ${state.pause.detail}` : ""}` : null, accountCapUsd: spend.capUsd,
      lastTick: state.lastTick, nextTickAt: next && Number.isFinite(next.getTime()) ? next.toISOString() : null, schemaAlert: state.schemaAlert,
      overBudget: projectedUsd > s.monthlyBudgetUsd - s.safetyMarginUsd,
    }
  }

  // ---------------- coverage ----------------

  async coverage(now = new Date()): Promise<CatalogCoverage> {
    const s = await this.cfg.get()
    const routes = await this.db.select().from(flightWatchlistRoutes).orderBy(asc(flightWatchlistRoutes.origin), asc(flightWatchlistRoutes.destination))
    const today = now.toISOString().slice(0, 10)
    const slots = routes.length ? await this.db.select().from(catalogSlots).where(and(inArray(catalogSlots.routeId, routes.map((r) => r.id)), gte(catalogSlots.departureDate, today))).orderBy(asc(catalogSlots.departureDate)) : []
    const board = await this.redis.zrevrange("demand:untracked", 0, 19, "WITHSCORES").catch(() => [] as string[])
    const untracked: CatalogCoverage["untracked"] = []
    for (let i = 0; i < board.length; i += 2) {
      const [origin, destination] = board[i]!.split("-")
      untracked.push({ origin: origin!, destination: destination!, demand: Math.round(Number(board[i + 1]) * 100) / 100 })
    }
    const policy = await this.compliance.carrierPolicy()
    // Without the Iran lane row, Iran results would be listed without the review notice (ADR-0031 I3, ADR-0034).
    const hasIran = [...(policy.reviewLanes ?? []), ...(policy.blockedLanes ?? [])].some((k) => k.startsWith("IR:") || k.endsWith(":IR"))
    return CatalogCoverage.parse({
      routes: routes.map((r) => ({
        route: routeView(r),
        slots: slots.filter((x) => x.routeId === r.id).map((x) => ({
          id: x.id, date: x.departureDate, status: slotStatus({ departureDate: x.departureDate, lastFetchedAt: x.lastFetchedAt, recentCounts: x.recentCounts, consecutiveErrors: x.consecutiveErrors, consecutiveEmpty: x.consecutiveEmpty }, s, now),
          tier: tierFor(daysOut(x.departureDate, now), s.tiers).name, lastFetchedAt: x.lastFetchedAt?.toISOString() ?? null, nextDueAt: x.nextDueAt.toISOString(), resultCount: x.lastResultCount,
          demand: Math.round(x.demandScore * 100) / 100, consecutiveEmpty: x.consecutiveEmpty, consecutiveErrors: x.consecutiveErrors, lastError: x.lastError,
        })),
      })),
      untracked,
      warnings: hasIran ? [] : ["NO_IR_LANE_POLICY"],
    })
  }

  // ---------------- settings ----------------

  private async estimate(s: CatalogSettings): Promise<BudgetEstimate> {
    return estimateMonthly(await this.db.select().from(flightWatchlistRoutes), s)
  }

  async settingsView(): Promise<CatalogSettingsResponse> {
    const settings = await this.cfg.get()
    return { settings, estimate: await this.estimate(settings) }
  }

  async patchSettings(patch: CatalogSettingsPatch, actor: AdminActor, requestId?: string): Promise<CatalogSettingsResponse> {
    const before = await this.cfg.get()
    const settings = await this.cfg.patch(patch, actor, requestId)
    if (patch.refreshTicksPerDay !== undefined && patch.refreshTicksPerDay !== before.refreshTicksPerDay) await this.refresh.schedule()
    if (patch.connections) await this.syncCombinedRoutes(settings)
    return { settings, estimate: await this.estimate(settings) }
  }

  /** Preview only: the merged settings through the same calculator, nothing saved. */
  async previewEstimate(patch: CatalogSettingsPatch): Promise<BudgetEstimate> {
    return this.estimate(CatalogSettings.parse({ ...(await this.cfg.get()), ...patch }))
  }

  /** Every enabled connection pair needs its COMBINED route (never sent to Apify). The feeder routes are the admin's to add. */
  private async syncCombinedRoutes(s: CatalogSettings) {
    for (const p of s.connections.pairs) {
      await this.db.insert(flightWatchlistRoutes).values({ origin: p.from, destination: p.to, kind: "COMBINED", viaHub: p.via, enabled: p.enabled, horizonDays: s.defaultHorizonDays })
        .onConflictDoUpdate({ target: [flightWatchlistRoutes.origin, flightWatchlistRoutes.destination], set: { viaHub: p.via, enabled: p.enabled, updatedAt: new Date() }, setWhere: eq(flightWatchlistRoutes.kind, "COMBINED") })
    }
    await this.refresh.rollSlots()
  }

  // ---------------- routes ----------------

  async listRoutes(): Promise<WatchRoute[]> {
    return (await this.db.select().from(flightWatchlistRoutes).orderBy(asc(flightWatchlistRoutes.origin), asc(flightWatchlistRoutes.destination))).map(routeView)
  }

  async createRoute(body: z.infer<typeof WatchRouteInput>, actor: AdminActor, requestId?: string): Promise<WatchRoute> {
    const [dup] = await this.db.select({ id: flightWatchlistRoutes.id }).from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.origin, body.origin), eq(flightWatchlistRoutes.destination, body.destination)))
    if (dup) throw new AppError("VALIDATION_FAILED", "This route is already on the watchlist", [{ path: "destination", code: "DUPLICATE" }])
    const row = await this.uow.run(async (tx) => {
      const [r] = await tx.insert(flightWatchlistRoutes).values({ origin: body.origin, destination: body.destination, kind: "DIRECT", enabled: body.enabled, horizonDays: body.horizonDays, maxResults: body.maxResults, priorityWeight: body.priorityWeight, note: body.note }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "catalog.route_created", entityType: "catalog_route", entityId: r!.id, after: { origin: r!.origin, destination: r!.destination, horizonDays: r!.horizonDays, maxResults: r!.maxResults }, ip: actor.ip, requestId })
      return r!
    })
    await this.refresh.rollSlots()
    return routeView(row)
  }

  async patchRoute(id: string, patch: Partial<Pick<RouteRow, "enabled" | "horizonDays" | "maxResults" | "priorityWeight" | "note">>, actor: AdminActor, requestId?: string): Promise<WatchRoute> {
    const row = await this.uow.run(async (tx) => {
      const [before] = await tx.select().from(flightWatchlistRoutes).where(eq(flightWatchlistRoutes.id, id)).for("update")
      if (!before) throw new AppError("NOT_FOUND", "Route not found")
      const [r] = await tx.update(flightWatchlistRoutes).set({ ...patch, updatedAt: new Date() }).where(eq(flightWatchlistRoutes.id, id)).returning()
      const changed = Object.keys(patch) as (keyof typeof patch)[]
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "catalog.route_updated", entityType: "catalog_route", entityId: id, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, r![k]])), ip: actor.ip, requestId })
      return r!
    })
    await this.refresh.rollSlots()
    return routeView(row)
  }

  // ---------------- pause ----------------

  async pause(actor: AdminActor, requestId?: string) {
    await this.cfg.patch({ paused: true }, actor, requestId)
    return this.usage()
  }

  /** Resume also clears a system pause (budget, credential, circuit): the operator has decided. */
  async resume(actor: AdminActor, requestId?: string) {
    await this.cfg.patch({ paused: false }, actor, requestId)
    await this.cfg.updateState(() => ({ pause: null, failedTicks: 0 }))
    return this.usage()
  }

  // ---------------- results ----------------

  async slotResults(slotId: string): Promise<AdminCatalogResult[]> {
    const rows = await this.db.select({ r: flightResults, p: flightResultPricing }).from(flightResults).leftJoin(flightResultPricing, eq(flightResultPricing.resultId, flightResults.id))
      .where(eq(flightResults.slotId, slotId)).orderBy(desc(flightResults.isCurrent), asc(flightResults.createdAt))
    return rows.map(({ r, p }) => AdminCatalogResult.parse({
      id: r.id, ...r.detail, isCurrent: r.isCurrent, lastSeenAt: r.lastSeenAt.toISOString(),
      price: p ? { amountMinor: p.amountMinor, currency: p.currency, previousAmountMinor: p.previousAmountMinor, changedAt: p.priceChangedAt?.toISOString() ?? null } : null,
    }))
  }

  // ---------------- Apify integration (Developer Panel) ----------------

  private async client(): Promise<ApifyClient> {
    const token = (await this.suppliers.credentials(APIFY_PROVIDER_ID))?.token
    if (!token) throw new AppError("NOT_CONFIGURED", "The Apify credential is not set")
    return new ApifyClient(token)
  }

  private async asApiError(err: unknown): Promise<never> {
    if (err instanceof AppError) throw err
    const e = err instanceof SupplierError ? err : new SupplierError("SUPPLIER_UNKNOWN", "Apify call failed")
    if (e.code === "SUPPLIER_AUTH") {
      await this.suppliers.markCredentialInvalid(APIFY_PROVIDER_ID)
      throw new AppError("SUPPLIER_AUTH", "Apify rejected the stored token; replace it")
    }
    throw new AppError("SUPPLIER_UNAVAILABLE", `Apify call failed: ${e.code}`)
  }

  /** Apify's free `/users/me/limits`. Never returns the token. */
  async testApify(): Promise<ApifyIntegrationTest> {
    try {
      const l = await (await this.client()).limits()
      await this.suppliers.markTested(APIFY_PROVIDER_ID)
      return { ok: true, cycleEnd: l.cycleEnd, monthlyUsageUsd: l.monthlyUsageUsd, maxMonthlyUsageUsd: l.maxMonthlyUsageUsd }
    } catch (err) {
      return this.asApiError(err)
    }
  }

  /** Sets Apify's account-wide hard cap to the catalog budget (ADR-0034 C9). Step-up and audit are enforced by the caller; only the owner presses it. */
  async applyCap(actor: AdminActor, requestId?: string): Promise<{ ok: true; maxMonthlyUsageUsd: number }> {
    const s = await this.cfg.get()
    try {
      await (await this.client()).setMonthlyCap(s.monthlyBudgetUsd)
    } catch (err) {
      return this.asApiError(err)
    }
    await this.audit.record(this.db, { actorUserId: actor.userId, actorKind: "STAFF", action: "catalog.apify_cap_applied", entityType: "catalog_settings", entityId: "catalog", after: { maxMonthlyUsageUsd: s.monthlyBudgetUsd }, ip: actor.ip, requestId })
    await this.budget.spend(s, { force: true })
    return { ok: true, maxMonthlyUsageUsd: s.monthlyBudgetUsd }
  }
}
