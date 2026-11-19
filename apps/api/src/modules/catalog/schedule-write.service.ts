import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, eq, inArray, notInArray } from "drizzle-orm"
import type { Redis } from "ioredis"

import { type CatalogSettings, type NormalisedOffer, type PublicItinerary, type SearchQuery, Segment, type SlotStatus } from "@unitravel/contracts"
import { catalogScheduleSlots, catalogSlots, type Db, flightSchedules, flightWatchlistRoutes, type Tx } from "@unitravel/db"
import { buildItinerary, type CarrierPolicy, joinAtHub, makeOffer, RuleResolver, segmentsVerdict } from "@unitravel/engine"

import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { AVIATION_EDGE_PROVIDER_ID } from "../suppliers/adapters/aviation-edge/client"
import type { ScheduleFlight } from "../suppliers/adapters/aviation-edge/normalise"
import { combinedIdentity, detailFromItinerary, detailFromSegments, type ResultDetail, snapshotPayload } from "./catalog-model"
import { CatalogSettingsService } from "./catalog-settings.service"
import { CatalogWriteService, SNAPSHOT_TTL_S, type SnapshotBlob } from "./catalog-write.service"

type SlotRow = typeof catalogSlots.$inferSelect
type RouteRow = typeof flightWatchlistRoutes.$inferSelect

/** The schedule layer's copy of a slot's customer snapshot (ADR-0036). Written with the slot, read by `CatalogReadService`. */
export const scheduleKey = (routeId: string, date: string) => `cat:sched:${routeId}:${date}`

const HOUR = 3_600_000
const ERROR_RETRY_MAX_HOURS = 12
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const iso = (d: Date) => d.toISOString()

export interface ScheduleWrite {
  slotId: string
  /** What Aviation Edge returned for this slot, before policy. */
  flights: ScheduleFlight[]
  fetchedAt: Date
  notices: string[]
  /** The call failed: the slot is marked ERROR and its previous schedule stays. */
  errored?: string
}

/**
 * ADR-0036 E2/E5/E9. The write path of the schedule layer. Rows go to `flight_schedules`, never `flight_results` (rule 3: a schedule is not
 * an offer), and only this slot's own schedule rows are ever retired. The policy filter is the one used for offers, applied to legs.
 */
@Injectable()
export class ScheduleWriteService {
  private readonly log = new Logger("ScheduleWrite")

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly cfg: CatalogSettingsService,
    private readonly reference: ReferenceService,
    private readonly compliance: ComplianceService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
    private readonly write: CatalogWriteService,
  ) {}

  /** One transaction per slot. Returns null when the slot is gone. */
  async writeScheduleSlot(w: ScheduleWrite, policy?: CarrierPolicy): Promise<{ version: number; kept: number; dropped: number } | null> {
    const [slot] = await this.db.select().from(catalogSlots).where(eq(catalogSlots.id, w.slotId))
    if (!slot) return null
    const s = await this.cfg.get()
    const pol = policy ?? (await this.compliance.carrierPolicy())
    const ref = this.reference.lookup()
    const now = w.fetchedAt

    const kept: { flight: ScheduleFlight; review: boolean }[] = []
    for (const flight of w.flights) {
      const verdict = segmentsVerdict([flight.segment], pol, ref)
      if (verdict !== "BLOCK") kept.push({ flight, review: verdict === "REVIEW" })
    }

    const blob = await this.uow.run(async (tx) => {
      const [cur] = await tx.select().from(catalogScheduleSlots).where(eq(catalogScheduleSlots.slotId, slot.id))
      const version = (cur?.version ?? 0) + 1
      if (w.errored) {
        const errors = (cur?.consecutiveErrors ?? 0) + 1
        const retryH = Math.min(s.aviationEdgeRefreshHours, ERROR_RETRY_MAX_HOURS)
        await this.upsertSlot(tx, slot.id, {
          status: "ERROR", consecutiveErrors: errors, lastError: w.errored.slice(0, 300), notices: w.notices.slice(0, 20), nextDueAt: new Date(now.getTime() + retryH * HOUR), version,
        })
        return this.blob(slot, version, cur?.lastFetchedAt ?? null, "ERROR", cur?.payload ?? [])
      }
      const keptIds: string[] = []
      const rows: { id: string; detail: ResultDetail }[] = []
      for (const { flight, review } of kept) {
        const detail = detailFromSegments([flight.segment], review, iso(now))
        const [r] = await tx.insert(flightSchedules).values({
          slotId: slot.id, provider: AVIATION_EDGE_PROVIDER_ID, origin: detail.origin, destination: detail.destination, departureDate: slot.departureDate, identityKey: flight.identityKey,
          selfTransfer: false, complianceReview: review, detail, providerData: { ...flight.providerData, segment: flight.segment }, firstSeenAt: now, lastSeenAt: now, isCurrent: true,
        }).onConflictDoUpdate({
          target: [flightSchedules.slotId, flightSchedules.identityKey],
          set: { detail, complianceReview: review, providerData: { ...flight.providerData, segment: flight.segment }, lastSeenAt: now, isCurrent: true, updatedAt: now },
        }).returning({ id: flightSchedules.id })
        keptIds.push(r!.id)
        rows.push({ id: r!.id, detail })
      }
      // "No longer listed": history stays with is_current = false. Only this slot's rows (the unique key is per slot).
      await tx.update(flightSchedules).set({ isCurrent: false, updatedAt: now })
        .where(and(eq(flightSchedules.slotId, slot.id), eq(flightSchedules.isCurrent, true), keptIds.length ? notInArray(flightSchedules.id, keptIds) : undefined))
      const status: SlotStatus = rows.length ? "FRESH" : "EMPTY"
      const payload = snapshotPayload(rows)
      await this.upsertSlot(tx, slot.id, {
        status, lastFetchedAt: now, nextDueAt: new Date(now.getTime() + s.aviationEdgeRefreshHours * HOUR), lastResultCount: rows.length, consecutiveErrors: 0, lastError: null,
        notices: w.notices.slice(0, 20), version, payload,
      })
      await this.outbox.add(tx, { aggregateType: "catalog_slot", aggregateId: slot.id, eventType: "catalog.slot_updated", payload: { slotId: slot.id, version, layer: "schedule" } })
      return this.blob(slot, version, now, status, payload)
    })
    await this.cache(slot, blob)
    if (!w.errored) await this.rebuildForFeeder(slot, pol).catch((err) => this.log.error({ err: String(err), slot: slot.id }, "schedule self-transfer rebuild failed"))
    return { version: blob.version, kept: kept.length, dropped: w.flights.length - kept.length }
  }

  private blob(slot: Pick<SlotRow, "id">, version: number, fetchedAt: Date | null, status: SlotStatus, payload: PublicItinerary[]): SnapshotBlob {
    return { slotId: slot.id, version, fetchedAt: fetchedAt ? iso(fetchedAt) : null, status, payload }
  }

  private async upsertSlot(tx: Tx, slotId: string, v: Partial<typeof catalogScheduleSlots.$inferInsert>) {
    await tx.insert(catalogScheduleSlots).values({ slotId, provider: AVIATION_EDGE_PROVIDER_ID, ...v })
      .onConflictDoUpdate({ target: catalogScheduleSlots.slotId, set: { ...v, updatedAt: new Date() } })
  }

  /** Redis is a cache of `catalog_schedule_slots`; a failure here never fails the write (the read path falls back to Postgres). */
  async cache(slot: Pick<SlotRow, "routeId" | "departureDate">, blob: SnapshotBlob) {
    try {
      await this.redis.set(scheduleKey(slot.routeId, slot.departureDate), JSON.stringify(blob), "EX", SNAPSHOT_TTL_S)
    } catch (err) {
      this.log.warn({ err: String(err) }, "schedule snapshot cache write failed")
    }
  }

  // ---------------- self-transfers built from schedule legs ----------------

  /** After a feeder slot's schedule changed: rebuild every combined slot that includes it (the same rule as `CatalogWriteService.rebuildForFeeder`). */
  async rebuildForFeeder(slot: SlotRow, policy?: CarrierPolicy): Promise<number> {
    const s = await this.cfg.get()
    const combined = await this.db.select().from(flightWatchlistRoutes).where(and(eq(flightWatchlistRoutes.kind, "COMBINED"), eq(flightWatchlistRoutes.enabled, true)))
    let rebuilt = 0
    for (const cr of combined) {
      const feeders = await this.write.feedersOf(cr, s)
      if (!feeders) continue
      let dates: string[] = []
      if (slot.routeId === feeders.a.id) dates = [slot.departureDate]
      else if (slot.routeId === feeders.b.id) dates = s.connections.dayOffsets.map((o) => addDays(slot.departureDate, -o))
      for (const d of new Set(dates)) if (await this.buildCombined(cr, feeders.a, feeders.b, d, s, policy)) rebuilt++
    }
    return rebuilt
  }

  /** Current schedule legs of some slots as in-memory offers for the connection check. They are never stored or served: a schedule is not an offer. */
  private async legsOf(slotIds: string[]): Promise<{ id: string; identityKey: string; offer: NormalisedOffer; fetchedAt: string }[]> {
    if (!slotIds.length) return []
    const rows = await this.db.select({ id: flightSchedules.id, identityKey: flightSchedules.identityKey, providerData: flightSchedules.providerData, lastSeenAt: flightSchedules.lastSeenAt }).from(flightSchedules)
      .where(and(inArray(flightSchedules.slotId, slotIds), eq(flightSchedules.isCurrent, true), eq(flightSchedules.selfTransfer, false)))
    return rows.flatMap((r) => {
      const parsed = Segment.safeParse(r.providerData?.segment)
      if (!parsed.success) return []
      const sg = parsed.data
      const offer = makeOffer({
        provider: AVIATION_EDGE_PROVIDER_ID, id: r.identityKey, fetchedAt: iso(r.lastSeenAt), totalMinor: 0, currency: "USD", rung: "CACHED_OFFER",
        slices: [[{ carrier: sg.marketing.carrier, number: sg.marketing.flightNumber, from: sg.origin.iata, to: sg.destination.iata, dep: sg.departure.local, arr: sg.arrival.local, fromTz: sg.departure.tz, toTz: sg.arrival.tz, terminals: [sg.origin.terminal, sg.destination.terminal], aircraft: sg.aircraft }]],
      })
      return [{ id: r.id, identityKey: r.identityKey, offer, fetchedAt: iso(r.lastSeenAt) }]
    })
  }

  /** Rebuilds the combined slot of `date` from feeder A's schedule on `date` and feeder B's on `date + offset`. */
  async buildCombined(cr: RouteRow, a: RouteRow, b: RouteRow, date: string, s: CatalogSettings, policy?: CarrierPolicy): Promise<boolean> {
    const [cslot] = await this.db.select().from(catalogSlots).where(and(eq(catalogSlots.routeId, cr.id), eq(catalogSlots.departureDate, date)))
    if (!cslot) return false
    const slotsOf = (routeId: string, dates: string[]) => this.db.select().from(catalogSlots).where(and(eq(catalogSlots.routeId, routeId), inArray(catalogSlots.departureDate, dates)))
    const [slotA] = await slotsOf(a.id, [date])
    const slotsB = await slotsOf(b.id, [...new Set(s.connections.dayOffsets.map((o) => addDays(date, o)))])
    if (!slotA) return false
    const sched = await this.db.select().from(catalogScheduleSlots).where(inArray(catalogScheduleSlots.slotId, [slotA.id, ...slotsB.map((x) => x.id)]))
    const fetched = sched.flatMap((x) => (x.lastFetchedAt ? [x.lastFetchedAt] : []))
    const hasA = sched.some((x) => x.slotId === slotA.id && x.lastFetchedAt)
    if (!hasA || !slotsB.some((x) => sched.some((y) => y.slotId === x.id && y.lastFetchedAt))) return false

    const legsA = await this.legsOf([slotA.id])
    const legsB = await this.legsOf(slotsB.map((x) => x.id))
    const byOffer = new Map<NormalisedOffer, (typeof legsA)[number]>([...legsA, ...legsB].map((l) => [l.offer, l]))
    const pol = policy ?? (await this.compliance.carrierPolicy())
    const ref = this.reference.lookup()
    const rules = new RuleResolver(this.write.rulesFor(s))
    const c = s.connections
    const ctx = {
      query: { tripType: "ONE_WAY", slices: [{ from: { airport: a.origin }, to: { airport: b.destination }, date, flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", preferences: { allowSelfTransfer: true, allowAirportChange: !c.sameAirport, allowOvernight: c.allowOvernight, maxStops: 3, nearestCabin: false, studentFare: false } } as SearchQuery,
      rules: this.write.rulesFor(s), hubs: this.config.get("HUBS"), policy: pol, reference: ref, ruleVersion: this.config.version("ENGINE_RULES"),
      flags: { selfTransfer: true, gateways: false }, locale: "en" as const, now: new Date(),
    }
    const built = new Map<string, { detail: ResultDetail; legs: [string, string]; review: boolean }>()
    const oldest = fetched.sort((x, y) => x.getTime() - y.getTime())[0]!
    for (const sol of joinAtHub(legsA.map((l) => l.offer), legsB.map((l) => l.offer), rules, !c.sameAirport, 0)) {
      const out = buildItinerary([sol], ctx, rules)
      if (!out) continue
      const [oa, ob] = sol.components as [NormalisedOffer, NormalisedOffer]
      const la = byOffer.get(oa)!
      const lb = byOffer.get(ob)!
      const verdict = segmentsVerdict(out.itinerary.components.flatMap((x) => x.slices[0]!.segments), pol, ref)
      if (verdict === "BLOCK") continue
      const detail = detailFromItinerary({ ...out.itinerary, complianceReview: out.itinerary.complianceReview || verdict === "REVIEW" }, iso(oldest), "SCHEDULE")
      built.set(combinedIdentity(la.identityKey, lb.identityKey), { detail, legs: [la.id, lb.id], review: detail.complianceReview })
    }

    const blob = await this.uow.run(async (tx) => {
      const [cur] = await tx.select().from(catalogScheduleSlots).where(eq(catalogScheduleSlots.slotId, cslot.id))
      const keptIds: string[] = []
      const rows: { id: string; detail: ResultDetail }[] = []
      for (const [identity, r] of built) {
        const [row] = await tx.insert(flightSchedules).values({
          slotId: cslot.id, provider: AVIATION_EDGE_PROVIDER_ID, origin: cr.origin, destination: cr.destination, departureDate: date, identityKey: identity, selfTransfer: true,
          complianceReview: r.review, detail: r.detail, providerData: { legs: r.legs }, firstSeenAt: oldest, lastSeenAt: oldest, isCurrent: true,
        }).onConflictDoUpdate({
          target: [flightSchedules.slotId, flightSchedules.identityKey],
          set: { detail: r.detail, complianceReview: r.review, providerData: { legs: r.legs }, lastSeenAt: oldest, isCurrent: true, updatedAt: new Date() },
        }).returning({ id: flightSchedules.id })
        keptIds.push(row!.id)
        rows.push({ id: row!.id, detail: r.detail })
      }
      // A combination whose leg disappeared (or no longer fits the layover window) is no longer listed.
      await tx.update(flightSchedules).set({ isCurrent: false, updatedAt: new Date() })
        .where(and(eq(flightSchedules.slotId, cslot.id), eq(flightSchedules.isCurrent, true), keptIds.length ? notInArray(flightSchedules.id, keptIds) : undefined))
      const status: SlotStatus = rows.length ? "FRESH" : "EMPTY"
      const version = (cur?.version ?? 0) + 1
      const payload = snapshotPayload(rows)
      await this.upsertSlot(tx, cslot.id, {
        status, lastFetchedAt: oldest, nextDueAt: new Date(oldest.getTime() + s.aviationEdgeRefreshHours * HOUR), lastResultCount: rows.length, version, payload, consecutiveErrors: 0, lastError: null,
      })
      await this.outbox.add(tx, { aggregateType: "catalog_slot", aggregateId: cslot.id, eventType: "catalog.slot_updated", payload: { slotId: cslot.id, version, layer: "schedule" } })
      return this.blob(cslot, version, oldest, status, payload)
    })
    await this.cache(cslot, blob)
    return true
  }
}
