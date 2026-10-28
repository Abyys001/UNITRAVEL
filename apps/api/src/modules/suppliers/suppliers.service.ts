import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"
import { and, eq, gte, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import { v7 as uuidv7 } from "uuid"

import type { NormalisedOffer, ProviderId, SeatMap } from "@unitravel/contracts"
import { type Db, providerCalls, providerCredentials, providers } from "@unitravel/db"

import { decryptField, encryptField } from "../../core/crypto"
import { sandboxAllowed } from "../../core/env"
import { AppError } from "../../core/errors"
import { DB, newRedis, REDIS } from "../../core/infra.module"
import { ObjectStorage } from "../../core/storage"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { type CallContext, type FlightSupplierAdapter, type OfferRef, type SliceQuery, SupplierError, type SupplierResult } from "./adapter"
import { AmadeusEnterpriseAdapter, ManualAdapter } from "./adapters/amadeus.adapter"
import { DuffelAdapter } from "./adapters/duffel.adapter"
import { safeError } from "../../core/safe-error"
import { FakeAdapter } from "./adapters/fake.adapter"

type ProviderRow = typeof providers.$inferSelect
type Operation = "search" | "price" | "seatMap" | "health"

const READS: Operation[] = ["search", "price", "seatMap", "health"]

/**
 * Supplier gateway (ch. 21.5): absolute deadlines, one retry for reads, token-bucket rate limits and a concurrency
 * semaphore per provider, a circuit breaker (5 failures or 50% errors in 60 s; half-open probe every 30 s), daily
 * call budgets, and a call record for every call with the redacted native payload kept 14 days.
 */
@Injectable()
export class SuppliersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Suppliers")
  private readonly adapters = new Map<ProviderId, FlightSupplierAdapter>()
  private rows: ProviderRow[] = []
  private loadedAt = 0
  private sub?: Redis

  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly reference: ReferenceService, private readonly outbox: OutboxService, private readonly storage: ObjectStorage) {
    const list: FlightSupplierAdapter[] = [new DuffelAdapter(), new AmadeusEnterpriseAdapter(), new ManualAdapter()]
    if (sandboxAllowed()) list.push(new FakeAdapter())
    for (const a of list) this.adapters.set(a.id, a)
  }

  async onModuleInit() {
    await this.reload()
    this.sub = newRedis()
    await this.sub.subscribe("provider.config_changed", "provider.health_changed")
    // Disabling a provider takes effect within seconds through a cache-invalidation event (ch. 16.2 §2).
    this.sub.on("message", () => void this.reload())
  }

  onModuleDestroy() {
    this.sub?.disconnect()
  }

  async reload() {
    // ADR-0015: this gateway serves flights; stay, rail and bus providers (none exist yet) are never searched here.
    this.rows = (await this.db.select().from(providers)).filter((p) => p.vertical === "FLIGHT")
    this.loadedAt = Date.now()
  }

  private async list(): Promise<ProviderRow[]> {
    if (Date.now() - this.loadedAt > 10_000) await this.reload()
    return this.rows
  }

  private envName(): "test" | "production" {
    // ADR-0014: only local development reads sandbox credentials; staging and production are live.
    return sandboxAllowed() ? "test" : "production"
  }

  adapter(id: ProviderId) {
    return this.adapters.get(id)
  }

  /** Providers the engine may search now: enabled, capability on (config and adapter), not shadowed, circuit not open. */
  async searchable(): Promise<{ row: ProviderRow; budgetRemaining: number; cityCodes: boolean }[]> {
    const out = []
    for (const row of await this.list()) {
      const a = this.adapters.get(row.id as ProviderId)
      if (!a || !row.enabled || !row.capabilities.search || !a.capabilities(row.environment).search) continue
      if (row.environment !== this.envName() && this.envName() === "production") continue
      if ((await this.circuit(row.id)).state === "OPEN") continue
      const used = Number((await this.redis.get(`budget:${row.id}:${today()}`)) ?? 0)
      out.push({ row, budgetRemaining: Math.max(0, row.limits.dailyBudget - used), cityCodes: a.capabilities(row.environment).cityCodes })
    }
    return out
  }

  async shadowProviders(): Promise<ProviderRow[]> {
    return (await this.list()).filter((r) => r.shadowMode && this.adapters.get(r.id as ProviderId)?.capabilities(r.environment).search)
  }

  async row(id: string) {
    return (await this.list()).find((r) => r.id === id)
  }

  private async credentials(id: string): Promise<Record<string, string> | null> {
    const [c] = await this.db.select().from(providerCredentials).where(and(eq(providerCredentials.providerId, id), eq(providerCredentials.environment, this.envName())))
    return c ? (JSON.parse(decryptField(c.ciphertext)) as Record<string, string>) : null
  }

  async setCredentials(id: string, values: Record<string, string>, actorId: string) {
    if (!sandboxAllowed() && id === "duffel" && values.accessToken?.startsWith("duffel_test_")) {
      throw new AppError("VALIDATION_FAILED", "A Duffel test token cannot be used outside APP_ENV=local (ADR-0014)")
    }
    const enc = encryptField(JSON.stringify(values))
    await this.db.insert(providerCredentials).values({ providerId: id, environment: this.envName(), ciphertext: enc.ciphertext, keyId: enc.keyId, rotatedBy: actorId, rotatedAt: new Date() })
      .onConflictDoUpdate({ target: [providerCredentials.providerId, providerCredentials.environment], set: { ciphertext: enc.ciphertext, keyId: enc.keyId, rotatedBy: actorId, rotatedAt: new Date() } })
    await this.redis.del(`supplier:${id}:${this.envName()}:token`)
  }

  async credentialMeta(id: string) {
    const [c] = await this.db.select({ rotatedAt: providerCredentials.rotatedAt, rotatedBy: providerCredentials.rotatedBy }).from(providerCredentials).where(and(eq(providerCredentials.providerId, id), eq(providerCredentials.environment, this.envName())))
    return c ?? null
  }

  // ---- circuit breaker ----
  async circuit(id: string): Promise<{ state: "CLOSED" | "OPEN" | "HALF_OPEN"; openedAt?: number }> {
    const h = await this.redis.hgetall(`cb:${id}`)
    if (h.state === "OPEN") {
      if (Date.now() - Number(h.openedAt) > 30_000) return { state: "HALF_OPEN", openedAt: Number(h.openedAt) }
      return { state: "OPEN", openedAt: Number(h.openedAt) }
    }
    return { state: "CLOSED" }
  }

  private async recordOutcome(id: string, ok: boolean, latency: number) {
    const now = Date.now()
    const key = `cbw:${id}`
    await this.redis.multi().zadd(key, now, `${now}:${ok ? 1 : 0}:${Math.random().toString(36).slice(2, 6)}`).zremrangebyscore(key, 0, now - 60_000).expire(key, 120).exec()
    await this.redis.multi().lpush(`lat:${id}`, String(latency)).ltrim(`lat:${id}`, 0, 199).exec()
    const entries = await this.redis.zrange(key, "0", "-1")
    const fails = entries.filter((e) => e.split(":")[1] === "0").length
    const total = entries.length
    const before = await this.circuit(id)
    if (!ok && (fails >= 5 || (total >= 10 && fails / total >= 0.5) || before.state === "HALF_OPEN")) {
      await this.redis.hset(`cb:${id}`, { state: "OPEN", openedAt: String(now) })
      if (before.state !== "OPEN") await this.healthChanged(id, "OPEN", `Circuit opened after ${fails}/${total} failures in 60 s`)
    } else if (ok && before.state !== "CLOSED") {
      await this.redis.del(`cb:${id}`)
      await this.healthChanged(id, "CLOSED", "Circuit closed after a successful probe")
    }
  }

  private async healthChanged(id: string, circuit: string, detail: string) {
    await this.outbox.add(this.db, { aggregateType: "provider", aggregateId: id, eventType: "provider.health_changed", payload: { provider: id, circuit, detail } })
  }

  /**
   * Token bucket (requests per second) and concurrency semaphore in Redis. Calls wait for capacity until their
   * deadline rather than failing; only an exhausted deadline turns into SUPPLIER_RATE_LIMITED.
   */
  private async acquire(row: ProviderRow, deadline: Date): Promise<() => Promise<void>> {
    const semKey = `sem:${row.id}`
    for (;;) {
      const sec = Math.floor(Date.now() / 1000)
      const rpsKey = `rps:${row.id}:${sec}`
      const n = await this.redis.incr(rpsKey)
      await this.redis.expire(rpsKey, 2)
      const rpsOk = row.limits.rps <= 0 || n <= row.limits.rps
      if (rpsOk) {
        const c = await this.redis.incr(semKey)
        await this.redis.expire(semKey, 60)
        if (row.limits.maxConcurrent <= 0 || c <= row.limits.maxConcurrent) return async () => void (await this.redis.decr(semKey))
        await this.redis.decr(semKey)
      }
      if (Date.now() + 150 > deadline.getTime()) throw new SupplierError("SUPPLIER_RATE_LIMITED", "No provider capacity before the deadline")
      await new Promise((r) => setTimeout(r, rpsOk ? 60 : 1000 - (Date.now() % 1000) + 5))
    }
  }

  async call<T>(id: ProviderId, op: Operation, fn: (a: FlightSupplierAdapter, ctx: CallContext) => Promise<T>, opts: { deadline: Date; searchId?: string; requestId: string }): Promise<SupplierResult<T>> {
    const row = await this.row(id)
    const adapter = this.adapters.get(id)
    const started = Date.now()
    if (!row || !adapter) return { ok: false, error: new SupplierError("CONTENT_RESTRICTED", "Unknown provider"), meta: { durationMs: 0 } }
    const cb = await this.circuit(id)
    if (cb.state === "OPEN") return { ok: false, error: new SupplierError("SUPPLIER_UNAVAILABLE", "Circuit open"), meta: { durationMs: 0 } }
    if (op === "search") {
      const used = await this.redis.incr(`budget:${id}:${today()}`)
      await this.redis.expire(`budget:${id}:${today()}`, 36 * 3600)
      if (used > row.limits.dailyBudget) return { ok: false, error: new SupplierError("SUPPLIER_RATE_LIMITED", "Daily call budget exhausted"), meta: { durationMs: 0 } }
    }
    const credentials = await this.credentials(id)
    let attempt = 0
    for (;;) {
      attempt++
      const remaining = opts.deadline.getTime() - Date.now()
      if (remaining <= 200) return this.finish(row, op, opts, started, { ok: false, error: new SupplierError("SUPPLIER_TIMEOUT", "Deadline reached"), meta: { durationMs: Date.now() - started } })
      let release: (() => Promise<void>) | undefined
      try {
        release = await this.acquire(row, opts.deadline)
        const timeout = Math.min(remaining, row.limits.timeoutMs || remaining)
        const signal = AbortSignal.timeout(timeout)
        const ctx: CallContext = { requestId: opts.requestId, deadline: opts.deadline, pointOfSale: { country: row.markets.pointOfSale, currency: row.markets.currency }, reference: this.reference.lookup(), credentials, environment: row.environment, signal }
        const value = await Promise.race([fn(adapter, ctx), new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new SupplierError("SUPPLIER_TIMEOUT", "Provider timeout"))))])
        return this.finish(row, op, opts, started, { ok: true, value, meta: { durationMs: Date.now() - started } })
      } catch (err) {
        const e = err instanceof SupplierError ? err : new SupplierError((err as Error).name === "TimeoutError" ? "SUPPLIER_TIMEOUT" : "SUPPLIER_UNKNOWN", String(err))
        // Reads retry once on network errors or 5xx if time remains; writes never retry (ch. 21.5).
        if (attempt === 1 && e.retryable && READS.includes(op) && opts.deadline.getTime() - Date.now() > 1500) {
          await new Promise((r) => setTimeout(r, 100 + Math.random() * 200))
          continue
        }
        return this.finish(row, op, opts, started, { ok: false, error: e, meta: { durationMs: Date.now() - started } })
      } finally {
        await release?.()
      }
    }
  }

  private async finish<T>(row: ProviderRow, op: Operation, opts: { searchId?: string; requestId: string }, started: number, r: SupplierResult<T>): Promise<SupplierResult<T>> {
    const duration = Date.now() - started
    const healthy = r.ok || ["NO_AVAILABILITY", "OFFER_EXPIRED", "PRICE_CHANGED", "CONTENT_RESTRICTED", "SUPPLIER_BAD_REQUEST"].includes(r.error.code)
    await this.recordOutcome(row.id, healthy, duration)
    const id = uuidv7()
    const payloadKey = `${new Date().toISOString().slice(0, 10)}/${row.id}/${id}.json.gz`
    if (!r.ok || op !== "health") void this.storage.putCallPayload(payloadKey, { op, searchId: opts.searchId, ok: r.ok, error: r.ok ? undefined : { code: r.error.code, message: r.error.message, raw: r.error.raw }, offers: r.ok && Array.isArray(r.value) ? (r.value as unknown[]).length : undefined })
    await this.db.insert(providerCalls).values({
      id, providerId: row.id, operation: op, searchId: opts.searchId, requestId: opts.requestId.slice(0, 128), status: r.ok ? "OK" : "ERROR", errorCode: r.ok ? null : r.error.code,
      durationMs: duration, offers: r.ok && Array.isArray(r.value) ? (r.value as unknown[]).length : null, payloadKey,
    }).catch((err) => this.log.warn({ err: safeError(err) }, "call record failed"))
    if (!r.ok && r.error.code === "SUPPLIER_AUTH") await this.healthChanged(row.id, "AUTH", "Credentials invalid or expired")
    return r
  }

  search(id: ProviderId, q: SliceQuery, opts: { deadline: Date; searchId?: string; requestId: string }) {
    return this.call<NormalisedOffer[]>(id, "search", (a, ctx) => a.search(q, ctx), opts)
  }

  price(ref: OfferRef, opts: { deadline: Date; requestId: string }) {
    return this.call<NormalisedOffer>(ref.provider, "price", (a, ctx) => a.price(ref, ctx), opts)
  }

  seatMap(ref: OfferRef, opts: { deadline: Date; requestId: string }) {
    return this.call<SeatMap[]>(ref.provider, "seatMap", (a, ctx) => (a.seatMap ? a.seatMap(ref, ctx) : Promise.resolve([])), opts)
  }

  async testConnection(id: ProviderId) {
    const r = await this.call(id, "health", (a, ctx) => a.healthCheck(ctx), { deadline: new Date(Date.now() + 15_000), requestId: `test-${Date.now()}` })
    return r.ok ? { ok: r.value.ok, latencyMs: r.value.latencyMs, detail: r.value.detail } : { ok: false, latencyMs: r.meta.durationMs, detail: `${r.error.code}: ${r.error.message}` }
  }

  async stats(id: string) {
    const lat = (await this.redis.lrange(`lat:${id}`, 0, 199)).map(Number).sort((a, b) => a - b)
    const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]! : null)
    const since = new Date(Date.now() - 24 * 3600_000)
    const rows = await this.db.select({ status: providerCalls.status, n: sql<number>`count(*)::int` }).from(providerCalls).where(and(eq(providerCalls.providerId, id), gte(providerCalls.createdAt, since))).groupBy(providerCalls.status)
    const ok = rows.find((r) => r.status === "OK")?.n ?? 0
    const err = rows.find((r) => r.status === "ERROR")?.n ?? 0
    const [last] = await this.db.select({ code: providerCalls.errorCode, at: providerCalls.createdAt }).from(providerCalls).where(and(eq(providerCalls.providerId, id), eq(providerCalls.status, "ERROR"))).orderBy(sql`created_at desc`).limit(1)
    return { p50: pct(0.5), p95: pct(0.95), successRate: ok + err ? ok / (ok + err) : null, callsToday: Number((await this.redis.get(`budget:${id}:${today()}`)) ?? 0), lastError: last ? `${last.code} · ${last.at.toISOString()}` : null }
  }

  async healthSummary() {
    const out = []
    for (const row of await this.list()) {
      const s = await this.stats(row.id)
      const cb = await this.circuit(row.id)
      out.push({ name: row.name, kind: "flight-provider", ok: row.enabled ? cb.state === "CLOSED" : null, successRate: s.successRate, p50: s.p50, p95: s.p95, lastError: s.lastError, circuit: cb.state })
    }
    return out
  }

  async view(id: string) {
    const row = await this.row(id)
    if (!row) throw new AppError("NOT_FOUND")
    const cred = await this.credentialMeta(id)
    const s = await this.stats(id)
    const cb = await this.circuit(id)
    return {
      id: row.id, name: row.name, environment: row.environment, enabled: row.enabled, priority: row.priority, capabilities: row.capabilities, limits: row.limits, markets: row.markets,
      shadowMode: row.shadowMode, version: row.version, credentials: { set: !!cred, rotatedAt: cred?.rotatedAt.toISOString() ?? null, rotatedBy: cred?.rotatedBy ?? null },
      health: { circuit: cb.state, successRate: s.successRate, p50: s.p50, p95: s.p95, lastError: s.lastError, callsToday: s.callsToday },
      adapterCapabilities: this.adapters.get(row.id as ProviderId)?.capabilities(row.environment) ?? null,
    }
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}
