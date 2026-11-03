import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, ilike, lt, or } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  type CuratedListingBody, type CuratedListingPatch, type CuratedListingView, type FlightListingItem, type FlightListingsView, type Itinerary, LISTING_PATHS, type ListingVertical,
  ProviderMetering, type PublicListingQuery, type SearchQuery, type PublicListingsView, type StaffListingQuery, type StaffListingView,
} from "@unitravel/contracts"
import { curatedListings, type Db } from "@unitravel/db"

import { sandboxAllowed } from "../../core/env"
import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { ReferenceService } from "../reference/reference.service"
import { SearchService } from "../search/search.service"
import { APIFY_ID, FlightDataService, MIN_WARM_INTERVAL_MS, prewarmIntervalMs } from "../suppliers/apify/flight-data.service"
import { SuppliersService } from "../suppliers/suppliers.service"

type Row = typeof curatedListings.$inferSelect
const iso = (d: Date | null) => d?.toISOString() ?? null
const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`

/** Cached flight results live 48 h at least; a warm interval longer than that (ADR-0032 B3) keeps them until the next warm. */
export const FLIGHT_CACHE_TTL_SECONDS = 48 * 3600
export const FLIGHT_CACHE_PREFIX = "listings:flights:"
/** Days ahead of today the warm-up searches of a non-metered source (a single date per route keeps the call budget small). */
export const WARM_DAYS_AHEAD = 21
/** ADR-0032 B3: the batched Apify warm takes one date per route, rotating across the next 14 days. */
export const WARM_ROTATION_DAYS = 14
export const flightCacheKey = (from: string, to: string) => `${FLIGHT_CACHE_PREFIX}${from}-${to}`
const WARM_SCHEDULER = "listings-warm-flights"
const COLLECT_ATTEMPTS = 6

export interface CachedFlights { fetchedAt: string; items: FlightListingItem[] }
interface WarmLeg { from: string; to: string; date: string }

/** Departure date of route `i` on warm number `rotation`: days 1..14 ahead, shifting one day per warm and spread across routes. */
export function rotatedDate(now: Date, rotation: number, i: number): string {
  const offset = 1 + ((rotation + i) % WARM_ROTATION_DAYS)
  return new Date(now.getTime() + offset * 86400_000).toISOString().slice(0, 10)
}

/** The one-way, one-adult economy query a popular-route listing stands for. Direct or one stop, no self-transfer, so it plans few legs. */
export function listingQuery(leg: WarmLeg): SearchQuery {
  return {
    tripType: "ONE_WAY", slices: [{ from: { airport: leg.from }, to: { airport: leg.to }, date: leg.date, flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY",
    preferences: { allowSelfTransfer: false, allowAirportChange: false, allowOvernight: true, maxStops: 1, nearestCabin: false, studentFare: false },
  }
}

/**
 * Turns stored itineraries into price-free listing items, keeping the cheapest few by the supplier's own total (never exposed).
 * Each item points at its stored itinerary so the existing ITINERARY request flow can take it (ADR-0032 B5).
 */
export function toFlightItems(itineraries: Itinerary[], searchId: string, departureDate: string, carrierName: (code: string) => string | undefined = () => undefined, max = 5): FlightListingItem[] {
  return [...itineraries].filter((it) => it.components.length === 1 && it.components[0]!.slices.length === 1).sort((a, b) => a.price.total.amountMinor - b.price.total.amountMinor).slice(0, max).map((it) => {
    const offer = it.components[0]!
    const slice = offer.slices[0]!
    const first = slice.segments[0]!
    const last = slice.segments[slice.segments.length - 1]!
    return {
      label: offer.source.fake ? "SANDBOX" as const : "CACHED_OFFER" as const, fetchedAt: offer.source.fetchedAt, origin: slice.origin, destination: slice.destination, departureDate,
      carriers: [...new Set(slice.segments.map((g) => g.marketing.carrier))], stops: slice.segments.length - 1, durationMin: slice.durationMin,
      departureLocal: first.departure.local, arrivalLocal: last.arrival.local,
      segments: slice.segments.map((g) => {
        const name = carrierName(g.marketing.carrier)
        return { marketing: g.marketing, operating: g.operating, origin: g.origin, destination: g.destination, departure: g.departure, arrival: g.arrival, cabin: g.cabin, ...(g.aircraft ? { aircraft: g.aircraft } : {}), ...(name ? { carrierName: name } : {}) }
      }),
      offerRef: { searchId, itineraryId: it.id },
      complianceReview: it.complianceReview,
    }
  })
}

/**
 * Listings (ADR-0021). Buses, trains and stays are staff-curated and always indicative; flights come only from a cache that the
 * worker fills from a live adapter. Nothing is invented: no source means an empty answer with a notice.
 */
@Injectable()
export class ListingsService implements OnModuleInit {
  private readonly log = new Logger("Listings")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly suppliers: SuppliersService,
    private readonly workers: WorkerRegistry,
    private readonly queues: Queues,
    private readonly search: SearchService,
    private readonly flightData: FlightDataService,
    private readonly reference: ReferenceService,
  ) {}

  async onModuleInit() {
    this.workers.registerJob("maintenance", "listings.warm-flights", () => this.warmFlights())
    this.workers.registerJob("maintenance", "listings.prewarmed", (job) => this.startListingSearches((job.data as { routes: { origin: string; destination: string; departureDate: string }[] }).routes.map((r) => ({ from: r.origin, to: r.destination, date: r.departureDate }))))
    this.workers.registerJob("maintenance", "listings.collect", (job) => this.collect(job.data as { legs: (WarmLeg & { searchId: string })[]; attempt: number }))
    // The 6-hourly scheduler of ADR-0021 is replaced by one whose interval follows the prewarm pool (ADR-0032 B3).
    await this.queues.get("maintenance").removeJobScheduler("listings-warm-flights-6h").catch(() => undefined)
    await this.scheduleWarm().catch(() => undefined)
  }

  // ---------------- public ----------------

  private publicView(r: Row): CuratedListingView {
    return {
      id: r.id, vertical: r.vertical, title: r.title, summary: r.summary, fromPlace: r.fromPlace, toPlace: r.toPlace, operator: r.operator, label: "INDICATIVE",
      // The price column only exists with priceQuoted (database CHECK); the second test keeps the rule visible here.
      price: r.priceQuoted && r.priceMinor != null && r.currency ? { amountMinor: r.priceMinor, currency: r.currency } : null,
      validUntil: iso(r.validUntil), updatedAt: r.updatedAt.toISOString(),
    }
  }

  async publicList(path: keyof typeof LISTING_PATHS, q: PublicListingQuery): Promise<PublicListingsView> {
    const vertical = LISTING_PATHS[path]
    const rows = await this.db.select().from(curatedListings).where(and(
      eq(curatedListings.vertical, vertical), eq(curatedListings.status, "PUBLISHED"),
      q.to ? ilike(curatedListings.toPlace, escapeLike(q.to)) : undefined, q.from ? ilike(curatedListings.fromPlace, escapeLike(q.from)) : undefined,
    )).orderBy(asc(curatedListings.sortOrder), desc(curatedListings.updatedAt)).limit(100)
    return { vertical, items: rows.map((r) => this.publicView(r)), notice: "INDICATIVE_ONLY" }
  }

  /** Only what the worker cached. FAKE items are dropped unless this is a developer machine; departed flights are dropped. */
  async flights(q: PublicListingQuery, now = new Date()): Promise<FlightListingsView> {
    const routes = q.from && q.to ? [{ from: q.from.toUpperCase(), to: q.to.toUpperCase() }] : this.config.settings().listings.flightRoutes
    const today = now.toISOString().slice(0, 10)
    const items: FlightListingItem[] = []
    for (const r of routes) {
      if (!/^[A-Z]{3}$/.test(r.from) || !/^[A-Z]{3}$/.test(r.to)) continue
      const raw = await this.redis.get(flightCacheKey(r.from, r.to))
      if (!raw) continue
      const cached = JSON.parse(raw) as CachedFlights
      items.push(...cached.items.filter((i) => (sandboxAllowed() || i.label === "CACHED_OFFER") && i.departureDate > today))
    }
    // A query that names only one side filters the configured routes.
    const to = q.to && !q.from ? q.to.toUpperCase() : null
    const from = q.from && !q.to ? q.from.toUpperCase() : null
    const shown = items.filter((i) => (!to || i.destination === to) && (!from || i.origin === from))
    return { items: shown, notice: shown.length ? null : "NO_SOURCES" }
  }

  /** A non-metered live source if one is enabled (FAKE only on a developer machine), else the metered Apify source, else none. */
  private async warmSource(routes: number): Promise<{ kind: "LIVE" } | { kind: "APIFY"; metering: ProviderMetering } | null> {
    const sources = (await this.suppliers.searchable()).sort((a, b) => a.row.priority - b.row.priority)
    const live = sources.filter((s) => s.budgetRemaining > routes && !s.row.metering)
    if (live.find((s) => s.row.id !== "fake") ?? (sandboxAllowed() ? live[0] : undefined)) return { kind: "LIVE" }
    const apify = sources.find((s) => s.row.id === APIFY_ID)
    return apify ? { kind: "APIFY", metering: ProviderMetering.parse(apify.row.metering ?? {}) } : null
  }

  /** ADR-0032 B3: Apify warms as often as the prewarm pool pays for (about 52 h with the defaults); other sources every 6 h. */
  private async scheduleWarm() {
    const routes = this.config.settings().listings.flightRoutes.length
    const source = await this.warmSource(routes)
    const every = source?.kind === "APIFY" ? (prewarmIntervalMs(routes, source.metering) ?? 30 * 86400_000) : MIN_WARM_INTERVAL_MS
    await this.queues.get("maintenance").upsertJobScheduler(WARM_SCHEDULER, { every }, { name: "listings.warm-flights" })
    return every
  }

  /** Listing cache lifetime: until the next warm has had time to land, never less than 48 h. */
  private async cacheTtlSeconds() {
    const routes = this.config.settings().listings.flightRoutes.length
    const source = await this.warmSource(routes)
    const every = source?.kind === "APIFY" ? (prewarmIntervalMs(routes, source.metering) ?? 0) : 0
    return Math.max(FLIGHT_CACHE_TTL_SECONDS, Math.ceil(every / 1000) + 6 * 3600)
  }

  /**
   * Worker job. A non-metered source is searched straight away; Apify gets one batched prewarm-pool run for all routes and the
   * listing searches start when it is collected (`listings.prewarmed`). Every listing goes through a stored SYSTEM search, so
   * the engine's policies apply and the item can be requested through the existing flow.
   */
  async warmFlights(now = new Date()): Promise<{ warmed: number; routes: number; reason?: string; runId?: string }> {
    const routes = this.config.settings().listings.flightRoutes
    if (!routes.length) return { warmed: 0, routes: 0, reason: "NO_ROUTES" }
    const source = await this.warmSource(routes.length)
    await this.scheduleWarm().catch(() => undefined)
    if (!source) return { warmed: 0, routes: routes.length, reason: "NO_SOURCES" }
    if (source.kind === "LIVE") {
      const date = new Date(now.getTime() + WARM_DAYS_AHEAD * 86400_000).toISOString().slice(0, 10)
      return { warmed: await this.startListingSearches(routes.map((r) => ({ ...r, date }))), routes: routes.length }
    }
    const rotation = Number(await this.redis.incr("listings:warm:rotation"))
    const legs = routes.map((r, i) => ({ ...r, date: rotatedDate(now, rotation, i) }))
    const q = listingQuery(legs[0]!)
    const maxConnections = Math.min(q.preferences.maxStops, this.config.get("ENGINE_RULES").global.maxStops)
    const r = await this.flightData.prewarm(legs.map((l) => ({ origin: l.from, destination: l.to, departureDate: l.date })), { passengers: q.passengers, cabin: q.cabin, maxConnections })
    const warmed = r.cached.length ? await this.startListingSearches(r.cached.map((c) => ({ from: c.origin, to: c.destination, date: c.departureDate }))) : 0
    if (!r.runId) this.log.warn({ reason: r.reason }, "popular-route warm not started")
    return { warmed, routes: routes.length, ...(r.runId ? { runId: r.runId } : {}), ...(r.reason ? { reason: r.reason } : {}) }
  }

  /** Starts one SYSTEM listing search per leg and a delayed job that turns the results into listing items. */
  async startListingSearches(legs: WarmLeg[]): Promise<number> {
    const started: (WarmLeg & { searchId: string })[] = []
    for (const leg of legs) {
      try {
        const s = await this.search.start(listingQuery(leg), {}, "en", { listing: true })
        started.push({ ...leg, searchId: s.id })
      } catch (err) {
        this.log.warn({ route: `${leg.from}-${leg.to}`, code: (err as AppError).code }, "listing search not started")
      }
    }
    if (started.length) await this.queues.get("maintenance").add("listings.collect", { legs: started, attempt: 1 }, { delay: 15_000, jobId: `listings-collect-${started[0]!.searchId}-1` })
    return started.length
  }

  /** Worker job: writes finished listing searches to the cache; re-queues itself while some are still running. */
  async collect(data: { legs: (WarmLeg & { searchId: string })[]; attempt: number }): Promise<{ written: number; pending: number }> {
    const pending: typeof data.legs = []
    let written = 0
    const ttl = await this.cacheTtlSeconds()
    for (const leg of data.legs) {
      const state = await this.search.get(leg.searchId, { staff: true, internal: true }, { limit: 50 }).catch(() => null)
      if (!state) continue
      if (state.status === "RUNNING" && data.attempt < COLLECT_ATTEMPTS) { pending.push(leg); continue }
      const items = toFlightItems(state.results as Itinerary[], leg.searchId, leg.date, (code) => this.reference.airline(code)?.name)
      // An empty answer keeps the previous listing: it still shows its age, and the route is not blanked by one bad warm.
      if (!items.length) continue
      await this.redis.set(flightCacheKey(leg.from, leg.to), JSON.stringify({ fetchedAt: items[0]!.fetchedAt, items } satisfies CachedFlights), "EX", ttl)
      written++
    }
    if (pending.length) await this.queues.get("maintenance").add("listings.collect", { legs: pending, attempt: data.attempt + 1 }, { delay: 20_000, jobId: `listings-collect-${pending[0]!.searchId}-${data.attempt + 1}` })
    return { written, pending: pending.length }
  }

  // ---------------- staff ----------------

  private staffView(r: Row): StaffListingView {
    const { label: _label, ...v } = this.publicView(r)
    return { ...v, status: r.status, priceQuoted: r.priceQuoted, sortOrder: r.sortOrder, version: r.version, createdAt: r.createdAt.toISOString() }
  }

  async staffList(q: StaffListingQuery) {
    const rows = await this.db.select().from(curatedListings).where(and(
      q.vertical ? eq(curatedListings.vertical, q.vertical) : undefined, q.status ? eq(curatedListings.status, q.status) : undefined,
      q.q ? or(ilike(curatedListings.toPlace, escapeLike(q.q)), ilike(curatedListings.fromPlace, escapeLike(q.q)), ilike(curatedListings.operator, escapeLike(q.q))) : undefined,
      q.cursor ? lt(curatedListings.id, q.cursor) : undefined,
    )).orderBy(desc(curatedListings.id)).limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    return { items: page.map((r) => this.staffView(r)), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null }
  }

  async staffGet(id: string): Promise<StaffListingView> {
    const [r] = await this.db.select().from(curatedListings).where(eq(curatedListings.id, id))
    if (!r) throw notFound("Listing")
    return this.staffView(r)
  }

  private assertShape(v: ListingVertical, fromPlace: string | null) {
    // A stay has no origin; a bus or train needs one so the page can filter by it.
    if (v === "STAY" && fromPlace) throw new AppError("VALIDATION_FAILED", "A stay has no origin place", [{ path: "fromPlace", code: "NOT_ALLOWED" }])
    if (v !== "STAY" && !fromPlace) throw new AppError("VALIDATION_FAILED", "A bus or train listing needs an origin place", [{ path: "fromPlace", code: "REQUIRED" }])
  }

  async create(body: CuratedListingBody, actor: Actor, requestId?: string): Promise<StaffListingView> {
    this.assertShape(body.vertical, body.fromPlace)
    return this.uow.run(async (tx) => {
      const [r] = await tx.insert(curatedListings).values({
        vertical: body.vertical, status: "DRAFT", title: body.title, summary: body.summary, fromPlace: body.fromPlace, toPlace: body.toPlace, operator: body.operator,
        priceQuoted: body.priceQuoted, priceMinor: body.price?.amountMinor ?? null, currency: body.price?.currency ?? null, validUntil: body.validUntil ? new Date(body.validUntil) : null,
        sortOrder: body.sortOrder, createdBy: actor.userId,
      }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "listing.created", entityType: "curated_listing", entityId: r!.id, after: { vertical: body.vertical, toPlace: body.toPlace, priceQuoted: body.priceQuoted }, ip: actor.ip, requestId })
      return this.staffView(r!)
    })
  }

  async update(id: string, patch: CuratedListingPatch, actor: Actor, requestId?: string): Promise<StaffListingView> {
    return this.uow.run(async (tx) => {
      const [cur] = await tx.select().from(curatedListings).where(eq(curatedListings.id, id)).for("update")
      if (!cur) throw notFound("Listing")
      if (cur.version !== patch.version) throw new AppError("VERSION_CONFLICT", "Listing changed; reload")
      const { version: _v, status, price, priceQuoted, ...rest } = patch
      const nextQuoted = priceQuoted ?? cur.priceQuoted
      const nextPrice = price !== undefined ? price : nextQuoted && cur.priceMinor != null ? { amountMinor: cur.priceMinor, currency: cur.currency! } : null
      if (nextQuoted !== (nextPrice != null)) throw new AppError("VALIDATION_FAILED", "A price needs priceQuoted, and priceQuoted needs a price", [{ path: "price", code: "PRICE_RULE" }])
      const vertical = rest.vertical ?? cur.vertical
      const fromPlace = rest.fromPlace !== undefined ? rest.fromPlace : cur.fromPlace
      this.assertShape(vertical, fromPlace)
      const [r] = await tx.update(curatedListings).set({
        ...(rest.vertical && { vertical: rest.vertical }), ...(rest.title && { title: rest.title }), ...(rest.summary && { summary: rest.summary }),
        ...(rest.fromPlace !== undefined && { fromPlace: rest.fromPlace }), ...(rest.toPlace && { toPlace: rest.toPlace }), ...(rest.operator !== undefined && { operator: rest.operator }),
        ...(rest.validUntil !== undefined && { validUntil: rest.validUntil ? new Date(rest.validUntil) : null }), ...(rest.sortOrder !== undefined && { sortOrder: rest.sortOrder }),
        ...(status && { status }), priceQuoted: nextQuoted, priceMinor: nextPrice?.amountMinor ?? null, currency: nextPrice?.currency ?? null, updatedBy: actor.userId, version: cur.version + 1,
      }).where(eq(curatedListings.id, id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: status && status !== cur.status ? `listing.${status.toLowerCase()}` : "listing.updated", entityType: "curated_listing", entityId: id, before: { status: cur.status, priceQuoted: cur.priceQuoted }, after: { status: r!.status, priceQuoted: r!.priceQuoted }, ip: actor.ip, requestId })
      return this.staffView(r!)
    })
  }
}
