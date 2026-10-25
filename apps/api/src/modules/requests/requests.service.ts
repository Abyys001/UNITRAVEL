import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"

import {
  type CreateFlightRequestBody, FlightRequestCustomerView, FlightRequestListItem, type FlightRequestStatus, type Itinerary, type PaymentStatus, RESERVED_AWAITING_PAYMENT, RESERVED_ISSUING, type SearchQuery,
  type StaffRequestChangedEvent,
} from "@unitravel/contracts"
import {
  afterSalesCases, contactAttempts, creditOverrides, type Db, type DbOrTx, documents, flightRequests, offerSnapshots, paymentRecords, quoteOptions, quotes, requestMessages,
  requestNotes, requestStatusHistory, requestTravellers, reservations, tickets, type Tx, userIdentities, users, customerProfiles, cargoRequests,
} from "@unitravel/db"
import {
  allowedCommands, computePaymentStatus, evaluate, FLIGHT_TERMINAL, FLIGHT_TRANSITIONS, type FlightCommandName, type FlightFacts, generateReference,
  type MachineActor, normaliseReference, passengerMixMismatch, paymentRecordingState, TRAVELLERS_NOT_VERIFIED, unknownQuoteFields,
} from "@unitravel/domain"

import { sha256 } from "../../core/crypto"
import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { CustomersService } from "../customers/customers.service"
import { DocumentNumbersService } from "../invoices/document-numbers.service"
import { DocumentsService } from "../documents/documents.service"
import { NotificationsService } from "../notifications/notifications.service"
import { addBusinessMinutes } from "../platform/business-hours"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { customerItinerary } from "../search/customer-projection"

type Req = typeof flightRequests.$inferSelect
export type Locale = "en" | "fa"

/** Implemented by the search module (Stage 3): itinerary lookup and revalidation for submission. */
export interface SearchPort {
  itineraryForSubmit(searchId: string, itineraryId: string, actor: Actor): Promise<{ itinerary: Itinerary; query: SearchQuery; ruleVersion: number; engineVersion: string; searchResultId: string | null }>
  revalidate(itinerary: Itinerary, requestId: string): Promise<{ outcome: "CONFIRMED" | "PRICE_CHANGED" | "OFFER_EXPIRED" | "UNAVAILABLE"; itinerary?: Itinerary; total?: { amountMinor: number; currency: string } }>
}

export function staffActor(a: Actor): MachineActor {
  return { kind: "STAFF", userId: a.userId, permissions: a.permissions }
}
export const SYSTEM: MachineActor = { kind: "SYSTEM", permissions: new Set() }

/**
 * The flight request lifecycle (ch. 13): a request is a case, not a booking. Every transition is a named command that
 * runs the state machine inside one transaction and writes the history row, the audit entry and the outbox event.
 */
@Injectable()
export class RequestsService {
  private readonly log = new Logger("Requests")
  private search?: SearchPort

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly reference: ReferenceService,
    private readonly customers: CustomersService,
    private readonly access: AccessService,
    private readonly compliance: ComplianceService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly numbers: DocumentNumbersService,
  ) {}

  setSearchPort(p: SearchPort) {
    this.search = p
  }

  routeLabel(q: SearchQuery, locale: Locale = "en"): string {
    const code = (p: SearchQuery["slices"][number]["from"]) => ("airport" in p ? p.airport : p.city)
    const s = q.slices
    const parts = [this.reference.placeName(code(s[0]!.from), locale), ...s.map((x) => this.reference.placeName(code(x.to), locale))]
    if (q.tripType === "RETURN") return `${parts[0]} ⇄ ${parts[1]}`
    return parts.join(" → ")
  }

  statusLabel(status: FlightRequestStatus, payment: PaymentStatus, locale: Locale): string {
    if (status === "RESERVED") return (payment === "PAID" ? RESERVED_ISSUING : RESERVED_AWAITING_PAYMENT)[locale]
    return this.config.get("WORKFLOW").statusLabels.flight[status][locale]
  }

  async byRef(ref: string, tx: DbOrTx = this.db, forUpdate = false): Promise<Req> {
    const norm = normaliseReference(ref)
    if (!norm || !norm.startsWith("UT-F-")) throw notFound("Request")
    const q = tx.select().from(flightRequests).where(eq(flightRequests.ref, norm))
    const [r] = forUpdate ? await q.for("update") : await q
    if (!r) throw notFound("Request")
    return r
  }

  /** Ownership on every customer lookup; a reference is a handle, not a credential (ch. 13.4). */
  async ownedByRef(ref: string, userId: string, tx: DbOrTx = this.db, forUpdate = false): Promise<Req> {
    const r = await this.byRef(ref, tx, forUpdate)
    if (r.customerUserId !== userId) throw notFound("Request")
    return r
  }

  private async uniqueRef(tx: DbOrTx, type: "F" | "A"): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const ref = generateReference(type)
      const table = type === "F" ? flightRequests : flightRequests
      const [hit] = await tx.select({ id: table.id }).from(table).where(eq(table.ref, ref))
      if (!hit) return ref
    }
    throw new Error("Could not allocate a unique reference")
  }

  // ---------------- submission (J2/J3) ----------------

  async create(body: CreateFlightRequestBody, actor: Actor, ctx: { requestId: string; locale: Locale; via: "WEB" | "MOBILE" | "CONSOLE" }) {
    const auth = this.config.get("AUTH")
    const [contact] = await this.db.select().from(userIdentities).where(and(eq(userIdentities.id, body.contactIdentityId), eq(userIdentities.userId, actor.userId), isNull(userIdentities.revokedAt)))
    if (!contact || contact.type !== "PHONE") throw new AppError("VALIDATION_FAILED", "Choose one of your phone numbers", [{ path: "contactIdentityId", code: "INVALID" }])
    // The contact number can be changed only to another verified number (ch. 11.3).
    if (auth.requireVerifiedPhoneForRequests && !contact.verifiedAt) throw new AppError("PHONE_NOT_VERIFIED", "Verify your phone number before submitting a request")
    const trav = await Promise.all(body.travellers.map((t) => this.customers.owned(actor.userId, t.travellerId)))
    const umnr = body.ssrs.some((s) => s.code === "UMNR") || body.travellers.every((t) => t.passengerType === "CHD" || t.passengerType === "INF" || t.passengerType === "INS")
    let kind = body.kind
    let query: SearchQuery
    let snapshotInput: { itinerary: Itinerary; ruleVersion: number; engineVersion: string; searchResultId: string | null; searchId: string; priceAtSubmit: number; revalidated?: { total: number; at: Date } } | null = null
    if (body.kind === "ITINERARY") {
      if (!this.search) throw new AppError("FEATURE_DISABLED", "Search is not available yet; send a manual request")
      const found = await this.search.itineraryForSubmit(body.searchId!, body.itineraryId!, actor)
      if (found.itinerary.ticketing === "SEPARATE_TICKETS" && !body.acknowledgements.selfTransfer) {
        throw new AppError("VALIDATION_FAILED", "Confirm that you understand this journey uses separate tickets", [{ path: "acknowledgements.selfTransfer", code: "REQUIRED" }])
      }
      query = found.query
      snapshotInput = { itinerary: found.itinerary, ruleVersion: found.ruleVersion, engineVersion: found.engineVersion, searchResultId: found.searchResultId, searchId: body.searchId!, priceAtSubmit: found.itinerary.price.total.amountMinor }
      if (this.config.settings().requestsRevalidateOnSubmit) {
        const rv = await this.search.revalidate(found.itinerary, ctx.requestId)
        if (rv.outcome === "OFFER_EXPIRED" || rv.outcome === "UNAVAILABLE") throw new AppError("OFFER_EXPIRED", "This price has expired — search again")
        // ADR-0004: the customer never saw a price, so a change is recorded on the snapshot for staff and never blocks or prompts them.
        if (rv.itinerary) snapshotInput.itinerary = rv.itinerary
        if (rv.total) snapshotInput.revalidated = { total: rv.total.amountMinor, at: new Date() }
      }
    } else query = body.query!
    // The snapshot is priced for the searched mix; a different set of travellers would be quoted and invoiced at the wrong price (ADR-0008 W6, ch. 12.4).
    const mixIssue = passengerMixMismatch(query.passengers.map((p) => p.type), body.travellers.map((t) => t.passengerType))
    if (mixIssue) throw new AppError("VALIDATION_FAILED", mixIssue, [{ path: "travellers", code: "PASSENGER_MIX_MISMATCH" }])
    // Unaccompanied minors are always routed to a manual request (ch. 12.4).
    if (umnr) kind = "MANUAL"
    const firstDate = query.slices[0]!.date
    const wf = this.config.get("WORKFLOW")
    const urgent = Date.parse(`${firstDate}T00:00:00Z`) - Date.now() < wf.sla.urgentWithinHours * 3600_000
    return this.uow.run(async (tx) => {
      let snapshotId: string | null = null
      if (snapshotInput) {
        const content = JSON.stringify(snapshotInput.itinerary)
        const [snap] = await tx.insert(offerSnapshots).values({
          searchResultId: snapshotInput.searchResultId, searchId: snapshotInput.searchId, itinerary: snapshotInput.itinerary,
          components: snapshotInput.itinerary.components.map((c) => ({ provider: c.source.provider, offerId: c.source.providerOfferId, rung: c.source.rung, fetchedAt: c.source.fetchedAt })),
          priceAtSubmitMinor: snapshotInput.priceAtSubmit, priceRevalidatedMinor: snapshotInput.revalidated?.total ?? null, currency: snapshotInput.itinerary.price.total.currency,
          revalidatedAt: snapshotInput.revalidated?.at ?? null, ruleVersion: snapshotInput.ruleVersion, engineVersion: snapshotInput.engineVersion, contentHash: sha256(content),
        }).returning()
        snapshotId = snap!.id
      }
      const ref = await this.uniqueRef(tx, "F")
      const now = new Date()
      const [req] = await tx.insert(flightRequests).values({
        ref, kind, customerUserId: actor.userId, contactIdentityId: contact.id, contactPhoneSnapshot: contact.valueNormalised, contactPhoneVerified: !!contact.verifiedAt,
        alternativeContact: body.alternativeContact ?? null, status: "SUBMITTED", paymentStatus: "NONE", offerSnapshotId: snapshotId, tripType: query.tripType, query,
        manual: body.manual ?? null, preferences: { seatPreference: body.seatPreference, seatChoice: body.seatChoice, ssrs: body.ssrs, bestTimeToCall: body.bestTimeToCall, selfTransferAcknowledged: body.acknowledgements.selfTransfer },
        customerNote: body.note ?? null, submittedVia: ctx.via, submittedLocale: ctx.locale, firstTravelDate: firstDate, urgent,
        slaDueAt: addBusinessMinutes(wf.businessHours, now, wf.sla.unassignedMinutes), submittedAt: now,
      }).returning()
      await tx.insert(requestTravellers).values(trav.map((t, i) => ({ requestId: req!.id, travellerId: t.id, passengerType: body.travellers[i]!.passengerType, nameSnapshot: { title: t.title, givenNames: t.givenNames, surname: t.surname, nameFa: t.nameFa, dateOfBirth: t.dateOfBirth } })))
      await tx.insert(requestStatusHistory).values({ requestType: "FLIGHT", requestId: req!.id, fromStatus: null, toStatus: "SUBMITTED", command: "submit", actorUserId: actor.userId, actorKind: "CUSTOMER" })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "flight_request.submitted", entityType: "flight_request", entityId: req!.id, contextRef: ref, after: { kind, tripType: query.tripType, travellers: trav.length, snapshot: !!snapshotId }, ip: actor.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: req!.id, eventType: "flight_request.submitted", payload: { requestId: req!.id, ref, customerUserId: actor.userId, routeLabel: this.routeLabel(query, ctx.locale), urgent }, dedupeKey: `fr-submitted:${req!.id}` })
      return { ref, status: "SUBMITTED" as const, kind }
    })
  }

  // ---------------- state machine ----------------

  async facts(tx: DbOrTx, r: Req, extra: Partial<FlightFacts> & { quoteId?: string } = {}): Promise<FlightFacts> {
    const rt = await tx.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
    const views = await this.customers.byIds(rt.map((t) => t.travellerId), tx)
    const qRows = extra.quoteId
      ? await tx.select().from(quotes).where(and(eq(quotes.id, extra.quoteId), eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id)))
      : await tx.select().from(quotes).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id))).orderBy(desc(quotes.version)).limit(1)
    const q = qRows[0]
    if (extra.quoteId && !q) throw notFound("Quote")
    const opts = q ? await tx.select().from(quoteOptions).where(eq(quoteOptions.quoteId, q.id)).orderBy(asc(quoteOptions.position)) : []
    const res = await tx.select().from(reservations).where(eq(reservations.requestId, r.id)).orderBy(desc(reservations.createdAt))
    const active = res.find((x) => x.status === "HELD" || x.status === "CONFIRMED") ?? res.find((x) => x.status === "LAPSED") ?? null
    const tks = await tx.select().from(tickets).where(and(eq(tickets.requestId, r.id), eq(tickets.status, "ISSUED")))
    const override = await tx.select().from(creditOverrides).where(and(eq(creditOverrides.requestId, r.id)))
    const accepted = q && q.acceptedOptionId ? opts.find((o) => o.id === q.acceptedOptionId) : undefined
    const segs = ((accepted?.itinerary as { slices?: { segments: { departure: { utc: string } }[] }[] } | undefined)?.slices ?? []).flatMap((s) => s.segments)
    return {
      status: r.status, paymentStatus: r.paymentStatus, now: new Date(),
      quote: q ? { id: q.id, status: q.status, validUntil: q.validUntil, options: opts.map((o) => ({ id: o.id, unknownFields: optionUnknowns(o) })) } : undefined,
      travellerDocumentsComplete: views.length > 0 && views.every((v) => v.documentComplete),
      allTravellersVerified: views.length > 0 && views.every((v) => v.verification.status === "VERIFIED"),
      activeReservation: active ? { status: active.status, ticketingDeadline: active.ticketingDeadline } : null,
      ticketsIssuedForEveryTraveller: rt.length > 0 && rt.every((t) => tks.some((k) => k.travellerId === t.travellerId)),
      creditOverrideApproved: override.some((o) => !!o.approvedBy),
      lastSegmentDeparture: segs.length ? new Date(segs[segs.length - 1]!.departure.utc) : null,
      ...extra,
    }
  }

  /** Travellers on the request whose document is not VERIFIED (ADR-0005, owner decision 4: required at record_tickets). */
  async unverifiedTravellers(tx: DbOrTx, r: Req) {
    const rt = await tx.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
    const views = await this.customers.byIds(rt.map((t) => t.travellerId), tx)
    return views.filter((v) => v.verification.status !== "VERIFIED").map((v) => ({ travellerId: v.id, name: `${v.givenNames} ${v.surname}`, status: v.verification.status }))
  }

  /** Runs one command (Table 13.1): guard → status update → history → audit → outbox, atomically. 409 on failure. */
  async transition(tx: Tx, r: Req, command: FlightCommandName, actor: MachineActor, opts: { facts?: Partial<FlightFacts> & { quoteId?: string }; expectedVersion?: number; reasonCode?: string; reasonText?: string; message?: string; patch?: Partial<typeof flightRequests.$inferInsert>; ip?: string; requestId?: string } = {}): Promise<Req> {
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== r.version) throw new AppError("VERSION_CONFLICT", `Request changed (version ${r.version}); reload`)
    const facts = await this.facts(tx, r, opts.facts)
    const ev = evaluate(FLIGHT_TRANSITIONS, command, facts, actor)
    if (!ev.ok) {
      if (ev.reason === TRAVELLERS_NOT_VERIFIED) throw new AppError("IDENTITY_NOT_VERIFIED", ev.reason)
      throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
    }
    const terminal = FLIGHT_TERMINAL.includes(ev.to)
    const [updated] = await tx.update(flightRequests).set({ status: ev.to, version: r.version + 1, closedAt: terminal ? new Date() : r.closedAt, ...opts.patch }).where(and(eq(flightRequests.id, r.id), eq(flightRequests.version, r.version))).returning()
    if (!updated) throw new AppError("VERSION_CONFLICT", "Request changed; reload")
    await tx.insert(requestStatusHistory).values({ requestType: "FLIGHT", requestId: r.id, fromStatus: ev.from, toStatus: ev.to, command, actorUserId: actor.userId ?? null, actorKind: actor.kind, reasonCode: opts.reasonCode, reasonText: opts.reasonText })
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.kind === "SYSTEM" ? "SYSTEM" : actor.kind, action: `flight_request.${command}`, entityType: "flight_request", entityId: r.id, contextRef: r.ref, before: { status: ev.from, version: r.version }, after: { status: ev.to, version: updated.version, reasonCode: opts.reasonCode }, ip: opts.ip, requestId: opts.requestId })
    const labels = { en: this.statusLabel(ev.to, updated.paymentStatus, "en"), fa: this.statusLabel(ev.to, updated.paymentStatus, "fa") }
    await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "flight_request.transitioned", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: updated.assigneeUserId, from: ev.from, to: ev.to, command, actorUserId: actor.userId ?? null, routeLabel: this.routeLabel(r.query), statusLabels: labels, message: opts.message, urgent: r.urgent } })
    return updated
  }

  /** Recomputed from verified payment records against the accepted quote total; never set by hand (ch. 13.2). */
  async recomputePaymentStatus(tx: Tx, r: Req): Promise<PaymentStatus> {
    const recs = await tx.select().from(paymentRecords).where(and(eq(paymentRecords.requestType, "FLIGHT"), eq(paymentRecords.requestId, r.id)))
    const accepted = await tx.select({ total: quoteOptions.totalMinor }).from(quotes).innerJoin(quoteOptions, eq(quoteOptions.id, quotes.acceptedOptionId)).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).limit(1)
    const ps = computePaymentStatus(recs.map((p) => ({ amountMinor: p.amountMinor, currency: p.currency, status: p.status })), accepted[0]?.total ?? null)
    if (ps !== r.paymentStatus) await tx.update(flightRequests).set({ paymentStatus: ps }).where(eq(flightRequests.id, r.id))
    return ps
  }

  // ---------------- staff commands ----------------

  async staffCommand(ref: string, command: string, body: Record<string, unknown>, actor: Actor, expectedVersion: number | undefined, requestId: string) {
    const m = staffActor(actor)
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx, true)
      const common = { expectedVersion, ip: actor.ip, requestId }
      switch (command) {
        case "claim":
          return this.transition(tx, r, "claim", m, { ...common, facts: { assigneeCanTransition: actor.permissions.has("flight_request.transition") }, patch: { assigneeUserId: actor.userId, assignedAt: new Date() } })
        case "assign": {
          const target = String(body.assigneeUserId)
          const acc = await this.access.load(target, tx)
          return this.transition(tx, r, "assign", m, { ...common, facts: { assigneeCanTransition: acc.permissions.includes("flight_request.transition") }, patch: { assigneeUserId: target, assignedAt: new Date() } })
        }
        case "request_info": {
          const message = String(body.message ?? "")
          const updated = await this.transition(tx, r, "request_info", m, { ...common, facts: { message }, message })
          await this.addMessage(tx, r, actor.userId, "TO_CUSTOMER", message, [], false)
          return updated
        }
        case "send_quote":
          return this.sendQuote(tx, r, String(body.quoteId), actor, common)
        case "record_acceptance": {
          const quoteId = String(body.quoteId)
          const optionId = String(body.optionId)
          const note = String(body.note ?? "")
          const updated = await this.transition(tx, r, "record_acceptance", m, { ...common, facts: { quoteId, optionId, acceptanceNote: { calledAt: new Date(String(body.calledAt)), note } }, reasonText: note })
          await tx.update(quotes).set({ status: "ACCEPTED", acceptedOptionId: optionId, acceptedAt: new Date(), acceptedVia: "STAFF_RECORDED", acceptanceNote: `${body.calledAt}: ${note}` }).where(eq(quotes.id, quoteId))
          await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "quote.accepted", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, quoteId, via: "STAFF_RECORDED" } })
          return updated
        }
        case "close": case "reopen":
          return this.transition(tx, r, command, m, { ...common, reasonText: body.note as string | undefined })
        case "cancel": case "decline": {
          const message = String(body.message ?? "")
          const updated = await this.transition(tx, r, command, m, { ...common, facts: { reasonCode: String(body.reasonCode ?? ""), message }, reasonCode: String(body.reasonCode), reasonText: message, message })
          if (message) await this.addMessage(tx, r, actor.userId, "TO_CUSTOMER", message, [], false)
          await tx.update(quotes).set({ status: "SUPERSEDED" }).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), inArray(quotes.status, ["DRAFT", "SENT"])))
          return updated
        }
        case "mark_reservation_lapsed": {
          const [res] = await tx.select().from(reservations).where(and(eq(reservations.requestId, r.id), inArray(reservations.status, ["HELD", "CONFIRMED"])))
          if (!res) throw new AppError("INVALID_TRANSITION", "No active reservation")
          await tx.update(reservations).set({ status: "LAPSED" }).where(eq(reservations.id, res.id))
          await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "reservation.lapsed", entityType: "reservation", entityId: res.id, contextRef: r.ref, after: { reason: body.reason } })
          if (res.ticketingDeadline <= new Date()) return this.transition(tx, r, "expire_reservation", SYSTEM, { reasonText: String(body.reason) })
          return r
        }
        default:
          throw new AppError("INVALID_TRANSITION", `Unknown command ${command}`)
      }
    })
  }

  private async sendQuote(tx: Tx, r: Req, quoteId: string, actor: Actor, common: { expectedVersion?: number; ip?: string; requestId?: string }) {
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestId, r.id)))
    if (!q) throw notFound("Quote")
    const updated = await this.transition(tx, r, "send_quote", staffActor(actor), { ...common, facts: { quoteId } })
    // Sending a new quote supersedes the previous one; a price change after acceptance needs a new acceptance (ch. 13.6).
    await tx.update(quotes).set({ status: "SUPERSEDED" }).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), ne(quotes.id, q.id), inArray(quotes.status, ["SENT", "ACCEPTED", "DRAFT"])))
    await tx.update(quotes).set({ status: "SENT", sentAt: new Date() }).where(eq(quotes.id, q.id))
    const documentNumber = await this.numbers.assignQuotation(tx, q.id)
    await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "quote.sent", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, quoteId: q.id, validUntil: q.validUntil?.toISOString(), documentNumber } })
    return updated
  }

  // ---------------- customer commands ----------------

  async customerMessage(ref: string, actor: Actor, body: string, documentIds: string[], requestId: string) {
    return this.uow.run(async (tx) => {
      const r = await this.ownedByRef(ref, actor.userId, tx, true)
      if (FLIGHT_TERMINAL.includes(r.status)) throw new AppError("INVALID_TRANSITION", "This request is closed; contact us to reopen it")
      await this.documents.attach(tx, documentIds, "FLIGHT", r.id, actor.userId)
      await this.addMessage(tx, r, actor.userId, "FROM_CUSTOMER", body, documentIds, true)
      // A reply while Action needed moves the case back to the team (respond).
      if (r.status === "AWAITING_CUSTOMER") await this.transition(tx, r, "respond", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { facts: { responseProvided: true }, requestId })
      return { ok: true }
    })
  }

  async acceptQuote(ref: string, quoteId: string, optionId: string, actor: Actor, requestId: string) {
    return this.uow.run(async (tx) => {
      const r = await this.ownedByRef(ref, actor.userId, tx, true)
      const updated = await this.transition(tx, r, "accept_quote", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { facts: { quoteId, optionId }, ip: actor.ip, requestId })
      await tx.update(quotes).set({ status: "ACCEPTED", acceptedOptionId: optionId, acceptedAt: new Date(), acceptedVia: "APP" }).where(eq(quotes.id, quoteId))
      await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "quote.accepted", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, quoteId, via: "APP" } })
      return updated
    })
  }

  async declineQuote(ref: string, quoteId: string, actor: Actor, requestId: string, reason?: string) {
    return this.uow.run(async (tx) => {
      const r = await this.ownedByRef(ref, actor.userId, tx, true)
      const updated = await this.transition(tx, r, "decline_quote", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { facts: { quoteId }, reasonText: reason, requestId })
      await tx.update(quotes).set({ status: "DECLINED" }).where(eq(quotes.id, quoteId))
      if (reason) await this.addMessage(tx, r, actor.userId, "FROM_CUSTOMER", reason, [], true)
      return updated
    })
  }

  async customerCancel(ref: string, actor: Actor, requestId: string, reason?: string) {
    return this.uow.run(async (tx) => {
      const r = await this.ownedByRef(ref, actor.userId, tx, true)
      const updated = await this.transition(tx, r, "cancel_by_customer", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { reasonCode: "CUSTOMER_REQUEST", reasonText: reason, requestId })
      await tx.update(quotes).set({ status: "SUPERSEDED" }).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), inArray(quotes.status, ["DRAFT", "SENT"])))
      return updated
    })
  }

  async addMessage(tx: Tx, r: { id: string; ref: string; customerUserId: string; assigneeUserId: string | null }, authorId: string, direction: "TO_CUSTOMER" | "FROM_CUSTOMER", body: string, documentIds: string[], notify = true) {
    const [m] = await tx.insert(requestMessages).values({ requestType: "FLIGHT", requestId: r.id, authorId, direction, body, documentIds }).returning()
    if (notify) await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "flight_request.message", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, direction, message: body } })
    return m!
  }

  async staffMessage(ref: string, actor: Actor, body: string, documentIds: string[]) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx)
      for (const d of documentIds) await this.documents.publish(tx, d)
      return this.addMessage(tx, r, actor.userId, "TO_CUSTOMER", body, documentIds, true)
    })
  }

  async note(ref: string, actor: Actor, body: string) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx)
      const [n] = await tx.insert(requestNotes).values({ requestType: "FLIGHT", requestId: r.id, authorId: actor.userId, body }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "flight_request.note_added", entityType: "request_note", entityId: n!.id, contextRef: r.ref })
      return n
    })
  }

  /** Call logging (ch. 15.4): outcomes feed SLA reporting; template SMS goes through the SMS router. */
  async contactAttempt(ref: string, actor: Actor, body: { channel: "PHONE" | "SMS_TEMPLATE"; outcome: string; callBackAt?: string; note?: string; templateKey?: string }) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx)
      const [c] = await tx.insert(contactAttempts).values({ requestType: "FLIGHT", requestId: r.id, staffId: actor.userId, channel: body.channel, outcome: body.outcome as "REACHED", callBackAt: body.callBackAt ? new Date(body.callBackAt) : null, note: body.note, templateKey: body.templateKey }).returning()
      if (!r.firstContactAt) await tx.update(flightRequests).set({ firstContactAt: new Date() }).where(eq(flightRequests.id, r.id))
      if (body.channel === "SMS_TEMPLATE") {
        await this.notifications.notify({ eventType: "request.message_from_staff", eventId: c!.id, audience: "CUSTOMER", userIds: [r.customerUserId], vars: { ref: r.ref, message_preview: body.templateKey === "tried_to_call" ? `We tried to call you about ${r.ref}. We will try again.` : `Please contact us about ${r.ref}.` }, linkPath: `/requests/${r.ref}`, requestKey: r.ref })
      }
      return c
    })
  }

  // ---------------- views ----------------

  async customerList(userId: string, locale: Locale) {
    const fr = await this.db.select().from(flightRequests).where(eq(flightRequests.customerUserId, userId)).orderBy(desc(flightRequests.submittedAt)).limit(100)
    const unread = await this.db.select({ requestId: requestMessages.requestId, n: sql<number>`count(*)::int` }).from(requestMessages).where(and(eq(requestMessages.direction, "TO_CUSTOMER"), isNull(requestMessages.readAt), inArray(requestMessages.requestId, fr.length ? fr.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]))).groupBy(requestMessages.requestId)
    return FlightRequestListItem.array().parse(fr.map((r) => ({ ref: r.ref, productType: "FLIGHT" as const, status: r.status, statusLabel: this.statusLabel(r.status, r.paymentStatus, locale), routeLabel: this.routeLabel(r.query, locale), firstDate: r.firstTravelDate, submittedAt: r.submittedAt.toISOString(), updatedAt: r.updatedAt.toISOString(), unread: unread.find((u) => u.requestId === r.id)?.n ?? 0 })))
  }

  async timeline(r: Req, customer: boolean, locale: Locale) {
    const hist = await this.db.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, "FLIGHT"), eq(requestStatusHistory.requestId, r.id))).orderBy(asc(requestStatusHistory.createdAt))
    const items = hist.map((h) => ({
      at: h.createdAt.toISOString(), kind: "STATUS" as const, fromStatus: h.fromStatus ?? undefined, toStatus: h.toStatus,
      label: customer ? this.statusLabel(h.toStatus as FlightRequestStatus, r.paymentStatus, locale) : `${this.statusLabel(h.toStatus as FlightRequestStatus, r.paymentStatus, "en")} · ${h.command.replace(/_/g, " ")}`,
      detail: customer ? undefined : h.reasonText ?? h.reasonCode ?? undefined, actor: customer ? undefined : h.actorKind,
    }))
    if (customer) return items.filter((x, i) => i === 0 || x.label !== items[i - 1]!.label)
    const contacts = await this.db.select().from(contactAttempts).where(and(eq(contactAttempts.requestType, "FLIGHT"), eq(contactAttempts.requestId, r.id)))
    return [...items, ...contacts.map((c) => ({ at: c.createdAt.toISOString(), kind: "CONTACT" as const, label: `${c.channel === "PHONE" ? "Call" : "SMS"}: ${c.outcome}`, detail: c.note ?? undefined }))].sort((a, b) => a.at.localeCompare(b.at))
  }

  private async quoteViews(requestId: string, includeInternal: boolean, includeCost = includeInternal) {
    const qs = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, requestId))).orderBy(desc(quotes.version))
    const opts = qs.length ? await this.db.select().from(quoteOptions).where(inArray(quoteOptions.quoteId, qs.map((q) => q.id))).orderBy(asc(quoteOptions.position)) : []
    const attesters = new Map<string, string>()
    for (const id of new Set(opts.map((o) => o.attestedBy).filter(Boolean) as string[])) attesters.set(id, (await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, id)))[0]?.n ?? "Uni Travel staff")
    return qs.filter((q) => includeInternal || q.status !== "DRAFT").map((q) => ({
      id: q.id, version: q.version, status: q.status, currency: q.currency, validUntil: q.validUntil?.toISOString() ?? null, sentAt: q.sentAt?.toISOString() ?? null,
      acceptedOptionId: q.acceptedOptionId, acceptedAt: q.acceptedAt?.toISOString() ?? null, acceptedVia: q.acceptedVia, rowVersion: q.rowVersion,
      options: opts.filter((o) => o.quoteId === q.id).map((o) => ({
        id: o.id, label: o.label, source: o.source, attestedBy: o.attestedBy ? attesters.get(o.attestedBy) ?? null : null, slices: (o.itinerary as { slices: unknown[] }).slices, ...(includeCost ? { components: o.components } : {}),
        priceBreakdown: o.priceBreakdown, baggage: o.baggage, conditions: o.conditions, ticketingModel: o.ticketingModel, unknownFields: optionUnknowns(o),
        ...(includeCost ? { internalCostMinor: o.internalCostMinor, supplierPrice: o.supplierPrice ?? undefined, supplierFetchedAt: o.supplierFetchedAt?.toISOString(), supplierExpiresAt: o.supplierExpiresAt?.toISOString() } : {}),
      })),
    }))
  }

  private customerActions(r: Req, f: FlightFacts) {
    const out: string[] = []
    if (r.status === "QUOTED") out.push("ACCEPT_QUOTE")
    if (r.status === "AWAITING_CUSTOMER") out.push("RESPOND")
    if (["QUOTED", "ACCEPTED"].includes(r.status) && !f.travellerDocumentsComplete) out.push("PROVIDE_PASSPORT")
    if (!FLIGHT_TERMINAL.includes(r.status) && !["RESERVED", "TICKETED"].includes(r.status)) out.push("CANCEL")
    if (!FLIGHT_TERMINAL.includes(r.status)) out.push("MESSAGE")
    return out
  }

  /** `includeInternal`: holds `pricing.read.internal`, so the stored itinerary keeps its amounts (ADR-0004). */
  private async snapshotView(id: string | null, includeInternal: boolean) {
    if (!id) return null
    const [s] = await this.db.select().from(offerSnapshots).where(eq(offerSnapshots.id, id))
    if (!s) return null
    const prices = includeInternal ? { priceAtSubmit: { amountMinor: s.priceAtSubmitMinor, currency: s.currency }, priceRevalidated: s.priceRevalidatedMinor ? { amountMinor: s.priceRevalidatedMinor, currency: s.currency } : null, revalidatedAt: s.revalidatedAt?.toISOString() ?? null } : {}
    return { id: s.id, itinerary: includeInternal ? s.itinerary : customerItinerary(s.itinerary), ...prices, ruleVersion: s.ruleVersion, engineVersion: s.engineVersion, contentHash: s.contentHash, createdAt: s.createdAt.toISOString() }
  }

  /** Customer-facing serialisation: never notes, internal costs, assignee details or screening results (ch. 25.6). */
  async customerDetail(ref: string, actor: Actor, locale: Locale) {
    const r = await this.ownedByRef(ref, actor.userId)
    await this.db.update(requestMessages).set({ readAt: new Date() }).where(and(eq(requestMessages.requestId, r.id), eq(requestMessages.direction, "TO_CUSTOMER"), isNull(requestMessages.readAt)))
    await this.notifications.markRequestRead(actor.userId, r.ref)
    const f = await this.facts(this.db, r)
    const rt = await this.db.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
    const views = await this.customers.byIds(rt.map((t) => t.travellerId))
    const msgs = await this.db.select({ m: requestMessages, author: users.displayName }).from(requestMessages).leftJoin(users, eq(users.id, requestMessages.authorId)).where(and(eq(requestMessages.requestType, "FLIGHT"), eq(requestMessages.requestId, r.id))).orderBy(asc(requestMessages.createdAt))
    const res = await this.db.select().from(reservations).where(eq(reservations.requestId, r.id)).orderBy(desc(reservations.createdAt)).limit(1)
    const tks = await this.db.select().from(tickets).where(eq(tickets.requestId, r.id))
    const docs = await this.documents.forRequest("FLIGHT", r.id, true)
    const status = r.status
    // Parsing through the customer schema strips anything internal a future change might add (ch. 32.2).
    return FlightRequestCustomerView.parse({
      ref: r.ref, kind: r.kind, status, statusLabel: this.statusLabel(status, r.paymentStatus, locale), paymentStatus: r.paymentStatus, tripType: r.tripType, query: r.query,
      routeLabel: this.routeLabel(r.query, locale), firstTravelDate: r.firstTravelDate, submittedAt: r.submittedAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      snapshot: await this.snapshotView(r.offerSnapshotId, false),
      travellers: rt.map((t) => { const v = views.find((x) => x.id === t.travellerId); return { travellerId: t.travellerId, passengerType: t.passengerType, name: `${t.nameSnapshot.givenNames} ${t.nameSnapshot.surname}`, documentComplete: !!v?.documentComplete } }),
      timeline: await this.timeline(r, true, locale),
      messages: msgs.map(({ m, author }) => ({ id: m.id, direction: m.direction, body: m.body, authorName: m.direction === "TO_CUSTOMER" ? "Uni Travel" : (author ?? "You"), createdAt: m.createdAt.toISOString(), readAt: m.readAt?.toISOString() ?? null, documentIds: m.documentIds })),
      quotes: await this.quoteViews(r.id, false),
      reservation: res[0] && ["HELD", "CONFIRMED"].includes(res[0].status) ? { status: res[0].status, ticketingDeadline: res[0].ticketingDeadline.toISOString() } : null,
      tickets: tks.map((t) => ({ ticketNumber: t.ticketNumber, travellerName: rt.find((x) => x.travellerId === t.travellerId)?.nameSnapshot.surname ?? "", status: t.status, documentId: t.documentId, validatingCarrier: t.validatingCarrier })),
      documents: docs.filter((d) => d.visibility === "CUSTOMER").map((d) => ({ id: d.id, type: d.type, filename: d.filename, createdAt: d.createdAt.toISOString() })),
      actions: this.customerActions(r, f),
      truthBadge: status === "TICKETED" || status === "COMPLETED" ? "TICKET_ISSUED" : status === "RESERVED" ? "SEATS_RESERVED" : r.offerSnapshotId ? "SNAPSHOT" : "REQUEST",
    })
  }

  /** One screen per case (ch. 15.3): customer, request + snapshot + timeline, actions + records + notes. */
  async staffDetail(ref: string, actor: Actor) {
    const r = await this.byRef(ref)
    const f = await this.facts(this.db, r)
    const [u] = await this.db.select().from(users).where(eq(users.id, r.customerUserId))
    const [p] = await this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, r.customerUserId))
    const [contact] = await this.db.select().from(userIdentities).where(eq(userIdentities.id, r.contactIdentityId))
    const rt = await this.db.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
    const views = await this.customers.byIds(rt.map((t) => t.travellerId))
    const msgs = await this.db.select({ m: requestMessages, author: users.displayName }).from(requestMessages).leftJoin(users, eq(users.id, requestMessages.authorId)).where(and(eq(requestMessages.requestType, "FLIGHT"), eq(requestMessages.requestId, r.id))).orderBy(asc(requestMessages.createdAt))
    const notes = await this.db.select({ n: requestNotes, author: users.displayName }).from(requestNotes).leftJoin(users, eq(users.id, requestNotes.authorId)).where(and(eq(requestNotes.requestType, "FLIGHT"), eq(requestNotes.requestId, r.id))).orderBy(desc(requestNotes.createdAt))
    const contacts = await this.db.select({ c: contactAttempts, staff: users.displayName }).from(contactAttempts).leftJoin(users, eq(users.id, contactAttempts.staffId)).where(and(eq(contactAttempts.requestType, "FLIGHT"), eq(contactAttempts.requestId, r.id))).orderBy(desc(contactAttempts.createdAt))
    const res = await this.db.select().from(reservations).where(eq(reservations.requestId, r.id)).orderBy(desc(reservations.createdAt))
    const tks = await this.db.select().from(tickets).where(eq(tickets.requestId, r.id))
    const pays = await this.db.select().from(paymentRecords).where(and(eq(paymentRecords.requestType, "FLIGHT"), eq(paymentRecords.requestId, r.id))).orderBy(desc(paymentRecords.createdAt))
    const history = await this.db.select({ ref: flightRequests.ref, status: flightRequests.status, submittedAt: flightRequests.submittedAt }).from(flightRequests).where(and(eq(flightRequests.customerUserId, r.customerUserId), ne(flightRequests.id, r.id))).orderBy(desc(flightRequests.submittedAt)).limit(10)
    const cargoHistory = await this.db.select({ ref: cargoRequests.ref, status: cargoRequests.status, submittedAt: cargoRequests.submittedAt }).from(cargoRequests).where(eq(cargoRequests.customerUserId, r.customerUserId)).orderBy(desc(cargoRequests.submittedAt)).limit(10)
    const assignee = r.assigneeUserId ? (await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, r.assigneeUserId)))[0]?.n ?? null : null
    const docs = await this.documents.forRequest("FLIGHT", r.id, false)
    const after = await this.db.select().from(afterSalesCases).where(eq(afterSalesCases.originalRequestId, r.id)).orderBy(desc(afterSalesCases.createdAt))
    const overrides = await this.db.select().from(creditOverrides).where(eq(creditOverrides.requestId, r.id)).orderBy(desc(creditOverrides.createdAt))
    const names = new Map<string, string>()
    for (const id of new Set([...pays.flatMap((x) => [x.recordedBy, x.verifiedBy]), ...res.map((x) => x.recordedBy), ...overrides.flatMap((o) => [o.requestedBy, o.approvedBy])].filter(Boolean) as string[])) names.set(id, (await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, id)))[0]?.n ?? id)
    const threshold = this.config.get("WORKFLOW").paymentFourEyesThresholdMinor
    const [acceptedOpt] = await this.db.select({ total: quoteOptions.totalMinor, breakdown: quoteOptions.priceBreakdown }).from(quotes).innerJoin(quoteOptions, eq(quoteOptions.id, quotes.acceptedOptionId)).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).limit(1)
    const paymentRecording = paymentRecordingState({ product: "FLIGHT", status: r.status, atolMode: this.config.get("WORKFLOW").atolMode, acceptedTotal: acceptedOpt ? { amountMinor: acceptedOpt.total, currency: (acceptedOpt.breakdown as { total: { currency: string } }).total.currency } : null, recordedMinor: pays.filter((x) => x.status === "RECORDED" || x.status === "VERIFIED").reduce((n, x) => n + x.amountMinor, 0) })
    // The assignee is picked in the assign dialog, so its guard cannot be judged here; the command re-checks it.
    const actions = allowedCommands(FLIGHT_TRANSITIONS, { ...f, assigneeCanTransition: true }, staffActor(actor), ["claim", "assign", "request_info", "send_quote", "record_acceptance", "record_reservation", "record_tickets", "close", "reopen", "cancel", "decline"])
    return {
      ref: r.ref, id: r.id, kind: r.kind, status: r.status, paymentStatus: r.paymentStatus, version: r.version, tripType: r.tripType, query: r.query, manual: r.manual, preferences: r.preferences,
      customerNote: r.customerNote, urgent: r.urgent, firstTravelDate: r.firstTravelDate, submittedAt: r.submittedAt.toISOString(), submittedVia: r.submittedVia, submittedLocale: r.submittedLocale,
      routeLabel: this.routeLabel(r.query), statusLabel: this.statusLabel(r.status, r.paymentStatus, "en"),
      sla: { dueAt: r.slaDueAt?.toISOString() ?? null, firstContactAt: r.firstContactAt?.toISOString() ?? null, assignedAt: r.assignedAt?.toISOString() ?? null },
      assignee: r.assigneeUserId ? { id: r.assigneeUserId, name: assignee } : null,
      customer: {
        id: r.customerUserId, displayName: u?.displayName ?? "", nameLatin: p ? `${p.givenNamesLatin ?? ""} ${p.surnameLatin ?? ""}`.trim() : null, nameFa: p?.nameFa ?? null,
        preferredLocale: u?.preferredLocale, contactTimePref: p?.contactTimePref ?? (r.preferences as { bestTimeToCall?: string }).bestTimeToCall ?? null,
        phone: actor.permissions.has("customer.read.pii") ? r.contactPhoneSnapshot : `${r.contactPhoneSnapshot.slice(0, 3)}•••${r.contactPhoneSnapshot.slice(-2)}`,
        phoneVerified: r.contactPhoneVerified, phoneVerifiedAt: contact?.verifiedAt?.toISOString() ?? null, alternativeContact: r.alternativeContact,
        history: [...history.map((h) => ({ ...h, productType: "FLIGHT" })), ...cargoHistory.map((h) => ({ ...h, productType: "CARGO" }))].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()),
      },
      travellers: rt.map((t) => { const v = views.find((x) => x.id === t.travellerId); return { travellerId: t.travellerId, passengerType: t.passengerType, name: t.nameSnapshot, document: v?.document ?? null, documentComplete: !!v?.documentComplete, nationality: v?.nationality, verificationStatus: v?.verification.status ?? "UNVERIFIED" } }),
      snapshot: await this.snapshotView(r.offerSnapshotId, actor.permissions.has("pricing.read.internal")),
      timeline: await this.timeline(r, false, "en"),
      messages: msgs.map(({ m, author }) => ({ id: m.id, direction: m.direction, body: m.body, authorName: author ?? "Customer", createdAt: m.createdAt.toISOString(), readAt: m.readAt?.toISOString() ?? null, documentIds: m.documentIds })),
      notes: notes.map(({ n, author }) => ({ id: n.id, body: n.body, author, createdAt: n.createdAt.toISOString() })),
      contacts: contacts.map(({ c, staff }) => ({ id: c.id, channel: c.channel, outcome: c.outcome, note: c.note, callBackAt: c.callBackAt?.toISOString() ?? null, staff, createdAt: c.createdAt.toISOString() })),
      quotes: await this.quoteViews(r.id, true, actor.permissions.has("pricing.read.internal")),
      reservations: res.map((x) => ({ id: x.id, system: x.system, recordLocator: x.recordLocator, airlineLocators: x.airlineLocators, status: x.status, ticketingDeadline: x.ticketingDeadline.toISOString(), quoteOptionId: x.quoteOptionId, mismatchReason: x.mismatchReason, recordedBy: names.get(x.recordedBy) ?? x.recordedBy, createdAt: x.createdAt.toISOString() })),
      tickets: tks.map((t) => ({ id: t.id, travellerId: t.travellerId, travellerName: (() => { const n = rt.find((x) => x.travellerId === t.travellerId)?.nameSnapshot; return n ? `${n.givenNames} ${n.surname}` : "" })(), ticketNumber: t.ticketNumber, validatingCarrier: t.validatingCarrier, issueDate: t.issueDate, status: t.status, documentId: t.documentId })),
      payments: pays.map((x) => ({ id: x.id, amount: { amountMinor: x.amountMinor, currency: x.currency }, method: x.method, receivedAt: x.receivedAt.toISOString(), externalReference: x.externalReference, payerName: x.payerName, status: x.status, recordedBy: x.recordedBy ? names.get(x.recordedBy) ?? x.recordedBy : "System (card payment)", verifiedBy: x.verifiedBy ? names.get(x.verifiedBy) ?? x.verifiedBy : null, needsSecondVerifier: x.status === "RECORDED" && x.amountMinor > threshold })),
      documents: docs.map((d) => ({ id: d.id, type: d.type, filename: d.filename, visibility: d.visibility, createdAt: d.createdAt.toISOString() })),
      afterSales: after.map((c) => ({ ref: c.ref, type: c.type, status: c.status, note: c.note, resolutionNote: c.resolutionNote, ticketIds: c.ticketIds, createdAt: c.createdAt.toISOString() })),
      creditOverrides: overrides.map((o) => ({ id: o.id, reason: o.reason, requestedBy: names.get(o.requestedBy) ?? o.requestedBy, requestedById: o.requestedBy, requestedByMe: o.requestedBy === actor.userId, approvedBy: o.approvedBy ? names.get(o.approvedBy) ?? o.approvedBy : null, approvedById: o.approvedBy ?? null, approvedAt: o.approvedAt?.toISOString() ?? null, createdAt: o.createdAt.toISOString() })),
      compliance: await this.compliance.casesForRequest("FLIGHT", r.id),
      actions,
      paymentRecording,
      atolMode: this.config.get("WORKFLOW").atolMode,
    }
  }

  async adminList(q: { tab?: string; status?: string; assignee?: string; q?: string; from?: string; to?: string; limit: number; cursor?: string; flags?: string }, actor: Actor) {
    const conds = []
    const tabStatus: Record<string, FlightRequestStatus[]> = { new: ["NEW"], awaiting: ["AWAITING_CUSTOMER"], quoted: ["QUOTED"], reserved: ["RESERVED", "ACCEPTED"], hold: ["COMPLIANCE_HOLD"], open: ["NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED", "COMPLIANCE_HOLD", "SUBMITTED"] }
    if (q.tab === "mine") conds.push(eq(flightRequests.assigneeUserId, actor.userId), inArray(flightRequests.status, tabStatus.open!))
    else if (q.tab && tabStatus[q.tab]) conds.push(inArray(flightRequests.status, tabStatus[q.tab]!))
    if (q.status) conds.push(eq(flightRequests.status, q.status as FlightRequestStatus))
    if (q.assignee) conds.push(eq(flightRequests.assigneeUserId, q.assignee))
    if (q.from) conds.push(sql`${flightRequests.firstTravelDate} >= ${q.from}`)
    if (q.to) conds.push(sql`${flightRequests.firstTravelDate} <= ${q.to}`)
    if (q.flags === "urgent") conds.push(eq(flightRequests.urgent, true))
    if (q.q) {
      const ref = normaliseReference(q.q)
      // Console search is case-insensitive (ch. 13.4).
      conds.push(ref ? eq(flightRequests.ref, ref) : or(ilike(flightRequests.ref, `%${q.q.toUpperCase()}%`), ilike(flightRequests.contactPhoneSnapshot, `%${q.q.replace(/\s/g, "")}%`)))
    }
    if (q.cursor) conds.push(lt(flightRequests.submittedAt, new Date(q.cursor)))
    // Sorted by SLA risk by default (ch. 15.2): due soonest first, then newest.
    const rows = await this.db.select({ r: flightRequests, name: users.displayName }).from(flightRequests).leftJoin(users, eq(users.id, flightRequests.customerUserId)).where(conds.length ? and(...conds) : undefined)
      .orderBy(sql`${flightRequests.slaDueAt} asc nulls last`, desc(flightRequests.submittedAt)).limit(q.limit + 1)
    const assignees = new Map<string, string>()
    for (const id of new Set(rows.map((x) => x.r.assigneeUserId).filter(Boolean) as string[])) assignees.set(id, (await this.db.select({ n: users.displayName }).from(users).where(eq(users.id, id)))[0]?.n ?? "")
    return {
      items: rows.slice(0, q.limit).map(({ r, name }) => ({ ref: r.ref, kind: r.kind, status: r.status, paymentStatus: r.paymentStatus, routeLabel: this.routeLabel(r.query), customer: name, travellers: r.query.passengers.length, firstTravelDate: r.firstTravelDate, urgent: r.urgent, slaDueAt: r.slaDueAt?.toISOString() ?? null, slaBreached: !!r.slaDueAt && r.slaDueAt < new Date() && ["NEW", "SUBMITTED"].includes(r.status), assignee: r.assigneeUserId ? assignees.get(r.assigneeUserId) ?? null : null, submittedAt: r.submittedAt.toISOString(), hasSnapshot: !!r.offerSnapshotId })),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.r.submittedAt.toISOString() : null,
    }
  }

  async queueSummary(actor: Actor) {
    const counts = await this.db.select({ status: flightRequests.status, n: sql<number>`count(*)::int` }).from(flightRequests).groupBy(flightRequests.status)
    const c = (s: string) => counts.find((x) => x.status === s)?.n ?? 0
    const [{ breaches } = { breaches: 0 }] = await this.db.select({ breaches: sql<number>`count(*)::int` }).from(flightRequests).where(and(inArray(flightRequests.status, ["NEW", "SUBMITTED"]), lt(flightRequests.slaDueAt, new Date())))
    const [{ mine } = { mine: 0 }] = await this.db.select({ mine: sql<number>`count(*)::int` }).from(flightRequests).where(and(eq(flightRequests.assigneeUserId, actor.userId), inArray(flightRequests.status, ["IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED"])))
    const deadlines = await this.db.select({ ref: flightRequests.ref, deadline: reservations.ticketingDeadline }).from(reservations).innerJoin(flightRequests, eq(flightRequests.id, reservations.requestId)).where(and(inArray(reservations.status, ["HELD", "CONFIRMED"]), sql`${reservations.ticketingDeadline} < now() + interval '24 hours'`, eq(flightRequests.status, "RESERVED")))
    return { new: c("NEW"), mine, awaitingCustomer: c("AWAITING_CUSTOMER"), quoted: c("QUOTED"), reserved: c("RESERVED") + c("ACCEPTED"), complianceHolds: c("COMPLIANCE_HOLD"), slaBreaches: breaches, deadlinesNext24h: deadlines.map((d) => ({ ref: d.ref, deadline: d.deadline.toISOString() })) }
  }

  /** Current ref and row version of a flight or cargo request, for the console's "someone else changed this" signal. */
  async refVersion(aggregateType: string, id: string): Promise<StaffRequestChangedEvent | null> {
    if (aggregateType === "flight_request") {
      const [r] = await this.db.select({ ref: flightRequests.ref, version: flightRequests.version, status: flightRequests.status, paymentStatus: flightRequests.paymentStatus }).from(flightRequests).where(eq(flightRequests.id, id))
      return r ? { requestType: "FLIGHT", ref: r.ref, version: r.version, status: r.status, statusLabel: this.statusLabel(r.status, r.paymentStatus, "en") } : null
    }
    if (aggregateType === "cargo_request") {
      const [r] = await this.db.select({ ref: cargoRequests.ref, version: cargoRequests.version, status: cargoRequests.status }).from(cargoRequests).where(eq(cargoRequests.id, id))
      return r ? { requestType: "CARGO", ref: r.ref, version: r.version, status: r.status, statusLabel: this.config.get("WORKFLOW").statusLabels.cargo[r.status].en } : null
    }
    return null
  }

  async documentsOf(requestId: string) {
    return this.db.select().from(documents).where(and(eq(documents.requestType, "FLIGHT"), eq(documents.requestId, requestId)))
  }
}

export function optionUnknowns(o: { itinerary: unknown; baggage: unknown; conditions: unknown }): string[] {
  const slices = (o.itinerary as { slices?: { segments: unknown[] }[] }).slices ?? []
  const segmentCount = slices.reduce((n, s) => n + s.segments.length, 0)
  return unknownQuoteFields({ segmentCount, baggage: o.baggage as never, conditions: o.conditions as never })
}
