import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, inArray, isNull, lt, max, ne, sql } from "drizzle-orm"

import { type CargoCommand, CargoCustomerView, CargoQuoteLines, type CargoStatus, ShipmentSummary, ShipmentView, TRACKING_EVENT_CODES, TRACKING_EVENT_LABELS, type TrackingEventCode, type CreateCargoRequestBody, FlightRequestListItem, type GoodsCategory } from "@unitravel/contracts"
import {
  cargoItems, cargoLanes, cargoPieces, cargoRequests, contactAttempts, type Db, type DbOrTx, partnerBookings, partners, paymentRecords, quotes, requestMessages, requestNotes,
  requestStatusHistory, serviceAvailability, trackingEvents, type Tx, userIdentities, users,
} from "@unitravel/db"
import { CARGO_TRANSITIONS, type CargoCommandName, type CargoFacts, type CargoTrackingPort, cargoWeights, dedupeIncoming, effectiveRecordIds, effectiveTimeline, evaluate, lastEvent, ManualTrackingAdapter, type TrackingRecord, generateReference, type MachineActor, normaliseReference, validateAwb, allowedCommands, paymentRecordingState, trackingEventAllowed } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { neutralDeclineForUser } from "../compliance/customer-messages"
import { ConfigService } from "../config/config.service"
import { DocumentsService } from "../documents/documents.service"
import { DocumentNumbersService } from "../invoices/document-numbers.service"
import { renderQuotationPdf } from "../invoices/commercial-pdf"
import { cargoSections, customerZone, docLabels, formatValidity } from "../invoices/quotation-content"
import { renderPdf } from "../documents/pdf"
import { addBusinessMinutes } from "../platform/business-hours"
import { OutboxService } from "../platform/outbox.service"
import { TimersService } from "../platform/timers.service"
import { ReferenceService } from "../reference/reference.service"
import { staffActor, SYSTEM } from "../requests/requests.service"

type Cargo = typeof cargoRequests.$inferSelect
type Lane = typeof cargoLanes.$inferSelect
/** Shown under "Shipments": accepted onwards, i.e. there is something to follow. */
const SHIPMENT_STATUSES: CargoStatus[] = ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "EXCEPTION"]
const MOVING: CargoStatus[] = ["BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "EXCEPTION"]
const TERMINAL: CargoStatus[] = ["COMPLETED", "DECLINED", "CANCELLED"]
const touchesIran = (l: { originCountry: string; destinationCountry: string }) => l.originCountry === "IR" || l.destinationCountry === "IR"

/**
 * Cargo transport requests (ch. 14): request-and-quote through vetted partners, a structured goods declaration,
 * goods and party screening before any admin sees the request, lanes as configuration (Iran lanes start disabled),
 * partner handover with AWB validation, tracking events and re-weigh exceptions.
 */
@Injectable()
export class CargoService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly compliance: ComplianceService,
    private readonly access: AccessService,
    private readonly reference: ReferenceService,
    private readonly docs: DocumentsService,
    private readonly timers: TimersService,
    private readonly numbers: DocumentNumbersService,
  ) {}

  onModuleInit() {
    this.compliance.onScreenRequest("cargo_request.submitted", (id) => this.screen(id))
    this.compliance.onScreenRequest("partner.updated", (id) => this.screenPartner(id))
    this.compliance.onOutcome("CARGO", async (tx, id, o) => {
      const [r] = await tx.select().from(cargoRequests).where(eq(cargoRequests.id, id)).for("update")
      if (!r) return
      const officer: MachineActor = { kind: "STAFF", userId: o.actorUserId, permissions: new Set(["compliance.case.decide"]) }
      if (o.decision === "RELEASE" && r.status === "COMPLIANCE_HOLD") await this.transition(tx, r, "release_hold", officer, { facts: { decisionReason: o.reason }, reasonText: o.reason })
      if (o.decision === "DECLINE") {
        const msg = o.customerMessage || await neutralDeclineForUser(tx, r.customerUserId)
        await this.transition(tx, r, "decline", officer, { facts: { reasonCode: o.reasonCode ?? "COMPLIANCE", message: msg }, reasonCode: o.reasonCode ?? "COMPLIANCE", message: msg })
        await tx.insert(requestMessages).values({ requestType: "CARGO", requestId: r.id, authorId: o.actorUserId, direction: "TO_CUSTOMER", body: msg })
      }
    })
    this.timers.onEvent("cargo_request.transitioned", async (e) => {
      const p = e.payload as { requestId: string; to: string }
      if (p.to === "QUOTED") {
        const [q] = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, p.requestId), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
        if (q?.validUntil) await this.timers.schedule("cargo.quote_expiry", `cr:${p.requestId}`, q.validUntil, { requestId: p.requestId })
      }
    })
    this.timers.onReconcile(async () => {
      const open = await this.db.select({ id: cargoRequests.id }).from(cargoRequests).where(eq(cargoRequests.status, "QUOTED"))
      let added = 0
      for (const r of open) {
        const [q] = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
        if (q?.validUntil && await this.timers.ensure("cargo.quote_expiry", `cr:${r.id}`, q.validUntil, { requestId: r.id })) added++
      }
      return added
    })
    this.timers.onTimer("cargo.quote_expiry", (d) => this.uow.run(async (tx) => {
      const [r] = await tx.select().from(cargoRequests).where(eq(cargoRequests.id, String(d.requestId))).for("update")
      if (r?.status !== "QUOTED") return "skip"
      const [q] = await tx.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
      if (!q?.validUntil || q.validUntil > new Date()) return "skip"
      await tx.update(quotes).set({ status: "EXPIRED" }).where(eq(quotes.id, q.id))
      await this.transition(tx, r, "expire_quote", SYSTEM, { facts: { quote: { status: "SENT", validUntil: q.validUntil, linesComplete: true } } })
      return "expired"
    }))
  }

  label(status: CargoStatus, locale: "en" | "fa") {
    return this.config.get("WORKFLOW").statusLabels.cargo[status][locale]
  }

  laneLabel(l: Lane, locale: "en" | "fa" = "en") {
    return `${this.reference.countryName(l.originCountry, locale)} → ${this.reference.countryName(l.destinationCountry, locale)}`
  }

  // ---------------- lanes, partners, availability ----------------

  /** Customers see enabled lanes with their services and notice; the notice also reads from the availability register. */
  async publicLanes(locale: "en" | "fa") {
    const lanes = await this.db.select().from(cargoLanes).orderBy(cargoLanes.originCountry, cargoLanes.destinationCountry)
    const blocked = await this.laneBlocks()
    return lanes.map((l) => ({
      id: l.id, originCountry: l.originCountry, destinationCountry: l.destinationCountry, label: this.laneLabel(l, locale), enabled: l.enabled,
      services: l.services.filter((s) => !blocked.has(`${l.originCountry}:${s}`) && !blocked.has(`${l.destinationCountry}:${s}`)), volumetricDivisor: l.volumetricDivisor, notice: l.customerNotice?.[locale] ?? null,
    }))
  }

  private async laneBlocks() {
    const policies = await this.compliance.listPolicies()
    return new Set(policies.filter((p) => p.type === "LANE" && p.action === "BLOCK" && p.status === "ACTIVE").map((p) => p.key))
  }

  async lanes() {
    return this.db.select().from(cargoLanes).orderBy(cargoLanes.originCountry)
  }

  /**
   * Lane configuration (ch. 14.2). Enabling a lane that touches Iran requires a counsel reference and approval by both
   * an owner and a compliance officer; such lanes always keep requires_compliance_approval.
   */
  async updateLane(id: string, body: { enabled: boolean; services: string[]; requiresComplianceApproval: boolean; volumetricDivisor: number; customerNotice: { en: string; fa: string } | null; counselReference: string | null }, actor: Actor, roles: string[]) {
    return this.uow.run(async (tx) => {
      const [l] = await tx.select().from(cargoLanes).where(eq(cargoLanes.id, id)).for("update")
      if (!l) throw notFound("Lane")
      const iran = touchesIran(l)
      const patch: Partial<typeof cargoLanes.$inferInsert> = { services: body.services as never, volumetricDivisor: body.volumetricDivisor, customerNotice: body.customerNotice, counselReference: body.counselReference, requiresComplianceApproval: iran ? true : body.requiresComplianceApproval, version: l.version + 1 }
      if (body.enabled && !l.enabled && iran) {
        if (!body.counselReference) throw new AppError("VALIDATION_FAILED", "Enabling an Iran lane needs counsel's reference", [{ path: "counselReference", code: "REQUIRED" }])
        if (roles.includes("owner")) patch.enabledByOwner = actor.userId
        if (roles.includes("compliance_officer")) patch.enabledByCompliance = actor.userId
        const owner = patch.enabledByOwner ?? l.enabledByOwner
        const comp = patch.enabledByCompliance ?? l.enabledByCompliance
        patch.enabled = !!owner && !!comp && owner !== comp
      } else patch.enabled = body.enabled
      if (!body.enabled) { patch.enabledByOwner = null; patch.enabledByCompliance = null }
      await tx.update(cargoLanes).set(patch).where(eq(cargoLanes.id, id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo.lane_updated", entityType: "cargo_lane", entityId: id, before: { enabled: l.enabled, services: l.services }, after: { ...patch } })
      const [after] = await tx.select().from(cargoLanes).where(eq(cargoLanes.id, id))
      return { ...after!, pendingSecondApproval: !!body.enabled && iran && !after!.enabled }
    })
  }

  async partners() {
    return this.db.select().from(partners).orderBy(partners.name)
  }

  async upsertPartner(id: string | null, body: { name: string; type: string; laneIds: string[]; services: string[]; integrationLevel: string; contacts: { name: string }[]; slaNote?: string; cutOffNote?: string; active: boolean }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const values = { ...body, type: body.type as "COURIER", services: body.services as never, integrationLevel: body.integrationLevel as "MANUAL", complianceStatus: "PENDING" as const }
      const [p] = id ? await tx.update(partners).set(values).where(eq(partners.id, id)).returning() : await tx.insert(partners).values(values).returning()
      if (!p) throw notFound("Partner")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: id ? "partner.updated" : "partner.created", entityType: "partner", entityId: p.id, after: { name: body.name } })
      // Partners are screened like customers at onboarding and on every list update (ch. 14.8).
      await this.outbox.add(tx, { aggregateType: "partner", aggregateId: p.id, eventType: "partner.updated", payload: { requestId: p.id } })
      return p
    })
  }

  async screenPartner(id: string) {
    const [p] = await this.db.select().from(partners).where(eq(partners.id, id))
    if (!p) return
    const s = await this.compliance.screen(this.db, { subjectType: "PARTNER", subjectRef: p.id, name: p.name, entity: true })
    await this.db.update(partners).set({ complianceStatus: s.result === "CLEAR" ? "CLEARED" : s.result === "MATCH" ? "BLOCKED" : "HOLD", lastScreenedAt: new Date() }).where(eq(partners.id, id))
  }

  async availability() {
    const rows = await this.db.select().from(serviceAvailability).orderBy(desc(serviceAvailability.lastCheckedAt))
    const stale = this.config.get("WORKFLOW").cargo.availabilityStaleDays * 86400_000
    const names = new Map<string, string>()
    for (const id of new Set(rows.map((r) => r.checkedBy))) names.set(id, (await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, id)))[0]?.n ?? id)
    // Entries older than 30 days are flagged for re-checking (ch. 14.7).
    return rows.map((r) => ({ ...r, lastCheckedAt: r.lastCheckedAt.toISOString(), checkedBy: names.get(r.checkedBy) ?? r.checkedBy, stale: Date.now() - r.lastCheckedAt.getTime() > stale }))
  }

  async upsertAvailability(id: string | null, body: { providerName: string; lane: string; service: string; status: string; sourceUrl: string; note?: string }, actor: Actor) {
    const values = { ...body, service: body.service as "PARCEL", status: body.status as "AVAILABLE", checkedBy: actor.userId, lastCheckedAt: new Date() }
    const [row] = id ? await this.db.update(serviceAvailability).set(values).where(eq(serviceAvailability.id, id)).returning() : await this.db.insert(serviceAvailability).values(values).returning()
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo.availability_checked", entityType: "service_availability", entityId: row!.id, after: body }))
    return row
  }

  // ---------------- requests ----------------

  async create(body: CreateCargoRequestBody, actor: Actor, ctx: { requestId: string; locale: "en" | "fa" }) {
    if (!this.config.flag("cargo.enabled")) throw new AppError("FEATURE_DISABLED", "Cargo requests are not available")
    const [lane] = await this.db.select().from(cargoLanes).where(eq(cargoLanes.id, body.laneId))
    if (!lane || !lane.enabled) throw new AppError("LANE_DISABLED", "This lane is not available")
    const blocks = await this.laneBlocks()
    if (!lane.services.includes(body.service) || blocks.has(`${lane.originCountry}:${body.service}`) || blocks.has(`${lane.destinationCountry}:${body.service}`)) throw new AppError("LANE_DISABLED", "This service is not offered on the lane", [{ path: "service", code: "NOT_OFFERED" }])
    // The shipper's phone must be the verified account phone or another verified number (ch. 14.3).
    const [phone] = await this.db.select().from(userIdentities).where(and(eq(userIdentities.id, body.shipperIdentityId), eq(userIdentities.userId, actor.userId), isNull(userIdentities.revokedAt)))
    if (!phone?.verifiedAt) throw new AppError("PHONE_NOT_VERIFIED", "The shipper's phone must be a verified number on your account")
    const currency = body.declaredTotal.currency
    return this.uow.run(async (tx) => {
      let ref = generateReference("C")
      for (let i = 0; i < 5 && (await tx.select({ id: cargoRequests.id }).from(cargoRequests).where(eq(cargoRequests.ref, ref))).length; i++) ref = generateReference("C")
      const wf = this.config.get("WORKFLOW")
      const [r] = await tx.insert(cargoRequests).values({
        ref, customerUserId: actor.userId, service: body.service, laneId: lane.id, status: "SUBMITTED", shipperIdentityId: phone.id, shipper: { ...body.shipper, phone: phone.valueNormalised }, consignee: body.consignee,
        purpose: body.items[0]?.purpose, declaredValueMinor: body.declaredTotal.amountMinor, currency, insuranceRequested: body.declarations.insuranceRequested, readyDate: body.readyDate,
        handoverMode: body.handoverMode, dgDeclared: body.declarations.dangerousGoods, declarations: body.declarations, commercial: body.commercial ?? null, customerNote: body.note ?? null,
        slaDueAt: addBusinessMinutes(wf.businessHours, new Date(), wf.sla.unassignedMinutes),
      }).returning()
      await tx.insert(cargoPieces).values(body.pieces.map((p) => ({ cargoRequestId: r!.id, ...p })))
      await tx.insert(cargoItems).values(body.items.map((i) => ({ cargoRequestId: r!.id, description: i.description, category: i.category, quantity: i.quantity, unitValueMinor: i.unitValue.amountMinor, currency: i.unitValue.currency, hsCode: i.hsCode ?? null, originCountry: i.originCountry, purpose: i.purpose })))
      await this.docs.attach(tx, body.documentIds, "CARGO", r!.id, actor.userId)
      await tx.insert(requestStatusHistory).values({ requestType: "CARGO", requestId: r!.id, fromStatus: null, toStatus: "SUBMITTED", command: "submit", actorUserId: actor.userId, actorKind: "CUSTOMER" })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "cargo_request.submitted", entityType: "cargo_request", entityId: r!.id, contextRef: ref, after: { service: body.service, lane: this.laneLabel(lane), items: body.items.length, pieces: body.pieces.length } })
      await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r!.id, eventType: "cargo_request.submitted", payload: { requestId: r!.id, ref, customerUserId: actor.userId, routeLabel: this.laneLabel(lane, ctx.locale), urgent: false } })
      return { ref, status: "SUBMITTED" as const, weights: cargoWeights(body.pieces, lane.volumetricDivisor) }
    })
  }

  /** Goods + party + lane screening before an admin sees the request (ch. 14.4). */
  async screen(requestId: string) {
    const [r] = await this.db.select().from(cargoRequests).where(eq(cargoRequests.id, requestId))
    if (!r || r.status !== "SUBMITTED") return
    const [lane] = await this.db.select().from(cargoLanes).where(eq(cargoLanes.id, r.laneId))
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    const wf = this.config.get("WORKFLOW")
    const outcomes = await this.compliance.screenGoods(items.map((i) => ({ description: i.description, category: i.category as GoodsCategory, hsCode: i.hsCode, unitValueMinor: i.unitValueMinor, quantity: i.quantity })), wf.cargo.highValueThresholdMinor)
    const shipper = r.shipper as { name: string; company?: string }
    const consignee = r.consignee as { name: string; company?: string }
    return this.uow.run(async (tx) => {
      for (let i = 0; i < items.length; i++) await tx.update(cargoItems).set({ screeningOutcome: outcomes[i]!.outcome, matchedRule: outcomes[i]!.matchedRule }).where(eq(cargoItems.id, items[i]!.id))
      const evidence: { kind: string; label: string; detail: string; score?: number }[] = []
      const screeningIds: string[] = []
      // A strong party MATCH is released only with a second approver (ch. 15.7, risk R-01; ADR-0008 W3).
      let requiresFourEyes = false
      for (const [type, party] of [["SHIPPER", shipper], ["CONSIGNEE", consignee]] as const) {
        for (const [name, entity] of [[party.name, false], ...(party.company ? [[party.company, true]] : [])] as [string, boolean][]) {
          const s = await this.compliance.screen(tx, { subjectType: type, subjectRef: `${r.id}:${type}:${name}`, name, contextRef: r.ref, entity })
          if (s.result === "MATCH") requiresFourEyes = true
          if (s.result !== "CLEAR") { screeningIds.push(s.screeningId); for (const h of s.hits) evidence.push({ kind: "PARTY_MATCH", label: `${type.toLowerCase()} ${name} ↔ ${h.matchedName}`, detail: `${h.listId} ${h.externalId}`, score: h.score }) }
        }
      }
      const prohibited = outcomes.some((o) => o.outcome === "PROHIBITED")
      if (prohibited || r.dgDeclared) {
        // Prohibited hits decline with a neutral message (ch. 14.4); dangerous goods are prohibited in v1.
        const msg = await neutralDeclineForUser(tx, r.customerUserId)
        await this.transition(tx, r, "screen_prohibited", SYSTEM, { reasonCode: "PROHIBITED_GOODS", reasonText: outcomes.map((o) => o.matchedRule).filter(Boolean).join("; ") || "dangerous goods declared", message: msg })
        await tx.insert(requestMessages).values({ requestType: "CARGO", requestId: r.id, authorId: null, direction: "TO_CUSTOMER", body: msg })
        return
      }
      outcomes.forEach((o, i) => { if (o.outcome === "REVIEW") evidence.push({ kind: "GOODS_RULE", label: items[i]!.description, detail: o.matchedRule ?? "review" }) })
      const lanePolicies = lane ? await this.compliance.lanePolicy(lane.originCountry, lane.destinationCountry) : []
      if (lane?.requiresComplianceApproval || lanePolicies.some((p) => p.action === "REVIEW")) evidence.push({ kind: "LANE", label: `Lane ${this.laneLabel(lane!)}`, detail: "Lane requires a compliance decision before quoting" })
      if (evidence.length) {
        await this.compliance.openCase(tx, { requestType: "CARGO", requestId: r.id, requestRef: r.ref, trigger: screeningIds.length ? "SCREENING" : evidence.some((e) => e.kind === "LANE") ? "LANE" : "GOODS", summary: `${evidence.length} item(s) need a compliance decision`, evidence, screeningIds, requiresFourEyes })
        await this.transition(tx, r, "screen_flag", SYSTEM)
      } else await this.transition(tx, r, "screen_pass", SYSTEM)
    })
  }

  async byRef(ref: string, tx: DbOrTx = this.db, lock = false): Promise<Cargo> {
    const norm = normaliseReference(ref)
    if (!norm?.startsWith("UT-C-")) throw notFound("Request")
    const q = tx.select().from(cargoRequests).where(eq(cargoRequests.ref, norm))
    const [r] = lock ? await q.for("update") : await q
    if (!r) throw notFound("Request")
    return r
  }

  async owned(ref: string, userId: string, tx: DbOrTx = this.db, lock = false) {
    const r = await this.byRef(ref, tx, lock)
    if (r.customerUserId !== userId) throw notFound("Request")
    return r
  }

  private async weights(r: Cargo, tx: DbOrTx = this.db) {
    const [lane] = await tx.select().from(cargoLanes).where(eq(cargoLanes.id, r.laneId))
    const pieces = await tx.select().from(cargoPieces).where(eq(cargoPieces.cargoRequestId, r.id))
    return { lane: lane!, pieces, weights: cargoWeights(pieces, lane!.volumetricDivisor) }
  }

  private async facts(tx: DbOrTx, r: Cargo, extra: Partial<CargoFacts> & { quoteId?: string } = {}): Promise<CargoFacts> {
    const [q] = extra.quoteId ? await tx.select().from(quotes).where(and(eq(quotes.id, extra.quoteId), eq(quotes.requestId, r.id))) : await tx.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id))).orderBy(desc(quotes.version)).limit(1)
    if (extra.quoteId && !q) throw notFound("Quote")
    return {
      status: r.status, now: new Date(), quote: q ? { status: q.status, validUntil: q.validUntil, linesComplete: !!q.cargoLines && !!q.cargoPartnerId } : undefined,
      exceptionReason: r.exceptionReason ?? undefined, exceptionResumeTo: (r.exceptionResumeTo as CargoStatus | null) ?? undefined, reweighTolerancePct: this.config.get("WORKFLOW").cargo.reweighTolerancePct, ...extra,
    }
  }

  async transition(tx: Tx, r: Cargo, command: CargoCommandName, actor: MachineActor, opts: { facts?: Partial<CargoFacts> & { quoteId?: string }; expectedVersion?: number; reasonCode?: string; reasonText?: string; message?: string; patch?: Partial<typeof cargoRequests.$inferInsert> } = {}) {
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== r.version) throw new AppError("VERSION_CONFLICT", "Request changed; reload")
    const ev = evaluate(CARGO_TRANSITIONS, command, await this.facts(tx, r, opts.facts), actor)
    if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
    const [u] = await tx.update(cargoRequests).set({ status: ev.to, version: r.version + 1, closedAt: TERMINAL.includes(ev.to) ? new Date() : r.closedAt, ...opts.patch }).where(and(eq(cargoRequests.id, r.id), eq(cargoRequests.version, r.version))).returning()
    if (!u) throw new AppError("VERSION_CONFLICT", "Request changed; reload")
    await tx.insert(requestStatusHistory).values({ requestType: "CARGO", requestId: r.id, fromStatus: ev.from, toStatus: ev.to, command, actorUserId: actor.userId ?? null, actorKind: actor.kind, reasonCode: opts.reasonCode, reasonText: opts.reasonText })
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.kind, action: `cargo_request.${command}`, entityType: "cargo_request", entityId: r.id, contextRef: r.ref, before: { status: ev.from }, after: { status: ev.to, reasonCode: opts.reasonCode } })
    await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo_request.transitioned", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: u.assigneeUserId, from: ev.from, to: ev.to, command, actorUserId: actor.userId ?? null, statusLabels: { en: this.label(ev.to, "en"), fa: this.label(ev.to, "fa") }, message: opts.message } })
    return u
  }

  /** Staff entry goes through the same ingest path a partner feed will use. */
  private async tracking(tx: Tx, r: Cargo, code: string, location: string, occurredAt: Date, description: string | undefined, actorId: string) {
    await this.ingest(tx, r, new ManualTrackingAdapter([{ eventCode: code, location, occurredAt: occurredAt.toISOString(), description }]), actorId)
  }

  /**
   * Stores what a tracking source reports. Idempotent: an event whose (source, externalEventId) is already stored is
   * skipped, so a replayed partner payload changes nothing. Returns how many rows were new.
   */
  async ingest(tx: Tx, r: Cargo, port: CargoTrackingPort, actorId: string | null): Promise<number> {
    const [booking] = await tx.select({ awb: partnerBookings.awbNumber }).from(partnerBookings).where(eq(partnerBookings.cargoRequestId, r.id)).orderBy(desc(partnerBookings.bookedAt)).limit(1)
    const incoming = await port.fetchEvents({ ref: r.ref, awbNumber: booking?.awb ?? null })
    const stored = await tx.select({ x: trackingEvents.externalEventId }).from(trackingEvents).where(and(eq(trackingEvents.source, port.source), eq(trackingEvents.cargoRequestId, r.id)))
    const fresh = dedupeIncoming(incoming, new Set(stored.flatMap((s) => (s.x ? [s.x] : []))))
    if (!fresh.length) return 0
    const rows = await tx.insert(trackingEvents).values(fresh.map((e) => ({ cargoRequestId: r.id, eventCode: e.eventCode, location: e.location, occurredAt: new Date(e.occurredAt), description: e.description, source: port.source, externalEventId: e.externalEventId, createdBy: actorId }))).onConflictDoNothing().returning({ id: trackingEvents.id })
    return rows.length
  }

  /** Only a quote created after the exception and accepted by the customer counts as the revised quote. */
  private async revisedQuoteAccepted(tx: DbOrTx, r: Cargo): Promise<boolean> {
    const [ex] = await tx.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, "CARGO"), eq(requestStatusHistory.requestId, r.id), eq(requestStatusHistory.toStatus, "EXCEPTION"))).orderBy(desc(requestStatusHistory.createdAt)).limit(1)
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id))).orderBy(desc(quotes.version)).limit(1)
    return !!q && q.status === "ACCEPTED" && !!ex && q.createdAt > ex.createdAt
  }

  async staffCommand(ref: string, command: CargoCommand, body: Record<string, unknown>, actor: Actor, expectedVersion?: number) {
    const m = staffActor(actor)
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx, true)
      const o = { expectedVersion }
      switch (command) {
        case "claim": return this.transition(tx, r, "claim", m, { ...o, patch: { assigneeUserId: actor.userId } })
        case "assign": {
          const acc = await this.access.load(String(body.assigneeUserId), tx)
          return this.transition(tx, r, "assign", m, { ...o, facts: { assigneeCanTransition: acc.permissions.includes("cargo_request.transition") }, patch: { assigneeUserId: String(body.assigneeUserId) } })
        }
        case "request_info": {
          const updated = await this.transition(tx, r, "request_info", m, { ...o, facts: { message: String(body.message) }, message: String(body.message) })
          await tx.insert(requestMessages).values({ requestType: "CARGO", requestId: r.id, authorId: actor.userId, direction: "TO_CUSTOMER", body: String(body.message) })
          return updated
        }
        case "send_quote": {
          const quoteId = String(body.quoteId)
          // The quote must be a draft of this very request: an id from another request would send that customer's
          // prices to this customer (and flip the other request's quote to SENT).
          const [own] = await tx.select({ status: quotes.status }).from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id)))
          if (!own) throw new AppError("NOT_FOUND", "Quote not found on this request")
          if (r.status === "EXCEPTION") {
            if (!actor.permissions.has("cargo_request.transition")) throw new AppError("FORBIDDEN", "Requires cargo_request.transition")
            if (expectedVersion !== undefined && expectedVersion !== r.version) throw new AppError("VERSION_CONFLICT", `Request changed (version ${r.version}); reload`)
            if (own.status !== "DRAFT") throw new AppError("INVALID_TRANSITION", "Only a draft can be sent")
            // Revised quote after a re-weigh: the shipment stays in EXCEPTION until the customer accepts (ch. 14.5).
            if (r.exceptionReason !== "REWEIGH") throw new AppError("INVALID_TRANSITION", "Revised quotes are for re-weigh exceptions")
            await tx.update(quotes).set({ status: "SUPERSEDED" }).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id), ne(quotes.id, quoteId), inArray(quotes.status, ["SENT", "ACCEPTED"])))
            await tx.update(quotes).set({ status: "SENT", sentAt: new Date() }).where(eq(quotes.id, quoteId))
            const documentNumber = await this.numbers.assignQuotation(tx, quoteId)
            await this.quotationPdf(tx, r, quoteId, actor)
            await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "quote.sent", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, quoteId, documentNumber } })
            return r
          }
          const updated = await this.transition(tx, r, "send_quote", m, { ...o, facts: { quoteId } })
          await tx.update(quotes).set({ status: "SUPERSEDED" }).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id), ne(quotes.id, quoteId), inArray(quotes.status, ["SENT", "DRAFT"])))
          await tx.update(quotes).set({ status: "SENT", sentAt: new Date() }).where(eq(quotes.id, quoteId))
          const [q] = await tx.select().from(quotes).where(eq(quotes.id, quoteId))
          const documentNumber = await this.numbers.assignQuotation(tx, quoteId)
          await this.quotationPdf(tx, r, quoteId, actor)
          await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "quote.sent", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, quoteId, validUntil: q?.validUntil?.toISOString(), documentNumber } })
          return updated
        }
        case "record_acceptance": {
          const quoteId = String(body.quoteId)
          const updated = await this.transition(tx, r, "record_acceptance", m, { ...o, facts: { quoteId, acceptanceNote: String(body.note) } })
          await tx.update(quotes).set({ status: "ACCEPTED", acceptedAt: new Date(), acceptedVia: "STAFF_RECORDED", acceptanceNote: `${body.calledAt}: ${body.note}` }).where(eq(quotes.id, quoteId))
          return updated
        }
        case "record_booking": {
          const [p] = await tx.select().from(partners).where(eq(partners.id, String(body.partnerId)))
          if (!p) throw notFound("Partner")
          const servesLaneAndService = p.active && p.laneIds.includes(r.laneId) && p.services.includes(r.service)
          const awb = body.awbNumber ? String(body.awbNumber) : undefined
          const updated = await this.transition(tx, r, "record_booking", m, { ...o, facts: { partner: { servesLaneAndService, complianceCleared: p.complianceStatus === "CLEARED" }, awbNumber: awb } })
          const norm = awb ? (validateAwb(awb) as { normalised: string }).normalised : null
          await tx.insert(partnerBookings).values({ cargoRequestId: r.id, partnerId: p.id, partnerReference: String(body.partnerReference), awbNumber: norm, recordedBy: actor.userId })
          return updated
        }
        case "schedule_handover": {
          const updated = await this.transition(tx, r, "schedule_handover", m, { ...o })
          await this.tracking(tx, r, "NOTE", r.handoverMode === "PICKUP" ? "Pickup scheduled" : "Awaiting drop-off", body.at ? new Date(String(body.at)) : new Date(), String(body.note), actor.userId)
          return updated
        }
        case "receive": {
          const { pieces, weights } = await this.weights(r, tx)
          const verified = body.verifiedWeights as { pieceId: string; weightKg: number }[]
          for (const v of verified) if (!pieces.some((p) => p.id === v.pieceId)) throw new AppError("VALIDATION_FAILED", "Unknown piece")
          const reweighed = cargoWeights(pieces.map((p) => ({ ...p, verifiedWeightKg: verified.find((v) => v.pieceId === p.id)?.weightKg ?? p.weightKg })), weights.divisor)
          const changePct = ((reweighed.chargeableKg - weights.chargeableKg) / weights.chargeableKg) * 100
          for (const v of verified) await tx.update(cargoPieces).set({ verifiedWeightKg: v.weightKg }).where(eq(cargoPieces.id, v.pieceId))
          const exception = Math.abs(changePct) > this.config.get("WORKFLOW").cargo.reweighTolerancePct
          const updated = await this.transition(tx, r, "receive", m, { ...o, facts: { reweighChangePct: changePct }, patch: exception ? { exceptionReason: "REWEIGH", exceptionResumeTo: "RECEIVED" } : {}, reasonCode: exception ? "REWEIGH" : undefined, reasonText: `chargeable ${weights.chargeableKg} → ${reweighed.chargeableKg} kg (${changePct.toFixed(1)}%)` })
          await this.tracking(tx, r, "RECEIVED", String(body.location), new Date(), exception ? `Re-weighed: ${reweighed.chargeableKg} kg chargeable` : undefined, actor.userId)
          return updated
        }
        case "depart": case "arrive_customs": case "clear_customs": case "out_for_delivery": {
          const codes = { depart: "DEPARTED", arrive_customs: "AT_CUSTOMS", clear_customs: "CLEARED", out_for_delivery: "OUT_FOR_DELIVERY" } as const
          const updated = await this.transition(tx, r, command, m, { ...o })
          await this.tracking(tx, r, codes[command], String(body.location), new Date(String(body.occurredAt)), undefined, actor.userId)
          return updated
        }
        case "deliver": {
          const updated = await this.transition(tx, r, "deliver", m, { ...o, facts: { podName: String(body.podName) } })
          await this.tracking(tx, r, "DELIVERED", String(body.location), new Date(String(body.occurredAt)), `Proof of delivery: ${body.podName}`, actor.userId)
          return updated
        }
        case "raise_exception": {
          const updated = await this.transition(tx, r, "raise_exception", m, { ...o, facts: { exceptionReason: String(body.reason) }, patch: { exceptionReason: String(body.reason), exceptionResumeTo: r.status }, reasonCode: String(body.reason), reasonText: String(body.note) })
          await this.tracking(tx, r, "HELD", "—", new Date(), String(body.note), actor.userId)
          return updated
        }
        case "resolve_exception": {
          return this.transition(tx, r, "resolve_exception", m, { ...o, facts: { revisedQuoteAccepted: await this.revisedQuoteAccepted(tx, r) }, patch: { exceptionReason: null, exceptionResumeTo: null }, reasonText: String(body.note) })
        }
        case "close": case "reopen":
          return this.transition(tx, r, command, m, { ...o })
        case "cancel": case "decline": {
          const updated = await this.transition(tx, r, command, m, { ...o, facts: { reasonCode: String(body.reasonCode), message: String(body.message) }, reasonCode: String(body.reasonCode), message: String(body.message) })
          await tx.insert(requestMessages).values({ requestType: "CARGO", requestId: r.id, authorId: actor.userId, direction: "TO_CUSTOMER", body: String(body.message) })
          return updated
        }
      }
    })
  }

  /** Cargo quote lines (ch. 14.6): partner cost and margin stay internal; validity default from configuration. */
  async draftQuote(ref: string, body: { validUntil?: string; partnerId: string; lines: Record<string, unknown> & { total: { amountMinor: number; currency: string } }; transitNote?: string; partnerCostMinor?: number }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx, true)
      if (!["IN_REVIEW", "QUOTED", "EXCEPTION"].includes(r.status)) throw new AppError("INVALID_TRANSITION", `Quotes cannot be drafted while ${r.status}`)
      const [p] = await tx.select().from(partners).where(eq(partners.id, body.partnerId))
      if (!p || !p.laneIds.includes(r.laneId) || !p.services.includes(r.service)) throw new AppError("VALIDATION_FAILED", "Partner does not serve this lane and service", [{ path: "partnerId", code: "NOT_SERVING" }])
      if (p.complianceStatus !== "CLEARED") throw new AppError("VALIDATION_FAILED", "Partner is not compliance-cleared", [{ path: "partnerId", code: "NOT_CLEARED" }])
      const [{ v } = { v: 0 }] = await tx.select({ v: max(quotes.version) }).from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id)))
      const validUntil = body.validUntil ? new Date(body.validUntil) : new Date(Date.now() + this.config.get("WORKFLOW").quoteDefaultValidityHours * 3600_000)
      const [q] = await tx.insert(quotes).values({ requestType: "CARGO", requestId: r.id, version: (v ?? 0) + 1, status: "DRAFT", currency: body.lines.total.currency, validUntil, cargoLines: body.lines, cargoPartnerId: p.id, transitNote: body.transitNote ?? null, partnerCostMinor: body.partnerCostMinor ?? null, createdBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo.quote_drafted", entityType: "quote", entityId: q!.id, contextRef: r.ref })
      return q
    })
  }

  async customerAccept(ref: string, quoteId: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.owned(ref, actor.userId, tx, true)
      const c: MachineActor = { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }
      const updated = await this.transition(tx, r, r.status === "EXCEPTION" ? "accept_revised_quote" : "accept_quote", c, { facts: { quoteId }, patch: r.status === "EXCEPTION" ? { exceptionReason: null, exceptionResumeTo: null } : {} })
      await tx.update(quotes).set({ status: "ACCEPTED", acceptedAt: new Date(), acceptedVia: "APP" }).where(eq(quotes.id, quoteId))
      return updated
    })
  }

  async customerCancel(ref: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.owned(ref, actor.userId, tx, true)
      return this.transition(tx, r, "cancel_by_customer", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { reasonCode: "CUSTOMER_REQUEST" })
    })
  }

  async customerMessage(ref: string, actor: Actor, body: string, documentIds: string[]) {
    return this.uow.run(async (tx) => {
      const r = await this.owned(ref, actor.userId, tx, true)
      await this.docs.attach(tx, documentIds, "CARGO", r.id, actor.userId)
      await tx.insert(requestMessages).values({ requestType: "CARGO", requestId: r.id, authorId: actor.userId, direction: "FROM_CUSTOMER", body, documentIds })
      await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo_request.message", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, direction: "FROM_CUSTOMER", message: body } })
      if (r.status === "AWAITING_CUSTOMER") await this.transition(tx, r, "respond", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { facts: { responseProvided: true } })
      return { ok: true }
    })
  }

  async staffMessage(ref: string, actor: Actor, body: string, documentIds: string[]) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx)
      for (const d of documentIds) await this.docs.publish(tx, d, { requestType: "CARGO", requestId: r.id, customerUserId: r.customerUserId, staffUserId: actor.userId })
      await tx.insert(requestMessages).values({ requestType: "CARGO", requestId: r.id, authorId: actor.userId, direction: "TO_CUSTOMER", body, documentIds })
      await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo_request.message", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, direction: "TO_CUSTOMER", message: body } })
      return { ok: true }
    })
  }

  async note(ref: string, actor: Actor, body: string) {
    const r = await this.byRef(ref)
    const [n] = await this.db.insert(requestNotes).values({ requestType: "CARGO", requestId: r.id, authorId: actor.userId, body }).returning()
    return n
  }

  async trackingEvent(ref: string, body: { eventCode: string; location: string; occurredAt: string; description?: string }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx)
      if (TERMINAL.includes(r.status)) throw new AppError("INVALID_TRANSITION", "Request is closed")
      this.assertTrackingFits(r, body.eventCode)
      await this.tracking(tx, r, body.eventCode, body.location, new Date(body.occurredAt), body.description, actor.userId)
      await this.outbox.add(tx, { aggregateType: "cargo_request", aggregateId: r.id, eventType: "cargo_request.transitioned", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, from: r.status, to: r.status, command: "tracking", statusLabels: { en: `${TRACKING_EVENT_LABELS[body.eventCode as TrackingEventCode].en} · ${body.location}`, fa: `${TRACKING_EVENT_LABELS[body.eventCode as TrackingEventCode].fa} · ${body.location}` } } })
      return { ok: true }
    })
  }

  /** Staff cannot record progress the request has not made (ADR-0008 W4). In EXCEPTION the shipment resumes from `exceptionResumeTo`. */
  private assertTrackingFits(r: Cargo, code: string) {
    if (!(TRACKING_EVENT_CODES as readonly string[]).includes(code)) return
    const stage = r.status === "EXCEPTION" ? ((r.exceptionResumeTo as CargoStatus | null) ?? "RECEIVED") : r.status
    const why = trackingEventAllowed(code as TrackingEventCode, stage)
    if (why) throw new AppError("INVALID_TRANSITION", why)
  }

  /** A correction is a new row pointing at the event it replaces; the original stays and staff see both (ch. 14.5, 14.8, 25.6, 32.2). */
  async correctTracking(ref: string, body: { correctsEventId: string; eventCode: string; location: string; occurredAt: string; description?: string; reason: string }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx, true)
      const [target] = await tx.select().from(trackingEvents).where(and(eq(trackingEvents.id, body.correctsEventId), eq(trackingEvents.cargoRequestId, r.id)))
      if (!target) throw notFound("Tracking event")
      const [row] = await tx.insert(trackingEvents).values({ cargoRequestId: r.id, eventCode: body.eventCode, location: body.location, occurredAt: new Date(body.occurredAt), description: body.description, source: "STAFF", correctsEventId: target.id, correctionReason: body.reason, createdBy: actor.userId }).returning({ id: trackingEvents.id })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.tracking_corrected", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, before: { eventId: target.id, eventCode: target.eventCode, location: target.location, occurredAt: target.occurredAt.toISOString() }, after: { correctionId: row!.id, eventCode: body.eventCode, location: body.location, occurredAt: body.occurredAt, reason: body.reason } })
      return { ok: true, id: row!.id }
    })
  }

  async setEstimatedDelivery(ref: string, estimatedDeliveryAt: string | null, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx, true)
      if (TERMINAL.includes(r.status)) throw new AppError("INVALID_TRANSITION", "Request is closed")
      await tx.update(cargoRequests).set({ estimatedDeliveryAt: estimatedDeliveryAt ? new Date(estimatedDeliveryAt) : null }).where(eq(cargoRequests.id, r.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.eta_set", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, before: { estimatedDeliveryAt: r.estimatedDeliveryAt?.toISOString() ?? null }, after: { estimatedDeliveryAt } })
      return { ok: true }
    })
  }

  /** The cargo quotation PDF: the sent quote's lines, pieces and weights with the document number (ADR-0006 C1), in the customer's language and zone. */
  private async quotationPdf(tx: Tx, r: typeof cargoRequests.$inferSelect, quoteId: string, actor: Actor) {
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id)))
    if (!q?.documentNumber) return
    const [lane] = await tx.select().from(cargoLanes).where(eq(cargoLanes.id, r.laneId))
    const c = CargoQuoteLines.parse(q.cargoLines)
    const zone = await customerZone(tx, r.customerUserId)
    const L = docLabels(zone.locale)
    const { pieces, weights } = await this.weights(r, tx)
    const cfg = this.config.settings()
    const pdf = await renderQuotationPdf({
      number: q.documentNumber, title: `${L.cargoTitle} - ${r.ref}`, subtitle: `${lane ? this.laneLabel(lane, zone.locale) : ""} · ${L.validUntil} ${q.validUntil ? formatValidity(q.validUntil, zone) : "-"}`,
      sections: cargoSections({ currency: q.currency, lines: c, pieces, weights, transitNote: q.transitNote }, zone), company: cfg.company, cfg: cfg.commercialDocuments, locale: zone.locale,
      footer: [L.cargoFooter],
    })
    const doc = await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "CARGO", requestId: r.id, type: "QUOTE_PDF", filename: `quotation-${q.documentNumber}.pdf`, body: pdf, createdBy: actor.userId, visibility: "CUSTOMER" })
    await tx.update(quotes).set({ pdfDocumentId: doc.id }).where(eq(quotes.id, quoteId))
  }

  /** Shipment summary and a commercial-invoice template, published to the customer (ch. 14.9). */
  async generateDocuments(ref: string, actor: Actor) {
    const r = await this.byRef(ref)
    const { lane, weights } = await this.weights(r)
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    const shipper = r.shipper as { name: string; company?: string; address: { city: string; country: string } }
    const consignee = r.consignee as { name: string; company?: string; address: { city: string; country: string } }
    const summary = await renderPdf(`Shipment summary · ${r.ref}`, this.laneLabel(lane), [
      { heading: "Parties", rows: [["Shipper", `${shipper.name}${shipper.company ? `, ${shipper.company}` : ""} · ${shipper.address.city}, ${shipper.address.country}`], ["Consignee", `${consignee.name}${consignee.company ? `, ${consignee.company}` : ""} · ${consignee.address.city}, ${consignee.address.country}`]] },
      { heading: "Shipment", rows: [["Service", r.service], ["Ready date", r.readyDate], ["Actual weight", `${weights.actualKg} kg`], ["Chargeable weight", `${weights.chargeableKg} kg (estimate, divisor ${weights.divisor})`]] },
      { heading: "Contents", rows: items.map((i) => [`${i.quantity} × ${i.description}`, `${i.currency} ${((i.unitValueMinor * i.quantity) / 100).toFixed(2)} · ${i.category}${i.hsCode ? ` · HS ${i.hsCode}` : ""}`] as [string, string]) },
    ], ["Uni Travel arranges shipments through partners and does not operate transport itself."])
    const invoice = await renderPdf("Commercial invoice (template)", `${r.ref} · to be completed and signed by the shipper`, [
      { rows: [["Seller / shipper", shipper.company ?? shipper.name], ["Buyer / consignee", consignee.company ?? consignee.name], ["Incoterms", (r.commercial as { incoterm?: string } | null)?.incoterm ?? "—"]] },
      { heading: "Lines", rows: items.map((i) => [i.description, `qty ${i.quantity} · unit ${i.currency} ${(i.unitValueMinor / 100).toFixed(2)} · origin ${i.originCountry} · HS ${i.hsCode ?? "—"}`] as [string, string]) },
    ], ["The commercial invoice remains the shipper's responsibility; this template is provided for convenience (ch. 14.9)."])
    await this.uow.run(async (tx) => {
      await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "CARGO", requestId: r.id, type: "SHIPMENT_SUMMARY", filename: `shipment-${r.ref}.pdf`, body: summary, createdBy: actor.userId, visibility: "CUSTOMER" })
      await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "CARGO", requestId: r.id, type: "COMMERCIAL_INVOICE", filename: `commercial-invoice-template-${r.ref}.pdf`, body: invoice, createdBy: actor.userId, visibility: "CUSTOMER" })
    })
    return { ok: true }
  }

  private record(t: typeof trackingEvents.$inferSelect): TrackingRecord {
    return { id: t.id, eventCode: t.eventCode, location: t.location, occurredAt: t.occurredAt.toISOString(), description: t.description, correctsEventId: t.correctsEventId, createdAt: t.createdAt.toISOString() }
  }

  /** Customer timeline: corrections applied, no source, author, reason or partner id. */
  private trackingView(records: TrackingRecord[], locale: "en" | "fa") {
    return effectiveTimeline(records).map((e) => ({ ...e, label: TRACKING_EVENT_LABELS[e.eventCode][locale] }))
  }

  // ---------------- shipments (Phase E) ----------------

  private async shipmentViews(userId: string, locale: "en" | "fa", ref?: string) {
    const rows = await this.db.select({ r: cargoRequests, l: cargoLanes }).from(cargoRequests).innerJoin(cargoLanes, eq(cargoLanes.id, cargoRequests.laneId))
      .where(and(eq(cargoRequests.customerUserId, userId), inArray(cargoRequests.status, SHIPMENT_STATUSES), ...(ref ? [eq(cargoRequests.ref, ref)] : []))).orderBy(desc(cargoRequests.submittedAt))
    if (!rows.length) return []
    const ids = rows.map(({ r }) => r.id)
    const events = await this.db.select().from(trackingEvents).where(inArray(trackingEvents.cargoRequestId, ids))
    const books = await this.db.select({ id: partnerBookings.cargoRequestId, awb: partnerBookings.awbNumber }).from(partnerBookings).where(inArray(partnerBookings.cargoRequestId, ids)).orderBy(asc(partnerBookings.bookedAt))
    return rows.map(({ r, l }) => {
      const timeline = this.trackingView(events.filter((e) => e.cargoRequestId === r.id).map((e) => this.record(e)), locale)
      return ShipmentView.parse({
        ref: r.ref, service: r.service, status: r.status, statusLabel: this.label(r.status, locale), laneLabel: this.laneLabel(l, locale), awbNumber: books.filter((b) => b.id === r.id).at(-1)?.awb ?? null,
        estimatedDeliveryAt: r.estimatedDeliveryAt?.toISOString() ?? null, lastEvent: lastEvent(timeline), timeline,
      })
    })
  }

  async customerShipments(userId: string, locale: "en" | "fa") {
    return this.shipmentViews(userId, locale)
  }

  async customerShipment(ref: string, actor: Actor, locale: "en" | "fa") {
    const r = await this.owned(ref, actor.userId)
    const [v] = await this.shipmentViews(actor.userId, locale, r.ref)
    if (!v) throw notFound("Request")
    return v
  }

  async shipmentSummary(userId: string, locale: "en" | "fa") {
    const all = await this.shipmentViews(userId, locale)
    const moving = all.filter((s) => MOVING.includes(s.status))
    const next = [...moving].sort((a, b) => (a.estimatedDeliveryAt ?? "9").localeCompare(b.estimatedDeliveryAt ?? "9"))[0]
    return ShipmentSummary.parse({
      total: all.length, inTransit: moving.length, delivered: all.filter((s) => s.status === "DELIVERED" || s.status === "COMPLETED").length,
      next: next ? { ref: next.ref, estimatedDeliveryAt: next.estimatedDeliveryAt, lastEvent: next.lastEvent, laneLabel: next.laneLabel } : null,
    })
  }

  // ---------------- views ----------------

  private async quoteViews(r: Cargo, internal: boolean) {
    const qs = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id))).orderBy(desc(quotes.version))
    const ps = await this.partners()
    return qs.filter((q) => internal || q.status !== "DRAFT").map((q) => ({
      id: q.id, version: q.version, status: q.status, validUntil: q.validUntil?.toISOString() ?? null, lines: q.cargoLines, transitNote: q.transitNote, sentAt: q.sentAt?.toISOString() ?? null, acceptedAt: q.acceptedAt?.toISOString() ?? null,
      partnerName: internal ? ps.find((p) => p.id === q.cargoPartnerId)?.name ?? "" : "Uni Travel partner", ...(internal ? { partnerCostMinor: q.partnerCostMinor, partnerId: q.cargoPartnerId, rowVersion: q.rowVersion } : {}),
    }))
  }

  async customerDetail(ref: string, actor: Actor, locale: "en" | "fa") {
    const r = await this.owned(ref, actor.userId)
    // Parsing through the customer schema strips anything internal a future change might add (ch. 32.2).
    return CargoCustomerView.parse(await this.detail(r, false, locale, actor))
  }

  async staffDetail(ref: string, actor: Actor) {
    return this.detail(await this.byRef(ref), true, "en", actor)
  }

  private async detail(r: Cargo, staff: boolean, locale: "en" | "fa", actor: Actor) {
    const { lane, pieces, weights } = await this.weights(r)
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    const hist = await this.db.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, "CARGO"), eq(requestStatusHistory.requestId, r.id))).orderBy(asc(requestStatusHistory.createdAt))
    const track = await this.db.select({ t: trackingEvents, by: users.displayName }).from(trackingEvents).leftJoin(users, eq(users.id, trackingEvents.createdBy)).where(eq(trackingEvents.cargoRequestId, r.id)).orderBy(asc(trackingEvents.occurredAt), asc(trackingEvents.createdAt))
    const records = track.map(({ t }) => this.record(t))
    const effectiveIds = effectiveRecordIds(records)
    const msgs = await this.db.select({ m: requestMessages, author: users.displayName }).from(requestMessages).leftJoin(users, eq(users.id, requestMessages.authorId)).where(and(eq(requestMessages.requestType, "CARGO"), eq(requestMessages.requestId, r.id))).orderBy(asc(requestMessages.createdAt))
    const [booking] = await this.db.select({ b: partnerBookings, p: partners.name }).from(partnerBookings).innerJoin(partners, eq(partners.id, partnerBookings.partnerId)).where(eq(partnerBookings.cargoRequestId, r.id)).orderBy(desc(partnerBookings.bookedAt)).limit(1)
    const docs = await this.docs.forRequest("CARGO", r.id, !staff)
    const base = {
      ref: r.ref, service: r.service, status: r.status, statusLabel: this.label(r.status, locale), paymentStatus: r.paymentStatus, lane: { origin: lane.originCountry, destination: lane.destinationCountry, label: this.laneLabel(lane, locale) },
      shipper: r.shipper, consignee: r.consignee, readyDate: r.readyDate, handoverMode: r.handoverMode,
      pieces: pieces.map((p) => ({ id: p.id, lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm, weightKg: p.weightKg, verifiedWeightKg: p.verifiedWeightKg })),
      items: items.map((i) => ({ id: i.id, description: i.description, category: i.category, quantity: i.quantity, unitValue: { amountMinor: i.unitValueMinor, currency: i.currency }, originCountry: i.originCountry, hsCode: i.hsCode ?? undefined, purpose: i.purpose, ...(staff ? { screeningOutcome: i.screeningOutcome, matchedRule: i.matchedRule } : {}) })),
      weights, declaredTotal: { amountMinor: r.declaredValueMinor, currency: r.currency }, submittedAt: r.submittedAt.toISOString(),
      timeline: hist.map((h) => ({ at: h.createdAt.toISOString(), label: staff ? `${h.command} → ${h.toStatus}` : this.label(h.toStatus as CargoStatus, locale), detail: staff ? h.reasonText ?? undefined : undefined })),
      tracking: this.trackingView(records, locale),
      estimatedDeliveryAt: r.estimatedDeliveryAt?.toISOString() ?? null,
      quotes: await this.quoteViews(r, staff),
      messages: msgs.map(({ m, author }) => ({ id: m.id, direction: m.direction, body: m.body, authorName: m.direction === "TO_CUSTOMER" ? "Uni Travel" : author ?? "Customer", createdAt: m.createdAt.toISOString() })),
      documents: docs.filter((d) => staff || d.visibility === "CUSTOMER").map((d) => ({ id: d.id, type: d.type, filename: d.filename, createdAt: d.createdAt.toISOString() })),
      booking: booking ? { partnerName: staff ? booking.p : "Uni Travel partner", awbNumber: booking.b.awbNumber, ...(staff ? { partnerReference: booking.b.partnerReference } : {}) } : null,
      actions: r.status === "QUOTED" || (r.status === "EXCEPTION" && r.exceptionReason === "REWEIGH") ? ["ACCEPT_QUOTE", "MESSAGE"] : TERMINAL.includes(r.status) ? [] : ["MESSAGE", ...(["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED"].includes(r.status) ? ["CANCEL"] : [])],
      notice: lane.customerNotice?.[locale] ?? null,
    }
    if (!staff) return base
    const notes = await this.db.select({ n: requestNotes, author: users.displayName }).from(requestNotes).leftJoin(users, eq(users.id, requestNotes.authorId)).where(and(eq(requestNotes.requestType, "CARGO"), eq(requestNotes.requestId, r.id))).orderBy(desc(requestNotes.createdAt))
    const [cu] = await this.db.select().from(users).where(eq(users.id, r.customerUserId))
    const ps = await this.partners()
    const f = await this.facts(this.db, r, r.status === "EXCEPTION" ? { revisedQuoteAccepted: await this.revisedQuoteAccepted(this.db, r) } : {})
    const pays = await this.db.select().from(paymentRecords).where(and(eq(paymentRecords.requestType, "CARGO"), eq(paymentRecords.requestId, r.id))).orderBy(desc(paymentRecords.createdAt))
    const staffNames = new Map<string, string>()
    for (const id of new Set(pays.flatMap((x) => [x.recordedBy, x.verifiedBy]).filter(Boolean) as string[])) staffNames.set(id, (await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, id)))[0]?.n ?? id)
    const threshold = this.config.get("WORKFLOW").paymentFourEyesThresholdMinor
    const [acceptedQuote] = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "CARGO"), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).limit(1)
    const acceptedTotal = (acceptedQuote?.cargoLines as { total?: { amountMinor: number; currency: string } } | null)?.total ?? null
    return {
      ...base,
      payments: pays.map((x) => ({ id: x.id, amount: { amountMinor: x.amountMinor, currency: x.currency }, method: x.method, receivedAt: x.receivedAt.toISOString(), externalReference: x.externalReference, payerName: x.payerName, status: x.status, recordedBy: x.recordedBy ? staffNames.get(x.recordedBy) ?? x.recordedBy : "System (card payment)", verifiedBy: x.verifiedBy ? staffNames.get(x.verifiedBy) ?? x.verifiedBy : null, needsSecondVerifier: x.status === "RECORDED" && x.amountMinor > threshold })),
      paymentRecording: paymentRecordingState({ product: "CARGO", status: r.status, atolMode: this.config.get("WORKFLOW").atolMode, acceptedTotal, recordedMinor: pays.filter((x) => x.status === "RECORDED" || x.status === "VERIFIED").reduce((n, x) => n + x.amountMinor, 0) }),
      // Staff see every stored row, originals and corrections, with which ones are in force.
      tracking: track.map(({ t, by }) => ({ id: t.id, eventCode: t.eventCode, location: t.location, occurredAt: t.occurredAt.toISOString(), description: t.description, source: t.source, externalEventId: t.externalEventId, correctsEventId: t.correctsEventId, correctionReason: t.correctionReason, createdBy: by, createdAt: t.createdAt.toISOString(), effective: effectiveIds.has(t.id) })),
      id: r.id, version: r.version, customer: { id: r.customerUserId, displayName: cu?.displayName }, exceptionReason: r.exceptionReason, assigneeUserId: r.assigneeUserId, customerNote: r.customerNote, declarations: r.declarations, commercial: r.commercial,
      notes: notes.map(({ n, author }) => ({ id: n.id, body: n.body, author, createdAt: n.createdAt.toISOString() })),
      eligiblePartners: ps.filter((p) => p.active && p.laneIds.includes(r.laneId) && p.services.includes(r.service)).map((p) => ({ id: p.id, name: p.name, complianceStatus: p.complianceStatus, slaNote: p.slaNote, cutOffNote: p.cutOffNote, contacts: p.contacts })),
      compliance: await this.compliance.casesForRequest("CARGO", r.id),
      // The assignee is picked in the assign dialog; the command re-checks its guard.
      actions: allowedCommands(CARGO_TRANSITIONS, { ...f, assigneeCanTransition: true }, staffActor(actor)),
    }
  }

  async customerList(userId: string, locale: "en" | "fa") {
    const rows = await this.db.select({ r: cargoRequests, l: cargoLanes }).from(cargoRequests).innerJoin(cargoLanes, eq(cargoLanes.id, cargoRequests.laneId)).where(eq(cargoRequests.customerUserId, userId)).orderBy(desc(cargoRequests.submittedAt))
    return FlightRequestListItem.array().parse(rows.map(({ r, l }) => ({ ref: r.ref, productType: "CARGO" as const, status: r.status, statusLabel: this.label(r.status, locale), routeLabel: this.laneLabel(l, locale), firstDate: r.readyDate, submittedAt: r.submittedAt.toISOString(), updatedAt: r.updatedAt.toISOString(), unread: 0 })))
  }

  async adminList(q: { tab?: string; status?: string; limit: number; cursor?: string }) {
    const conds = []
    if (q.tab === "hold") conds.push(eq(cargoRequests.status, "COMPLIANCE_HOLD"))
    else if (q.tab === "new") conds.push(eq(cargoRequests.status, "NEW"))
    else if (q.tab === "open") conds.push(inArray(cargoRequests.status, ["NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "EXCEPTION"]))
    if (q.status) conds.push(eq(cargoRequests.status, q.status as CargoStatus))
    if (q.cursor) conds.push(lt(cargoRequests.submittedAt, new Date(q.cursor)))
    const rows = await this.db.select({ r: cargoRequests, l: cargoLanes, name: users.displayName }).from(cargoRequests).innerJoin(cargoLanes, eq(cargoLanes.id, cargoRequests.laneId)).leftJoin(users, eq(users.id, cargoRequests.customerUserId)).where(conds.length ? and(...conds) : undefined).orderBy(sql`${cargoRequests.slaDueAt} asc nulls last`, desc(cargoRequests.submittedAt)).limit(q.limit + 1)
    return { items: rows.slice(0, q.limit).map(({ r, l, name }) => ({ ref: r.ref, service: r.service, status: r.status, lane: this.laneLabel(l), customer: name, readyDate: r.readyDate, submittedAt: r.submittedAt.toISOString(), slaDueAt: r.slaDueAt?.toISOString() ?? null })), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.r.submittedAt.toISOString() : null }
  }

  async contact(ref: string, actor: Actor, body: { channel: "PHONE" | "SMS_TEMPLATE"; outcome: string; note?: string }) {
    const r = await this.byRef(ref)
    const [c] = await this.db.insert(contactAttempts).values({ requestType: "CARGO", requestId: r.id, staffId: actor.userId, channel: body.channel, outcome: body.outcome as "REACHED", note: body.note }).returning()
    return c
  }
}
