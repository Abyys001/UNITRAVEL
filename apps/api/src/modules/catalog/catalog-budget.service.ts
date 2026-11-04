import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, eq, gte, sql } from "drizzle-orm"
import { v7 as uuidv7 } from "uuid"

import type { CatalogSettings, UsagePurpose } from "@unitravel/contracts"
import { type Db, providerUsageLedger } from "@unitravel/db"
import { creditBudget, type CreditBudget, tickBudget, type TickBudget } from "@unitravel/engine"

import { DB } from "../../core/infra.module"
import { SupplierError } from "../suppliers/adapter"
import { ApifyClient, APIFY_PROVIDER_ID } from "../suppliers/adapters/apify/client"
import { FLIGHTAPI_PROVIDER_ID } from "../suppliers/adapters/flightapi/client"
import { SuppliersService } from "../suppliers/suppliers.service"
import { type CatalogRuntimeState, CatalogSettingsService, type CycleCache } from "./catalog-settings.service"

const DAY = 86_400_000
/** Spec §4.2: the cycle and usage read from Apify are cached this long. */
export const CYCLE_CACHE_MS = 10 * 60_000

export interface SpendView {
  cycleStart: Date
  cycleEnd: Date
  spentUsd: number
  spentSource: "apify" | "ledger"
  /** What Apify reports as the account cap, if known. */
  capUsd: number | null
  ledgerUsd: number
  adminSpentUsd: number
  refreshSpentUsd: number
}

export interface LedgerRowInput {
  purpose: UsagePurpose
  providerRunId?: string | null
  slotIds: string[]
  maxResults: number
  estCostUsd: number
  maxChargeUsd: number
  /** Defaults to Apify. FlightAPI rows carry `credits` instead of dollars (ADR-0035). */
  provider?: string
  credits?: number
  meta?: Record<string, unknown>
}

const usd = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * The money side of the catalog (ADR-0034 C2, C6): the billing cycle and spend from Apify's free `/users/me/limits`
 * (cached 10 minutes), the ledger of every metered run, and the budget derived from both. Admin runs and staff searches draw on
 * the reserve through `reserveAdmin`, so nothing spends without a ledger row.
 */
@Injectable()
export class CatalogBudgetService {
  private readonly log = new Logger("CatalogBudget")

  constructor(@Inject(DB) private readonly db: Db, private readonly cfg: CatalogSettingsService, private readonly suppliers: SuppliersService) {}

  // ---------------- ledger ----------------

  async openLedger(row: LedgerRowInput): Promise<string> {
    const id = uuidv7()
    await this.db.insert(providerUsageLedger).values({
      id, provider: row.provider ?? APIFY_PROVIDER_ID, purpose: row.purpose, providerRunId: row.providerRunId ?? null, slotIds: row.slotIds, maxResults: row.maxResults,
      estCostUsd: String(row.estCostUsd), maxChargeUsd: String(row.maxChargeUsd), credits: row.credits ?? 0, meta: row.meta ?? null, status: "RUNNING",
    })
    return id
  }

  async closeLedger(where: { id: string } | { providerRunId: string }, patch: Partial<Pick<typeof providerUsageLedger.$inferInsert, "apifyRunId" | "rowsBilled" | "status" | "error" | "credits" | "meta">> & { estCostUsd?: number; actualCostUsd?: number | null }) {
    const { estCostUsd, actualCostUsd, ...rest } = patch
    const set = {
      ...rest, ...(estCostUsd !== undefined ? { estCostUsd: String(estCostUsd) } : {}), ...(actualCostUsd !== undefined ? { actualCostUsd: actualCostUsd === null ? null : String(actualCostUsd) } : {}),
      ...(patch.status && patch.status !== "RUNNING" ? { finishedAt: new Date() } : {}),
    }
    await this.db.update(providerUsageLedger).set(set).where("id" in where ? eq(providerUsageLedger.id, where.id) : eq(providerUsageLedger.providerRunId, where.providerRunId))
  }

  /** Cost of what ran in the cycle by purpose. A run still in flight counts at its charge cap, so a second run cannot be funded from the same money. */
  private async ledgerSince(since: Date): Promise<{ total: number; admin: number; refresh: number }> {
    const cost = sql<string>`coalesce(sum(case when ${providerUsageLedger.status} = 'RUNNING' then ${providerUsageLedger.maxChargeUsd} else coalesce(${providerUsageLedger.actualCostUsd}, ${providerUsageLedger.estCostUsd}) end), 0)`
    const rows = await this.db.select({ purpose: providerUsageLedger.purpose, usd: cost }).from(providerUsageLedger)
      .where(and(eq(providerUsageLedger.provider, APIFY_PROVIDER_ID), gte(providerUsageLedger.startedAt, since))).groupBy(providerUsageLedger.purpose)
    const by = (p: string) => Number(rows.find((r) => r.purpose === p)?.usd ?? 0)
    const refresh = by("refresh")
    const admin = rows.filter((r) => r.purpose !== "refresh").reduce((n, r) => n + Number(r.usd), 0)
    return { total: refresh + admin, admin, refresh }
  }

  // ---------------- FlightAPI credits (ADR-0035) ----------------

  /** Credits drawn this calendar month (UTC) by purpose; a call in flight counts at its full price, so a second call cannot be funded from the same credits. */
  async creditsThisMonth(now = new Date()): Promise<{ used: number; admin: number }> {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const rows = await this.db.select({ purpose: providerUsageLedger.purpose, credits: sql<string>`coalesce(sum(${providerUsageLedger.credits}), 0)` }).from(providerUsageLedger)
      .where(and(eq(providerUsageLedger.provider, FLIGHTAPI_PROVIDER_ID), gte(providerUsageLedger.startedAt, since))).groupBy(providerUsageLedger.purpose)
    const total = rows.reduce((n, r) => n + Number(r.credits), 0)
    return { used: total, admin: total - Number(rows.find((r) => r.purpose === "refresh")?.credits ?? 0) }
  }

  async credits(s?: CatalogSettings, now = new Date()): Promise<{ used: number; adminUsed: number; budget: CreditBudget; settings: CatalogSettings }> {
    const settings = s ?? (await this.cfg.get())
    const { used, admin } = await this.creditsThisMonth(now)
    return { used, adminUsed: admin, settings, budget: creditBudget({ settings, usedCredits: used, adminUsedCredits: admin, now }) }
  }

  // ---------------- cycle and spend ----------------

  /** Reads `/users/me/limits` when the cached copy is older than 10 minutes. Returns null when there is no usable token or the call fails. */
  private async refreshCycle(state: CatalogRuntimeState, force: boolean): Promise<CycleCache | null> {
    const cached = state.cycle
    if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < CYCLE_CACHE_MS) return cached
    const token = (await this.suppliers.credentials(APIFY_PROVIDER_ID))?.token
    if (!token || (await this.suppliers.credentialInvalid(APIFY_PROVIDER_ID))) return cached
    try {
      const l = await new ApifyClient(token).limits()
      const fresh: CycleCache = { start: l.cycle, end: l.cycleEnd, spentUsd: l.monthlyUsageUsd, capUsd: l.maxMonthlyUsageUsd, fetchedAt: new Date().toISOString() }
      await this.cfg.updateState(() => ({ cycle: fresh }))
      return fresh
    } catch (err) {
      if (err instanceof SupplierError && err.code === "SUPPLIER_AUTH") await this.suppliers.markCredentialInvalid(APIFY_PROVIDER_ID)
      this.log.warn({ code: err instanceof SupplierError ? err.code : "UNKNOWN" }, "Apify limits unavailable; the ledger is used")
      return cached
    }
  }

  async spend(s: CatalogSettings, opts: { force?: boolean; now?: Date } = {}): Promise<SpendView> {
    const now = opts.now ?? new Date()
    const state = await this.cfg.state()
    const cycle = await this.refreshCycle(state, !!opts.force)
    // Without a reading, assume the last known cycle repeated every 30 days; with none at all, the 30 days behind us. Never "the 1st of the month".
    let start = cycle?.start ? new Date(cycle.start) : new Date(now.getTime() - 30 * DAY)
    let end = cycle?.end ? new Date(cycle.end) : new Date(now.getTime() + 30 * DAY)
    while (end.getTime() <= now.getTime()) { start = end; end = new Date(end.getTime() + 30 * DAY) }
    const ledger = await this.ledgerSince(start)
    if (cycle?.spentUsd != null && cycle.end && new Date(cycle.end).getTime() > now.getTime()) {
      // Apify's number lags our runs: add what ran after the reading was taken so a finished run is never invisible.
      const since = await this.ledgerSince(new Date(Date.parse(cycle.fetchedAt)))
      return { cycleStart: start, cycleEnd: end, spentUsd: usd(cycle.spentUsd + since.total * s.costCorrection), spentSource: "apify", capUsd: cycle.capUsd, ledgerUsd: usd(ledger.total), adminSpentUsd: usd(ledger.admin), refreshSpentUsd: usd(ledger.refresh) }
    }
    // Spec §9: never assume zero spend when the call fails.
    return { cycleStart: start, cycleEnd: end, spentUsd: usd(ledger.total * s.costCorrection), spentSource: "ledger", capUsd: cycle?.capUsd ?? null, ledgerUsd: usd(ledger.total), adminSpentUsd: usd(ledger.admin), refreshSpentUsd: usd(ledger.refresh) }
  }

  async budget(s?: CatalogSettings, opts: { force?: boolean; now?: Date } = {}): Promise<{ spend: SpendView; budget: TickBudget; settings: CatalogSettings }> {
    const settings = s ?? (await this.cfg.get())
    const now = opts.now ?? new Date()
    const spend = await this.spend(settings, opts)
    return { spend, settings, budget: tickBudget({ settings, spentUsd: spend.spentUsd, adminSpentUsd: spend.adminSpentUsd, cycleEnd: spend.cycleEnd, now }) }
  }

  /** True when the reserve (plus anything the budget still allows) covers `costUsd`. Staff searches call this before they start a run. */
  async canSpendAdmin(costUsd: number): Promise<boolean> {
    return (await this.budget()).budget.adminAvailableUsd + 1e-9 >= costUsd
  }

  /** How many `costUsd` runs the reserve can still pay for; the planner's replacement for the call-count budget (ADR-0034). */
  async adminRunsAffordable(costUsd: number): Promise<number> {
    if (!(costUsd > 0)) return 0
    return Math.max(0, Math.floor((await this.budget()).budget.adminAvailableUsd / costUsd + 1e-9))
  }
}
