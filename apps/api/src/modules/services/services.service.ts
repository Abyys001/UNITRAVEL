import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, lt, max, ne, sql } from "drizzle-orm"

import {
  type CreateServiceRequestBody, CustomerServiceQuoteView, type CustomerServiceRequestView, type PublicTrackView, SERVICE_COMMANDS, SERVICE_TYPE_FLAG, type ServiceCommand, ServiceCommandBodies, type ServiceQuoteLine,
  type ServiceQuoteView, type ServiceRequestStatus, type ServiceRequestSummary, type ServiceRequestType, type StaffServiceRequestPage, type StaffServiceRequestView, serviceQuoteTotal,
} from "@unitravel/contracts"
import {
  complianceCases, customerProfiles, type Db, type DbOrTx, flightRequests, quotes, requestMessages, requestStatusHistory, serviceRequests, travellers, type Tx, userIdentities, users,
} from "@unitravel/db"
import {
  allowedCommands, evaluate, generateReference, type MachineActor, normaliseReference, SERVICE_TRANSITIONS, type ServiceCommandName, type ServiceFacts, isServiceTerminal,
} from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { NEUTRAL_DECLINE, neutralDeclineForUser } from "../compliance/customer-messages"
import { ConfigService } from "../config/config.service"
import { CustomersService } from "../customers/customers.service"
import { DocumentsService } from "../documents/documents.service"
import { renderQuotationPdf } from "../invoices/commercial-pdf"
import { DocumentNumbersService } from "../invoices/document-numbers.service"
import { customerZone, docLabels, formatValidity } from "../invoices/quotation-content"
import { addBusinessMinutes } from "../platform/business-hours"
import { OutboxService } from "../platform/outbox.service"
import { TimersService } from "../platform/timers.service"
import { staffActor, SYSTEM } from "../requests/requests.service"
import { validateClubDiscountLines } from "./club-discount.hook"
import { SERVICE_STATUS_LABELS, SERVICE_TYPE_LABELS, serviceTitle } from "./service-labels"
import { servicePolicyKeys } from "./service-policy"

type Row = typeof serviceRequests.$inferSelect
type Locale = "en" | "fa"

const QUOTE_EXPIRY = "sr.quote_expiry"
/** Statuses the customer sees as "Received": a compliance hold is never disclosed (ch. 27.5). */
const customerStatus = (s: ServiceRequestStatus): ServiceRequestStatus => (s === "COMPLIANCE_HOLD" ? "SUBMITTED" : s)
const BEFORE_CONFIRMED: ServiceRequestStatus[] = ["SUBMITTED", "COMPLIANCE_HOLD", "IN_PROGRESS", "QUOTED"]
const STAFF_COMMANDS = ["claim", "assign", "send_quote", "record_acceptance", "complete", "cancel", "decline", "release_hold"] as const satisfies readonly ServiceCommandName[]
const iso = (d: Date | null) => d?.toISOString() ?? null

/**
 * Service requests (ADR-0015, spec section 4.2): visa, tour call-back, airport CIP, insurance and, later, hotel, stay,
 * train and bus requests. A request is a case, not a sale: staff quote, the customer accepts, staff complete. Every status
 * change runs SERVICE_TRANSITIONS inside one transaction with the history row, audit entry and outbox event.
 */
@Injectable()
export class ServicesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly compliance: ComplianceService,
    private readonly access: AccessService,
    private readonly customers: CustomersService,
    private readonly docs: DocumentsService,
    private readonly timers: TimersService,
    private readonly numbers: DocumentNumbersService,
  ) {}

  onModuleInit() {
    this.compliance.onScreenRequest("service_request.submitted", (id) => this.screen(id))
    this.compliance.onOutcome("SERVICE", async (tx, id, o) => {
      const [r] = await tx.select().from(serviceRequests).where(eq(serviceRequests.id, id)).for("update")
      if (!r) return
      const officer: MachineActor = { kind: "STAFF", userId: o.actorUserId, permissions: new Set(["compliance.case.decide"]) }
      if (o.decision === "RELEASE" && r.status === "COMPLIANCE_HOLD") await this.transition(tx, r, "release_hold", officer, { facts: { reason: o.reason }, reasonText: o.reason })
      if (o.decision === "DECLINE") {
        const msg = o.customerMessage || await neutralDeclineForUser(tx, r.customerUserId)
        await this.transition(tx, r, "decline", officer, { facts: { reason: o.reason }, reasonCode: o.reasonCode ?? "COMPLIANCE", reasonText: o.reason, message: msg })
        await tx.insert(requestMessages).values({ requestType: "SERVICE", requestId: r.id, authorId: o.actorUserId, direction: "TO_CUSTOMER", body: msg })
      }
    })
    this.timers.onEvent("service_request.transitioned", async (e) => {
      const p = e.payload as { requestId: string; to: string }
      if (p.to === "QUOTED") {
        const q = await this.latestSentQuote(this.db, p.requestId)
        if (q?.validUntil) await this.timers.schedule(QUOTE_EXPIRY, `sr:${p.requestId}`, q.validUntil, { requestId: p.requestId })
      }
    })
    this.timers.onReconcile(async () => {
      const open = await this.db.select({ id: serviceRequests.id }).from(serviceRequests).where(eq(serviceRequests.status, "QUOTED"))
      let added = 0
      for (const r of open) {
        const q = await this.latestSentQuote(this.db, r.id)
        if (q?.validUntil && await this.timers.ensure(QUOTE_EXPIRY, `sr:${r.id}`, q.validUntil, { requestId: r.id })) added++
      }
      return added
    })
    // The only timeout-driven close: a quote nobody accepted in time (IN_PROGRESS waits on staff, not on the customer).
    this.timers.onTimer(QUOTE_EXPIRY, (d) => this.uow.run(async (tx) => {
      const [r] = await tx.select().from(serviceRequests).where(eq(serviceRequests.id, String(d.requestId))).for("update")
      if (r?.status !== "QUOTED") return "skip"
      const q = await this.latestSentQuote(tx, r.id)
      if (!q?.validUntil || q.validUntil > new Date()) return "skip"
      await tx.update(quotes).set({ status: "EXPIRED" }).where(eq(quotes.id, q.id))
      await this.transition(tx, r, "close_no_response", SYSTEM, { reasonCode: "QUOTE_EXPIRED" })
      return "expired"
    }))
  }

  // ---------------- lookups ----------------

  async byRef(ref: string, tx: DbOrTx = this.db, lock = false): Promise<Row> {
    const norm = normaliseReference(ref)
    if (!norm?.startsWith("UT-S-")) throw notFound("Request")
    const q = tx.select().from(serviceRequests).where(eq(serviceRequests.ref, norm))
    const [r] = lock ? await q.for("update") : await q
    if (!r) throw notFound("Request")
    return r
  }

  /** Ownership on every customer lookup; a miss is 404, never 403. */
  async owned(ref: string, userId: string, tx: DbOrTx = this.db, lock = false): Promise<Row> {
    const r = await this.byRef(ref, tx, lock)
    if (r.customerUserId !== userId) throw notFound("Request")
    return r
  }

  private latestSentQuote(tx: DbOrTx, requestId: string) {
    return tx.select().from(quotes).where(and(eq(quotes.requestType, "SERVICE"), eq(quotes.requestId, requestId), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1).then((r) => r[0])
  }

  private async uniqueRef(tx: DbOrTx): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const ref = generateReference("S")
      const [hit] = await tx.select({ id: serviceRequests.id }).from(serviceRequests).where(eq(serviceRequests.ref, ref))
      if (!hit) return ref
    }
    throw new Error("Could not allocate a unique reference")
  }

  // ---------------- submission ----------------

  async create(body: CreateServiceRequestBody, actor: Actor, ctx: { requestId: string; locale: Locale; via: "WEB" | "MOBILE" | "CONSOLE" }) {
    if (!this.config.flag(SERVICE_TYPE_FLAG[body.type])) throw new AppError("FEATURE_DISABLED", "This service is not available")
    const auth = this.config.get("AUTH")
    const [contact] = await this.db.select().from(userIdentities).where(and(eq(userIdentities.id, body.contactIdentityId), eq(userIdentities.userId, actor.userId), isNull(userIdentities.revokedAt)))
    if (!contact || contact.type !== "PHONE") throw new AppError("VALIDATION_FAILED", "Choose one of your phone numbers", [{ path: "contactIdentityId", code: "INVALID" }])
    // As for flights, the contact is the customer's own verified phone (ch. 11.3); the platform flag decides whether verification is enforced.
    if (auth.requireVerifiedPhoneForRequests && !contact.verifiedAt) throw new AppError("PHONE_NOT_VERIFIED", "Verify your phone number before submitting a request")
    const details = body.details as Record<string, unknown>
    const travellerIds = Array.isArray(details.travellerIds) ? (details.travellerIds as string[]) : []
    for (const id of new Set(travellerIds)) await this.customers.owned(actor.userId, id)
    const linked = typeof details.linkedFlightRequestRef === "string" ? normaliseReference(details.linkedFlightRequestRef) : null
    if (linked) {
      const [f] = await this.db.select({ owner: flightRequests.customerUserId }).from(flightRequests).where(eq(flightRequests.ref, linked))
      if (f?.owner !== actor.userId) throw new AppError("VALIDATION_FAILED", "Choose one of your own flight requests", [{ path: "details.linkedFlightRequestRef", code: "INVALID" }])
    }
    const wf = this.config.get("WORKFLOW")
    return this.uow.run(async (tx) => {
      const ref = await this.uniqueRef(tx)
      const now = new Date()
      const [r] = await tx.insert(serviceRequests).values({
        ref, type: body.type, status: "SUBMITTED", customerUserId: actor.userId, contactIdentityId: contact.id, contactPhoneSnapshot: contact.valueNormalised, details,
        submittedVia: ctx.via, submittedLocale: ctx.locale, slaDueAt: addBusinessMinutes(wf.businessHours, now, wf.sla.unassignedMinutes), submittedAt: now,
      }).returning()
      await tx.insert(requestStatusHistory).values({ requestType: "SERVICE", requestId: r!.id, fromStatus: null, toStatus: "SUBMITTED", command: "submit", actorUserId: actor.userId, actorKind: "CUSTOMER" })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "service_request.submitted", entityType: "service_request", entityId: r!.id, contextRef: ref, after: { type: body.type, travellers: travellerIds.length }, ip: actor.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "service_request", aggregateId: r!.id, eventType: "service_request.submitted", payload: { requestId: r!.id, ref, customerUserId: actor.userId, serviceType: body.type, ...this.labelVars(body.type), routeLabel: SERVICE_TYPE_LABELS[body.type][ctx.locale] }, dedupeKey: `sr-submitted:${r!.id}` })
      return { ref, type: body.type, status: "SUBMITTED" as const }
    })
  }

  private labelVars(type: ServiceRequestType) {
    return { service_en: SERVICE_TYPE_LABELS[type].en, service_fa: SERVICE_TYPE_LABELS[type].fa }
  }

  /** Party screening and SERVICE policy lookup before any admin works the request (ch. 27.1, ADR-0015). */
  async screen(requestId: string) {
    const [r] = await this.db.select().from(serviceRequests).where(eq(serviceRequests.id, requestId))
    if (!r || r.status !== "SUBMITTED") return
    const [u] = await this.db.select().from(users).where(eq(users.id, r.customerUserId))
    const [p] = await this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, r.customerUserId))
    const ids = Array.isArray(r.details.travellerIds) ? (r.details.travellerIds as string[]) : []
    const trav = await this.customers.byIds(ids)
    const policies = await this.compliance.servicePolicies(servicePolicyKeys(r.type, r.details, { residenceCountry: p?.addressCountry ?? null, contactPhone: r.contactPhoneSnapshot }))
    return this.uow.run(async (tx) => {
      const results = []
      const customerName = p?.givenNamesLatin && p.surnameLatin ? `${p.givenNamesLatin} ${p.surnameLatin}` : u?.displayName ?? ""
      if (customerName && customerName !== "Customer") results.push({ who: `Customer ${customerName}`, ...(await this.compliance.screen(tx, { subjectType: "CUSTOMER", subjectRef: r.customerUserId, name: customerName, nameFa: p?.nameFa, contextRef: r.ref })) })
      for (const t of trav) results.push({ who: `Traveller ${t.givenNames} ${t.surname}`, ...(await this.compliance.screen(tx, { subjectType: "TRAVELLER", subjectRef: t.id, name: `${t.givenNames} ${t.surname}`, nameFa: t.nameFa, dateOfBirth: t.dateOfBirth, nationality: t.nationality, contextRef: r.ref })) })
      const blocking = policies.find((x) => x.action === "BLOCK")
      if (blocking) {
        const msg = NEUTRAL_DECLINE[r.submittedLocale]
        await this.transition(tx, r, "screen_block", SYSTEM, { reasonCode: "SERVICE_POLICY", reasonText: `Policy ${blocking.type}:${blocking.key}`, message: msg })
        await tx.insert(requestMessages).values({ requestType: "SERVICE", requestId: r.id, authorId: null, direction: "TO_CUSTOMER", body: msg })
        return
      }
      const evidence: { kind: string; label: string; detail: string; score?: number }[] = []
      const screeningIds: string[] = []
      for (const res of results) if (res.result !== "CLEAR") {
        screeningIds.push(res.screeningId)
        for (const h of res.hits) evidence.push({ kind: "PARTY_MATCH", label: `${res.who} ↔ ${h.matchedName}`, detail: `${h.listId} ${h.externalId} · ${h.programmes.join(", ")} · ${h.reasons.join("; ")}`, score: h.score })
      }
      for (const pol of policies) evidence.push({ kind: "SERVICE_POLICY", label: `Policy ${pol.key}`, detail: pol.reason })
      if (!evidence.length) return
      await this.compliance.openCase(tx, { requestType: "SERVICE", requestId: r.id, requestRef: r.ref, trigger: screeningIds.length ? "SCREENING" : "POLICY", summary: `${evidence.length} item(s) need a compliance decision`, evidence, screeningIds })
      await this.transition(tx, r, "screen_flag", SYSTEM)
    })
  }

  // ---------------- state machine ----------------

  private async facts(tx: DbOrTx, r: Row, extra: Partial<ServiceFacts> = {}): Promise<ServiceFacts> {
    const q = await this.latestSentQuote(tx, r.id)
    return { status: r.status, type: r.type, now: new Date(), quote: q ? { status: q.status, validUntil: q.validUntil, linesComplete: Array.isArray(q.serviceLines) && q.serviceLines.length > 0 } : undefined, ...extra }
  }

  async transition(tx: Tx, r: Row, command: ServiceCommandName, actor: MachineActor, opts: { facts?: Partial<ServiceFacts>; expectedVersion?: number; reasonCode?: string; reasonText?: string; message?: string; patch?: Partial<typeof serviceRequests.$inferInsert> } = {}) {
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== r.version) throw new AppError("VERSION_CONFLICT", "Request changed; reload")
    const ev = evaluate(SERVICE_TRANSITIONS, command, await this.facts(tx, r, opts.facts), actor)
    if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
    const [u] = await tx.update(serviceRequests).set({ status: ev.to, version: r.version + 1, closedAt: isServiceTerminal(ev.to) ? new Date() : r.closedAt, ...opts.patch }).where(and(eq(serviceRequests.id, r.id), eq(serviceRequests.version, r.version))).returning()
    if (!u) throw new AppError("VERSION_CONFLICT", "Request changed; reload")
    await tx.insert(requestStatusHistory).values({ requestType: "SERVICE", requestId: r.id, fromStatus: ev.from, toStatus: ev.to, command, actorUserId: actor.userId ?? null, actorKind: actor.kind, reasonCode: opts.reasonCode, reasonText: opts.reasonText })
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: actor.kind, action: `service_request.${command}`, entityType: "service_request", entityId: r.id, contextRef: r.ref, before: { status: ev.from }, after: { status: ev.to, reasonCode: opts.reasonCode } })
    await this.outbox.add(tx, {
      aggregateType: "service_request", aggregateId: r.id, eventType: "service_request.transitioned",
      payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: u.assigneeUserId, serviceType: r.type, ...this.labelVars(r.type), from: ev.from, to: ev.to, command, actorUserId: actor.userId ?? null, statusLabels: SERVICE_STATUS_LABELS[ev.to], message: opts.message },
    })
    return u
  }

  async staffCommand(ref: string, command: ServiceCommand, input: Record<string, unknown>, actor: Actor, expectedVersion: number) {
    if (!(SERVICE_COMMANDS as readonly string[]).includes(command)) throw new AppError("NOT_FOUND", "Unknown command")
    const body = ServiceCommandBodies[command].parse(input) as Record<string, unknown>
    const m = staffActor(actor)
    await this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx, true)
      const o = { expectedVersion }
      switch (command) {
        case "claim": return this.transition(tx, r, "claim", m, { ...o, patch: { assigneeUserId: actor.userId } })
        case "assign": {
          const acc = await this.access.load(String(body.assigneeUserId), tx)
          return this.transition(tx, r, "assign", m, { ...o, facts: { assigneeCanWrite: acc.permissions.includes("service_request.write") }, patch: { assigneeUserId: String(body.assigneeUserId) } })
        }
        case "send_quote": return this.sendQuote(tx, r, body as unknown as { lines: ServiceQuoteLine[]; validUntil: string; note?: string }, m, actor, o.expectedVersion)
        case "record_acceptance": {
          const q = await this.latestSentQuote(tx, r.id)
          const updated = await this.transition(tx, r, "record_acceptance", m, { ...o, facts: { note: String(body.note) }, reasonText: String(body.note) })
          if (q) await tx.update(quotes).set({ status: "ACCEPTED", acceptedAt: new Date(), acceptedVia: "STAFF_RECORDED", acceptanceNote: String(body.note) }).where(eq(quotes.id, q.id))
          return updated
        }
        case "complete": return this.transition(tx, r, "complete", m, { ...o, facts: { note: String(body.note) }, reasonText: String(body.note) })
        case "cancel": return this.transition(tx, r, "cancel", m, { ...o, facts: { reason: String(body.reason) }, reasonCode: "STAFF_CANCEL", reasonText: String(body.reason) })
        case "decline": {
          // The staff reason stays internal; the customer reads the neutral text (ch. 14.4, 27.5).
          const msg = NEUTRAL_DECLINE[r.submittedLocale]
          const updated = await this.transition(tx, r, "decline", m, { ...o, facts: { reason: String(body.reason) }, reasonCode: "STAFF_DECLINE", reasonText: String(body.reason), message: msg })
          await tx.insert(requestMessages).values({ requestType: "SERVICE", requestId: r.id, authorId: actor.userId, direction: "TO_CUSTOMER", body: msg })
          return updated
        }
        case "release_hold": return this.transition(tx, r, "release_hold", m, { ...o, facts: { reason: String(body.reason) }, reasonText: String(body.reason) })
      }
    })
    return this.staffDetail(ref, actor)
  }

  private async sendQuote(tx: Tx, r: Row, body: { lines: ServiceQuoteLine[]; validUntil: string; note?: string }, m: MachineActor, actor: Actor, expectedVersion: number) {
    await validateClubDiscountLines(tx, r.customerUserId, body.lines, this.config.flag("loyalty.enabled"))
    const total = serviceQuoteTotal(body.lines)
    const validUntil = new Date(body.validUntil)
    const [{ v } = { v: 0 }] = await tx.select({ v: max(quotes.version) }).from(quotes).where(and(eq(quotes.requestType, "SERVICE"), eq(quotes.requestId, r.id)))
    // Machine first: a tour call-back or a wrong state fails before any quote row or number exists.
    const updated = await this.transition(tx, r, "send_quote", m, { expectedVersion, facts: { quote: { status: "SENT", validUntil, linesComplete: body.lines.length > 0 } } })
    await tx.update(quotes).set({ status: "SUPERSEDED" }).where(and(eq(quotes.requestType, "SERVICE"), eq(quotes.requestId, r.id), inArray(quotes.status, ["SENT", "DRAFT"])))
    const [q] = await tx.insert(quotes).values({
      requestType: "SERVICE", requestId: r.id, version: (v ?? 0) + 1, status: "SENT", currency: total.currency, validUntil, sentAt: new Date(), serviceLines: body.lines, serviceNote: body.note ?? null, createdBy: actor.userId,
    }).returning()
    const documentNumber = await this.numbers.assignQuotation(tx, q!.id)
    await this.quotationPdf(tx, r, q!.id, actor)
    await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "service_request.quote_sent", entityType: "quote", entityId: q!.id, contextRef: r.ref, after: { documentNumber, lines: body.lines.length, validUntil: validUntil.toISOString() } })
    await this.outbox.add(tx, { aggregateType: "service_request", aggregateId: r.id, eventType: "service_request.quote_sent", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, quoteId: q!.id, validUntil: validUntil.toISOString(), documentNumber } })
    return updated
  }

  /** Quotation PDF published to the customer when the quote is sent: the quote plus its document number (ADR-0006 C1). */
  private async quotationPdf(tx: Tx, r: Row, quoteId: string, actor: Actor) {
    const [q] = await tx.select().from(quotes).where(eq(quotes.id, quoteId))
    if (!q?.documentNumber) return
    const cfg = this.config.settings()
    const zone = await customerZone(tx, r.customerUserId)
    const fa = zone.locale === "fa"
    const L = docLabels(zone.locale)
    const lines = q.serviceLines as ServiceQuoteLine[]
    const money = (a: { amountMinor: number; currency: string }) => `${a.currency} ${(a.amountMinor / 100).toFixed(2)}`
    const total = serviceQuoteTotal(lines)
    const pdf = await renderQuotationPdf({
      number: q.documentNumber, title: `${fa ? "پیشنهاد قیمت" : "Quotation"} - ${serviceTitle(r.type, zone.locale)} - ${r.ref}`, subtitle: `${L.validUntil} ${q.validUntil ? formatValidity(q.validUntil, zone) : "-"}`,
      sections: [
        { heading: fa ? "هزینه‌ها" : "Charges", rows: [...lines.map((l): [string, string] => [l.label, `${l.kind === "CLUB_DISCOUNT" ? "-" : ""}${money(l.amount)}`]), [L.total, money(total)]] },
        ...(q.serviceNote ? [{ heading: fa ? "توضیحات" : "Notes", paragraphs: [q.serviceNote] }] : []),
      ],
      company: cfg.company, cfg: cfg.commercialDocuments, locale: zone.locale,
      footer: [fa
        ? "این یک پیشنهاد قیمت است، نه تعهد: خدمت فقط پس از پذیرش شما و تأیید تیم ما انجام می‌شود. زمان و روش پرداخت توسط تیم ما اعلام می‌شود."
        : "This is a quotation, not a commitment: the service goes ahead only after you accept it and our team confirms. Our team will confirm when and how to pay."],
    })
    const doc = await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "SERVICE", requestId: r.id, type: "QUOTE_PDF", filename: `quotation-${q.documentNumber}.pdf`, body: pdf, createdBy: actor.userId, visibility: "CUSTOMER" })
    await tx.update(quotes).set({ pdfDocumentId: doc.id }).where(eq(quotes.id, quoteId))
  }

  // ---------------- customer commands ----------------

  async customerAccept(ref: string, actor: Actor) {
    await this.uow.run(async (tx) => {
      const r = await this.owned(ref, actor.userId, tx, true)
      const q = await this.latestSentQuote(tx, r.id)
      const c: MachineActor = { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }
      await this.transition(tx, r, "accept_quote", c, {})
      await tx.update(quotes).set({ status: "ACCEPTED", acceptedAt: new Date(), acceptedVia: "APP" }).where(eq(quotes.id, q!.id))
    })
  }

  async customerCancel(ref: string, actor: Actor, reason?: string) {
    await this.uow.run(async (tx) => {
      const r = await this.owned(ref, actor.userId, tx, true)
      await this.transition(tx, r, "cancel_by_customer", { kind: "CUSTOMER", userId: actor.userId, permissions: new Set(), isOwner: true }, { reasonCode: "CUSTOMER_REQUEST", reasonText: reason })
    })
  }

  async customerMessage(ref: string, actor: Actor, body: string, documentIds: string[]) {
    return this.uow.run(async (tx) => {
      const r = await this.owned(ref, actor.userId, tx, true)
      if (isServiceTerminal(r.status)) throw new AppError("INVALID_TRANSITION", "This request is closed")
      await this.docs.attach(tx, documentIds, "SERVICE", r.id, actor.userId)
      await tx.insert(requestMessages).values({ requestType: "SERVICE", requestId: r.id, authorId: actor.userId, direction: "FROM_CUSTOMER", body, documentIds })
      await this.outbox.add(tx, { aggregateType: "service_request", aggregateId: r.id, eventType: "service_request.message", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, assigneeUserId: r.assigneeUserId, direction: "FROM_CUSTOMER", message: body } })
      return { ok: true }
    })
  }

  async staffMessage(ref: string, actor: Actor, body: string, documentIds: string[]) {
    return this.uow.run(async (tx) => {
      const r = await this.byRef(ref, tx)
      for (const d of documentIds) await this.docs.publish(tx, d, { requestType: "SERVICE", requestId: r.id, customerUserId: r.customerUserId, staffUserId: actor.userId })
      await tx.insert(requestMessages).values({ requestType: "SERVICE", requestId: r.id, authorId: actor.userId, direction: "TO_CUSTOMER", body, documentIds })
      await this.outbox.add(tx, { aggregateType: "service_request", aggregateId: r.id, eventType: "service_request.message", payload: { requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, direction: "TO_CUSTOMER", message: body } })
      return { ok: true }
    })
  }

  // ---------------- views ----------------

  private summary(r: Row, locale: Locale): ServiceRequestSummary {
    return { ref: r.ref as ServiceRequestSummary["ref"], type: r.type, status: customerStatus(r.status), title: serviceTitle(r.type, locale), createdAt: r.submittedAt.toISOString(), updatedAt: r.updatedAt.toISOString() }
  }

  private quoteView(q: typeof quotes.$inferSelect): ServiceQuoteView {
    const lines = q.serviceLines as ServiceQuoteLine[]
    return { id: q.id, status: q.status, lines, total: serviceQuoteTotal(lines), validUntil: iso(q.validUntil)!, note: q.serviceNote, sentAt: iso(q.sentAt), quotationNumber: q.documentNumber }
  }

  async customerList(userId: string, locale: Locale): Promise<ServiceRequestSummary[]> {
    const rows = await this.db.select().from(serviceRequests).where(eq(serviceRequests.customerUserId, userId)).orderBy(desc(serviceRequests.submittedAt))
    return rows.map((r) => this.summary(r, locale))
  }

  async customerDetail(ref: string, actor: Actor, locale: Locale): Promise<CustomerServiceRequestView> {
    const r = await this.owned(ref, actor.userId)
    const [hist, msgs, qs] = await Promise.all([
      this.db.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, "SERVICE"), eq(requestStatusHistory.requestId, r.id))).orderBy(requestStatusHistory.createdAt),
      this.db.select({ m: requestMessages, author: users.displayName }).from(requestMessages).leftJoin(users, eq(users.id, requestMessages.authorId)).where(and(eq(requestMessages.requestType, "SERVICE"), eq(requestMessages.requestId, r.id))).orderBy(requestMessages.createdAt),
      // A quote exists for the customer only once sent (ADR-0004): nothing is ever stored as a draft, and the filter keeps it that way.
      this.db.select().from(quotes).where(and(eq(quotes.requestType, "SERVICE"), eq(quotes.requestId, r.id), ne(quotes.status, "DRAFT"), ne(quotes.status, "SUPERSEDED"))).orderBy(desc(quotes.version)).limit(1),
    ])
    const quote = qs[0]
    return {
      ...this.summary(r, locale),
      details: r.details,
      // The hold and its release are internal: a customer sees "Received" throughout.
      timeline: hist.filter((h) => h.toStatus !== "COMPLIANCE_HOLD" && h.fromStatus !== "COMPLIANCE_HOLD").map((h) => ({ at: h.createdAt.toISOString(), kind: "STATUS" as const, label: SERVICE_STATUS_LABELS[h.toStatus as ServiceRequestStatus]?.[locale] ?? h.toStatus, toStatus: h.toStatus, ...(h.fromStatus ? { fromStatus: h.fromStatus } : {}) })),
      messages: msgs.map(({ m, author }) => ({ id: m.id, direction: m.direction, body: m.body, authorName: m.direction === "TO_CUSTOMER" ? "Uni Travel" : (author ?? "You"), createdAt: m.createdAt.toISOString(), readAt: iso(m.readAt), documentIds: m.documentIds })),
      quote: quote ? CustomerServiceQuoteView.parse(this.quoteView(quote)) : null,
      canCancel: BEFORE_CONFIRMED.includes(r.status),
      canAcceptQuote: r.status === "QUOTED" && quote?.status === "SENT" && !!quote.validUntil && quote.validUntil > new Date(),
    }
  }

  async staffDetail(ref: string, actor: Actor): Promise<StaffServiceRequestView> {
    const r = await this.byRef(ref)
    const [hist, msgs, qs, owner, assignee, cases] = await Promise.all([
      this.db.select({ h: requestStatusHistory, name: users.displayName }).from(requestStatusHistory).leftJoin(users, eq(users.id, requestStatusHistory.actorUserId)).where(and(eq(requestStatusHistory.requestType, "SERVICE"), eq(requestStatusHistory.requestId, r.id))).orderBy(requestStatusHistory.createdAt),
      this.db.select({ m: requestMessages, author: users.displayName }).from(requestMessages).leftJoin(users, eq(users.id, requestMessages.authorId)).where(and(eq(requestMessages.requestType, "SERVICE"), eq(requestMessages.requestId, r.id))).orderBy(requestMessages.createdAt),
      this.db.select().from(quotes).where(and(eq(quotes.requestType, "SERVICE"), eq(quotes.requestId, r.id), ne(quotes.status, "DRAFT"))).orderBy(desc(quotes.version)),
      this.db.select({ name: users.displayName }).from(users).where(eq(users.id, r.customerUserId)),
      r.assigneeUserId ? this.db.select({ name: users.displayName }).from(users).where(eq(users.id, r.assigneeUserId)) : Promise.resolve([]),
      this.db.select({ id: complianceCases.id }).from(complianceCases).where(and(eq(complianceCases.requestType, "SERVICE"), eq(complianceCases.requestId, r.id))).orderBy(desc(complianceCases.openedAt)).limit(1),
    ])
    const ids = Array.isArray(r.details.travellerIds) ? (r.details.travellerIds as string[]) : []
    const trav = ids.length ? await this.db.select().from(travellers).where(inArray(travellers.id, ids)) : []
    const live = qs.find((q) => q.status !== "SUPERSEDED")
    const base = this.summary(r, "en")
    return {
      ...base, status: r.status, // staff see the real status, including COMPLIANCE_HOLD
      details: r.details,
      timeline: hist.map(({ h, name }) => ({ at: h.createdAt.toISOString(), kind: "STATUS" as const, label: h.command, ...(h.reasonText ? { detail: h.reasonText } : {}), ...(name ? { actor: name } : {}), toStatus: h.toStatus, ...(h.fromStatus ? { fromStatus: h.fromStatus } : {}) })),
      messages: msgs.map(({ m, author }) => ({ id: m.id, direction: m.direction, body: m.body, authorName: author ?? (m.direction === "TO_CUSTOMER" ? "Uni Travel" : "Customer"), createdAt: m.createdAt.toISOString(), readAt: iso(m.readAt), documentIds: m.documentIds })),
      quote: live ? this.quoteView(live) : null,
      canCancel: BEFORE_CONFIRMED.includes(r.status),
      canAcceptQuote: r.status === "QUOTED" && live?.status === "SENT",
      version: r.version,
      customer: { userId: r.customerUserId, name: owner[0]?.name ?? "", phone: r.contactPhoneSnapshot },
      assignee: r.assigneeUserId ? { userId: r.assigneeUserId, name: assignee[0]?.name ?? "" } : null,
      slaDueAt: iso(r.slaDueAt), submittedVia: r.submittedVia, submittedLocale: r.submittedLocale, complianceCaseId: cases[0]?.id ?? null,
      travellers: trav.map((t) => ({ id: t.id, name: `${t.givenNames} ${t.surname}`, nationality: t.nationality })),
      quotes: qs.map((q) => this.quoteView(q)),
      allowedCommands: allowedCommands(SERVICE_TRANSITIONS, await this.facts(this.db, r), staffActor(actor), STAFF_COMMANDS),
    }
  }

  async adminList(q: { type?: ServiceRequestType; status?: ServiceRequestStatus; mine?: boolean; limit: number; cursor?: string }, actor: Actor): Promise<StaffServiceRequestPage> {
    const conds = []
    if (q.type) conds.push(eq(serviceRequests.type, q.type))
    if (q.status) conds.push(eq(serviceRequests.status, q.status))
    if (q.mine) conds.push(eq(serviceRequests.assigneeUserId, actor.userId))
    if (q.cursor) conds.push(lt(serviceRequests.submittedAt, new Date(q.cursor)))
    const rows = await this.db.select({ r: serviceRequests, customer: users.displayName, assigneeName: sql<string | null>`(select display_name from users where id = ${serviceRequests.assigneeUserId})` })
      .from(serviceRequests).leftJoin(users, eq(users.id, serviceRequests.customerUserId)).where(conds.length ? and(...conds) : undefined)
      .orderBy(sql`${serviceRequests.slaDueAt} asc nulls last`, desc(serviceRequests.submittedAt)).limit(q.limit + 1)
    return {
      items: rows.slice(0, q.limit).map(({ r, customer, assigneeName }) => ({ ...this.summary(r, "en"), status: r.status, customerName: customer ?? "", assigneeName, slaDueAt: iso(r.slaDueAt) })),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.r.submittedAt.toISOString() : null,
    }
  }

  // ---------------- tracking (spec section 4.5) ----------------

  async publicTrack(r: Row): Promise<PublicTrackView> {
    const hist = await this.db.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, "SERVICE"), eq(requestStatusHistory.requestId, r.id))).orderBy(requestStatusHistory.createdAt)
    return {
      ref: r.ref, kind: "SERVICE", serviceType: r.type, status: customerStatus(r.status),
      timeline: hist.filter((h) => h.toStatus !== "COMPLIANCE_HOLD" && h.fromStatus !== "COMPLIANCE_HOLD").map((h) => ({ at: h.createdAt.toISOString(), status: h.toStatus })),
    }
  }
}
