import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray } from "drizzle-orm"

import type { PaymentBody, ReservationBody } from "@unitravel/contracts"
import {
  afterSalesCases, creditOverrides, type Db, documents, flightRequests, paymentRecords, quoteOptions, quotes, requestStatusHistory, requestTravellers,
  reservationSegments, reservations, tickets, type Tx,
} from "@unitravel/db"
import { AFTER_SALES_TRANSITIONS, atolAllowsPayment, evaluate, generateReference, needsSecondVerifier, normaliseReference, validateTicketNumber } from "@unitravel/domain"
import { flightKey } from "@unitravel/engine"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { DocumentsService } from "../documents/documents.service"
import { renderPdf } from "../documents/pdf"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { RequestsService, staffActor, SYSTEM } from "../requests/requests.service"

type Req = typeof flightRequests.$inferSelect

/**
 * Version 1 records what staff did in the agency terminal (ch. 13.7): reservations, tickets and offline payments,
 * validated against the accepted option, the carriers' accounting codes and the ATOL mode.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly requests: RequestsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly compliance: ComplianceService,
    private readonly reference: ReferenceService,
    private readonly docs: DocumentsService,
  ) {}

  private async acceptedOption(tx: Tx, r: Req) {
    const [row] = await tx.select({ o: quoteOptions }).from(quotes).innerJoin(quoteOptions, eq(quoteOptions.id, quotes.acceptedOptionId)).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).limit(1)
    return row?.o
  }

  async recordReservation(ref: string, body: ReservationBody, actor: Actor, expectedVersion: number | undefined, requestId: string) {
    return this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx, true)
      const opt = await this.acceptedOption(tx, r)
      if (!opt || opt.id !== body.quoteOptionId) throw new AppError("VALIDATION_FAILED", "The reservation must refer to the accepted option", [{ path: "quoteOptionId", code: "NOT_ACCEPTED" }])
      const rt = await tx.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
      const passengersMatch = rt.length === body.travellerIds.length && rt.every((t) => body.travellerIds.includes(t.travellerId))
      const accepted = (opt.itinerary as { slices: { segments: Parameters<typeof flightKey>[0] }[] }).slices
      const segmentsMatch = accepted.map((s) => flightKey(s.segments)).join("#") === body.slices.map((s) => flightKey(s.segments)).join("#")
      const updated = await this.requests.transition(tx, r, "record_reservation", staffActor(actor), {
        expectedVersion, ip: actor.ip, requestId,
        facts: { reservation: { recordLocator: body.recordLocator, ticketingDeadline: new Date(body.ticketingDeadline), passengersMatch, segmentsMatch, mismatchReason: body.mismatchReason } },
      })
      const [res] = await tx.insert(reservations).values({ requestId: r.id, system: body.system, recordLocator: body.recordLocator, airlineLocators: body.airlineLocators, status: body.status, ticketingDeadline: new Date(body.ticketingDeadline), quoteOptionId: body.quoteOptionId, travellerIds: body.travellerIds, segments: body.slices, mismatchReason: body.mismatchReason ?? null, recordedBy: actor.userId }).returning()
      const segRows = body.slices.flatMap((s, si) => s.segments.map((g, gi) => ({ reservationId: res!.id, sliceIndex: si, segmentIndex: gi, carrier: g.marketing.carrier, flightNumber: g.marketing.flightNumber, origin: g.origin.iata, destination: g.destination.iata, departureUtc: new Date(g.departure.utc) })))
      if (segRows.length) await tx.insert(reservationSegments).values(segRows)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "reservation.recorded", entityType: "reservation", entityId: res!.id, contextRef: r.ref, after: { system: body.system, recordLocator: body.recordLocator, deadline: body.ticketingDeadline, passengersMatch, segmentsMatch } })
      await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "reservation.recorded", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, deadline: body.ticketingDeadline } })
      return updated
    })
  }

  async cancelReservation(ref: string, reservationId: string, reason: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx)
      const [res] = await tx.select().from(reservations).where(and(eq(reservations.id, reservationId), eq(reservations.requestId, r.id)))
      if (!res) throw notFound("Reservation")
      await tx.update(reservations).set({ status: "CANCELLED" }).where(eq(reservations.id, res.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "reservation.cancelled", entityType: "reservation", entityId: res.id, contextRef: r.ref, after: { reason } })
      return { ok: true }
    })
  }

  /** Payer screening at recording time; any hit stops the payment and opens a case (ch. 27.1). */
  private async screenPayer(tx: Tx, r: Req, payerName: string) {
    const s = await this.compliance.screen(tx, { subjectType: "PAYER", subjectRef: `${r.id}:${payerName}`, name: payerName, contextRef: r.ref })
    if (s.result !== "CLEAR") {
      await this.compliance.openCase(tx, { requestType: "FLIGHT", requestId: r.id, requestRef: r.ref, trigger: "SCREENING", summary: "Payer needs a compliance decision", evidence: s.hits.map((h) => ({ kind: "PAYER_MATCH", label: `${payerName} ↔ ${h.matchedName}`, detail: `${h.listId} ${h.externalId}`, score: h.score })), screeningIds: [s.screeningId] })
    }
    return s
  }

  private async insertPayment(tx: Tx, r: Req, p: PaymentBody, actor: Actor) {
    const s = await this.screenPayer(tx, r, p.payerName)
    if (s.result !== "CLEAR") return { blocked: true as const, screeningId: s.screeningId }
    const threshold = this.config.get("WORKFLOW").paymentFourEyesThresholdMinor
    const four = needsSecondVerifier(p.amount.amountMinor, threshold)
    if (p.evidenceDocumentId) {
      const [d] = await tx.select().from(documents).where(eq(documents.id, p.evidenceDocumentId))
      if (!d) throw notFound("Evidence document")
      await tx.update(documents).set({ requestType: "FLIGHT", requestId: r.id }).where(eq(documents.id, d.id))
    }
    const [row] = await tx.insert(paymentRecords).values({
      requestType: "FLIGHT", requestId: r.id, amountMinor: p.amount.amountMinor, currency: p.amount.currency, method: p.method, receivedAt: new Date(p.receivedAt), externalReference: p.externalReference,
      payerName: p.payerName, payerScreeningId: s.screeningId, evidenceDocumentId: p.evidenceDocumentId ?? null,
      // Above the threshold a different staff member must verify (ch. 13.7); below it the recording counts as verified.
      status: four ? "RECORDED" : "VERIFIED", recordedBy: actor.userId, verifiedBy: four ? null : actor.userId, verifiedAt: four ? null : new Date(),
    }).returning()
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payment.recorded", entityType: "payment_record", entityId: row!.id, contextRef: r.ref, after: { amount: p.amount, method: p.method, fourEyes: four } })
    await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "payment.recorded", payload: { requestId: r.id, ref: r.ref, paymentId: row!.id } })
    return { blocked: false as const, payment: row!, fourEyes: four }
  }

  /** ATOL certificate at first payment when selling as agent for an ATOL holder or under Uni Travel's own ATOL (ch. 27.6). */
  private async maybeAtolCertificate(tx: Tx, r: Req, actor: Actor) {
    const wf = this.config.get("WORKFLOW")
    if (wf.atolMode === "PAY_ON_TICKETING") return
    const prior = await tx.select().from(paymentRecords).where(and(eq(paymentRecords.requestType, "FLIGHT"), eq(paymentRecords.requestId, r.id)))
    if (prior.length !== 1) return
    const holder = wf.atolHolder ?? { name: "Uni Travel Ltd", number: "ATOL pending" }
    const pdf = await renderPdf("ATOL Certificate", `${r.ref} · issued ${new Date().toISOString().slice(0, 10)}`, [{ rows: [["ATOL holder", holder.name], ["ATOL number", holder.number], ["Mode", wf.atolMode], ["Reference", r.ref]] }, { paragraphs: ["This certificate confirms ATOL protection for the flight-inclusive arrangements listed in your booking, as issued by the ATOL holder named above. Template supplied by the ATOL holder; wording to be confirmed by counsel."] }], ["Uni Travel Ltd · ATOL wording pending counsel review (ch. 4.8 question 6)"])
    await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "FLIGHT", requestId: r.id, type: "RECEIPT", filename: `ATOL-certificate-${r.ref}.pdf`, body: pdf, createdBy: actor.userId, visibility: "CUSTOMER" })
  }

  async recordPayment(ref: string, body: PaymentBody, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx, true)
      const stage = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED"].includes(r.status) ? "BEFORE_RESERVATION" : "RESERVED"
      if (!["ACCEPTED", "RESERVED", "TICKETED"].includes(r.status)) throw new AppError("INVALID_TRANSITION", "Payments are recorded after a quote is accepted")
      const atol = atolAllowsPayment(this.config.get("WORKFLOW").atolMode, stage === "BEFORE_RESERVATION" ? "BEFORE_RESERVATION" : "RESERVED")
      if (!atol.ok && r.status !== "TICKETED") throw new AppError("ATOL_PAYMENT_NOT_ALLOWED", atol.reason)
      const res = await this.insertPayment(tx, r, body, actor)
      if (res.blocked) throw new AppError("FORBIDDEN", "The payer needs a compliance decision before this payment can be recorded", undefined, { screeningId: res.screeningId })
      await this.requests.recomputePaymentStatus(tx, r)
      await this.maybeAtolCertificate(tx, r, actor)
      return { paymentId: res.payment.id, status: res.payment.status, needsSecondVerifier: res.fourEyes }
    })
  }

  /** Second-person verification; completes a ticketing step that was waiting for it (PAY_ON_TICKETING above threshold). */
  async verifyPayment(paymentId: string, actor: Actor, requestId: string) {
    return this.uow.run(async (tx) => {
      const [p] = await tx.select().from(paymentRecords).where(eq(paymentRecords.id, paymentId)).for("update")
      if (!p) throw notFound("Payment")
      if (p.status !== "RECORDED") throw new AppError("INVALID_TRANSITION", `Payment is ${p.status}`)
      if (p.recordedBy === actor.userId) throw new AppError("FOUR_EYES_REQUIRED", "A different staff member must verify this payment")
      await tx.update(paymentRecords).set({ status: "VERIFIED", verifiedBy: actor.userId, verifiedAt: new Date() }).where(eq(paymentRecords.id, p.id))
      const [r] = await tx.select().from(flightRequests).where(eq(flightRequests.id, p.requestId)).for("update")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payment.verified", entityType: "payment_record", entityId: p.id, contextRef: r?.ref })
      await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: p.requestId, eventType: "payment.verified", payload: { requestId: p.requestId, paymentId: p.id } })
      if (!r) return { ok: true }
      const ps = await this.requests.recomputePaymentStatus(tx, r)
      const fresh = { ...r, paymentStatus: ps }
      if (r.status === "RESERVED") {
        const f = await this.requests.facts(tx, fresh)
        if (f.ticketsIssuedForEveryTraveller && ps === "PAID") await this.completeTicketing(tx, fresh, actor, requestId)
      }
      return { ok: true, paymentStatus: ps }
    })
  }

  private async completeTicketing(tx: Tx, r: Req, actor: Actor, requestId: string) {
    const updated = await this.requests.transition(tx, r, "record_tickets", staffActor(actor), { requestId, ip: actor.ip })
    const tks = await tx.select().from(tickets).where(and(eq(tickets.requestId, r.id), eq(tickets.status, "ISSUED")))
    const opt = await this.acceptedOption(tx, r)
    const segs = ((opt?.itinerary as { slices?: { segments: { departure: { utc: string } }[] }[] })?.slices ?? []).flatMap((s) => s.segments)
    await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "ticket.recorded", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, ticketNumbers: tks.map((t) => t.ticketNumber), lastDeparture: segs.at(-1)?.departure.utc } })
    return updated
  }

  /**
   * record_tickets (Table 13.1): one ISSUED ticket per traveller, 13 digits with the validating carrier's prefix, and
   * payment PAID or an owner-approved credit override. In PAY_ON_TICKETING mode the payment is recorded in this step.
   */
  async recordTickets(ref: string, body: { reservationId: string; tickets: { travellerId: string; ticketNumber: string; validatingCarrier: string; issueDate: string; coupons: unknown[]; receiptDocumentId?: string }[]; payment?: PaymentBody; creditOverride?: { reason: string } }, actor: Actor, expectedVersion: number | undefined, requestId: string) {
    return this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx, true)
      if (expectedVersion !== undefined && expectedVersion !== r.version) throw new AppError("VERSION_CONFLICT", "Request changed; reload")
      if (r.status !== "RESERVED") throw new AppError("INVALID_TRANSITION", `record_tickets is not allowed from ${r.status}`)
      const [res] = await tx.select().from(reservations).where(and(eq(reservations.id, body.reservationId), eq(reservations.requestId, r.id)))
      if (!res || !["HELD", "CONFIRMED"].includes(res.status)) throw new AppError("VALIDATION_FAILED", "Choose the active reservation", [{ path: "reservationId", code: "INVALID" }])
      const rt = await tx.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
      const errors: { path: string; code: string; message: string }[] = []
      body.tickets.forEach((t, i) => {
        if (!rt.some((x) => x.travellerId === t.travellerId)) errors.push({ path: `tickets[${i}].travellerId`, code: "NOT_ON_REQUEST", message: "Traveller is not on this request" })
        const v = validateTicketNumber(t.ticketNumber, this.reference.airline(t.validatingCarrier)?.accountingCode)
        if (!v.ok) errors.push({ path: `tickets[${i}].ticketNumber`, code: "INVALID_TICKET", message: v.reason })
      })
      if (new Set(body.tickets.map((t) => t.travellerId)).size !== body.tickets.length) errors.push({ path: "tickets", code: "DUPLICATE_TRAVELLER", message: "One ticket per traveller" })
      if (errors.length) throw new AppError("VALIDATION_FAILED", errors[0]!.message, errors)
      const existing = body.tickets.length ? await tx.select().from(tickets).where(inArray(tickets.ticketNumber, body.tickets.map((t) => t.ticketNumber))) : []
      if (existing.length) throw new AppError("VALIDATION_FAILED", `Ticket ${existing[0]!.ticketNumber} is already recorded`)
      const wf = this.config.get("WORKFLOW")
      let fourEyesPending = false
      if (body.payment) {
        const p = await this.insertPayment(tx, r, body.payment, actor)
        if (p.blocked) throw new AppError("FORBIDDEN", "The payer needs a compliance decision first")
        fourEyesPending = p.fourEyes
      } else if (wf.atolMode === "PAY_ON_TICKETING" && r.paymentStatus !== "PAID" && !body.creditOverride) {
        throw new AppError("ATOL_PAYMENT_NOT_ALLOWED", "PAY_ON_TICKETING: record the payment in this step, or an owner-approved credit override")
      }
      if (body.creditOverride) {
        const approved = await tx.select().from(creditOverrides).where(eq(creditOverrides.requestId, r.id))
        if (!approved.some((o) => o.approvedBy)) throw new AppError("FOUR_EYES_REQUIRED", "A credit override needs an owner's approval first")
      }
      for (const t of body.tickets) {
        if (t.receiptDocumentId) await this.docs.publish(tx, t.receiptDocumentId)
        await tx.insert(tickets).values({ requestId: r.id, reservationId: res.id, travellerId: t.travellerId, ticketNumber: t.ticketNumber, validatingCarrier: t.validatingCarrier, issueDate: t.issueDate, coupons: t.coupons, documentId: t.receiptDocumentId ?? null, recordedBy: actor.userId })
        if (t.receiptDocumentId) await tx.update(documents).set({ requestType: "FLIGHT", requestId: r.id, ownerUserId: r.customerUserId, type: "E_TICKET_RECEIPT" }).where(eq(documents.id, t.receiptDocumentId))
      }
      await tx.update(reservations).set({ status: "CONFIRMED" }).where(eq(reservations.id, res.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "tickets.recorded", entityType: "flight_request", entityId: r.id, contextRef: r.ref, after: { tickets: body.tickets.map((t) => t.ticketNumber), fourEyesPending } })
      const ps = await this.requests.recomputePaymentStatus(tx, r)
      if (fourEyesPending) return { status: "RESERVED", awaitingPaymentVerification: true, message: "Tickets recorded; a second staff member must verify the payment to complete ticketing" }
      const updated = await this.completeTicketing(tx, { ...r, paymentStatus: ps }, actor, requestId)
      return { status: updated.status, awaitingPaymentVerification: false }
    })
  }

  async requestCreditOverride(ref: string, reason: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.requests.byRef(ref, tx)
      const [o] = await tx.insert(creditOverrides).values({ requestId: r.id, reason, requestedBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "credit_override.requested", entityType: "credit_override", entityId: o!.id, contextRef: r.ref, after: { reason } })
      return o
    })
  }

  async approveCreditOverride(id: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const [o] = await tx.select().from(creditOverrides).where(eq(creditOverrides.id, id))
      if (!o) throw notFound("Override")
      if (o.requestedBy === actor.userId) throw new AppError("FOUR_EYES_REQUIRED", "Another person must approve")
      await tx.update(creditOverrides).set({ approvedBy: actor.userId, approvedAt: new Date() }).where(eq(creditOverrides.id, id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "credit_override.approved", entityType: "credit_override", entityId: id })
      return { ok: true }
    })
  }

  // ---------------- after-sales (ch. 13.8) ----------------

  async createAfterSales(ref: string, body: { type: "CHANGE" | "REFUND" | "CANCEL"; ticketIds: string[]; note: string }, actor: Actor, byCustomer: boolean) {
    return this.uow.run(async (tx) => {
      const r = byCustomer ? await this.requests.ownedByRef(ref, actor.userId, tx) : await this.requests.byRef(ref, tx)
      if (!["TICKETED", "COMPLETED"].includes(r.status)) throw new AppError("INVALID_TRANSITION", "After-sales requests need issued tickets")
      const tks = await tx.select().from(tickets).where(and(eq(tickets.requestId, r.id), inArray(tickets.id, body.ticketIds)))
      if (tks.length !== body.ticketIds.length) throw notFound("Ticket")
      let asRef = generateReference("A")
      for (let i = 0; i < 5 && (await tx.select().from(afterSalesCases).where(eq(afterSalesCases.ref, asRef))).length; i++) asRef = generateReference("A")
      const [c] = await tx.insert(afterSalesCases).values({ ref: asRef, originalRequestId: r.id, customerUserId: r.customerUserId, type: body.type, ticketIds: body.ticketIds, note: body.note, assigneeUserId: r.assigneeUserId }).returning()
      await tx.insert(requestStatusHistory).values({ requestType: "AFTER_SALES", requestId: c!.id, fromStatus: null, toStatus: "OPEN", command: "open", actorUserId: actor.userId, actorKind: byCustomer ? "CUSTOMER" : "STAFF" })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: byCustomer ? "CUSTOMER" : "STAFF", action: "after_sales.opened", entityType: "after_sales_case", entityId: c!.id, contextRef: asRef, after: { original: r.ref, type: body.type } })
      await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "flight_request.message", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, direction: "FROM_CUSTOMER", message: `After-sales ${body.type} opened: ${asRef}` } })
      return { ref: asRef, status: "OPEN", originalRef: r.ref, type: body.type }
    })
  }

  async afterSalesCommand(asRef: string, command: "start" | "request_info" | "respond" | "resolve" | "reject", body: { message?: string; resolutionNote?: string; ticketStatus?: "EXCHANGED" | "REFUNDED" | "VOIDED" }, actor: Actor, byCustomer: boolean) {
    return this.uow.run(async (tx) => {
      const norm = normaliseReference(asRef)
      const [c] = norm ? await tx.select().from(afterSalesCases).where(eq(afterSalesCases.ref, norm)).for("update") : []
      if (!c || (byCustomer && c.customerUserId !== actor.userId)) throw notFound("After-sales case")
      const ev = evaluate(AFTER_SALES_TRANSITIONS, command, { status: c.status, message: body.message, resolutionNote: body.resolutionNote }, byCustomer ? { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true } : staffActor(actor))
      if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
      await tx.update(afterSalesCases).set({ status: ev.to, resolutionNote: body.resolutionNote ?? c.resolutionNote, version: c.version + 1 }).where(eq(afterSalesCases.id, c.id))
      // History is never rewritten: the original request stays TICKETED; tickets move to EXCHANGED/REFUNDED/VOIDED.
      if (command === "resolve" && body.ticketStatus) await tx.update(tickets).set({ status: body.ticketStatus }).where(inArray(tickets.id, c.ticketIds))
      await tx.insert(requestStatusHistory).values({ requestType: "AFTER_SALES", requestId: c.id, fromStatus: ev.from, toStatus: ev.to, command, actorUserId: actor.userId, actorKind: byCustomer ? "CUSTOMER" : "STAFF", reasonText: body.resolutionNote ?? body.message })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: byCustomer ? "CUSTOMER" : "STAFF", action: `after_sales.${command}`, entityType: "after_sales_case", entityId: c.id, contextRef: c.ref, after: { to: ev.to, ticketStatus: body.ticketStatus } })
      return { ref: c.ref, status: ev.to }
    })
  }

  async afterSalesFor(requestId: string) {
    return this.db.select().from(afterSalesCases).where(eq(afterSalesCases.originalRequestId, requestId)).orderBy(desc(afterSalesCases.createdAt))
  }

  /** Quote PDF published to the customer when a quote is sent (ch. 14.9 / 15.5). */
  async quotePdf(tx: Tx, r: Req, quoteId: string, actor: Actor) {
    const opts = await tx.select().from(quoteOptions).where(eq(quoteOptions.quoteId, quoteId))
    const [q] = await tx.select().from(quotes).where(eq(quotes.id, quoteId))
    const money = (m: { amountMinor: number; currency: string }) => `${m.currency} ${(m.amountMinor / 100).toFixed(2)}`
    const pdf = await renderPdf(`Your travel options · ${r.ref}`, `Valid until ${q?.validUntil?.toISOString().slice(0, 16).replace("T", " ")} UTC`, opts.map((o, i) => {
      const segs = ((o.itinerary as { slices: { segments: { marketing: { carrier: string; flightNumber: string }; origin: { iata: string }; destination: { iata: string }; departure: { local: string } }[] }[] }).slices).flatMap((s) => s.segments)
      const pb = o.priceBreakdown as { fare: { amountMinor: number; currency: string }; taxes: { amountMinor: number; currency: string }; serviceFee: { amountMinor: number; currency: string }; total: { amountMinor: number; currency: string } }
      return { heading: `Option ${i + 1} · ${o.label}`, rows: [...segs.map((g) => [`${g.marketing.carrier}${g.marketing.flightNumber}`, `${g.origin.iata} → ${g.destination.iata} · ${g.departure.local.replace("T", " ")} local`] as [string, string]), ["Ticketing", o.ticketingModel === "SINGLE_TICKET" ? "Single ticket (protected connections)" : "Separate tickets (self-transfer)"], ["Fare + taxes", `${money(pb.fare)} + ${money(pb.taxes)}`], ["Service fee", money(pb.serviceFee)], ["Total", money(pb.total)]] }
    }), ["This is a quote, not a booking: seats are reserved only after you accept and our team confirms the reservation.", this.config.get("WORKFLOW").atolMode === "PAY_ON_TICKETING" ? "Flights are sold as an airline ticket agent: payment is taken only when tickets are issued; this flight is not ATOL protected (wording pending counsel review)." : "ATOL protection details are provided with your ATOL Certificate."])
    await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "FLIGHT", requestId: r.id, type: "QUOTE_PDF", filename: `quote-${r.ref}-v${q?.version}.pdf`, body: pdf, createdBy: actor.userId, visibility: "CUSTOMER" })
  }

  systemActor() {
    return SYSTEM
  }
}
