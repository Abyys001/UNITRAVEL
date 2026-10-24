import { createHash } from "node:crypto"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  ENGINE_VERSION, type EngineRules, type HubsConfig, type Itinerary, type CustomerSeatMap, type NormalisedOffer, type PriceCheckResult, type ResultTab, type SearchQuery, type SeatMap,
} from "@unitravel/contracts"
import { type Db, searchResults, searches } from "@unitravel/db"
import { validatePassengerMix } from "@unitravel/domain"
import { assemble, type CollectedCall, type EngineContext, orderForTab, plan, type PlannedCall } from "@unitravel/engine"

import { AppError, notFound } from "../../core/errors"
import { DB, REDIS } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { ReferenceService } from "../reference/reference.service"
import { RequestsService, type SearchPort } from "../requests/requests.service"
import { SuppliersService } from "../suppliers/suppliers.service"
import { customerItinerary, customerSeatMaps } from "./customer-projection"

const SEARCH_TTL_MS = 30 * 60_000

interface SearchStateRedis {
  id: string
  status: "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED"
  version: number
  progress: { sourcesTotal: number; sourcesDone: number; removedByPolicy: number; slowSources: string[]; wave: number }
  notices: string[]
  expiresAt: string
}

/** `internal`: holds `pricing.read.internal`, so may see supplier totals, scores and the CHEAPEST tab (ADR-0004). */
export interface SearchOwner { userId?: string; anonKey?: string; staff?: boolean; internal?: boolean }

/**
 * Flight search as an asynchronous job with progressive results (ADR-05, ch. 22.4–22.9): the API accepts in < 300 ms,
 * the worker fans out in waves within one absolute deadline, and each wave's valid itineraries are published to Redis.
 */
@Injectable()
export class SearchService implements OnModuleInit, SearchPort {
  private readonly log = new Logger("Search")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
    private readonly config: ConfigService,
    private readonly reference: ReferenceService,
    private readonly compliance: ComplianceService,
    private readonly suppliers: SuppliersService,
    private readonly requests: RequestsService,
  ) {}

  onModuleInit() {
    this.workers.register("search.execute", (job) => this.execute((job.data as { searchId: string }).searchId), 20)
    this.requests.setSearchPort(this)
  }

  async start(query: SearchQuery, owner: SearchOwner, locale: "en" | "fa") {
    const issues = validatePassengerMix(query.passengers.map((p) => p.type))
    if (issues.length) throw new AppError("VALIDATION_FAILED", issues[0], [{ path: "passengers", code: "MIX" }])
    for (const s of query.slices) for (const p of [s.from, s.to]) {
      const code = "airport" in p ? p.airport : p.city
      if (!this.reference.airport(code) && this.reference.lookup().cityAirports(code).length === 0) throw new AppError("VALIDATION_FAILED", `Unknown place ${code}`, [{ path: "slices", code: "UNKNOWN_PLACE" }])
    }
    const expiresAt = new Date(Date.now() + SEARCH_TTL_MS)
    const [row] = await this.db.insert(searches).values({
      userId: owner.userId ?? null, actorKind: owner.staff ? "STAFF" : owner.userId ? "CUSTOMER" : "ANONYMOUS", anonKey: owner.anonKey ?? null, query, status: "RUNNING",
      ruleVersion: this.config.version("ENGINE_RULES"), hubsVersion: this.config.version("HUBS"), engineVersion: ENGINE_VERSION, locale, expiresAt,
    }).returning()
    const state: SearchStateRedis = { id: row!.id, status: "RUNNING", version: 0, progress: { sourcesTotal: 0, sourcesDone: 0, removedByPolicy: 0, slowSources: [], wave: 0 }, notices: [], expiresAt: expiresAt.toISOString() }
    await this.redis.set(`search:${row!.id}:state`, JSON.stringify(state), "PX", SEARCH_TTL_MS)
    await this.queues.get("search.execute").add("search", { searchId: row!.id }, { jobId: `search-${row!.id}` })
    return { id: row!.id, status: "RUNNING" as const, expiresAt: expiresAt.toISOString() }
  }

  private async ctxFor(query: SearchQuery, locale: "en" | "fa", rules?: EngineRules, hubs?: HubsConfig): Promise<EngineContext> {
    return {
      query, rules: rules ?? this.config.get("ENGINE_RULES"), hubs: hubs ?? this.config.get("HUBS"), policy: await this.compliance.carrierPolicy(), reference: this.reference.lookup(),
      ruleVersion: this.config.version("ENGINE_RULES"), flags: { selfTransfer: this.config.flag("search.self_transfer.enabled"), gateways: this.config.flag("search.gateways.enabled") }, locale, now: new Date(),
    }
  }

  private legKey(provider: string, c: PlannedCall, q: SearchQuery) {
    const pax = createHash("sha1").update(q.passengers.map((p) => `${p.type}${p.age ?? ""}`).sort().join(",")).digest("hex").slice(0, 10)
    return `leg:${provider}:${c.slices.map((s) => `${s.origin}:${s.destination}:${s.date}`).join("+")}:${pax}:${q.cabin}`
  }

  /** Worker: plan → fan out (waves in parallel) → assemble after each wave → publish (ch. 22.4). */
  async execute(searchId: string) {
    const [row] = await this.db.select().from(searches).where(eq(searches.id, searchId))
    if (!row || row.status !== "RUNNING") return
    const started = Date.now()
    const rules = this.config.get("ENGINE_RULES")
    const ctx = await this.ctxFor(row.query, row.locale)
    const providers = await this.suppliers.searchable()
    const p = plan(ctx, providers.map((x) => ({ id: x.row.id as never, priority: x.row.priority, budgetRemaining: x.budgetRemaining, supportsCityCodes: x.cityCodes })))
    const priority = new Map(providers.map((x) => [x.row.id, x.row.priority]))
    const collected: CollectedCall[] = []
    const errors: string[] = []
    let cacheHits = 0
    const state = (JSON.parse((await this.redis.get(`search:${searchId}:state`)) ?? "null") as SearchStateRedis | null) ?? { id: searchId, status: "RUNNING", version: 0, progress: { sourcesTotal: 0, sourcesDone: 0, removedByPolicy: 0, slowSources: [], wave: 0 }, notices: [], expiresAt: row.expiresAt.toISOString() }
    state.progress.sourcesTotal = p.calls.length
    state.notices = [...p.notes]
    if (providers.length === 0) state.notices.push("NO_SOURCES")
    const deadline = new Date(started + rules.deadlines.totalMs)
    const firstWave = new Date(started + rules.deadlines.firstWaveMs)
    let lastResults: Itinerary[] = []

    const publish = async (final: boolean) => {
      const r = assemble({ ...ctx, now: new Date() }, collected, priority)
      lastResults = r.results
      state.version += 1
      state.progress.removedByPolicy = r.stats.removedByPolicy
      state.notices = [...new Set([...state.notices, ...r.notices])]
      if (final) state.status = collected.length === 0 && p.calls.length > 0 ? "FAILED" : errors.length ? "PARTIAL" : "COMPLETE"
      const ttl = Math.max(1000, row.expiresAt.getTime() - Date.now())
      await this.redis.set(`search:${searchId}:results:v${state.version}`, JSON.stringify(r.results), "PX", ttl)
      await this.redis.set(`search:${searchId}:results:latest`, String(state.version), "PX", ttl)
      for (const it of r.results) await this.redis.set(`itn:${it.id}`, searchId, "PX", ttl)
      await this.redis.set(`search:${searchId}:state`, JSON.stringify(state), "PX", ttl)
      await this.redis.publish(`search.progress.${searchId}`, JSON.stringify({ event: "results", version: state.version, count: r.results.length }))
      await this.redis.publish(`search.progress.${searchId}`, JSON.stringify({ event: "progress", ...state.progress }))
      return r
    }

    const runCall = async (c: PlannedCall) => {
      const key = this.legKey(c.provider, c, row.query)
      const cached = await this.redis.get(key)
      if (cached) {
        cacheHits++
        // A cached leg keeps its own fetch time and is labelled CACHED_OFFER, never relabelled as live (ch. 22.9).
        const offers = (JSON.parse(cached) as NormalisedOffer[]).map((o) => ({ ...o, source: { ...o.source, rung: "CACHED_OFFER" as const } }))
        collected.push({ call: c, offers })
      } else {
        const res = await this.suppliers.search(c.provider, { slices: c.slices, passengers: row.query.passengers, cabin: row.query.cabin, maxConnections: Math.min(row.query.preferences.maxStops, rules.global.maxStops) }, { deadline: c.wave === 1 ? firstWave : deadline, searchId, requestId: `search-${searchId}` })
        if (res.ok) {
          collected.push({ call: c, offers: res.value })
          await this.redis.set(key, JSON.stringify(res.value), "EX", rules.cache.legTtlSeconds)
        } else {
          collected.push({ call: c, offers: [], error: res.error.code })
          if (res.error.code !== "NO_AVAILABILITY" && res.error.code !== "CONTENT_RESTRICTED") {
            errors.push(`${c.provider}:${res.error.code}`)
            if (res.error.code === "SUPPLIER_TIMEOUT" && !state.progress.slowSources.includes(c.provider)) state.progress.slowSources.push(c.provider)
          }
        }
      }
      state.progress.sourcesDone += 1
    }

    const waves = [1, 2, 3] as const
    await Promise.all(waves.map(async (w) => {
      const calls = p.calls.filter((c) => c.wave === w)
      if (!calls.length) return
      await Promise.all(calls.map(runCall))
      state.progress.wave = Math.max(state.progress.wave, w)
      await publish(false)
    }))
    // Shadow-mode providers are called and logged, never shown (ch. 21.9 step 6).
    for (const sp of await this.suppliers.shadowProviders()) void this.suppliers.search(sp.id as never, { slices: row.query.slices.map((s) => ({ origin: "airport" in s.from ? s.from.airport : s.from.city, destination: "airport" in s.to ? s.to.airport : s.to.city, date: s.date })), passengers: row.query.passengers, cabin: row.query.cabin, maxConnections: 1 }, { deadline, searchId, requestId: `shadow-${searchId}` })
    const final = await publish(true)
    await this.redis.publish(`search.progress.${searchId}`, JSON.stringify({ event: "done", status: state.status, count: final.results.length, durationMs: Date.now() - started }))
    const stats = { ...final.stats, calls: p.calls.length, cacheHits, droppedForBudget: p.droppedForBudget, errors, hubs: p.hubs, gateways: p.gateways, durationMs: Date.now() - started }
    await this.db.transaction(async (tx) => {
      await tx.update(searches).set({ status: state.status, stats, collected: collected.map((c) => ({ call: c.call, offers: c.offers, error: c.error })), completedAt: new Date() }).where(eq(searches.id, searchId))
      if (lastResults.length) await tx.insert(searchResults).values(lastResults.map((it, i) => ({ searchId, itineraryKey: it.id, rank: i, tabs: it.tabs, construction: it.construction, itinerary: it, priceTotalMinor: it.price.total.amountMinor, currency: it.price.total.currency, durationMin: it.durationMin, riskFlags: it.riskFlags, score: String(it.score), scoreComponents: it.explain })))
    })
    this.log.log({ searchId, calls: p.calls.length, results: lastResults.length, ms: Date.now() - started }, "search complete")
  }

  /** Same actor as creator (ch. 24.3); anonymous searches belong to their first-party anonymous key. */
  private async owned(id: string, owner: SearchOwner) {
    const [row] = await this.db.select().from(searches).where(eq(searches.id, id))
    if (!row) throw notFound("Search")
    const ok = owner.staff || (row.userId && row.userId === owner.userId) || (!row.userId && ((row.anonKey && row.anonKey === owner.anonKey) || owner.userId))
    if (!ok) throw notFound("Search")
    return row
  }

  async get(id: string, owner: SearchOwner, q: { tab?: ResultTab; limit: number; cursor?: string; version?: number }) {
    const row = await this.owned(id, owner)
    const raw = await this.redis.get(`search:${id}:state`)
    const historical = !raw || row.expiresAt < new Date()
    let results: Itinerary[]
    let state: SearchStateRedis
    if (!historical) {
      state = JSON.parse(raw!) as SearchStateRedis
      const v = q.version ?? Number((await this.redis.get(`search:${id}:results:latest`)) ?? 0)
      results = v ? (JSON.parse((await this.redis.get(`search:${id}:results:v${v}`)) ?? "[]") as Itinerary[]) : []
    } else {
      // After 30 minutes a search shows its results as historical and offers "Search again" (ch. 22.8).
      const rows = await this.db.select().from(searchResults).where(eq(searchResults.searchId, id)).orderBy(asc(searchResults.rank))
      results = rows.map((r) => r.itinerary)
      const st = row.stats as { calls?: number; removedByPolicy?: number }
      state = { id, status: row.status, version: 1, progress: { sourcesTotal: st.calls ?? 0, sourcesDone: st.calls ?? 0, removedByPolicy: st.removedByPolicy ?? 0, slowSources: [], wave: 3 }, notices: [], expiresAt: row.expiresAt.toISOString() }
    }
    // A price-sorted list leaks prices by order alone.
    if (q.tab === "CHEAPEST" && !owner.internal) throw new AppError("VALIDATION_FAILED", "This tab is not available", [{ path: "tab", code: "FORBIDDEN" }])
    const ordered = q.tab ? orderForTab(results, q.tab) : results
    const start = q.cursor ? Number(q.cursor) : 0
    const page = ordered.slice(start, start + q.limit)
    return {
      id, status: state.status, version: state.version, query: row.query, progress: state.progress, expiresAt: row.expiresAt.toISOString(), historical, ruleVersion: row.ruleVersion, engineVersion: row.engineVersion,
      notices: state.notices, results: owner.internal ? page : page.map(customerItinerary), nextCursor: start + q.limit < ordered.length ? String(start + q.limit) : null, total: ordered.length,
    }
  }

  async subscribe(id: string, owner: SearchOwner) {
    await this.owned(id, owner)
    return `search.progress.${id}`
  }

  async itinerary(id: string, owner: SearchOwner): Promise<{ itinerary: Itinerary; searchId: string; query: SearchQuery; ruleVersion: number; engineVersion: string; searchResultId: string | null }> {
    let searchId = await this.redis.get(`itn:${id}`)
    let it: Itinerary | undefined
    let resultId: string | null = null
    if (!searchId) {
      const [r] = await this.db.select().from(searchResults).where(eq(searchResults.itineraryKey, id)).limit(1)
      if (!r) throw notFound("Itinerary")
      searchId = r.searchId
      it = r.itinerary
      resultId = r.id
    }
    const row = await this.owned(searchId, owner)
    if (!it) {
      const v = await this.redis.get(`search:${searchId}:results:latest`)
      it = (JSON.parse((await this.redis.get(`search:${searchId}:results:v${v}`)) ?? "[]") as Itinerary[]).find((x) => x.id === id)
      const [r] = await this.db.select({ id: searchResults.id }).from(searchResults).where(and(eq(searchResults.searchId, searchId), eq(searchResults.itineraryKey, id))).limit(1)
      resultId = r?.id ?? null
    }
    if (!it) throw notFound("Itinerary")
    return { itinerary: it, searchId, query: row.query, ruleVersion: row.ruleVersion, engineVersion: row.engineVersion, searchResultId: resultId }
  }

  /** Revalidate now (ch. 22.9): every component offer priced again. Staff only (ADR-0004): customers are never shown a price check. */
  async priceCheck(itineraryId: string, owner: SearchOwner, requestId: string): Promise<PriceCheckResult> {
    const { itinerary } = await this.itinerary(itineraryId, owner)
    const r = await this.revalidate(itinerary, requestId)
    return { outcome: r.outcome, previousTotal: itinerary.price.total, currentTotal: r.total, checkedAt: new Date().toISOString(), itinerary: r.itinerary }
  }

  async revalidate(itinerary: Itinerary, requestId: string) {
    const deadline = new Date(Date.now() + 8000)
    const priced: NormalisedOffer[] = []
    for (const c of itinerary.components) {
      if (c.source.rung === "MANUAL") { priced.push(c); continue }
      const res = await this.suppliers.price({ provider: c.source.provider, providerOfferId: c.source.providerOfferId, offer: c }, { deadline, requestId })
      if (!res.ok) {
        if (res.error.code === "OFFER_EXPIRED") return { outcome: "OFFER_EXPIRED" as const }
        if (res.error.code === "SUPPLIER_UNAVAILABLE" || res.error.code === "SUPPLIER_TIMEOUT") throw new AppError("SUPPLIER_UNAVAILABLE", "The airline system did not answer; try again")
        return { outcome: "UNAVAILABLE" as const }
      }
      priced.push(res.value)
    }
    const total = { amountMinor: priced.reduce((s, o) => s + o.price.total.amountMinor, 0), currency: itinerary.price.total.currency }
    const updated: Itinerary = {
      ...itinerary, components: priced, price: { ...itinerary.price, total },
      truth: priced.map((c, i) => ({ component: i + 1, provider: c.source.provider, rung: c.source.rung, fetchedAt: c.source.fetchedAt, expiresAt: c.source.expiresAt, fake: c.source.fake })),
    }
    return { outcome: total.amountMinor === itinerary.price.total.amountMinor ? "CONFIRMED" as const : "PRICE_CHANGED" as const, itinerary: updated, total }
  }

  async itineraryForSubmit(searchId: string, itineraryId: string, actor: Actor) {
    const found = await this.itinerary(itineraryId, { userId: actor.userId, staff: actor.isStaff })
    if (found.searchId !== searchId) throw notFound("Itinerary")
    return { itinerary: found.itinerary, query: found.query, ruleVersion: found.ruleVersion, engineVersion: found.engineVersion, searchResultId: found.searchResultId }
  }

  /** View-only seat maps only when every component's supplier returns one (D-07, ch. 7.2). Seat prices only for `internal` callers (ADR-0004). */
  async seatMaps(itineraryId: string, owner: SearchOwner, requestId: string): Promise<{ available: boolean; reason?: string; maps: SeatMap[] | CustomerSeatMap[] }> {
    if (!this.config.flag("seatmaps.enabled")) return { available: false, reason: "SEATMAPS_DISABLED", maps: [] }
    const { itinerary } = await this.itinerary(itineraryId, owner)
    if (!itinerary.components.every((c) => c.seatMapAvailable)) return { available: false, reason: "NOT_FROM_SUPPLIER", maps: [] }
    const maps: SeatMap[] = []
    for (const c of itinerary.components) {
      const r = await this.suppliers.seatMap({ provider: c.source.provider, providerOfferId: c.source.providerOfferId }, { deadline: new Date(Date.now() + 8000), requestId })
      if (!r.ok || r.value.length === 0) return { available: false, reason: "NOT_FROM_SUPPLIER", maps: [] }
      maps.push(...r.value)
    }
    return { available: true, maps: owner.internal ? maps : customerSeatMaps(maps) }
  }

  /** Developer Panel simulator: cached supplier responses only, draft vs published rules side by side (ch. 16.2 §4). */
  async simulate(searchId: string, draft: { rules?: EngineRules; hubs?: HubsConfig }) {
    const [row] = await this.db.select().from(searches).where(eq(searches.id, searchId))
    if (!row) throw notFound("Search")
    const collected = row.collected as CollectedCall[]
    const priority = new Map((await this.suppliers.searchable()).map((x) => [x.row.id, x.row.priority]))
    const published = assemble(await this.ctxFor(row.query, row.locale), collected, priority)
    const drafted = assemble(await this.ctxFor(row.query, row.locale, draft.rules, draft.hubs), collected, priority)
    const top = (r: typeof published) => r.results.slice(0, 15).map((it) => ({ id: it.id, construction: it.construction, ticketing: it.ticketing, price: it.price.total, durationMin: it.durationMin, score: it.score, tabs: it.tabs, route: it.components.flatMap((c) => c.slices.flatMap((s) => s.segments.map((g) => `${g.marketing.carrier}${g.marketing.flightNumber} ${g.origin.iata}-${g.destination.iata}`))).join(" · "), flags: it.riskFlags, explain: it.explain }))
    return { searchId, query: row.query, supplierCallsMade: 0, cachedCalls: collected.length, published: { count: published.results.length, stats: published.stats, top: top(published) }, draft: { count: drafted.results.length, stats: drafted.stats, top: top(drafted) } }
  }

  async recent(limit = 20) {
    return this.db.select({ id: searches.id, query: searches.query, status: searches.status, createdAt: searches.createdAt, actorKind: searches.actorKind }).from(searches).orderBy(desc(searches.createdAt)).limit(limit)
  }
}
