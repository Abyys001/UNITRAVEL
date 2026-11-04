import { Inject, Injectable, Logger } from "@nestjs/common"
import { eq } from "drizzle-orm"

import { CatalogSettings, type CatalogSettingsPatch, DEFAULT_CATALOG_SETTINGS } from "@unitravel/contracts"
import { type Db, settings } from "@unitravel/db"

import { env } from "../../core/env"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"

const SETTINGS_KEY = "catalog"
const STATE_KEY = "catalog.state"
const CACHE_MS = 15_000

export type PauseReason = "MANUAL" | "BUDGET" | "AUTH" | "CIRCUIT"

/** The Apify billing cycle as last read from `/users/me/limits`; never assumed to start on the 1st (spec §4.2). */
export interface CycleCache {
  start: string | null
  end: string | null
  spentUsd: number | null
  capUsd: number | null
  fetchedAt: string
}

/** Runtime state of the pacer (settings row `catalog.state`): written by the worker, read by the admin views. */
export interface CatalogRuntimeState {
  /** Set while refreshes are paused by the system (budget, credential, circuit); auto-resume once it passes (AUTH clears when the credential is replaced). */
  pause: { reason: PauseReason; until: string | null; at: string; detail?: string; /** AUTH on FlightAPI: fingerprint of the rejected key, so a changed key resumes the pacer. */ key?: string } | null
  failedTicks: number
  lastTick: { at: string; outcome: string; tickBudgetUsd: number; slots: number } | null
  schemaAlert: string | null
  cycle: CycleCache | null
  /** The one run in flight, if any. */
  currentRun: { ledgerId: string; startedAt: string } | null
  /** A failed tick's slots, retried once (spec §9). */
  retry: { at: string; ledgerId: string; slotIds: string[] } | null
}

const EMPTY_STATE: CatalogRuntimeState = { pause: null, failedTicks: 0, lastTick: null, schemaAlert: null, cycle: null, currentRun: null, retry: null }

/** Catalog settings (key `catalog`) and pacer runtime state (key `catalog.state`) in the shared `settings` table. */
@Injectable()
export class CatalogSettingsService {
  private readonly log = new Logger("CatalogSettings")
  private cache?: { at: number; value: CatalogSettings }

  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  async get(): Promise<CatalogSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value
    const [row] = await this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY))
    // ADR-0035: FlightAPI is the default source once its key is configured; a stored choice always wins.
    const parsed = CatalogSettings.safeParse({ ...DEFAULT_CATALOG_SETTINGS, source: env().FLIGHTAPI_KEY ? "flightapi" : "apify", ...((row?.value as object | undefined) ?? {}) })
    if (!parsed.success) this.log.error({ issues: parsed.error.issues.length }, "stored catalog settings are invalid; defaults in use")
    const value = parsed.success ? parsed.data : DEFAULT_CATALOG_SETTINGS
    this.cache = { at: Date.now(), value }
    return value
  }

  /** Validated merge, written and audited in one transaction. `actor` is null for the system (reconcile raising costCorrection). */
  async patch(patch: CatalogSettingsPatch, actor: { userId: string; ip?: string } | null, requestId?: string): Promise<CatalogSettings> {
    const before = await this.get()
    const next = CatalogSettings.parse({ ...before, ...patch })
    await this.uow.run(async (tx) => {
      await tx.insert(settings).values({ key: SETTINGS_KEY, value: next, updatedBy: actor?.userId ?? null })
        .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: actor?.userId ?? null, updatedAt: new Date() } })
      const changed = (Object.keys(patch) as (keyof CatalogSettings)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
      await this.audit.record(tx, {
        actorUserId: actor?.userId ?? null, actorKind: actor ? "STAFF" : "SYSTEM", action: "catalog.settings_changed", entityType: "catalog_settings", entityId: SETTINGS_KEY,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, next[k]])), ip: actor?.ip, requestId,
      })
    })
    this.cache = { at: Date.now(), value: next }
    return next
  }

  async state(): Promise<CatalogRuntimeState> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, STATE_KEY))
    return { ...EMPTY_STATE, ...((row?.value as Partial<CatalogRuntimeState> | undefined) ?? {}) }
  }

  /** Read-modify-write. Only the worker (concurrency 1) and the admin pause endpoints write; a lost update costs at worst a stale display field. */
  async updateState(fn: (s: CatalogRuntimeState) => Partial<CatalogRuntimeState>): Promise<CatalogRuntimeState> {
    const cur = await this.state()
    const next = { ...cur, ...fn(cur) }
    await this.db.insert(settings).values({ key: STATE_KEY, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } })
    return next
  }
}
