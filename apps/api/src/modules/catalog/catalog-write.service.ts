import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, eq, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import type { CatalogSettings, EngineRules, NormalisedOffer, PublicItinerary, SearchQuery, SlotStatus } from "@unitravel/contracts"
import { catalogPublicSnapshots, catalogSlots, type Db, flightResultFares, flightResultLegs, flightResultPricing, flightResults, flightWatchlistRoutes, type Tx } from "@unitravel/db"
import { buildItinerary, catalogEngineRules, type CarrierPolicy, emptyStats, filterOffers, joinAtHub, nextDueAt, offerLaneVerdict, RuleResolver, slotStatus } from "@unitravel/engine"

import { AppError } from "../../core/errors"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { OutboxService } from "../platform/outbox.service"
import type { NormalisedCapture } from "../suppliers/adapters/flight-builder/normalise"
import { ReferenceService } from "../reference/reference.service"
import { combinedIdentity, detailFromItinerary, detailFromOffer, type ResultDetail, snapshotPayload } from "./catalog-model"
import { CatalogSettingsService } from "./catalog-settings.service"

type SlotRow = typeof catalogSlots.$inferSelect
type RouteRow = typeof flightWatchlistRoutes.$inferSelect

export const SNAPSHOT_TTL_S = 7 * 86_400
export const snapshotKey = (slotId: string, version: number) => `cat:${slotId}:v${version}`
export const latestKey = (slotId: string) => `cat:${slotId}:latest`
export const slotIndexKey = (routeId: string, date: string) => `cat:slot:${routeId}:${date}`
export const datesKey = (routeId: string) => `cat:dates:${routeId}`

/** What the read path serves for one slot (Redis value, built from `catalog_public_snapshots` on a miss). */
export interface SnapshotBlob { slotId: string; version: number; fetchedAt: string | null; status: SlotStatus; payload: PublicItinerary[] }

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const minIso = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b)

export interface SlotWrite {
  slotId: string
  /** Offers the run returned for this slot, before policy. */
  offers: NormalisedOffer[]
  fetchedAt: Date
  notices: string[]
  /** Only error rows came back: the slot is marked ERROR and its previous results stay. */
  errored?: string
}

/**
 * ADR-0034 write path. Everything customers will see is built here, once, at write time: the policy filter, the identity upsert, the
 * price history, the self-transfer combinations and the allowlisted snapshot. Nothing here is reachable from a public request.
 */
@Injectable()
export class CatalogWriteService {
  private readonly log = new Logger("CatalogWrite")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly cfg: CatalogSettingsService,
    private readonly reference: ReferenceService,
    private readonly compliance: ComplianceService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------------- direct slots ----------------

  /** One transaction per slot (spec §5). Returns the new version, or null when the slot is gone. */
  async writeSlot(w: SlotWrite, policy?: CarrierPolicy): Promise<{ version: number; kept: number; dropped: number } | null> {
    const [slot] = await this.db.select().from(catalogSlots).where(eq(catalogSlots.id, w.slotId))
    if (!slot) return null
    const [route] = await this.db.select().from(flightWatchlistRoutes).where(eq(flightWatchlistRoutes.id, slot.routeId))
    if (!route) return null
    const s = await this.cfg.get()
    const pol = policy ?? (await this.compliance.carrierPolicy())
    const ref = this.reference.lookup()
    const kept = filterOffers(w.offers, pol, ref, w.fetchedAt, emptyStats())
    const now = w.fetchedAt

    let result: { blob: SnapshotBlob; kept: number }
    if (w.errored) {
      result = await this.uow.run((tx) => this.markError(tx, slot, w.errored!, w.notices, now, s))
    } else {
      result = await this.uow.run(async (tx) => {
        const keptIds: string[] = []
        const rows: { id: string; detail: ResultDetail }[] = []
        for (const offer of kept) {
          const identity = offer.source.providerOfferId
          const review = offerLaneVerdict(offer, pol, ref) === "REVIEW"
          const detail = detailFromOffer(offer, review)
          const [r] = await tx.insert(flightResults).values({
            slotId: slot.id, origin: route.origin, destination: route.destination, departureDate: slot.departureDate, identityKey: identity, selfTransfer: false,
            complianceReview: review, offer, detail, firstSeenAt: now, lastSeenAt: now, isCurrent: true,
          }).onConflictDoUpdate({
            target: [flightResults.slotId, flightResults.identityKey],
            set: { offer, detail, complianceReview: review, lastSeenAt: now, isCurrent: true, updatedAt: now },
          }).returning({ id: flightResults.id })
          await this.upsertPrice(tx, r!.id, offer.price.total.amountMinor, offer.price.total.currency, now)
          keptIds.push(r!.id)
          rows.push({ id: r!.id, detail })
        }
        // "No longer listed": the row stays as history with is_current = false (spec §3).
        // ADR-0037 D2: only FEED rows are retired by a feed refresh; staff captures survive it and leave through the freshness sweep or a retire.
        await tx.update(flightResults).set({ isCurrent: false, updatedAt: now })
          .where(and(eq(flightResults.slotId, slot.id), eq(flightResults.capture, "FEED"), eq(flightResults.isCurrent, true), keptIds.length ? notInArray(flightResults.id, keptIds) : undefined))
        // Counts follow what Apify returned (billed rows), not what policy let through, so the pacer's cost estimate stays honest.
        const count = w.offers.length
        const recent = [count, ...slot.recentCounts].slice(0, 3)
        const empty = count === 0 ? slot.consecutiveEmpty + 1 : 0
        const status = slotStatus({ departureDate: slot.departureDate, lastFetchedAt: now, recentCounts: recent, consecutiveErrors: 0, consecutiveEmpty: empty }, s, now)
        const version = slot.version + 1
        await tx.update(catalogSlots).set({
          lastFetchedAt: now, nextDueAt: nextDueAt({ departureDate: slot.departureDate, consecutiveEmpty: empty, lastFetchedAt: now }, s, now), status, lastResultCount: count, recentCounts: recent,
          consecutiveEmpty: empty, consecutiveErrors: 0, lastErrorAt: null, lastError: null, notices: w.notices.slice(0, 20), version, updatedAt: now,
        }).where(eq(catalogSlots.id, slot.id))
        const blob = await this.commitSnapshot(tx, slot, version, now, status, snapshotPayload(await this.snapshotRows(tx, slot.id)))
        return { blob, kept: rows.length }
      })
    }
    await this.cacheSnapshot(slot, result.blob)
    await this.rebuildForFeeder(slot.id, pol).catch((err) => this.log.error({ err: String(err), slot: slot.id }, "combined rebuild failed"))
    return { version: result.blob.version, kept: result.kept, dropped: w.offers.length - kept.length }
  }

  /**
   * ADR-0037 D2: what a slot's snapshot is built from, every time: all current rows, FEED and STAFF. When a FEED row and a STAFF row
   * describe the same flights at the same local departure, the STAFF row wins (a person looked at the panel); the FEED row stays stored.
   */
  private async snapshotRows(tx: Tx, slotId: string): Promise<{ id: string; detail: ResultDetail }[]> {
    const rows = await tx.select({ id: flightResults.id, detail: flightResults.detail, capture: flightResults.capture }).from(flightResults)
      .where(and(eq(flightResults.slotId, slotId), eq(flightResults.isCurrent, true)))
    const keyOf = (d: ResultDetail) => `${d.flightNumbers.join(",")}|${d.departLocal}`
    const staff = new Set(rows.filter((r) => r.capture === "STAFF").map((r) => keyOf(r.detail)))
    return rows.filter((r) => r.capture === "STAFF" || !staff.has(keyOf(r.detail))).map(({ id, detail }) => ({ id, detail }))
  }

  /**
   * Rebuilds one slot's snapshot from its current rows without touching the slot's pacer fields (ADR-0037): the freshness sweep and a
   * retire use it. The snapshot's fetch time is the newer of the slot's last feed fetch and the newest staff observation shown.
   */
  async rebuildSnapshot(slotId: string, now = new Date()): Promise<void> {
    const [slot] = await this.db.select().from(catalogSlots).where(eq(catalogSlots.id, slotId))
    if (!slot) return
    const blob = await this.uow.run(async (tx) => this.commitStaffSnapshot(tx, slot, now))
    await this.cacheSnapshot(slot, blob)
  }

  private async commitStaffSnapshot(tx: Tx, slot: SlotRow, now: Date): Promise<SnapshotBlob> {
    const rows = await this.snapshotRows(tx, slot.id)
    const [obs] = rows.length
      ? await tx.select({ at: sql<Date | null>`max(${flightResults.lastSeenAt})` }).from(flightResults).where(and(eq(flightResults.slotId, slot.id), eq(flightResults.isCurrent, true), eq(flightResults.capture, "STAFF")))
      : []
    const staffAt = obs?.at ? new Date(obs.at) : null
    const fetchedAt = staffAt && (!slot.lastFetchedAt || staffAt > slot.lastFetchedAt) ? staffAt : slot.lastFetchedAt
    const version = slot.version + 1
    await tx.update(catalogSlots).set({ version, updatedAt: now }).where(eq(catalogSlots.id, slot.id))
    return this.commitSnapshot(tx, slot, version, fetchedAt, slot.status, snapshotPayload(rows))
  }

  /**
   * ADR-0037 D2: records one staff-captured option. The caller has normalised it; this applies the compliance filter, finds the catalog slot
   * (creating the row for a tracked route's date if needed; feed polling follows the route's own horizon and is not changed), upserts the result
   * on `fb:{flight numbers}:{date}`, upserts its fares by position (extra old positions are RETIRED, so fare ids stay stable) and rebuilds the
   * snapshot. `inTx` runs in the same transaction (audit, request note).
   */
  async writeStaffOption(w: {
    capture: NormalisedCapture
    actorUserId: string
    observedAt: Date
    sourceRecordId?: string
    requestRef?: string
    note?: string
    now?: Date
  }, inTx?: (tx: Tx, r: { resultId: string; slotId: string; created: boolean; review: boolean }) => Promise<void>): Promise<{ resultId: string; slotId: string; created: boolean; review: boolean; slotCreated: boolean }> {
    const now = w.now ?? new Date()
    const { offer, fares, identityKey } = w.capture
    const pol = await this.compliance.carrierPolicy()
    const ref = this.reference.lookup()
    const stats = emptyStats()
    if (!filterOffers([offer], pol, ref, now, stats).length) {
      if (stats.removedByPolicy) throw new AppError("POLICY_BLOCKED", "This flight uses a carrier, airport or lane the compliance policy blocks, so it cannot be recorded")
      throw new AppError("VALIDATION_FAILED", "This flight failed the catalog checks (times or time zones)")
    }
    const review = offerLaneVerdict(offer, pol, ref) === "REVIEW"
    const origin = offer.slices[0]!.origin
    const destination = offer.slices[0]!.destination
    const date = offer.slices[0]!.segments[0]!.departure.local.slice(0, 10)
    if (date < now.toISOString().slice(0, 10)) throw new AppError("VALIDATION_FAILED", "The departure date is in the past", [{ path: "segments.0.departLocal", code: "PAST" }])
    const [route] = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.origin, origin), eq(flightWatchlistRoutes.destination, destination), eq(flightWatchlistRoutes.kind, "DIRECT"), eq(flightWatchlistRoutes.enabled, true)))
    if (!route) throw new AppError("ROUTE_NOT_TRACKED", `${origin}-${destination} is not a tracked catalog route; add it to the watchlist first`)
    let slotCreated = false
    let [slot] = await this.db.select().from(catalogSlots).where(and(eq(catalogSlots.routeId, route.id), eq(catalogSlots.departureDate, date)))
    if (!slot) {
      await this.db.insert(catalogSlots).values({ routeId: route.id, departureDate: date, nextDueAt: now }).onConflictDoNothing({ target: [catalogSlots.routeId, catalogSlots.departureDate] })
      slotCreated = true
      ;[slot] = await this.db.select().from(catalogSlots).where(and(eq(catalogSlots.routeId, route.id), eq(catalogSlots.departureDate, date)))
    }
    const detail = detailFromOffer(offer, review)
    const rep = offer.price.total
    const out = await this.uow.run(async (tx) => {
      const [r] = await tx.insert(flightResults).values({
        slotId: slot!.id, origin, destination, departureDate: date, identityKey, selfTransfer: false, complianceReview: review, offer, detail, firstSeenAt: w.observedAt, lastSeenAt: w.observedAt, isCurrent: true,
        capture: "STAFF", capturedBy: w.actorUserId, sourceRecordId: w.sourceRecordId ?? null, verification: "RECORDED", requestRef: w.requestRef ?? null, captureNote: w.note ?? null,
      }).onConflictDoUpdate({
        target: [flightResults.slotId, flightResults.identityKey],
        set: { offer, detail, complianceReview: review, lastSeenAt: w.observedAt, isCurrent: true, capturedBy: w.actorUserId, sourceRecordId: w.sourceRecordId ?? null, requestRef: w.requestRef ?? null, captureNote: w.note ?? null, updatedAt: now },
      }).returning({ id: flightResults.id, created: sql<boolean>`(xmax = 0)` })
      const resultId = r!.id
      await tx.insert(flightResultFares).values(fares.map((f) => ({
        resultId, position: f.position, cabin: f.cabin, bookingClasses: f.bookingClasses, seatsRaw: f.seatsRaw, fareBasis: f.fareBasis, fareType: f.fareType, fareTypeRaw: f.fareTypeRaw,
        baseMinor: f.baseMinor, taxesMinor: f.taxesMinor, totalMinor: f.totalMinor, currency: f.currency, baggage: f.baggage, conditions: f.conditions, ticketingDeadline: f.ticketingDeadline,
        status: "LIVE" as const, observedAt: w.observedAt,
      }))).onConflictDoUpdate({
        target: [flightResultFares.resultId, flightResultFares.position],
        set: {
          cabin: sql`excluded.cabin`, bookingClasses: sql`excluded.booking_classes`, seatsRaw: sql`excluded.seats_raw`, fareBasis: sql`excluded.fare_basis`, fareType: sql`excluded.fare_type`, fareTypeRaw: sql`excluded.fare_type_raw`,
          baseMinor: sql`excluded.base_minor`, taxesMinor: sql`excluded.taxes_minor`, totalMinor: sql`excluded.total_minor`, currency: sql`excluded.currency`, baggage: sql`excluded.baggage`, conditions: sql`excluded.conditions`,
          ticketingDeadline: sql`excluded.ticketing_deadline`, status: sql`'LIVE'`, observedAt: sql`excluded.observed_at`, updatedAt: now,
        },
      })
      await tx.update(flightResultFares).set({ status: "RETIRED", updatedAt: now }).where(and(eq(flightResultFares.resultId, resultId), gte(flightResultFares.position, fares.length)))
      await this.upsertPrice(tx, resultId, rep.amountMinor, rep.currency, now)
      if (inTx) await inTx(tx, { resultId, slotId: slot!.id, created: r!.created, review })
      const blob = await this.commitStaffSnapshot(tx, slot!, now)
      return { blob, resultId, created: r!.created }
    })
    await this.cacheSnapshot(slot!, out.blob)
    return { resultId: out.resultId, slotId: slot!.id, created: out.created, review, slotCreated }
  }

  /** Staff retire a captured option: its fares are RETIRED, the row leaves the snapshot, and the history stays (ADR-0037). Returns false when it is not a staff capture. */
  async retireStaffOption(resultId: string, inTx?: (tx: Tx, r: { slotId: string | null }) => Promise<void>, now = new Date()): Promise<boolean> {
    const [row] = await this.db.select({ slotId: flightResults.slotId, capture: flightResults.capture }).from(flightResults).where(eq(flightResults.id, resultId))
    if (!row || row.capture !== "STAFF") return false
    const [slot] = row.slotId ? await this.db.select().from(catalogSlots).where(eq(catalogSlots.id, row.slotId)) : []
    const blob = await this.uow.run(async (tx) => {
      await tx.update(flightResultFares).set({ status: "RETIRED", updatedAt: now }).where(eq(flightResultFares.resultId, resultId))
      await tx.update(flightResults).set({ isCurrent: false, updatedAt: now }).where(eq(flightResults.id, resultId))
      if (inTx) await inTx(tx, { slotId: row.slotId })
      return slot ? this.commitStaffSnapshot(tx, slot, now) : null
    })
    if (slot && blob) await this.cacheSnapshot(slot, blob)
    return true
  }

  private async markError(tx: Tx, slot: SlotRow, message: string, notices: string[], now: Date, s: CatalogSettings): Promise<{ blob: SnapshotBlob; kept: number }> {
    const errors = slot.consecutiveErrors + 1
    const status = slotStatus({ departureDate: slot.departureDate, lastFetchedAt: slot.lastFetchedAt, recentCounts: slot.recentCounts, consecutiveErrors: errors, consecutiveEmpty: slot.consecutiveEmpty }, s, now)
    await tx.update(catalogSlots).set({
      status, consecutiveErrors: errors, lastErrorAt: now, lastError: message.slice(0, 300), notices: notices.slice(0, 20),
      nextDueAt: new Date(now.getTime() + s.minRefreshIntervalHours * 3_600_000), updatedAt: now,
    }).where(eq(catalogSlots.id, slot.id))
    // Previous results stay on display (they age into STALE on their own); only the status changes.
    const [snap] = await tx.select().from(catalogPublicSnapshots).where(eq(catalogPublicSnapshots.slotId, slot.id))
    return { blob: { slotId: slot.id, version: snap?.version ?? slot.version, fetchedAt: snap?.fetchedAt?.toISOString() ?? null, status, payload: snap?.payload ?? [] }, kept: snap?.payload.length ?? 0 }
  }

  private async upsertPrice(tx: Tx, resultId: string, amountMinor: number, currency: string, at: Date) {
    const changed = sql`${flightResultPricing.amountMinor} <> excluded.amount_minor`
    await tx.insert(flightResultPricing).values({ resultId, amountMinor, currency }).onConflictDoUpdate({
      target: flightResultPricing.resultId,
      set: {
        previousAmountMinor: sql`case when ${changed} then ${flightResultPricing.amountMinor} else ${flightResultPricing.previousAmountMinor} end`,
        priceChangedAt: sql`case when ${changed} then ${at.toISOString()}::timestamptz else ${flightResultPricing.priceChangedAt} end`,
        amountMinor: sql`excluded.amount_minor`, currency: sql`excluded.currency`, updatedAt: at,
      },
    })
  }

  /** The snapshot row and the outbox event commit with the slot; the Redis copy follows after commit. */
  private async commitSnapshot(tx: Tx, slot: Pick<SlotRow, "id" | "routeId" | "departureDate">, version: number, fetchedAt: Date | null, status: SlotStatus, payload: PublicItinerary[]): Promise<SnapshotBlob> {
    await tx.insert(catalogPublicSnapshots).values({ slotId: slot.id, version, payload, fetchedAt, builtAt: new Date() })
      .onConflictDoUpdate({ target: catalogPublicSnapshots.slotId, set: { version, payload, fetchedAt, builtAt: new Date() } })
    await this.outbox.add(tx, { aggregateType: "catalog_slot", aggregateId: slot.id, eventType: "catalog.slot_updated", payload: { slotId: slot.id, version } })
    return { slotId: slot.id, version, fetchedAt: fetchedAt?.toISOString() ?? null, status, payload }
  }

  /** Redis is a cache of the snapshot table; a failure here never fails the write (the read path falls back to Postgres). */
  async cacheSnapshot(slot: Pick<SlotRow, "id" | "routeId" | "departureDate">, blob: SnapshotBlob) {
    try {
      await this.redis.multi()
        .set(snapshotKey(slot.id, blob.version), JSON.stringify(blob), "EX", SNAPSHOT_TTL_S)
        .set(latestKey(slot.id), String(blob.version), "EX", SNAPSHOT_TTL_S)
        .set(slotIndexKey(slot.routeId, slot.departureDate), slot.id, "EX", SNAPSHOT_TTL_S)
        .del(datesKey(slot.routeId))
        .exec()
    } catch (err) {
      this.log.warn({ err: String(err) }, "snapshot cache write failed")
    }
  }

  // ---------------- self-transfer combinations ----------------

  private async currentOffers(slotIds: string[]) {
    if (!slotIds.length) return []
    return this.db.select({ id: flightResults.id, offer: flightResults.offer, slotId: flightResults.slotId }).from(flightResults)
      // STAFF captures never feed self-transfer combinations (ADR-0037 D2): their fares are not an offer a customer can be combined onto.
      .where(and(inArray(flightResults.slotId, slotIds), eq(flightResults.isCurrent, true), eq(flightResults.capture, "FEED"), isNotNull(flightResults.offer)))
  }

  /** After a feeder slot changed: rebuild every combined slot that includes it (spec §5 step 5). */
  async rebuildForFeeder(slotId: string, policy?: CarrierPolicy): Promise<number> {
    const [slot] = await this.db.select().from(catalogSlots).where(eq(catalogSlots.id, slotId))
    if (!slot) return 0
    const s = await this.cfg.get()
    const combined = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.kind, "COMBINED"), eq(flightWatchlistRoutes.enabled, true)))
    let rebuilt = 0
    for (const cr of combined) {
      const feeders = await this.feedersOf(cr, s)
      if (!feeders) continue
      let dates: string[] = []
      if (slot.routeId === feeders.a.id) dates = [slot.departureDate]
      else if (slot.routeId === feeders.b.id) dates = s.connections.dayOffsets.map((o) => addDays(slot.departureDate, -o))
      for (const d of new Set(dates)) if (await this.buildCombined(cr, feeders.a, feeders.b, d, s, policy)) rebuilt++
    }
    return rebuilt
  }

  /** The two DIRECT feeder routes of a combined route, if the pair is enabled and its hub is allowed. */
  async feedersOf(cr: RouteRow, s: CatalogSettings): Promise<{ a: RouteRow; b: RouteRow } | null> {
    const pair = s.connections.pairs.find((p) => p.enabled && p.from === cr.origin && p.to === cr.destination && p.via === cr.viaHub)
    if (!pair || !s.connections.hubs.some((h) => h.enabled && h.iata === pair.via)) return null
    const routes = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.kind, "DIRECT"), eq(flightWatchlistRoutes.enabled, true)))
    const a = routes.find((r) => r.origin === pair.from && r.destination === pair.via)
    const b = routes.find((r) => r.origin === pair.via && r.destination === pair.to)
    return a && b ? { a, b } : null
  }

  /** Rebuilds the combined slot of `date` from feeder A on `date` and feeder B on `date + offset`. Combining happens here, never at read time. */
  async buildCombined(cr: RouteRow, a: RouteRow, b: RouteRow, date: string, s: CatalogSettings, policy?: CarrierPolicy): Promise<boolean> {
    const [cslot] = await this.db.select().from(catalogSlots).where(and(eq(catalogSlots.routeId, cr.id), eq(catalogSlots.departureDate, date)))
    if (!cslot) return false
    const slotsOf = async (routeId: string, dates: string[]) => this.db.select().from(catalogSlots).where(and(eq(catalogSlots.routeId, routeId), inArray(catalogSlots.departureDate, dates)))
    const [slotA] = await slotsOf(a.id, [date])
    const slotsB = await slotsOf(b.id, [...new Set(s.connections.dayOffsets.map((o) => addDays(date, o)))])
    const fetchedSlots = [slotA, ...slotsB].filter((x): x is SlotRow => !!x && !!x.lastFetchedAt)
    // Nothing to combine until both legs have been fetched at least once.
    if (!slotA?.lastFetchedAt || !slotsB.some((x) => x.lastFetchedAt)) return false

    const offersA = await this.currentOffers([slotA.id])
    const offersB = await this.currentOffers(slotsB.map((x) => x.id))
    const idOf = new Map<NormalisedOffer, string>([...offersA, ...offersB].map((r) => [r.offer!, r.id]))
    const pol = policy ?? (await this.compliance.carrierPolicy())
    const ref = this.reference.lookup()
    const rules = new RuleResolver(this.rulesFor(s))
    const c = s.connections
    const ctx = {
      query: { tripType: "ONE_WAY", slices: [{ from: { airport: a.origin }, to: { airport: b.destination }, date, flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", preferences: { allowSelfTransfer: true, allowAirportChange: !c.sameAirport, allowOvernight: c.allowOvernight, maxStops: 3, nearestCabin: false, studentFare: false } } as SearchQuery,
      rules: this.rulesFor(s), hubs: this.config.get("HUBS"), policy: pol, reference: ref, ruleVersion: this.config.version("ENGINE_RULES"),
      flags: { selfTransfer: true, gateways: false }, locale: "en" as const, now: new Date(),
    }
    const built = new Map<string, { detail: ResultDetail; a: string; b: string; amountMinor: number; currency: string; fetchedAt: string }>()
    for (const sol of joinAtHub(offersA.map((r) => r.offer!), offersB.map((r) => r.offer!), rules, !c.sameAirport, 0)) {
      const out = buildItinerary([sol], ctx, rules)
      if (!out) continue
      const [oa, ob] = sol.components as [NormalisedOffer, NormalisedOffer]
      const identity = combinedIdentity(oa.source.providerOfferId, ob.source.providerOfferId)
      // Older leg decides how fresh the combination is (spec: combined fetchedAt = older leg).
      const fetchedAt = minIso(oa.source.fetchedAt, ob.source.fetchedAt)
      built.set(identity, { detail: detailFromItinerary(out.itinerary, fetchedAt), a: idOf.get(oa)!, b: idOf.get(ob)!, amountMinor: out.itinerary.price.total.amountMinor, currency: out.itinerary.price.total.currency, fetchedAt })
    }

    const fetched = fetchedSlots.map((x) => x.lastFetchedAt!).sort((x, y) => x.getTime() - y.getTime())[0]!
    await this.uow.run(async (tx) => {
      const keptIds: string[] = []
      const rows: { id: string; detail: ResultDetail }[] = []
      for (const [identity, r] of built) {
        const [row] = await tx.insert(flightResults).values({
          slotId: cslot.id, origin: cr.origin, destination: cr.destination, departureDate: date, identityKey: identity, selfTransfer: true,
          complianceReview: r.detail.complianceReview, offer: null, detail: r.detail, firstSeenAt: fetched, lastSeenAt: fetched, isCurrent: true,
        }).onConflictDoUpdate({
          target: [flightResults.slotId, flightResults.identityKey],
          set: { detail: r.detail, complianceReview: r.detail.complianceReview, lastSeenAt: fetched, isCurrent: true, updatedAt: new Date() },
        }).returning({ id: flightResults.id })
        await this.upsertPrice(tx, row!.id, r.amountMinor, r.currency, new Date())
        await tx.insert(flightResultLegs).values([{ resultId: row!.id, position: 0, legResultId: r.a }, { resultId: row!.id, position: 1, legResultId: r.b }])
          .onConflictDoUpdate({ target: [flightResultLegs.resultId, flightResultLegs.position], set: { legResultId: sql`excluded.leg_result_id` } })
        keptIds.push(row!.id)
        rows.push({ id: row!.id, detail: r.detail })
      }
      // A combination whose leg disappeared (or no longer fits the layover window) is no longer listed.
      await tx.update(flightResults).set({ isCurrent: false, updatedAt: new Date() })
        .where(and(eq(flightResults.slotId, cslot.id), eq(flightResults.isCurrent, true), keptIds.length ? notInArray(flightResults.id, keptIds) : undefined))
      const status: SlotStatus = rows.length ? slotStatus({ departureDate: date, lastFetchedAt: fetched, recentCounts: [rows.length], consecutiveErrors: 0, consecutiveEmpty: 0 }, s, new Date()) : "EMPTY"
      const version = cslot.version + 1
      await tx.update(catalogSlots).set({ lastFetchedAt: fetched, status, lastResultCount: rows.length, recentCounts: [rows.length], consecutiveEmpty: rows.length ? 0 : 1, version, updatedAt: new Date() }).where(eq(catalogSlots.id, cslot.id))
      const blob = await this.commitSnapshot(tx, cslot, version, fetched, status, snapshotPayload(rows))
      return blob
    }).then((blob) => this.cacheSnapshot(cslot, blob))
    return true
  }

  rulesFor(s: CatalogSettings): EngineRules {
    return catalogEngineRules(this.config.get("ENGINE_RULES"), s.connections)
  }

  // ---------------- policy changes ----------------

  /**
   * `catalog.snapshots.rebuild` (no Apify cost): re-applies the carrier, airport and lane policy to every stored direct result, then
   * rebuilds the combinations and snapshots. Tightening a policy takes effect at once; a row a policy removed comes back only with the
   * next refresh (stored rows are deleted, never hidden, so no stale copy can be served).
   */
  async rebuildAll(routeIds?: string[]): Promise<{ slots: number; removed: number; flagged: number }> {
    this.compliance.invalidatePolicyCache()
    const policy = await this.compliance.carrierPolicy()
    const ref = this.reference.lookup()
    const s = await this.cfg.get()
    const direct = await this.db.select({ slot: catalogSlots, route: flightWatchlistRoutes }).from(catalogSlots).innerJoin(flightWatchlistRoutes, eq(flightWatchlistRoutes.id, catalogSlots.routeId)).where(and(eq(flightWatchlistRoutes.kind, "DIRECT"), routeIds ? inArray(flightWatchlistRoutes.id, routeIds) : undefined))
    let removed = 0
    let flagged = 0
    let touched = 0
    for (const { slot } of direct) {
      const rows = await this.db.select({ id: flightResults.id, offer: flightResults.offer, detail: flightResults.detail, complianceReview: flightResults.complianceReview, isCurrent: flightResults.isCurrent }).from(flightResults).where(eq(flightResults.slotId, slot.id))
      const stats = emptyStats()
      const live = new Set(filterOffers(rows.flatMap((r) => (r.offer ? [r.offer] : [])), policy, ref, new Date(0), stats).map((o) => o.source.providerOfferId))
      const blocked = rows.filter((r) => r.offer && !live.has(r.offer.source.providerOfferId))
      const reviewChanged = rows.filter((r) => r.offer && live.has(r.offer.source.providerOfferId) && (offerLaneVerdict(r.offer, policy, ref) === "REVIEW") !== r.complianceReview)
      if (!blocked.length && !reviewChanged.length) continue
      touched++
      removed += blocked.length
      flagged += reviewChanged.length
      const blob = await this.uow.run(async (tx) => {
        if (blocked.length) await tx.delete(flightResults).where(inArray(flightResults.id, blocked.map((r) => r.id)))
        for (const r of reviewChanged) {
          const review = offerLaneVerdict(r.offer!, policy, ref) === "REVIEW"
          await tx.update(flightResults).set({ complianceReview: review, detail: { ...r.detail, complianceReview: review }, updatedAt: new Date() }).where(eq(flightResults.id, r.id))
        }
        const current = await this.snapshotRows(tx, slot.id)
        const version = slot.version + 1
        await tx.update(catalogSlots).set({ version, updatedAt: new Date() }).where(eq(catalogSlots.id, slot.id))
        return this.commitSnapshot(tx, slot, version, slot.lastFetchedAt, slot.status, snapshotPayload(current))
      })
      await this.cacheSnapshot(slot, blob)
    }
    // Combinations are rebuilt from whatever the feeders hold now, so a blocked leg takes its combinations with it.
    const combined = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.kind, "COMBINED"), eq(flightWatchlistRoutes.enabled, true)))
    for (const cr of combined) {
      const feeders = await this.feedersOf(cr, s)
      if (!feeders) continue
      const slots = await this.db.select().from(catalogSlots).where(eq(catalogSlots.routeId, cr.id))
      for (const cs of slots) await this.buildCombined(cr, feeders.a, feeders.b, cs.departureDate, s, policy)
    }
    return { slots: touched, removed, flagged }
  }
}
