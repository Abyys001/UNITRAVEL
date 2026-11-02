import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, ilike, lt, or } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  type CuratedListingBody, type CuratedListingPatch, type CuratedListingView, type FlightListingItem, type FlightListingsView, LISTING_PATHS, type ListingVertical, type NormalisedOffer,
  type PublicListingQuery, type PublicListingsView, type StaffListingQuery, type StaffListingView,
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
import { SuppliersService } from "../suppliers/suppliers.service"

type Row = typeof curatedListings.$inferSelect
const iso = (d: Date | null) => d?.toISOString() ?? null
const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`

/** Cached flight results live 48 h at most; a stale entry is dropped on read so the page never shows old fares as current. */
export const FLIGHT_CACHE_TTL_SECONDS = 48 * 3600
export const FLIGHT_CACHE_PREFIX = "listings:flights:"
/** Days ahead of today the warm-up searches (a single date per route keeps the call budget small). */
export const WARM_DAYS_AHEAD = 21
export const flightCacheKey = (from: string, to: string) => `${FLIGHT_CACHE_PREFIX}${from}-${to}`

export interface CachedFlights { fetchedAt: string; items: FlightListingItem[] }

/** Turns normalised offers into price-free listing items, keeping the cheapest few by the supplier's own total (never exposed). */
export function toFlightItems(offers: NormalisedOffer[], fetchedAt: string, departureDate: string, max = 5): FlightListingItem[] {
  return [...offers].sort((a, b) => a.price.total.amountMinor - b.price.total.amountMinor).slice(0, max).map((o) => {
    const slice = o.slices[0]!
    const first = slice.segments[0]!
    const last = slice.segments[slice.segments.length - 1]!
    return {
      label: o.source.fake ? "SANDBOX" as const : "CACHED_OFFER" as const, fetchedAt, origin: slice.origin, destination: slice.destination, departureDate,
      carriers: [...new Set(slice.segments.map((s) => s.marketing.carrier))], stops: slice.segments.length - 1, durationMin: slice.durationMin,
      departureLocal: first.departure.local, arrivalLocal: last.arrival.local,
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
  ) {}

  async onModuleInit() {
    this.workers.registerJob("maintenance", "listings.warm-flights", () => this.warmFlights())
    await this.queues.get("maintenance").upsertJobScheduler("listings-warm-flights-6h", { every: 6 * 3600_000 }, { name: "listings.warm-flights" }).catch(() => undefined)
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

  /** Only what the worker cached. Entries older than the TTL are gone from Redis; FAKE items are dropped unless this is a developer machine. */
  async flights(q: PublicListingQuery): Promise<FlightListingsView> {
    const routes = q.from && q.to ? [{ from: q.from.toUpperCase(), to: q.to.toUpperCase() }] : this.config.settings().listings.flightRoutes
    const items: FlightListingItem[] = []
    for (const r of routes) {
      if (!/^[A-Z]{3}$/.test(r.from) || !/^[A-Z]{3}$/.test(r.to)) continue
      const raw = await this.redis.get(flightCacheKey(r.from, r.to))
      if (!raw) continue
      const cached = JSON.parse(raw) as CachedFlights
      items.push(...cached.items.filter((i) => sandboxAllowed() || i.label === "CACHED_OFFER"))
    }
    // A query that names only one side filters the configured routes.
    const to = q.to && !q.from ? q.to.toUpperCase() : null
    const from = q.from && !q.to ? q.from.toUpperCase() : null
    const shown = items.filter((i) => (!to || i.destination === to) && (!from || i.origin === from))
    return { items: shown, notice: shown.length ? null : "NO_SOURCES" }
  }

  /** Worker job: refreshes the cache for the configured routes through the supplier gateway. Does nothing when no live adapter is enabled. */
  async warmFlights(now = new Date()): Promise<{ warmed: number; routes: number; reason?: string }> {
    const routes = this.config.settings().listings.flightRoutes
    if (!routes.length) return { warmed: 0, routes: 0, reason: "NO_ROUTES" }
    // Live adapters only; the FAKE adapter exists in this list on a developer machine only (ADR-0014).
    // Metered providers (ADR-0029) are paid per row and have their own budget pools; the cache warm-up never spends them.
    const sources = (await this.suppliers.searchable()).filter((s) => s.budgetRemaining > routes.length && !s.row.metering).sort((a, b) => a.row.priority - b.row.priority)
    const source = sources.find((s) => s.row.id !== "fake") ?? (sandboxAllowed() ? sources[0] : undefined)
    if (!source) return { warmed: 0, routes: routes.length, reason: "NO_SOURCES" }
    const date = new Date(now.getTime() + WARM_DAYS_AHEAD * 86400_000).toISOString().slice(0, 10)
    let warmed = 0
    for (const r of routes) {
      const res = await this.suppliers.search(source.row.id as never, { slices: [{ origin: r.from, destination: r.to, date }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", maxConnections: 1 }, { deadline: new Date(Date.now() + 20_000), requestId: `listings-${r.from}-${r.to}` })
      if (!res.ok) { this.log.warn({ route: `${r.from}-${r.to}`, code: res.error.code }, "flight listing refresh failed"); continue }
      const fetchedAt = new Date().toISOString()
      const items = toFlightItems(res.value, fetchedAt, date)
      if (!items.length) { await this.redis.del(flightCacheKey(r.from, r.to)); continue }
      await this.redis.set(flightCacheKey(r.from, r.to), JSON.stringify({ fetchedAt, items } satisfies CachedFlights), "EX", FLIGHT_CACHE_TTL_SECONDS)
      warmed++
    }
    return { warmed, routes: routes.length }
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
