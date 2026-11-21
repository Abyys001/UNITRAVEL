import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"

import type { CargoTrackingSettingsBody, CargoTrackingSettingsView, CargoTrackingSyncResult } from "@unitravel/contracts"
import { cargoCarrierTracking, cargoRequests, type Db, partnerBookings, settings } from "@unitravel/db"
import type { CargoTrackingPort, IncomingTrackingEvent } from "@unitravel/domain"

import { env } from "../../core/env"
import { AppError } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { scrubMessage } from "../../core/safe-error"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import { CargoService } from "../cargo/cargo.service"
import { VendorCredentialsService } from "../notifications/vendor-credentials.service"
import { TimersService } from "../platform/timers.service"
import { TrackingMoreAdapter, TrackingMoreError } from "./trackingmore.adapter"

const SETTINGS_KEY = "cargo.tracking"
const VENDOR = "cargo-tracking:trackingmore"
/** Shipments the airline can still report on; the request has been booked and not yet closed. */
const POLLED_STATUSES = ["BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "EXCEPTION"] as const
const POLL_EVERY_MS = 30 * 60_000
/** TrackingMore bills per lookup (plan UNKNOWN): one poll run never reads more shipments than this. */
const POLL_BATCH = 40

interface StoredSettings { enabled: boolean; dpiaApproved: boolean; lastSyncAt: string | null; lastError: string | null }
const DEFAULT_SETTINGS: StoredSettings = { enabled: false, dpiaApproved: false, lastSyncAt: null, lastError: null }
export type CarrierState = CargoTrackingSyncResult["state"]

/** Settings, credentials and the sync of TrackingMore (ADR-0040 D5). Off until a key is saved; off on deployed hosts until the DPIA lists the processor. */
@Injectable()
export class CarrierTrackingService implements OnModuleInit {
  private readonly log = new Logger("CarrierTracking")

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly creds: VendorCredentialsService,
    private readonly cargo: CargoService,
    private readonly timers: TimersService,
    private readonly workers: WorkerRegistry,
    private readonly queues: Queues,
  ) {}

  async onModuleInit() {
    // Registered as soon as staff record the AWB; failures are kept on the shipment's state row, so the event is never retried blindly.
    this.timers.onEvent("cargo_request.transitioned", async (e) => {
      const p = e.payload as { requestId: string; command?: string }
      if (p.command !== "record_booking") return
      await this.sync(p.requestId).catch((err) => this.log.warn({ err: scrubMessage(String(err)) }, "AWB registration failed"))
    })
    this.workers.registerJob("maintenance", "cargo.carrier-sync", () => this.pollDue())
    await this.queues.get("maintenance").upsertJobScheduler("cargo-carrier-sync", { every: POLL_EVERY_MS }, { name: "cargo.carrier-sync" }).catch(() => undefined)
  }

  // ---------------- settings ----------------

  private async stored(): Promise<StoredSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY))
    return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<StoredSettings> | undefined) ?? {}) }
  }

  private async write(patch: Partial<StoredSettings>, actorId: string | null) {
    const next = { ...(await this.stored()), ...patch }
    await this.db.insert(settings).values({ key: SETTINGS_KEY, value: next, updatedBy: actorId }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: actorId, updatedAt: new Date() } })
  }

  /** Deployed hosts stay off until the DPIA lists TrackingMore as a processor and a developer records that here. */
  private blockedReason(s: StoredSettings): string | null {
    return env().APP_ENV !== "local" && !s.dpiaApproved ? "TrackingMore is not listed as a processor in the DPIA yet (ADR-0040 D5); it stays off on this host until that is recorded." : null
  }

  async view(): Promise<CargoTrackingSettingsView> {
    const s = await this.stored()
    return { provider: "TRACKINGMORE", enabled: s.enabled, keyConfigured: !!(await this.creds.get(VENDOR))?.apiKey, dpiaApproved: s.dpiaApproved, blockedReason: this.blockedReason(s), lastSyncAt: s.lastSyncAt, lastError: s.lastError }
  }

  async update(body: CargoTrackingSettingsBody, actor: Actor, requestId?: string): Promise<CargoTrackingSettingsView> {
    const before = await this.stored()
    const next: StoredSettings = { ...before, enabled: body.enabled, dpiaApproved: body.dpiaApproved ?? before.dpiaApproved }
    await this.uow.run(async (tx) => {
      if (body.apiKey) await this.creds.set(tx, VENDOR, { apiKey: body.apiKey }, actor.userId)
      await tx.insert(settings).values({ key: SETTINGS_KEY, value: next, updatedBy: actor.userId }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: actor.userId, updatedAt: new Date() } })
      // The key itself never reaches the audit log: only that it was rotated.
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_tracking.settings_changed", entityType: "cargo_tracking", entityId: "trackingmore", before: { enabled: before.enabled, dpiaApproved: before.dpiaApproved }, after: { enabled: next.enabled, dpiaApproved: next.dpiaApproved, keyRotated: !!body.apiKey }, ip: actor.ip, requestId })
    })
    return this.view()
  }

  /** The adapter when the integration may run now, else null. */
  async adapter(): Promise<TrackingMoreAdapter | null> {
    const s = await this.stored()
    if (!s.enabled || this.blockedReason(s)) return null
    const key = (await this.creds.get(VENDOR))?.apiKey
    return key ? new TrackingMoreAdapter(key) : null
  }

  // ---------------- per-shipment state ----------------

  /** What the customer is told about carrier tracking for one shipment. Nothing is syncing unless the integration may run, whatever an old row says. */
  async state(requestId: string, awbNumber: string | null): Promise<{ state: CarrierState; airline: string | null; lastSyncedAt: string | null }> {
    const [row] = await this.db.select().from(cargoCarrierTracking).where(eq(cargoCarrierTracking.cargoRequestId, requestId))
    const running = !!(await this.adapter())
    if (!awbNumber || !running) return { state: "NOT_CONFIGURED", airline: null, lastSyncedAt: null }
    if (!row || row.awbNumber !== awbNumber) return { state: "PENDING", airline: null, lastSyncedAt: null }
    return { state: row.state, airline: row.airline, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null }
  }

  // ---------------- sync ----------------

  private async latestAwb(requestId: string): Promise<string | null> {
    const [b] = await this.db.select({ awb: partnerBookings.awbNumber }).from(partnerBookings).where(eq(partnerBookings.cargoRequestId, requestId)).orderBy(desc(partnerBookings.bookedAt)).limit(1)
    return b?.awb ?? null
  }

  /** Looks the AWB up and stores new checkpoints through the common ingest path (dedupe by external id; staff corrections stay in force). */
  async sync(requestId: string): Promise<{ added: number; state: CarrierState; at: Date }> {
    const at = new Date()
    const adapter = await this.adapter()
    const awb = await this.latestAwb(requestId)
    if (!adapter || !awb) return { added: 0, state: "NOT_CONFIGURED", at }
    let events: IncomingTrackingEvent[] = []
    let error: string | null = null
    // The airline or number cannot be served, or the key is refused: shown as unavailable. A busy or unreachable provider keeps the last state.
    let terminal = false
    try {
      events = (await adapter.lookup(awb)).events
    } catch (err) {
      error = err instanceof TrackingMoreError ? err.message : "TrackingMore lookup failed"
      terminal = err instanceof TrackingMoreError && (err.failure === "AUTH" || err.failure === "INVALID_AWB" || err.failure === "AIRLINE_UNSUPPORTED")
    }
    const port: CargoTrackingPort = { source: "PARTNER_API", fetchEvents: async () => events }
    const result = await this.uow.run(async (tx) => {
      const [req] = await tx.select({ ref: cargoRequests.ref }).from(cargoRequests).where(eq(cargoRequests.id, requestId))
      const r = await this.cargo.byRef(req!.ref, tx, true)
      const added = events.length ? await this.cargo.ingest(tx, r, port, null) : 0
      const [prev] = await tx.select().from(cargoCarrierTracking).where(eq(cargoCarrierTracking.cargoRequestId, requestId))
      const same = prev?.awbNumber === awb ? prev : undefined
      const state: Exclude<CarrierState, "NOT_CONFIGURED"> = !error ? "ACTIVE" : terminal ? "UNAVAILABLE" : same?.state ?? "PENDING"
      const row = { awbNumber: awb, state, airline: adapter.airline ?? same?.airline ?? null, lastSyncedAt: error ? same?.lastSyncedAt ?? null : at, lastError: error }
      await tx.insert(cargoCarrierTracking).values({ cargoRequestId: requestId, ...row }).onConflictDoUpdate({ target: cargoCarrierTracking.cargoRequestId, set: { ...row, updatedAt: at } })
      return { added, state }
    })
    await this.write({ lastSyncAt: error ? undefined : at.toISOString(), lastError: error }, null)
    return { ...result, at }
  }

  /** Staff-triggered refresh of one shipment. */
  async syncByRef(ref: string): Promise<CargoTrackingSyncResult> {
    const r = await this.cargo.byRef(ref)
    if (!(await this.adapter())) throw new AppError("VALIDATION_FAILED", "Carrier tracking is not enabled on this host")
    if (!(await this.latestAwb(r.id))) throw new AppError("VALIDATION_FAILED", "Record the AWB number first")
    const res = await this.sync(r.id)
    return { shipmentRef: r.ref, added: res.added, state: res.state, at: res.at.toISOString() }
  }

  /** Poll job: booked shipments with a carrier row that is not unavailable, or none yet. Oldest sync first. */
  async pollDue(): Promise<{ polled: number; added: number } | "off"> {
    if (!(await this.adapter())) return "off"
    const due = await this.db.select({ id: cargoRequests.id }).from(cargoRequests)
      .innerJoin(partnerBookings, eq(partnerBookings.cargoRequestId, cargoRequests.id))
      .leftJoin(cargoCarrierTracking, eq(cargoCarrierTracking.cargoRequestId, cargoRequests.id))
      .where(and(inArray(cargoRequests.status, [...POLLED_STATUSES]), sql`${partnerBookings.awbNumber} is not null`, or(isNull(cargoCarrierTracking.cargoRequestId), inArray(cargoCarrierTracking.state, ["PENDING", "ACTIVE"]))))
      .groupBy(cargoRequests.id, cargoCarrierTracking.lastSyncedAt).orderBy(sql`${cargoCarrierTracking.lastSyncedAt} asc nulls first`).limit(POLL_BATCH)
    let added = 0
    for (const d of due) added += (await this.sync(d.id).catch(() => ({ added: 0 }))).added
    return { polled: due.length, added }
  }
}
