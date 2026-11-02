import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm"

import {
  type BillingDocuments, CargoQuoteLines, type CustomerInvoice, type DirectInvoiceCreateBody, type DirectInvoiceUpdateBody, directInvoiceTotal, type InvoiceCancelCode, type InvoiceLineType, STAFF_SURFACE_PERMISSIONS, type InvoiceStatus, type PriceBreakdown, type PurchasableItem, type ServiceQuoteLine, serviceQuoteTotal, type StaffInvoice, type StaffInvoiceListItem,
} from "@unitravel/contracts"
import {
  cargoRequests, complianceCases, customerProfiles, type Db, type DbOrTx, flightRequests, invoiceLines, invoices, invoiceStatusHistory, paymentRecords, quoteOptions, quotes, serviceRequests, tickets, type Tx, userIdentities, users,
} from "@unitravel/db"
import { evaluate, generateReference, INVOICE_TRANSITIONS, type InvoiceCommand, type InvoiceFacts, invoiceExpiry, type MachineActor, normaliseReference } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { AccessService } from "../access/access.service"
import { AuditService } from "../audit/audit.service"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { DocumentsService } from "../documents/documents.service"
import { NotificationsService } from "../notifications/notifications.service"
import { OutboxService } from "../platform/outbox.service"
import { TimersService } from "../platform/timers.service"
import { staffActor, SYSTEM } from "../requests/requests.service"
import { pdfMoney, renderInvoicePdf } from "./commercial-pdf"
import { DocumentNumbersService } from "./document-numbers.service"
import { serviceTitle } from "../services/service-labels"
import { productOf } from "./product"

type Inv = typeof invoices.$inferSelect
type ReqType = "FLIGHT" | "CARGO" | "SERVICE"
interface Draft { currency: string; lines: { description: string; quantity: number; unitAmountMinor: number; amountMinor: number; serviceType?: InvoiceLineType }[]; totalMinor: number }

const TIMER = "invoice.expire"
const timerKey = (id: string) => `inv:${id}`
const iso = (d: Date | null) => d?.toISOString() ?? null

const LINE_LABEL: Record<InvoiceLineType, string> = { VISA: "Visa", BUS: "Bus", TRAIN: "Train", HOTEL: "Hotel", STAY: "Stay", CIP: "CIP", INSURANCE: "Insurance", TOUR: "Tour", TRANSFER: "Transfer", BAGGAGE: "Baggage", OTHER: "", DISCOUNT: "Discount" }
/** Line types that are not services, so no SERVICE policy can apply to them. */
const NOT_A_SERVICE: readonly string[] = ["OTHER", "DISCOUNT"]
const documentLine = (l: { serviceType: string | null; description: string }) => {
  const label = l.serviceType ? LINE_LABEL[l.serviceType as InvoiceLineType] : ""
  return label ? `${label}: ${l.description}` : l.description
}

/**
 * Invoices (ADR-0006). The server builds an invoice from the accepted quote; the domain machine decides every
 * transition; amounts are frozen at issue. Payments reach an invoice only through `markPaid` / `settleFromPayments`
 * (offline recording today, the verified Stripe webhook in Phase D).
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly docs: DocumentsService,
    private readonly numbers: DocumentNumbersService,
    private readonly timers: TimersService,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
    private readonly compliance: ComplianceService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    this.notifications.onAttachment(async (documentId, userId) => {
      const d = await this.docs.get(documentId)
      // The attachment goes to the notification's own recipient, never to anyone else.
      if (!d || d.ownerUserId !== userId) return null
      return { filename: d.filename, content: await this.docs.readBytes(d), contentType: "application/pdf" }
    })
    this.timers.onTimer(TIMER, (d) => this.expire(String(d.invoiceId)))
    this.timers.onReconcile(() => this.reconcileTimers())
    this.workers.registerJob("maintenance", "invoices.expire-due", () => this.expireDue())
    await this.queues.get("maintenance").upsertJobScheduler("invoices-expire-due-every-5m", { every: 5 * 60_000 }, { name: "invoices.expire-due" }).catch(() => undefined)
  }

  // ---------------- request context ----------------

  private async requestOf(tx: DbOrTx, type: ReqType, id: string) {
    if (type === "FLIGHT") {
      const [r] = await tx.select().from(flightRequests).where(eq(flightRequests.id, id))
      return r ? { ref: r.ref, customerUserId: r.customerUserId, status: r.status as string } : null
    }
    if (type === "SERVICE") {
      const [r] = await tx.select().from(serviceRequests).where(eq(serviceRequests.id, id))
      return r ? { ref: r.ref, customerUserId: r.customerUserId, status: r.status as string } : null
    }
    const [r] = await tx.select().from(cargoRequests).where(eq(cargoRequests.id, id))
    return r ? { ref: r.ref, customerUserId: r.customerUserId, status: r.status as string } : null
  }

  private async ticketedAt(tx: DbOrTx, inv: Inv): Promise<Date | null> {
    if (inv.requestType !== "FLIGHT") return null
    const r = await this.requestOf(tx, "FLIGHT", inv.requestId)
    if (!r || !["TICKETED", "COMPLETED"].includes(r.status)) return null
    const rows = await tx.select({ at: tickets.createdAt }).from(tickets).where(and(eq(tickets.requestId, inv.requestId), eq(tickets.status, "ISSUED"))).orderBy(desc(tickets.createdAt)).limit(1)
    return rows[0]?.at ?? null
  }

  private facts(inv: Inv, ticketedAt: Date | null, now = new Date()): InvoiceFacts {
    return { status: inv.status, productType: productOf(inv.requestType), atolMode: this.config.get("WORKFLOW").atolMode, now, ticketedAt, expiresAt: inv.expiresAt }
  }

  // ---------------- drafts ----------------

  /** Lines come from the accepted quote only: staff never type an amount (ADR-0006 C2). */
  private async draftFromQuote(tx: Tx, type: ReqType, q: typeof quotes.$inferSelect): Promise<Draft> {
    const line = (description: string, amountMinor: number) => ({ description, quantity: 1, unitAmountMinor: amountMinor, amountMinor })
    let lines: Draft["lines"]
    let totalMinor: number
    if (type === "FLIGHT") {
      const [o] = q.acceptedOptionId ? await tx.select().from(quoteOptions).where(eq(quoteOptions.id, q.acceptedOptionId)) : []
      if (!o) throw new AppError("INVALID_TRANSITION", "The accepted quote has no accepted option")
      const pb = o.priceBreakdown as PriceBreakdown
      // Extras are their own lines; a discount is a negative line, so the lines still add up to the total (ADR-0013 A6).
      lines = [line(`Airfare - ${o.label}`, pb.fare.amountMinor), ...(pb.taxes.amountMinor > 0 ? [line("Taxes, fees and carrier charges", pb.taxes.amountMinor)] : []), ...(pb.serviceFee.amountMinor > 0 ? [line("Uni Travel service fee", pb.serviceFee.amountMinor)] : []),
        ...(pb.extras ?? []).map((e) =>
          // Catalogue extras keep their type and quantity x unit (STAGE-23); only use them when they reconcile with the amount.
          e.lineType && e.quantity && e.unitAmountMinor !== undefined && e.quantity * e.unitAmountMinor === e.amount.amountMinor
            ? { description: e.label, quantity: e.quantity, unitAmountMinor: e.unitAmountMinor, amountMinor: e.amount.amountMinor, serviceType: e.lineType }
            : line(e.label, e.amount.amountMinor)), ...(pb.discount ? [line(`Discount - ${pb.discount.label}`, -pb.discount.amount.amountMinor)] : [])]
      totalMinor = pb.total.amountMinor
    } else if (type === "SERVICE") {
      // ADR-0015: the lines staff sent, with a club discount as its own negative line.
      const sl = (q.serviceLines ?? []) as ServiceQuoteLine[]
      lines = sl.map((l) => line(l.label, l.kind === "CLUB_DISCOUNT" ? -l.amount.amountMinor : l.amount.amountMinor))
      totalMinor = serviceQuoteTotal(sl).amountMinor
    } else {
      const c = CargoQuoteLines.parse(q.cargoLines)
      const named: [string, number][] = [
        [`Freight (${c.freight.chargeableKg} kg)`, c.freight.amount.amountMinor], ["Fuel surcharge", c.fuelSurcharge.amountMinor], ["Security surcharge", c.securitySurcharge.amountMinor], ["Handling", c.handling.amountMinor],
        ["Customs brokerage", c.customsBrokerage.amountMinor], ["Insurance", c.insurance.amountMinor], ["Pickup", c.pickup.amountMinor], ["Delivery", c.delivery.amountMinor],
        ...(c.dutiesTaxes !== "PAYABLE_BY_CONSIGNEE" ? [["Duties and taxes", c.dutiesTaxes.amountMinor] as [string, number]] : []),
      ]
      lines = named.filter(([, a]) => a > 0).map(([d, a]) => line(d, a))
      totalMinor = c.total.amountMinor
    }
    if (lines.reduce((s, l) => s + l.amountMinor, 0) !== totalMinor || totalMinor <= 0) throw new AppError("VALIDATION_FAILED", "The accepted quote's lines do not add up to its total; fix the quote first")
    return { currency: q.currency, lines, totalMinor }
  }

  async createDraft(ref: string, actor: Actor) {
    const norm = normaliseReference(ref)
    if (!norm || norm.startsWith("UT-A-") || norm.startsWith("UT-D-")) throw notFound("Request")
    const type: ReqType = norm.startsWith("UT-C-") ? "CARGO" : norm.startsWith("UT-S-") ? "SERVICE" : "FLIGHT"
    const id = await this.uow.run(async (tx) => {
      const [r] = type === "FLIGHT" ? await tx.select().from(flightRequests).where(eq(flightRequests.ref, norm)).for("update")
        : type === "SERVICE" ? await tx.select().from(serviceRequests).where(eq(serviceRequests.ref, norm)).for("update")
        : await tx.select().from(cargoRequests).where(eq(cargoRequests.ref, norm)).for("update")
      if (!r) throw notFound("Request")
      if (["CANCELLED", "DECLINED", "EXPIRED", "CLOSED_NO_RESPONSE"].includes(r.status)) throw new AppError("INVALID_TRANSITION", `No invoice for a ${r.status} request`)
      const [q] = await tx.select().from(quotes).where(and(eq(quotes.requestType, type), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).orderBy(desc(quotes.version)).limit(1)
      if (!q) throw new AppError("INVALID_TRANSITION", "An invoice is created from an accepted quote")
      const [open] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.quoteId, q.id), inArray(invoices.status, ["DRAFT", "ISSUED", "PAID"])))
      if (open) throw new AppError("INVALID_TRANSITION", "This quote already has a live invoice (draft, issued or paid); cancel it to reissue")
      const d = await this.draftFromQuote(tx, type, q)
      const [inv] = await tx.insert(invoices).values({ requestType: type, requestId: r.id, requestRef: r.ref, customerUserId: r.customerUserId, quoteId: q.id, currency: d.currency, totalMinor: d.totalMinor, createdBy: actor.userId }).returning()
      await tx.insert(invoiceLines).values(d.lines.map((l, i) => ({ invoiceId: inv!.id, position: i, ...l })))
      await this.history(tx, inv!.id, null, "DRAFT", "create", actor.userId, "STAFF")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "invoice.draft_created", entityType: "invoice", entityId: inv!.id, contextRef: r.ref, after: { quoteId: q.id, totalMinor: d.totalMinor, currency: d.currency } })
      return inv!.id
    })
    return this.staffById(id, actor)
  }

  // ---------------- direct invoices (ADR-0028) ----------------

  private async assertCustomer(customerId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, customerId))
    if (!u || u.status !== "ACTIVE" || u.mergedInto) throw notFound("Customer")
    // Staff are not customers (as in ADR-0020).
    if ((await this.access.load(customerId)).permissions.some((p) => STAFF_SURFACE_PERMISSIONS.includes(p as never))) throw notFound("Customer")
  }

  private async uniqueDirectRef(tx: DbOrTx): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const ref = generateReference("D")
      const [hit] = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.requestRef, ref)).limit(1)
      if (!hit) return ref
    }
    throw new Error("Could not allocate a unique reference")
  }

  private directLineRows(invoiceId: string, lines: DirectInvoiceCreateBody["lines"]) {
    return lines.map((l, position) => ({ invoiceId, position, serviceType: l.serviceType, description: l.description, quantity: l.quantity, unitAmountMinor: l.unitAmountMinor, amountMinor: l.quantity * l.unitAmountMinor }))
  }

  async createDirect(body: DirectInvoiceCreateBody, actor: Actor) {
    await this.assertCustomer(body.customerUserId)
    const id = await this.uow.run(async (tx) => {
      const invoiceId = crypto.randomUUID()
      const ref = await this.uniqueDirectRef(tx)
      const totalMinor = directInvoiceTotal(body.lines)
      await tx.insert(invoices).values({ id: invoiceId, origin: "DIRECT", requestType: "SERVICE", requestId: invoiceId, requestRef: ref, customerUserId: body.customerUserId, currency: body.currency, totalMinor, dueDays: body.dueDays, notes: body.notes, createdBy: actor.userId })
      await tx.insert(invoiceLines).values(this.directLineRows(invoiceId, body.lines))
      await this.history(tx, invoiceId, null, "DRAFT", "create", actor.userId, "STAFF")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "invoice.draft_created", entityType: "invoice", entityId: invoiceId, contextRef: ref, after: { origin: "DIRECT", customerUserId: body.customerUserId, totalMinor, currency: body.currency, lines: body.lines.map((l) => l.serviceType) } })
      return invoiceId
    })
    return this.staffById(id, actor)
  }

  async updateDirect(id: string, body: DirectInvoiceUpdateBody, actor: Actor) {
    await this.uow.run(async (tx) => {
      const inv = await this.lock(tx, id)
      if (inv.origin !== "DIRECT") throw new AppError("INVALID_TRANSITION", "Only a direct invoice can be edited; a quote-based invoice takes its lines from the quote")
      if (inv.status !== "DRAFT") throw new AppError("INVALID_TRANSITION", "Only a draft can be edited; cancel an issued invoice and create a new one")
      const [screened] = await tx.select({ id: complianceCases.id }).from(complianceCases).where(and(eq(complianceCases.requestType, "SERVICE"), eq(complianceCases.requestId, inv.id))).limit(1)
      // The decision covered these services; changing them afterwards would slip past it.
      if (screened) throw new AppError("INVALID_TRANSITION", "This draft has a compliance decision; cancel it and create a new invoice to change it")
      const totalMinor = directInvoiceTotal(body.lines)
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id))
      await tx.insert(invoiceLines).values(this.directLineRows(inv.id, body.lines))
      await tx.update(invoices).set({ currency: body.currency, totalMinor, dueDays: body.dueDays, notes: body.notes, rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "invoice.draft_updated", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, before: { totalMinor: inv.totalMinor, currency: inv.currency }, after: { totalMinor, currency: body.currency, lines: body.lines.map((l) => l.serviceType) } })
    })
    return this.staffById(id, actor)
  }

  private async caseStatuses(tx: DbOrTx, invoiceId: string): Promise<string[]> {
    const rows = await tx.select({ status: complianceCases.status }).from(complianceCases).where(and(eq(complianceCases.requestType, "SERVICE"), eq(complianceCases.requestId, invoiceId)))
    return rows.map((r) => r.status)
  }

  private complianceBlock(statuses: string[]): string | null {
    if (statuses.includes("DECLINED")) return "Compliance declined this invoice; it cannot be issued"
    if (statuses.some((s) => s === "OPEN" || s === "ESCALATED")) return "Waiting for a compliance decision"
    return null
  }

  /** ADR-0028 D5. Returns true when a new case was opened, so the caller commits it and then refuses. */
  private async directComplianceGate(tx: Tx, inv: Inv, lines: (typeof invoiceLines.$inferSelect)[]): Promise<boolean> {
    const statuses = await this.caseStatuses(tx, inv.id)
    const blocked = this.complianceBlock(statuses)
    if (blocked) throw new AppError("COMPLIANCE_REVIEW_REQUIRED", blocked)
    if (statuses.includes("RELEASED")) return false
    const types = [...new Set(lines.map((l) => l.serviceType).filter((t): t is string => !!t && !NOT_A_SERVICE.includes(t)))]
    const policies = types.length ? await this.compliance.servicePoliciesForTypes(types) : []
    const blocking = policies.find((p) => p.action === "BLOCK")
    if (blocking) throw new AppError("COMPLIANCE_REVIEW_REQUIRED", `A compliance policy does not allow this service (${blocking.key})`)
    const evidence: { kind: string; label: string; detail: string; score?: number }[] = policies.map((p) => ({ kind: "SERVICE_POLICY", label: `Policy ${p.key}`, detail: p.reason }))
    const [name] = await this.billTo(tx, inv.customerUserId)
    const screeningIds: string[] = []
    if (name && name !== "Customer") {
      const s = await this.compliance.screen(tx, { subjectType: "CUSTOMER", subjectRef: inv.customerUserId, name, contextRef: inv.requestRef })
      if (s.result !== "CLEAR") {
        screeningIds.push(s.screeningId)
        for (const h of s.hits) evidence.push({ kind: "PARTY_MATCH", label: `Customer ${name} ↔ ${h.matchedName}`, detail: h.reasons.join("; "), score: h.score })
      }
    }
    if (!evidence.length) return false
    await this.compliance.openCase(tx, { requestType: "SERVICE", requestId: inv.id, requestRef: inv.requestRef, trigger: screeningIds.length ? "SCREENING" : "POLICY", summary: `Direct invoice: ${evidence.length} item(s) need a compliance decision`, evidence, screeningIds })
    return true
  }

  /** What the invoice email shows (ADR-0028 D8); the same text for the issue email and a resent link. */
  async emailSummary(tx: DbOrTx, inv: Inv) {
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position))
    const money = (amountMinor: number) => pdfMoney({ amountMinor, currency: inv.currency })
    return { services: lines.map((l) => `- ${documentLine(l)}${l.quantity > 1 ? ` x ${l.quantity}` : ""}: ${money(l.amountMinor)}`).join("\n"), total: money(inv.totalMinor), documentId: inv.documentId }
  }

  /**
   * Bank-transfer block for the `invoice.issued` email (en and fa), empty while online payment is on. Only the text staff
   * entered in settings goes in; with none set the email says to ask us for the details (UNKNOWN stays UNKNOWN).
   */
  paymentInstructionBlocks(): { en: string; fa: string } {
    if (this.config.flag("payments.online.enabled")) return { en: "", fa: "" }
    const t = this.config.settings().payment.offlineInstructions
    return {
      en: t?.en.trim() ? `How to pay (bank transfer):\n${t.en.trim()}\n\n` : "To pay by bank transfer, contact us and we will send you the payment details.\n\n",
      fa: t?.fa.trim() ? `روش پرداخت (انتقال بانکی):\n${t.fa.trim()}\n\n` : "برای پرداخت با انتقال بانکی با ما تماس بگیرید تا اطلاعات پرداخت را برایتان بفرستیم.\n\n",
    }
  }

  // ---------------- transitions ----------------

  private history(tx: DbOrTx, invoiceId: string, from: InvoiceStatus | null, to: InvoiceStatus, command: string, actorUserId: string | null, actorKind: "STAFF" | "SYSTEM", reason?: { code?: string; text?: string }) {
    return tx.insert(invoiceStatusHistory).values({ invoiceId, fromStatus: from, toStatus: to, command, actorUserId, actorKind, reasonCode: reason?.code ?? null, reasonText: reason?.text ?? null })
  }

  private async lock(tx: Tx, id: string): Promise<Inv> {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update")
    if (!inv) throw notFound("Invoice")
    return inv
  }

  private run(inv: Inv, command: InvoiceCommand, ticketedAt: Date | null, actor: MachineActor) {
    const ev = evaluate(INVOICE_TRANSITIONS, command, this.facts(inv, ticketedAt), actor)
    if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
    return ev
  }

  /** Verified payments of the request not yet allocated to a PAID invoice, in the invoice's currency. */
  private async unallocatedPaymentMinor(tx: DbOrTx, inv: Inv): Promise<number> {
    const paid = await tx.select().from(paymentRecords).where(and(eq(paymentRecords.requestType, inv.requestType), eq(paymentRecords.requestId, inv.requestId), eq(paymentRecords.status, "VERIFIED"), eq(paymentRecords.currency, inv.currency)))
    const settled = await tx.select({ total: invoices.totalMinor }).from(invoices).where(and(eq(invoices.requestType, inv.requestType), eq(invoices.requestId, inv.requestId), eq(invoices.status, "PAID"), ne(invoices.id, inv.id)))
    return paid.reduce((s, p) => s + p.amountMinor, 0) - settled.reduce((s, p) => s + p.total, 0)
  }

  async issue(id: string, actor: Actor) {
    const now = new Date()
    const status = await this.uow.run(async (tx) => {
      const inv = await this.lock(tx, id)
      this.run(inv, "issue", await this.ticketedAt(tx, inv), staffActor(actor))
      if (inv.origin === "DIRECT" && (await this.directComplianceGate(tx, inv, await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id))))) return "HELD"
      const cfg = this.config.settings()
      const number = await this.numbers.allocate(tx, "INVOICE", now)
      const expiresAt = invoiceExpiry({ productType: productOf(inv.requestType), atolMode: this.config.get("WORKFLOW").atolMode, now, validityDays: inv.dueDays ?? cfg.commercialDocuments.invoiceValidityDays })
      const paid = (await this.unallocatedPaymentMinor(tx, inv)) >= inv.totalMinor
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position))
      const pdf = await renderInvoicePdf({
        number, requestRef: inv.requestRef, issuedAt: now, expiresAt, paid, currency: inv.currency, totalMinor: inv.totalMinor,
        lines: lines.map((l) => ({ description: documentLine(l), quantity: l.quantity, unitAmountMinor: l.unitAmountMinor, amountMinor: l.amountMinor })),
        billTo: await this.billTo(tx, inv.customerUserId), company: cfg.company, cfg: cfg.commercialDocuments,
        notes: this.config.get("WORKFLOW").atolMode === "PAY_ON_TICKETING" && inv.requestType === "FLIGHT" ? ["Flights are sold as an airline ticket agent; payment is taken when tickets are issued (ATOL wording pending counsel review)."] : inv.notes ? [inv.notes] : [],
      })
      const doc = await this.docs.storeGenerated(tx, { ownerUserId: inv.customerUserId, requestType: productOf(inv.requestType), requestId: inv.requestId, type: "INVOICE", filename: `invoice-${number}.pdf`, body: pdf, createdBy: actor.userId, visibility: "CUSTOMER" })
      await tx.update(invoices).set({ status: "ISSUED", number, issuedAt: now, expiresAt, documentId: doc.id, rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
      await this.history(tx, inv.id, "DRAFT", "ISSUED", "issue", actor.userId, "STAFF")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "invoice.issued", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number, totalMinor: inv.totalMinor, currency: inv.currency, expiresAt: expiresAt.toISOString() } })
      await this.outbox.add(tx, { aggregateType: "invoice", aggregateId: inv.id, eventType: "invoice.issued", payload: { invoiceId: inv.id, number, ref: inv.requestRef, customerUserId: inv.customerUserId, expiresAt: expiresAt.toISOString(), productType: inv.requestType, paymentInstructions: this.paymentInstructionBlocks(), ...(await this.emailSummary(tx, { ...inv, documentId: doc.id })) } })
      if (paid) await this.markPaid(tx, inv.id, "Payment already verified for this request")
      return paid ? "PAID" : "ISSUED"
    })
    // Thrown after the commit so the case that was just opened survives.
    if (status === "HELD") throw new AppError("COMPLIANCE_REVIEW_REQUIRED", "This invoice needs a compliance decision before it can be issued")
    if (status === "ISSUED") await this.scheduleExpiry(id)
    return this.staffById(id, actor)
  }

  async cancel(id: string, body: { reasonCode: "CORRECTION" | "CUSTOMER_REQUEST" | "DUPLICATE" | "OTHER"; note?: string }, actor: Actor) {
    await this.uow.run(async (tx) => {
      const inv = await this.lock(tx, id)
      const ev = this.run(inv, "cancel", null, staffActor(actor))
      await tx.update(invoices).set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: body.reasonCode, rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
      await this.history(tx, inv.id, ev.from, "CANCELLED", "cancel", actor.userId, "STAFF", { code: body.reasonCode, text: body.note })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "invoice.cancelled", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, before: { status: ev.from }, after: { number: inv.number, reasonCode: body.reasonCode, note: body.note } })
      // A draft was never shown to the customer, so cancelling it tells them nothing.
      if (ev.from === "ISSUED") await this.outbox.add(tx, { aggregateType: "invoice", aggregateId: inv.id, eventType: "invoice.cancelled", payload: { invoiceId: inv.id, number: inv.number, ref: inv.requestRef, customerUserId: inv.customerUserId, productType: inv.requestType } })
    })
    await this.timers.cancel(TIMER, timerKey(id))
    return this.staffById(id, actor)
  }

  /** System command, fired by the delayed job at `expiresAt` and by the sweep; re-checks the domain guard. */
  async expire(id: string): Promise<"expired" | "skipped"> {
    return this.uow.run(async (tx) => {
      const inv = await this.lock(tx, id)
      if (inv.status !== "ISSUED") return "skipped"
      const ev = evaluate(INVOICE_TRANSITIONS, "expire", this.facts(inv, null), SYSTEM)
      if (!ev.ok) return "skipped"
      await tx.update(invoices).set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: "EXPIRED", rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
      await this.history(tx, inv.id, "ISSUED", "CANCELLED", "expire", null, "SYSTEM", { code: "EXPIRED" })
      await this.audit.record(tx, { actorUserId: null, actorKind: "SYSTEM", action: "invoice.expired", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, before: { status: "ISSUED" }, after: { number: inv.number, expiresAt: iso(inv.expiresAt) } })
      await this.outbox.add(tx, { aggregateType: "invoice", aggregateId: inv.id, eventType: "invoice.expired", payload: { invoiceId: inv.id, number: inv.number, ref: inv.requestRef, customerUserId: inv.customerUserId, productType: inv.requestType } })
      return "expired"
    })
  }

  /** The seam for payments (ADR-0006 C11): Phase D's verified webhook calls this with its payment record. */
  async markPaid(tx: Tx, invoiceId: string, via: string): Promise<boolean> {
    const inv = await this.lock(tx, invoiceId)
    if (!evaluate(INVOICE_TRANSITIONS, "mark_paid", this.facts(inv, null), SYSTEM).ok) return false
    await tx.update(invoices).set({ status: "PAID", paidAt: new Date(), rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
    await this.history(tx, inv.id, "ISSUED", "PAID", "mark_paid", null, "SYSTEM", { text: via })
    await this.audit.record(tx, { actorUserId: null, actorKind: "SYSTEM", action: "invoice.paid", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, before: { status: "ISSUED" }, after: { number: inv.number, via } })
    // Card and verified offline payments alike; the machine allows ISSUED -> PAID once, so the receipt is sent once (ADR-0013 A7).
    await this.outbox.add(tx, { aggregateType: "invoice", aggregateId: inv.id, eventType: "invoice.paid", payload: { invoiceId: inv.id, number: inv.number, ref: inv.requestRef, customerUserId: inv.customerUserId, productType: inv.requestType }, dedupeKey: `invoice-paid:${inv.id}` })
    return true
  }

  async markRefunded(tx: Tx, invoiceId: string, via: string): Promise<boolean> {
    const inv = await this.lock(tx, invoiceId)
    if (!evaluate(INVOICE_TRANSITIONS, "mark_refunded", this.facts(inv, null), SYSTEM).ok) return false
    await tx.update(invoices).set({ status: "REFUNDED", rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
    await this.history(tx, inv.id, "PAID", "REFUNDED", "mark_refunded", null, "SYSTEM", { text: via })
    await this.audit.record(tx, { actorUserId: null, actorKind: "SYSTEM", action: "invoice.refunded", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, before: { status: "PAID" }, after: { number: inv.number, via } })
    return true
  }

  /** Called after an offline payment is recorded or verified: ISSUED invoices covered by verified money become PAID. */
  async settleFromPayments(tx: Tx, requestType: ReqType, requestId: string): Promise<number> {
    const open = await tx.select().from(invoices).where(and(eq(invoices.requestType, requestType), eq(invoices.requestId, requestId), eq(invoices.status, "ISSUED"))).orderBy(asc(invoices.issuedAt))
    let settled = 0
    for (const inv of open) if ((await this.unallocatedPaymentMinor(tx, inv)) >= inv.totalMinor && (await this.markPaid(tx, inv.id, "Verified offline payment"))) settled++
    return settled
  }

  // ---------------- timers ----------------

  private async scheduleExpiry(id: string) {
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, id))
    if (inv?.status === "ISSUED" && inv.expiresAt) await this.timers.schedule(TIMER, timerKey(id), inv.expiresAt, { invoiceId: id })
  }

  async reconcileTimers(): Promise<number> {
    const open = await this.db.select().from(invoices).where(eq(invoices.status, "ISSUED"))
    let added = 0
    for (const inv of open) if (inv.expiresAt && (await this.timers.ensure(TIMER, timerKey(inv.id), inv.expiresAt, { invoiceId: inv.id }))) added++
    return added
  }

  async expireDue(): Promise<{ expired: number }> {
    const open = await this.db.select({ id: invoices.id, expiresAt: invoices.expiresAt }).from(invoices).where(eq(invoices.status, "ISSUED"))
    let expired = 0
    for (const inv of open) if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now() && (await this.expire(inv.id)) === "expired") expired++
    return { expired }
  }

  // ---------------- views ----------------

  async billTo(tx: DbOrTx, userId: string): Promise<string[]> {
    const [u] = await tx.select().from(users).where(eq(users.id, userId))
    const [p] = await tx.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))
    const name = p?.givenNamesLatin && p.surnameLatin ? `${p.givenNamesLatin} ${p.surnameLatin}` : u?.displayName ?? "Customer"
    const address = [p?.addressLine1, p?.addressLine2, [p?.addressPostcode, p?.addressCity].filter(Boolean).join(" "), p?.addressCountry].filter(Boolean) as string[]
    return [name, ...address]
  }

  private async linesOf(ids: string[]) {
    const rows = ids.length ? await this.db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.position)) : []
    const by = new Map<string, typeof rows>()
    for (const l of rows) by.set(l.invoiceId, [...(by.get(l.invoiceId) ?? []), l])
    return by
  }

  private customerView(inv: Inv, lines: (typeof invoiceLines.$inferSelect)[]): CustomerInvoice {
    const m = (amountMinor: number) => ({ amountMinor, currency: inv.currency })
    return {
      number: inv.number!, status: inv.status as CustomerInvoice["status"], requestRef: inv.requestRef as CustomerInvoice["requestRef"], productType: productOf(inv.requestType),
      lines: lines.map((l) => ({ serviceType: l.serviceType as InvoiceLineType | null, description: l.description, quantity: l.quantity, unitAmount: m(l.unitAmountMinor), amount: m(l.amountMinor) })), total: m(inv.totalMinor), notes: inv.notes,
      issuedAt: iso(inv.issuedAt)!, expiresAt: iso(inv.expiresAt)!, paidAt: iso(inv.paidAt), cancelledAt: iso(inv.cancelledAt), cancelReason: (inv.cancelReason as InvoiceCancelCode | null) ?? null, documentId: inv.documentId,
    }
  }

  /** Own invoices and quotations only. A draft does not exist for the customer. */
  async billing(userId: string): Promise<BillingDocuments> {
    const mine = await this.db.select().from(invoices).where(and(eq(invoices.customerUserId, userId), ne(invoices.status, "DRAFT"))).orderBy(desc(invoices.issuedAt))
    const lines = await this.linesOf(mine.map((i) => i.id))
    const quotation = (q: typeof quotes.$inferSelect, ref: string, productType: ReqType) => ({ number: q.documentNumber!, requestRef: ref as CustomerInvoice["requestRef"], productType, status: q.status as "SENT", sentAt: iso(q.sentAt)!, validUntil: iso(q.validUntil), documentId: q.pdfDocumentId })
    const sent = ne(quotes.status, "DRAFT")
    const f = await this.db.select({ q: quotes, ref: flightRequests.ref }).from(quotes).innerJoin(flightRequests, eq(flightRequests.id, quotes.requestId)).where(and(eq(quotes.requestType, "FLIGHT"), eq(flightRequests.customerUserId, userId), sent))
    const c = await this.db.select({ q: quotes, ref: cargoRequests.ref }).from(quotes).innerJoin(cargoRequests, eq(cargoRequests.id, quotes.requestId)).where(and(eq(quotes.requestType, "CARGO"), eq(cargoRequests.customerUserId, userId), sent))
    const sv = await this.db.select({ q: quotes, ref: serviceRequests.ref }).from(quotes).innerJoin(serviceRequests, eq(serviceRequests.id, quotes.requestId)).where(and(eq(quotes.requestType, "SERVICE"), eq(serviceRequests.customerUserId, userId), sent))
    const quotations = [...f.map((x) => ({ ...x, t: "FLIGHT" as const })), ...c.map((x) => ({ ...x, t: "CARGO" as const })), ...sv.map((x) => ({ ...x, t: "SERVICE" as const }))]
      .filter((x) => x.q.documentNumber && x.q.sentAt).sort((a, b) => b.q.sentAt!.getTime() - a.q.sentAt!.getTime()).map((x) => quotation(x.q, x.ref, x.t))
    return { quotations, invoices: mine.map((i) => this.customerView(i, lines.get(i.id) ?? [])) }
  }

  /**
   * "Available for purchase" (ADR-0020): the customer's own issued invoices that can still be paid and the service quotes that
   * can still be accepted. A flight quote has several options, so it is not listed here; the request page shows it.
   */
  async purchasable(userId: string, locale: "en" | "fa"): Promise<PurchasableItem[]> {
    const now = new Date()
    const open = await this.db.select().from(invoices).where(and(eq(invoices.customerUserId, userId), eq(invoices.status, "ISSUED")))
    const openLines = await this.linesOf(open.filter((i) => i.origin === "DIRECT").map((i) => i.id))
    const items: PurchasableItem[] = open.filter((i) => i.expiresAt && i.expiresAt > now).map((i) => ({
      kind: "INVOICE", action: "PAY", requestRef: i.requestRef as PurchasableItem["requestRef"], number: i.number!, title: openLines.get(i.id)?.[0]?.description ?? i.requestRef, productType: productOf(i.requestType),
      amount: { amountMinor: i.totalMinor, currency: i.currency }, dueAt: i.expiresAt!.toISOString(),
    }))
    const sent = await this.db.select({ q: quotes, ref: serviceRequests.ref, type: serviceRequests.type, status: serviceRequests.status }).from(quotes)
      .innerJoin(serviceRequests, eq(serviceRequests.id, quotes.requestId))
      .where(and(eq(quotes.requestType, "SERVICE"), eq(serviceRequests.customerUserId, userId), eq(quotes.status, "SENT"), eq(serviceRequests.status, "QUOTED")))
    for (const { q, ref, type } of sent) {
      if (!q.validUntil || q.validUntil <= now || !q.documentNumber) continue
      const total = serviceQuoteTotal((q.serviceLines ?? []) as ServiceQuoteLine[])
      items.push({ kind: "QUOTE", action: "ACCEPT", requestRef: ref as PurchasableItem["requestRef"], number: q.documentNumber, title: serviceTitle(type, locale), productType: "SERVICE", amount: total, dueAt: q.validUntil.toISOString() })
    }
    return items.sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  }

  async customerInvoice(number: string, userId: string): Promise<CustomerInvoice> {
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.number, number.toUpperCase()))
    if (!inv || inv.customerUserId !== userId || inv.status === "DRAFT") throw notFound("Invoice")
    return this.customerView(inv, (await this.linesOf([inv.id])).get(inv.id) ?? [])
  }

  /** Staff who issue documents see all; others see the product line they can already read. */
  private readable(inv: Inv, actor: Actor): boolean {
    return actor.permissions.has("commercial_document.issue") || actor.permissions.has(inv.requestType === "CARGO" ? "cargo_request.read.any" : inv.requestType === "SERVICE" ? "service_request.read.any" : "flight_request.read.any")
  }

  private async staffItems(all: Inv[], actor: Actor, detail: boolean): Promise<StaffInvoice[]> {
    const rows = all.filter((r) => this.readable(r, actor))
    const see = actor.permissions.has("pricing.read.internal")
    const lines = detail ? await this.linesOf(rows.map((r) => r.id)) : new Map<string, (typeof invoiceLines.$inferSelect)[]>()
    const customerIds = [...new Set(rows.map((r) => r.customerUserId))]
    const names = customerIds.length ? await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, customerIds)) : []
    const emails = customerIds.length ? await this.db.select({ id: userIdentities.userId }).from(userIdentities).where(and(inArray(userIdentities.userId, customerIds), eq(userIdentities.type, "EMAIL"), isNotNull(userIdentities.verifiedAt), isNull(userIdentities.revokedAt))) : []
    const hist = detail && rows.length ? await this.db.select({ h: invoiceStatusHistory, name: users.displayName }).from(invoiceStatusHistory).leftJoin(users, eq(users.id, invoiceStatusHistory.actorUserId)).where(inArray(invoiceStatusHistory.invoiceId, rows.map((r) => r.id))).orderBy(asc(invoiceStatusHistory.createdAt)) : []
    return Promise.all(rows.map(async (inv) => {
      const m = (amountMinor: number) => (see ? { amountMinor, currency: inv.currency } : null)
      const ticketedAt = detail && inv.status === "DRAFT" ? await this.ticketedAt(this.db, inv) : null
      const held = detail && inv.origin === "DIRECT" && inv.status === "DRAFT" ? this.complianceBlock(await this.caseStatuses(this.db, inv.id)) : null
      const acts = detail ? (["issue", "cancel"] as const).flatMap((command) => {
        if (!INVOICE_TRANSITIONS[command].from.includes(inv.status)) return []
        const ev = evaluate(INVOICE_TRANSITIONS, command, this.facts(inv, ticketedAt), staffActor(actor))
        if (command === "issue" && held) return [{ command, allowed: false, reason: held }]
        return [ev.ok ? { command, allowed: true } : { command, allowed: false, reason: ev.reason }]
      }) : []
      return {
        id: inv.id, number: inv.number, status: inv.status, origin: inv.origin, notes: inv.notes, dueDays: inv.dueDays,
        customer: { id: inv.customerUserId, name: names.find((n) => n.id === inv.customerUserId)?.name ?? "", emailDeliverable: emails.some((e) => e.id === inv.customerUserId) },
        requestRef: inv.requestRef as StaffInvoice["requestRef"], productType: productOf(inv.requestType), currency: inv.currency,
        lines: (lines.get(inv.id) ?? []).map((l) => ({ serviceType: l.serviceType as InvoiceLineType | null, description: l.description, quantity: l.quantity, unitAmount: m(l.unitAmountMinor), amount: m(l.amountMinor) })), total: m(inv.totalMinor),
        issuedAt: iso(inv.issuedAt), expiresAt: iso(inv.expiresAt), paidAt: iso(inv.paidAt), cancelledAt: iso(inv.cancelledAt), cancelReason: (inv.cancelReason as InvoiceCancelCode | null) ?? null, documentId: inv.documentId, createdAt: inv.createdAt.toISOString(),
        history: hist.filter((x) => x.h.invoiceId === inv.id).map(({ h, name }) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, command: h.command, reasonCode: h.reasonCode, reasonText: h.reasonText, actorKind: h.actorKind, actorName: name ?? null, createdAt: h.createdAt.toISOString() })),
        actions: acts,
      }
    }))
  }

  async staffById(id: string, actor: Actor): Promise<StaffInvoice> {
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, id))
    const [view] = inv ? await this.staffItems([inv], actor, true) : []
    if (!view) throw notFound("Invoice")
    return view
  }

  async staffForRequest(ref: string, actor: Actor): Promise<StaffInvoice[]> {
    const norm = normaliseReference(ref)
    if (!norm) throw notFound("Request")
    const rows = await this.db.select().from(invoices).where(eq(invoices.requestRef, norm)).orderBy(desc(invoices.createdAt))
    return this.staffItems(rows, actor, true)
  }

  async staffList(filter: { status?: InvoiceStatus; limit: number }, actor: Actor): Promise<StaffInvoiceListItem[]> {
    const rows = await this.db.select().from(invoices).where(filter.status ? eq(invoices.status, filter.status) : undefined).orderBy(desc(invoices.createdAt)).limit(filter.limit)
    return (await this.staffItems(rows, actor, false)).map(({ lines: _l, history: _h, actions: _a, ...item }) => item)
  }
}
