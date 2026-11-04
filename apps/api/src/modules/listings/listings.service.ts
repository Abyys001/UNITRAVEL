import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, ilike, lt, or } from "drizzle-orm"

import {
  type CuratedListingBody, type CuratedListingPatch, type CuratedListingView, type FlightListingItem, type FlightListingsView, LISTING_PATHS, type ListingVertical,
  type PublicItinerary, type PublicListingQuery, type PublicListingsView, type StaffListingQuery, type StaffListingView,
} from "@unitravel/contracts"
import { curatedListings, type Db } from "@unitravel/db"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { AuditService } from "../audit/audit.service"
import { CatalogReadService } from "../catalog/catalog-read.service"
import { ConfigService } from "../config/config.service"

type Row = typeof curatedListings.$inferSelect
const iso = (d: Date | null) => d?.toISOString() ?? null
const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`

/** Popular-route cards show the next few departures that currently have flights in the catalog (ADR-0034). */
const CARD_LIMIT = 5

/** A catalog snapshot row as a price-free listing card. `offerRef` is null: catalog rows are not stored searches, so the card offers "Ask our team". */
export function toListingItem(it: PublicItinerary): FlightListingItem {
  return {
    label: "CACHED_OFFER", fetchedAt: it.fetchedAt, origin: it.origin, destination: it.destination, departureDate: it.departureDate, carriers: it.carriers, stops: it.stops,
    durationMin: it.durationMin, departureLocal: it.departLocal, arrivalLocal: it.arriveLocal, offerRef: null, complianceReview: it.complianceReview,
  }
}

/**
 * Listings (ADR-0021). Buses, trains and stays are staff-curated and always indicative; flights come only from the flight catalog's
 * stored snapshots (ADR-0034). Nothing is invented: no data means an empty answer with a notice.
 */
@Injectable()
export class ListingsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly queues: Queues,
    private readonly catalog: CatalogReadService,
  ) {}

  async onModuleInit() {
    // The prewarm schedulers of ADR-0021 and ADR-0032 B3 are gone: the catalog pacer refreshes flights (ADR-0034).
    for (const id of ["listings-warm-flights", "listings-warm-flights-6h"]) await this.queues.get("maintenance").removeJobScheduler(id).catch(() => undefined)
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

  /** The configured popular routes (or the requested one) from the catalog's snapshots; departed flights are never listed. No amounts. */
  async flights(q: PublicListingQuery, now = new Date()): Promise<FlightListingsView> {
    const routes = q.from && q.to ? [{ from: q.from.toUpperCase(), to: q.to.toUpperCase() }] : this.config.settings().listings.flightRoutes
    const today = now.toISOString().slice(0, 10)
    const items: FlightListingItem[] = []
    for (const r of routes) {
      if (!/^[A-Z]{3}$/.test(r.from) || !/^[A-Z]{3}$/.test(r.to)) continue
      items.push(...(await this.catalog.upcoming(r.from, r.to, CARD_LIMIT, now)).filter((i) => i.departureDate > today).map(toListingItem))
    }
    // A query that names only one side filters the configured routes.
    const to = q.to && !q.from ? q.to.toUpperCase() : null
    const from = q.from && !q.to ? q.from.toUpperCase() : null
    const shown = items.filter((i) => (!to || i.destination === to) && (!from || i.origin === from))
    return { items: shown, notice: shown.length ? null : "NO_SOURCES" }
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
