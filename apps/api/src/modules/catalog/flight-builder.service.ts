import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"

import {
  type Cabin, type FlightBuilderCaptureInput, type FlightBuilderSegmentInput, FlightBuilderSettings, type FlightBuilderSettingsPatch, FlightBuilderStatus, FlightBuilderUsage, type Itinerary, Itinerary as ItinerarySchema,
  type NormalisedOffer, type ProviderAuthorisationInput, ProviderAuthorisationView, PublicFare, type PublicItineraryDetail, PublicItineraryDetail as PublicItineraryDetailSchema, type RefreshRequest, StaffFare,
  StaffFareNoPrice, StaffFlightBuilderOption, SyncRunView, type UsageObservationInput, UsageObservationView,
} from "@unitravel/contracts"
import {
  type Db, type DbOrTx, flightBuilderSyncRuns, flightBuilderUsageObservations, flightRequests, flightResultFares, flightResults, providerAuthorisations, requestNotes, settings, type Tx,
} from "@unitravel/db"
import { authorisationActive, deadlineWarning, FB_ADAPTER_PRESENT, fareFreshness, fbConnectionState, normaliseReference, seatsReported, syncGate, usageSummary } from "@unitravel/domain"
import { stableHash } from "@unitravel/engine"

import { sha256 } from "../../core/crypto"
import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AuditService } from "../audit/audit.service"
import { ReferenceService } from "../reference/reference.service"
import { FLIGHT_BUILDER_PROVIDER_ID as ID, FlightBuilderInputError, normalise } from "../suppliers/adapters/flight-builder/normalise"
import { SuppliersService } from "../suppliers/suppliers.service"
import { CatalogWriteService } from "./catalog-write.service"

const SETTINGS_KEY = "flight_builder"
const CACHE_MS = 15_000
const CABIN_ORDER: Record<Cabin, number> = { ECONOMY: 0, PREMIUM_ECONOMY: 1, BUSINESS: 2, FIRST: 3 }
const minutes = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000)

type FareRow = typeof flightResultFares.$inferSelect
type ResultRow = typeof flightResults.$inferSelect
type Who = { userId: string; ip?: string }

/** The staff copy of a fare as stored on a CATALOG snapshot. */
export type CatalogFare = StaffFare

/**
 * ADR-0037. Everything about Flight Builder as a staff-capture source: settings, derived connection state, the authorisation record, the
 * quota log, refresh attempts (always BLOCKED today), captured options and their customer views. There is no HTTP client here, and
 * nothing in this file reads a credential value or fetches the panel URL.
 */
@Injectable()
export class FlightBuilderService {
  private readonly log = new Logger("FlightBuilder")
  private cache?: { at: number; value: FlightBuilderSettings }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly suppliers: SuppliersService,
    private readonly write: CatalogWriteService,
    private readonly reference: ReferenceService,
  ) {}

  // ---------------- settings ----------------

  async settings(): Promise<FlightBuilderSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value
    const [row] = await this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY))
    const parsed = FlightBuilderSettings.safeParse((row?.value as object | undefined) ?? {})
    if (!parsed.success) this.log.error({ issues: parsed.error.issues.length }, "stored flight_builder settings are invalid; defaults in use")
    const value = parsed.success ? parsed.data : FlightBuilderSettings.parse({})
    this.cache = { at: Date.now(), value }
    return value
  }

  /** `onChanged` lets the jobs service move the scheduler after the commit. */
  async patchSettings(patch: FlightBuilderSettingsPatch, who: Who, requestId: string): Promise<FlightBuilderStatus> {
    const before = await this.settings()
    const next = FlightBuilderSettings.parse({ ...before, ...patch })
    if (next.staleHours < next.freshHours) throw new AppError("VALIDATION_FAILED", "Stale hours must not be less than fresh hours", [{ path: "staleHours", code: "TOO_SMALL" }])
    if (next.syncMode !== "DISABLED") {
      const gate = await this.gate(next)
      if (!gate.allowed) throw new AppError("AUTHORISATION_REQUIRED", "Sync cannot be switched on without a recorded written authorisation and an adapter", undefined, { reason: gate.reason })
    }
    await this.uow.run(async (tx) => {
      await tx.insert(settings).values({ key: SETTINGS_KEY, value: next, updatedBy: who.userId }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: who.userId, updatedAt: new Date() } })
      const changed = (Object.keys(patch) as (keyof FlightBuilderSettings)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
      await this.audit.record(tx, { actorUserId: who.userId, actorKind: "STAFF", action: "flight_builder.settings.updated", entityType: "flight_builder_settings", entityId: SETTINGS_KEY, after: { changed }, ip: who.ip, requestId })
    })
    this.cache = { at: Date.now(), value: next }
    return this.state()
  }

  // ---------------- derived state ----------------

  private async authorisationRow() {
    const rows = await this.db.select().from(providerAuthorisations).where(eq(providerAuthorisations.providerId, ID)).orderBy(desc(providerAuthorisations.recordedAt))
    const now = new Date()
    return rows.find((r) => authorisationActive(r, now)) ?? rows[0] ?? null
  }

  private async usageRows(limit = 200) {
    return this.db.select().from(flightBuilderUsageObservations).orderBy(desc(flightBuilderUsageObservations.observedAt)).limit(limit)
  }

  private async gate(s: FlightBuilderSettings, now = new Date()) {
    const auth = await this.authorisationRow()
    const summary = usageSummary(await this.usageRows(1), now)
    return syncGate({ enabled: s.enabled, authorisation: auth, adapterPresent: FB_ADAPTER_PRESENT, usageRatio: summary?.limitShare ?? null }, now)
  }

  async state(now = new Date()): Promise<FlightBuilderStatus> {
    const s = await this.settings()
    const view = await this.suppliers.view(ID)
    const auth = await this.authorisationRow()
    const usage = usageSummary(await this.usageRows(1), now)
    const [last] = await this.db.select().from(flightBuilderSyncRuns).orderBy(desc(flightBuilderSyncRuns.startedAt)).limit(1)
    const state = fbConnectionState({
      enabled: s.enabled, credentialsSet: view.credentials.set, panelUrlSet: !!s.panelUrl, usageRatio: usage?.limitShare ?? null, authorisation: auth,
      credentialsInvalidAt: view.credentials.invalidAt ? new Date(view.credentials.invalidAt) : null, verifiedCheckAt: null,
    }, now)
    return FlightBuilderStatus.parse({
      state, gate: await this.gate(s, now), credentials: view.credentials, settings: s, lastRun: last ? this.runView(last) : null,
      latestUsage: usage ? { ...usage, observedAt: usage.observedAt.toISOString() } : null, authorisation: auth ? this.authView(auth) : null,
    })
  }

  // ---------------- authorisation ----------------

  private authView(r: typeof providerAuthorisations.$inferSelect) {
    return ProviderAuthorisationView.parse({
      id: r.id, providerId: r.providerId, documentRef: r.documentRef, grantedByName: r.grantedByName, grantedAt: r.grantedAt.toISOString(), scope: r.scope, maxSearchesPerDay: r.maxSearchesPerDay,
      expiresAt: r.expiresAt?.toISOString() ?? null, recordedBy: r.recordedBy, recordedAt: r.recordedAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null, revokedBy: r.revokedBy, revokedReason: r.revokedReason,
    })
  }

  async recordAuthorisation(input: ProviderAuthorisationInput, who: Who, requestId: string) {
    return this.uow.run(async (tx) => {
      const [r] = await tx.insert(providerAuthorisations).values({
        providerId: ID, documentRef: input.documentRef, grantedByName: input.grantedByName, grantedAt: new Date(input.grantedAt), scope: input.scope,
        maxSearchesPerDay: input.maxSearchesPerDay ?? null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, recordedBy: who.userId,
      }).returning()
      await this.audit.record(tx, { actorUserId: who.userId, actorKind: "STAFF", action: "provider.authorisation.recorded", entityType: "provider_authorisation", entityId: r!.id, after: { providerId: ID, expiresAt: r!.expiresAt?.toISOString() ?? null }, ip: who.ip, requestId })
      return this.authView(r!)
    })
  }

  async revokeAuthorisation(id: string, reason: string, who: Who, requestId: string) {
    return this.uow.run(async (tx) => {
      const rows = await tx.update(providerAuthorisations).set({ revokedAt: new Date(), revokedBy: who.userId, revokedReason: reason })
        .where(and(eq(providerAuthorisations.id, id), eq(providerAuthorisations.providerId, ID), isNull(providerAuthorisations.revokedAt))).returning()
      if (!rows[0]) throw notFound("Authorisation")
      await this.audit.record(tx, { actorUserId: who.userId, actorKind: "STAFF", action: "provider.authorisation.revoked", entityType: "provider_authorisation", entityId: id, after: { providerId: ID }, ip: who.ip, requestId })
      return this.authView(rows[0])
    })
  }

  // ---------------- usage ----------------

  private usageView(r: typeof flightBuilderUsageObservations.$inferSelect) {
    return UsageObservationView.parse({
      id: r.id, observedAt: r.observedAt.toISOString(), bookings: r.bookings, scanHits: r.scanHits, warningThreshold: r.warningThreshold, criticalThreshold: r.criticalThreshold,
      remainingReported: r.remainingReported, source: r.source, observerUserId: r.observerUserId, note: r.note, createdAt: r.createdAt.toISOString(),
    })
  }

  async usage(now = new Date()): Promise<FlightBuilderUsage> {
    const rows = await this.usageRows()
    const latest = usageSummary(rows, now)
    return FlightBuilderUsage.parse({ observations: rows.map((r) => this.usageView(r)), latest: latest ? { ...latest, observedAt: latest.observedAt.toISOString() } : null })
  }

  async recordUsage(input: UsageObservationInput, who: Who, requestId: string) {
    return this.uow.run(async (tx) => {
      const [r] = await tx.insert(flightBuilderUsageObservations).values({
        observedAt: new Date(input.observedAt), bookings: input.bookings, scanHits: input.scanHits, warningThreshold: input.warningThreshold, criticalThreshold: input.criticalThreshold,
        remainingReported: input.remainingReported ?? null, source: input.source, observerUserId: who.userId, note: input.note ?? null,
      }).returning()
      await this.audit.record(tx, { actorUserId: who.userId, actorKind: "STAFF", action: "flight_builder.usage.recorded", entityType: "flight_builder_usage", entityId: r!.id, after: { source: r!.source }, ip: who.ip, requestId })
      return this.usageView(r!)
    })
  }

  // ---------------- sync runs (always blocked today) ----------------

  private runView(r: typeof flightBuilderSyncRuns.$inferSelect) {
    return SyncRunView.parse({
      id: r.id, trigger: r.trigger, scope: r.scope, status: r.status, blockedReason: r.blockedReason, imported: r.imported, updated: r.updated, skipped: r.skipped, errors: r.errors,
      actorUserId: r.actorUserId, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
    })
  }

  async syncRuns(limit = 50) {
    return (await this.db.select().from(flightBuilderSyncRuns).orderBy(desc(flightBuilderSyncRuns.startedAt)).limit(limit)).map((r) => this.runView(r))
  }

  /** Writes the BLOCKED run row (and, for a staff-triggered one, its audit event) and returns the gate reason. No provider is called. */
  async recordBlockedRun(trigger: "MANUAL" | "SCHEDULED", scope: Record<string, unknown>, who: Who | null, requestId?: string) {
    const gate = await this.gate(await this.settings())
    const reason = gate.reason ?? "NO_ADAPTER"
    const run = await this.uow.run(async (tx) => {
      const now = new Date()
      const [r] = await tx.insert(flightBuilderSyncRuns).values({ trigger, scope, status: "BLOCKED", blockedReason: reason, actorUserId: who?.userId ?? null, startedAt: now, finishedAt: now }).returning()
      await this.audit.record(tx, { actorUserId: who?.userId ?? null, actorKind: who ? "STAFF" : "SYSTEM", action: "flight_builder.refresh.blocked", entityType: "flight_builder_sync_run", entityId: r!.id, after: { trigger, reason }, ip: who?.ip, requestId })
      return r!
    })
    return { run: this.runView(run), reason }
  }

  async refresh(body: RefreshRequest, who: Who, requestId: string): Promise<never> {
    const { run, reason } = await this.recordBlockedRun("MANUAL", body.scope, who, requestId)
    const code = reason === "NO_ADAPTER" ? "NO_ADAPTER" : "SOURCE_NOT_AUTHORISED"
    const detail = reason === "NO_ADAPTER" ? "No automated adapter exists; Flight Builder is staff-capture only (ADR-0037)" : reason === "DISABLED" ? "Flight Builder is disabled" : "No active written authorisation is recorded for this source"
    throw new AppError(code, detail, undefined, { reason, runId: run.id })
  }

  // ---------------- views ----------------

  private fareShared(f: FareRow, s: FlightBuilderSettings, now: Date) {
    const freshness = f.status === "EXPIRED" ? "EXPIRED" as const : fareFreshness(f.observedAt, f.ticketingDeadline, now, s)
    return {
      id: f.id, position: f.position, cabin: f.cabin, bookingClasses: f.bookingClasses, seats: f.seatsRaw.map(seatsReported), fareBasis: f.fareBasis, fareType: f.fareType, fareTypeRaw: f.fareTypeRaw,
      baggage: f.baggage, change: f.conditions.change, refund: f.conditions.refund, rulesText: f.conditions.rulesText ?? null, ticketingDeadline: f.ticketingDeadline, status: f.status, freshness,
      deadlineWarning: deadlineWarning(f.ticketingDeadline, now, s.deadlineWarnHours), observedAt: f.observedAt.toISOString(),
    }
  }

  staffFare(f: FareRow, s: FlightBuilderSettings, now = new Date()): StaffFare {
    return StaffFare.parse({ ...this.fareShared(f, s, now), baseMinor: f.baseMinor, taxesMinor: f.taxesMinor, totalMinor: f.totalMinor, currency: f.currency })
  }

  /** Penalty amounts are prices too, so they go with the rest of the price fields. */
  staffFareNoPrice(f: FareRow, s: FlightBuilderSettings, now = new Date()): StaffFareNoPrice {
    const v = this.fareShared(f, s, now)
    const strip = ({ penaltyMinor: _p, ...c }: typeof v.change) => c
    return StaffFareNoPrice.parse({ ...v, change: strip(v.change), refund: strip(v.refund) })
  }

  /** Customer view of one fare: the strict schema is the backstop, so no price, fare type, basis or rules text can reach the customer. */
  publicFareOf(f: FareRow, s: FlightBuilderSettings, now = new Date()): PublicFare {
    const v = this.fareShared(f, s, now)
    return PublicFare.parse({
      id: v.id, cabin: v.cabin, bookingClasses: v.bookingClasses, seats: v.seats, baggage: v.baggage,
      conditions: { change: { state: v.change.state }, refund: { state: v.refund.state } },
      ticketingDeadline: v.ticketingDeadline, deadlineWarning: v.deadlineWarning, observedAt: v.observedAt, freshness: v.freshness,
    })
  }

  private segmentsOf(offer: NormalisedOffer): FlightBuilderSegmentInput[] {
    return offer.slices[0]!.segments.map((g) => ({
      carrier: g.marketing.carrier, flightNumber: g.marketing.flightNumber, ...(g.operating.carrier !== g.marketing.carrier ? { operatingCarrier: g.operating.carrier } : {}),
      from: g.origin.iata, to: g.destination.iata, departLocal: g.departure.local, arriveLocal: g.arrival.local, departTz: g.departure.tz, arriveTz: g.arrival.tz,
      ...(g.aircraft ? { aircraft: g.aircraft } : {}), durationMin: Math.max(0, minutes(g.departure.utc, g.arrival.utc)),
    }))
  }

  private optionView(r: ResultRow, fares: FareRow[], actor: Pick<Actor, "permissions">, s: FlightBuilderSettings, now: Date) {
    const priced = actor.permissions.has("pricing.read.internal")
    return StaffFlightBuilderOption.parse({
      resultId: r.id, segments: r.offer ? this.segmentsOf(r.offer) : [],
      fares: fares.sort((a, b) => a.position - b.position).map((f) => (priced ? this.staffFare(f, s, now) : this.staffFareNoPrice(f, s, now))),
      capture: r.capture, capturedBy: r.capturedBy, sourceRecordId: r.sourceRecordId, verification: r.verification, observedAt: r.lastSeenAt.toISOString(), isCurrent: r.isCurrent,
      requestRef: r.requestRef, note: r.captureNote,
    })
  }

  async option(id: string, actor: Pick<Actor, "permissions">, now = new Date()) {
    const [r] = await this.db.select().from(flightResults).where(and(eq(flightResults.id, id), eq(flightResults.capture, "STAFF")))
    if (!r) throw notFound("Option")
    const fares = await this.db.select().from(flightResultFares).where(eq(flightResultFares.resultId, id))
    return this.optionView(r, fares, actor, await this.settings(), now)
  }

  async options(q: { from?: string; to?: string; date?: string; status?: "LIVE" | "STALE" | "EXPIRED" | "RETIRED"; current?: boolean; limit: number }, actor: Pick<Actor, "permissions">, now = new Date()) {
    const rows = await this.db.select().from(flightResults).where(and(
      eq(flightResults.capture, "STAFF"), q.from ? eq(flightResults.origin, q.from) : undefined, q.to ? eq(flightResults.destination, q.to) : undefined,
      q.date ? eq(flightResults.departureDate, q.date) : undefined, q.current === undefined ? undefined : eq(flightResults.isCurrent, q.current),
      q.status ? sql`exists (select 1 from ${flightResultFares} f where f.result_id = ${flightResults.id} and f.status = ${q.status})` : undefined,
    )).orderBy(desc(flightResults.lastSeenAt)).limit(q.limit)
    const fares = rows.length ? await this.db.select().from(flightResultFares).where(inArray(flightResultFares.resultId, rows.map((r) => r.id))) : []
    const s = await this.settings()
    return rows.map((r) => this.optionView(r, fares.filter((f) => f.resultId === r.id), actor, s, now))
  }

  // ---------------- capture ----------------

  async capture(body: FlightBuilderCaptureInput, actor: Actor, requestId: string) {
    const now = new Date()
    let norm
    try {
      norm = normalise(body, { reference: this.reference.lookup(), confirmedBy: actor.userId, now })
    } catch (err) {
      if (err instanceof FlightBuilderInputError) throw new AppError("VALIDATION_FAILED", err.message, [{ path: err.path, code: "INVALID" }])
      throw err
    }
    let requestId_: string | null = null
    if (body.requestRef) {
      const ref = normaliseReference(body.requestRef)
      const [r] = ref?.startsWith("UT-F-") ? await this.db.select({ id: flightRequests.id, ref: flightRequests.ref }).from(flightRequests).where(eq(flightRequests.ref, ref)) : []
      if (!r) throw new AppError("VALIDATION_FAILED", "No such request to link", [{ path: "requestRef", code: "NOT_FOUND" }])
      requestId_ = r.id
      body = { ...body, requestRef: r.ref }
    }
    const numbers = body.segments.map((g) => `${g.carrier}${g.flightNumber}`).join(",")
    const out = await this.write.writeStaffOption({ capture: norm, actorUserId: actor.userId, observedAt: new Date(body.observedAt), sourceRecordId: body.sourceRecordId, requestRef: body.requestRef, note: body.note, now }, async (tx, r) => {
      // No amounts and no credentials in the audit event or the note (ADR-0004).
      await this.audit.record(tx, {
        actorUserId: actor.userId, actorKind: "STAFF", action: "flight_builder.option.captured", entityType: "flight_result", entityId: r.resultId, contextRef: body.requestRef,
        after: { slotId: r.slotId, created: r.created, route: `${norm.offer.slices[0]!.origin}-${norm.offer.slices[0]!.destination}`, flights: numbers, fares: norm.fares.length, complianceReview: r.review }, ip: actor.ip, requestId,
      })
      if (requestId_) await tx.insert(requestNotes).values({ requestType: "FLIGHT", requestId: requestId_, authorId: actor.userId, body: `Flight Builder option recorded: ${numbers} on ${norm.offer.slices[0]!.segments[0]!.departure.local.slice(0, 10)} (${norm.fares.length} fare option${norm.fares.length === 1 ? "" : "s"}).${body.note ? ` ${body.note}` : ""}` })
    })
    return this.option(out.resultId, actor, now)
  }

  async retire(id: string, actor: Actor, requestId: string) {
    const ok = await this.write.retireStaffOption(id, async (tx) => {
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "flight_builder.option.retired", entityType: "flight_result", entityId: id, ip: actor.ip, requestId })
    })
    if (!ok) throw notFound("Option")
    return this.option(id, actor)
  }

  /** The staff copy frozen on a CATALOG snapshot: with price only for `pricing.read.internal`, otherwise the same fare without price fields. */
  snapshotStaffFare(stored: unknown, priced: boolean): StaffFare | StaffFareNoPrice | null {
    const f = StaffFare.safeParse(stored)
    if (!f.success) return null
    if (priced) return f.data
    const { baseMinor: _b, taxesMinor: _t, totalMinor: _m, currency: _c, ...rest } = f.data
    const strip = ({ penaltyMinor: _p, ...c }: typeof rest.change) => c
    return StaffFareNoPrice.parse({ ...rest, change: strip(rest.change), refund: strip(rest.refund) })
  }

  async sourceRecordIdOf(resultId: string): Promise<string | null> {
    const [r] = await this.db.select({ s: flightResults.sourceRecordId }).from(flightResults).where(eq(flightResults.id, resultId))
    return r?.s ?? null
  }

  // ---------------- customer side ----------------

  /** LIVE fares of one result, customer view, ordered by cabin then class (never by price). Stale and expired fares are not shown (ADR-0037 D10). */
  async publicFares(resultId: string, now = new Date()): Promise<PublicFare[]> {
    const rows = await this.db.select().from(flightResultFares).where(and(eq(flightResultFares.resultId, resultId), eq(flightResultFares.status, "LIVE")))
    const s = await this.settings()
    return rows
      .filter((f) => {
        const fr = fareFreshness(f.observedAt, f.ticketingDeadline, now, s)
        return fr !== "STALE" && fr !== "EXPIRED"
      })
      .sort((a, b) => CABIN_ORDER[a.cabin as Cabin] - CABIN_ORDER[b.cabin as Cabin] || a.bookingClasses.join("").localeCompare(b.bookingClasses.join("")) || a.position - b.position)
      .map((f) => this.publicFareOf(f, s, now))
  }

  /** The customer result detail plus its fares. A staff capture that has left the catalog is hidden at once. */
  async publicDetail(base: PublicItineraryDetail, now = new Date()): Promise<PublicItineraryDetail> {
    const [r] = await this.db.select({ capture: flightResults.capture, isCurrent: flightResults.isCurrent }).from(flightResults).where(eq(flightResults.id, base.id))
    if (r?.capture === "STAFF" && !r.isCurrent) throw new AppError("NOT_FOUND", "Flight not found")
    return PublicItineraryDetailSchema.strict().parse({ ...base, fares: r?.capture === "STAFF" ? await this.publicFares(base.id, now) : [] })
  }

  private async liveFare(resultId: string, fareId: string, db: DbOrTx = this.db) {
    const [r] = await db.select().from(flightResults).where(and(eq(flightResults.id, resultId), eq(flightResults.capture, "STAFF")))
    const [f] = await db.select().from(flightResultFares).where(and(eq(flightResultFares.id, fareId), eq(flightResultFares.resultId, resultId)))
    if (!r || !f) throw notFound("Fare")
    return { r, f }
  }

  /**
   * ADR-0037 D5: everything a CATALOG request freezes: the itinerary for the snapshot, the customer copy, and the staff copy with price.
   * 409 OFFER_EXPIRED unless the result is current and the fare is LIVE and neither stale nor past its ticketing date.
   */
  async catalogSnapshot(resultId: string, fareId: string, now = new Date()) {
    const { r, f } = await this.liveFare(resultId, fareId)
    const s = await this.settings()
    const fr = fareFreshness(f.observedAt, f.ticketingDeadline, now, s)
    if (!r.isCurrent || f.status !== "LIVE" || fr === "STALE" || fr === "EXPIRED" || !r.offer) throw new AppError("OFFER_EXPIRED", "This fare is no longer available; choose another or send a manual request")
    const itinerary = this.itineraryOf(r, f)
    const customerView = this.publicFareOf(f, s, now)
    const staffFare = this.staffFare(f, s, now)
    const first = itinerary.components[0]!.slices[0]!
    return {
      itinerary, customerView, staffFare, origin: first.origin, destination: first.destination, date: first.segments[0]!.departure.local.slice(0, 10), cabin: f.cabin as Cabin,
      identityKey: r.identityKey, contentHash: sha256(JSON.stringify({ itinerary, customerView, staffFare })),
    }
  }

  /** A single-ticket itinerary for the chosen fare. The result's offer is rebuilt around this fare's class, baggage, conditions and price. */
  private itineraryOf(r: ResultRow, f: FareRow): Itinerary {
    const base = r.offer!
    const currency = f.currency
    const known = (c: { state: string; penaltyMinor?: number }) =>
      c.state === "UNKNOWN" ? ({ status: "UNKNOWN" } as const) : ({ status: "KNOWN", value: { allowed: c.state === "KNOWN_ALLOWED", ...(c.penaltyMinor ? { penalty: { amountMinor: c.penaltyMinor, currency } } : {}) } } as const)
    const segs = base.slices[0]!.segments.map((g, i) => ({ ...g, cabin: f.cabin as Cabin, bookingClass: f.bookingClasses[i], ...(f.fareBasis[i] ? { fareBasis: f.fareBasis[i] } : { fareBasis: undefined }) }))
    const offer: NormalisedOffer = {
      ...base,
      slices: [{ ...base.slices[0]!, segments: segs }],
      price: { total: { amountMinor: f.totalMinor, currency }, ...(f.baseMinor !== null ? { base: { amountMinor: f.baseMinor, currency } } : {}), ...(f.taxesMinor !== null ? { taxes: { amountMinor: f.taxesMinor, currency } } : {}) },
      baggage: f.baggage.map((b) => ({ segmentIndex: b.segmentIndex, passengerType: b.passengerType, checked: b.checked, cabin: b.cabin })),
      conditions: { change: known(f.conditions.change), refund: known(f.conditions.refund) },
      source: { ...base.source, fetchedAt: f.observedAt.toISOString() },
    }
    const first = segs[0]!
    const last = segs[segs.length - 1]!
    const connections = segs.slice(0, -1).map((a, i) => ({
      sliceIndex: 0, at: a.destination.iata, departAirport: segs[i + 1]!.origin.iata, layoverMin: minutes(a.arrival.utc, segs[i + 1]!.departure.utc), requiredMin: 0, inPreferredWindow: false,
      protected: true, overnight: false, flags: [] as never[], ruleId: "flight-builder-capture",
    }))
    return ItinerarySchema.parse({
      id: `itn_${stableHash(`${ID}:${r.identityKey}:${f.id}`)}`, construction: "THROUGH", ticketing: "SINGLE_TICKET", tabs: [], price: { total: offer.price.total, isSumOfTickets: false },
      durationMin: minutes(first.departure.utc, last.arrival.utc), components: [offer], connections,
      truth: [{ component: 1, provider: ID, rung: "MANUAL", fetchedAt: f.observedAt.toISOString(), fake: false }], baggage: offer.baggage, riskFlags: [],
      score: 0, explain: { price: 0, duration: 0, layoverFit: 0, risk: 0, stops: 0, timeOfDay: 0, preferredCarrierBonus: 0 },
      stops: segs.length - 1, firstDeparture: first.departure.utc, lastArrival: last.arrival.utc, carriers: [...new Set(segs.map((g) => g.marketing.carrier))], complianceReview: r.complianceReview,
    })
  }

  /** Staff quote builder: the chosen fare with its tri-state data copied as captured. UNKNOWN stays UNKNOWN and still blocks sending. */
  async quoteOption(fareId: string, priced: boolean) {
    const [fr] = await this.db.select({ resultId: flightResultFares.resultId }).from(flightResultFares).where(eq(flightResultFares.id, fareId))
    if (!fr) throw notFound("Fare")
    const { r, f } = await this.liveFare(fr.resultId, fareId)
    if (!r.offer || f.status === "RETIRED" || f.status === "EXPIRED") throw new AppError("OFFER_EXPIRED", "This fare is no longer available")
    const it = this.itineraryOf(r, f)
    const comp = it.components[0]!
    const slice = comp.slices[0]!
    // Without pricing.read.internal the supplier price stays out: the editor gets the tri-state data and types the price itself.
    const money = (n: number) => ({ amountMinor: priced ? n : 0, currency: f.currency })
    const base = f.baseMinor ?? f.totalMinor
    const taxes = f.baseMinor !== null && f.taxesMinor !== null ? f.taxesMinor : 0
    return {
      label: `${slice.origin} → ${slice.destination}`,
      source: "CATALOG" as const,
      slices: comp.slices,
      components: [{ provider: ID, offerId: r.identityKey, rung: "MANUAL", fetchedAt: f.observedAt.toISOString() }],
      priceBreakdown: { fare: money(base), taxes: money(taxes), serviceFee: money(0), total: money(f.totalMinor) },
      baggage: comp.baggage,
      conditions: comp.conditions,
      ticketingModel: "SINGLE_TICKET" as const,
      ...(priced ? { supplierPrice: money(f.totalMinor) } : {}),
      supplierFetchedAt: f.observedAt.toISOString(),
      // The deadline's timezone is UNKNOWN; its 00:00 UTC start errs early, so a quote never outlives the fare (ADR-0037 D10).
      ...(f.ticketingDeadline ? { supplierExpiresAt: `${f.ticketingDeadline}T00:00:00.000Z` } : {}),
    }
  }

  // ---------------- freshness sweep ----------------

  /** Marks LIVE fares STALE or EXPIRED, takes results with no LIVE fare out of the catalog and rebuilds the affected snapshots. Makes no provider call. */
  async sweepFreshness(now = new Date()): Promise<{ fares: number; results: number; slots: number }> {
    const s = await this.settings()
    const live = await this.db.select({ f: flightResultFares, slotId: flightResults.slotId }).from(flightResultFares).innerJoin(flightResults, eq(flightResults.id, flightResultFares.resultId))
      .where(and(eq(flightResultFares.status, "LIVE"), eq(flightResults.capture, "STAFF")))
    const next = new Map<string, "STALE" | "EXPIRED">()
    for (const { f } of live) {
      const fr = fareFreshness(f.observedAt, f.ticketingDeadline, now, s)
      if (fr === "STALE" || fr === "EXPIRED") next.set(f.id, fr)
    }
    const affected = new Set<string>()
    let results = 0
    if (next.size) {
      await this.uow.run(async (tx) => {
        for (const state of ["STALE", "EXPIRED"] as const) {
          const ids = [...next].filter(([, v]) => v === state).map(([k]) => k)
          if (ids.length) await tx.update(flightResultFares).set({ status: state, updatedAt: now }).where(inArray(flightResultFares.id, ids))
        }
      })
    }
    const orphans = await this.db.select({ id: flightResults.id, slotId: flightResults.slotId }).from(flightResults)
      .where(and(eq(flightResults.capture, "STAFF"), eq(flightResults.isCurrent, true), sql`not exists (select 1 from ${flightResultFares} f where f.result_id = ${flightResults.id} and f.status = 'LIVE')`))
    if (orphans.length) {
      await this.db.update(flightResults).set({ isCurrent: false, updatedAt: now }).where(inArray(flightResults.id, orphans.map((o) => o.id)))
      results = orphans.length
      for (const o of orphans) if (o.slotId) affected.add(o.slotId)
    }
    for (const { f, slotId } of live) if (next.has(f.id) && slotId) affected.add(slotId)
    for (const slotId of affected) await this.write.rebuildSnapshot(slotId, now)
    return { fares: next.size, results, slots: affected.size }
  }
}
