import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, max } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  type AppSettings, type AuthConfig, CONFIG_SCHEMAS, type ConfigDomain, DEFAULT_FLAGS, type EngineRules, FEATURE_FLAGS, type FeatureFlag, type HubsConfig,
  type NotificationMatrix, type WorkflowConfig, AppSettings as AppSettingsSchema,
} from "@unitravel/contracts"
import { configVersions, type Db, featureFlags, settings, type Tx } from "@unitravel/db"

import { AppError } from "../../core/errors"
import { DB, newRedis, REDIS } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { OutboxService } from "../platform/outbox.service"

interface DomainTypes { ENGINE_RULES: EngineRules; HUBS: HubsConfig; WORKFLOW: WorkflowConfig; NOTIFICATION_MATRIX: NotificationMatrix; AUTH: AuthConfig }
type Current = { [K in ConfigDomain]: { version: number; payload: DomainTypes[K] } }

/**
 * Versioned configuration (ch. 16.3): drafts are validated with the same Zod schema the editor uses, published as a
 * new immutable version, announced through the outbox (config.published), and every process reloads from the DB.
 */
@Injectable()
export class ConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Config")
  private current?: Current
  private flagsCache?: Record<FeatureFlag, boolean>
  private settingsCache?: AppSettings
  private sub?: Redis

  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly outbox: OutboxService, private readonly audit: AuditService) {}

  async onModuleInit() {
    await this.reload()
    this.sub = newRedis()
    await this.sub.subscribe("config.published")
    this.sub.on("message", () => void this.reload().then(() => this.log.log({ versions: this.versions() }, "configuration reloaded")))
  }

  onModuleDestroy() {
    this.sub?.disconnect()
  }

  async reload(): Promise<void> {
    const rows = await this.db.select().from(configVersions).where(eq(configVersions.status, "PUBLISHED"))
    const next: Partial<Current> = {}
    for (const r of rows) {
      const parsed = CONFIG_SCHEMAS[r.domain].parse(r.payload)
      const prev = next[r.domain]
      if (!prev || prev.version < r.version) (next as Record<string, unknown>)[r.domain] = { version: r.version, payload: parsed }
    }
    for (const d of Object.keys(CONFIG_SCHEMAS) as ConfigDomain[]) if (!next[d]) throw new Error(`No published ${d} configuration`)
    this.current = next as Current
    const flags = await this.db.select().from(featureFlags)
    this.flagsCache = { ...DEFAULT_FLAGS, ...Object.fromEntries(flags.map((f) => [f.key, f.enabled])) } as Record<FeatureFlag, boolean>
    const app = await this.db.select().from(settings).where(eq(settings.key, "app"))
    this.settingsCache = AppSettingsSchema.parse(app[0]?.value)
  }

  get<K extends ConfigDomain>(domain: K): DomainTypes[K] {
    if (!this.current) throw new Error("Config not loaded")
    return this.current[domain].payload as DomainTypes[K]
  }

  version(domain: ConfigDomain): number {
    return this.current![domain].version
  }

  versions(): Record<ConfigDomain, number> {
    return Object.fromEntries(Object.entries(this.current!).map(([k, v]) => [k, v.version])) as Record<ConfigDomain, number>
  }

  flag(key: FeatureFlag): boolean {
    return this.flagsCache?.[key] ?? DEFAULT_FLAGS[key]
  }

  flags(): Record<FeatureFlag, boolean> {
    return { ...this.flagsCache! }
  }

  settings(): AppSettings {
    return this.settingsCache!
  }

  // ---- versioning (Developer Panel) ----

  async listVersions(domain: ConfigDomain) {
    return this.db.select().from(configVersions).where(eq(configVersions.domain, domain)).orderBy(desc(configVersions.version))
  }

  async saveDraft(domain: ConfigDomain, payload: unknown, changeNote: string | undefined, actorId: string) {
    const parsed = CONFIG_SCHEMAS[domain].safeParse(payload)
    if (!parsed.success) throw parsed.error
    return this.db.transaction(async (tx) => {
      const [{ v } = { v: 0 }] = await tx.select({ v: max(configVersions.version) }).from(configVersions).where(eq(configVersions.domain, domain))
      const [row] = await tx.insert(configVersions).values({ domain, version: (v ?? 0) + 1, status: "DRAFT", payload: parsed.data, changeNote, createdBy: actorId }).returning()
      await this.audit.record(tx, { actorUserId: actorId, actorKind: "STAFF", action: "config.draft_saved", entityType: "config_version", entityId: row!.id, contextRef: domain, after: { version: row!.version, changeNote } })
      return row!
    })
  }

  async publish(domain: ConfigDomain, version: number, changeNote: string, actorId: string, ctx: { ip?: string; requestId?: string }) {
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(configVersions).where(and(eq(configVersions.domain, domain), eq(configVersions.version, version)))
      if (!draft) throw new AppError("NOT_FOUND", "Version not found")
      if (draft.status === "PUBLISHED") throw new AppError("INVALID_TRANSITION", "Already published")
      const prev = await tx.select().from(configVersions).where(and(eq(configVersions.domain, domain), eq(configVersions.status, "PUBLISHED")))
      await tx.update(configVersions).set({ status: "SUPERSEDED" }).where(and(eq(configVersions.domain, domain), eq(configVersions.status, "PUBLISHED")))
      let row = draft
      if (draft.status === "DRAFT") {
        ;[row] = await tx.update(configVersions).set({ status: "PUBLISHED", publishedBy: actorId, publishedAt: new Date(), changeNote }).where(eq(configVersions.id, draft.id)).returning() as [typeof draft]
      } else {
        // Rolling back to a superseded version republishes its payload as a new version; published rows never change.
        const [{ v } = { v: 0 }] = await tx.select({ v: max(configVersions.version) }).from(configVersions).where(eq(configVersions.domain, domain))
        ;[row] = await tx.insert(configVersions).values({ domain, version: (v ?? 0) + 1, status: "PUBLISHED", payload: draft.payload, changeNote: `Rollback to v${draft.version}: ${changeNote}`, createdBy: actorId, publishedBy: actorId, publishedAt: new Date() }).returning() as [typeof draft]
      }
      await this.audit.record(tx, { actorUserId: actorId, actorKind: "STAFF", action: "config.published", entityType: "config_version", entityId: row.id, contextRef: domain, before: { version: prev[0]?.version, payload: prev[0]?.payload }, after: { version: row.version, payload: row.payload, changeNote }, ip: ctx.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "config", aggregateId: domain, eventType: "config.published", payload: { domain, version: row.version } })
      return row
    })
  }

  async setFlag(key: FeatureFlag, enabled: boolean, actorId: string, tx: Tx) {
    if (!FEATURE_FLAGS.includes(key)) throw new AppError("VALIDATION_FAILED", "Unknown flag")
    const [before] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key))
    await tx.update(featureFlags).set({ enabled, updatedBy: actorId }).where(eq(featureFlags.key, key))
    await this.audit.record(tx, { actorUserId: actorId, actorKind: "STAFF", action: "flag.changed", entityType: "feature_flag", entityId: key, before: { enabled: before?.enabled }, after: { enabled } })
    await this.outbox.add(tx, { aggregateType: "config", aggregateId: key, eventType: "config.published", payload: { flag: key } })
  }

  async setSettings(value: AppSettings, actorId: string, tx: Tx) {
    const parsed = AppSettingsSchema.parse(value)
    const [before] = await tx.select().from(settings).where(eq(settings.key, "app"))
    await tx.update(settings).set({ value: parsed, updatedBy: actorId }).where(eq(settings.key, "app"))
    await this.audit.record(tx, { actorUserId: actorId, actorKind: "STAFF", action: "settings.changed", entityType: "settings", entityId: "app", before: before?.value, after: parsed })
    await this.outbox.add(tx, { aggregateType: "config", aggregateId: "settings", eventType: "config.published", payload: { settings: true } })
  }
}
