import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"

import {
  type BillingDocuments, CargoQuoteLines, type CustomerInvoice, type InvoiceCancelCode, type InvoiceStatus, type PriceBreakdown, type StaffInvoice, type StaffInvoiceListItem,
} from "@unitravel/contracts"
import {
  cargoRequests, customerProfiles, type Db, type DbOrTx, flightRequests, invoiceLines, invoices, invoiceStatusHistory, paymentRecords, quoteOptions, quotes, tickets, type Tx, users,
} from "@unitravel/db"
import { evaluate, INVOICE_TRANSITIONS, type InvoiceCommand, type InvoiceFacts, invoiceExpiry, type MachineActor, normaliseReference } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { DocumentsService } from "../documents/documents.service"
import { OutboxService } from "../platform/outbox.service"
import { TimersService } from "../platform/timers.service"
import { staffActor, SYSTEM } from "../requests/requests.service"
import { renderInvoicePdf } from "./commercial-pdf"
import { DocumentNumbersService } from "./document-numbers.service"

type Inv = typeof invoices.$inferSelect
type ReqType = "FLIGHT" | "CARGO"
interface Draft { currency: string; lines: { description: string; quantity: number; unitAmountMinor: number; amountMinor: number }[]; totalMinor: number }

const TIMER = "invoice.expire"
const timerKey = (id: string) => `inv:${id}`
const iso = (d: Date | null) => d?.toISOString() ?? null

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
  ) {}

  async onModuleInit() {
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
    return { status: inv.status, productType: inv.requestType === "CARGO" ? "CARGO" : "FLIGHT", atolMode: this.config.get("WORKFLOW").atolMode, now, ticketedAt, expiresAt: inv.expiresAt }
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
        ...(pb.extras ?? []).map((e) => line(e.label, e.amount.amountMinor)), ...(pb.discount ? [line(`Discount - ${pb.discount.label}`, -pb.discount.amount.amountMinor)] : [])]
      totalMinor = pb.total.amountMinor
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
    if (!norm || norm.startsWith("UT-A-")) throw notFound("Request")
    const type: ReqType = norm.startsWith("UT-C-") ? "CARGO" : "FLIGHT"
    const id = await this.uow.run(async (tx) => {
      const [r] = type === "FLIGHT" ? await tx.select().from(flightRequests).where(eq(flightRequests.ref, norm)).for("update") : await tx.select().from(cargoRequests).where(eq(cargoRequests.ref, norm)).for("update")
      if (!r) throw notFound("Request")
      if (["CANCELLED", "DECLINED", "EXPIRED"].includes(r.status)) throw new AppError("INVALID_TRANSITION", `No invoice for a ${r.status} request`)
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
      const cfg = this.config.settings()
      const number = await this.numbers.allocate(tx, "INVOICE", now)
      const expiresAt = invoiceExpiry({ productType: inv.requestType === "CARGO" ? "CARGO" : "FLIGHT", atolMode: this.config.get("WORKFLOW").atolMode, now, validityDays: cfg.commercialDocuments.invoiceValidityDays })
      const paid = (await this.unallocatedPaymentMinor(tx, inv)) >= inv.totalMinor
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position))
      const pdf = await renderInvoicePdf({
        number, requestRef: inv.requestRef, issuedAt: now, expiresAt, paid, currency: inv.currency, totalMinor: inv.totalMinor,
        lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmountMinor: l.unitAmountMinor, amountMinor: l.amountMinor })),
        billTo: await this.billTo(tx, inv.customerUserId), company: cfg.company, cfg: cfg.commercialDocuments,
        notes: this.config.get("WORKFLOW").atolMode === "PAY_ON_TICKETING" && inv.requestType === "FLIGHT" ? ["Flights are sold as an airline ticket agent; payment is taken when tickets are issued (ATOL wording pending counsel review)."] : [],
      })
      const doc = await this.docs.storeGenerated(tx, { ownerUserId: inv.customerUserId, requestType: inv.requestType === "CARGO" ? "CARGO" : "FLIGHT", requestId: inv.requestId, type: "INVOICE", filename: `invoice-${number}.pdf`, body: pdf, createdBy: actor.userId, visibility: "CUSTOMER" })
      await tx.update(invoices).set({ status: "ISSUED", number, issuedAt: now, expiresAt, documentId: doc.id, rowVersion: inv.rowVersion + 1 }).where(eq(invoices.id, inv.id))
      await this.history(tx, inv.id, "DRAFT", "ISSUED", "issue", actor.userId, "STAFF")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "invoice.issued", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number, totalMinor: inv.totalMinor, currency: inv.currency, expiresAt: expiresAt.toISOString() } })
      await this.outbox.add(tx, { aggregateType: "invoice", aggregateId: inv.id, eventType: "invoice.issued", payload: { invoiceId: inv.id, number, ref: inv.requestRef, customerUserId: inv.customerUserId, expiresAt: expiresAt.toISOString(), productType: inv.requestType } })
      if (paid) await this.markPaid(tx, inv.id, "Payment already verified for this request")
      return paid ? "PAID" : "ISSUED"
    })
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

  private async billTo(tx: DbOrTx, userId: string): Promise<string[]> {
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
      number: inv.number!, status: inv.status as CustomerInvoice["status"], requestRef: inv.requestRef as CustomerInvoice["requestRef"], productType: inv.requestType === "CARGO" ? "CARGO" : "FLIGHT",
      lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmount: m(l.unitAmountMinor), amount: m(l.amountMinor) })), total: m(inv.totalMinor),
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
    const quotations = [...f.map((x) => ({ ...x, t: "FLIGHT" as const })), ...c.map((x) => ({ ...x, t: "CARGO" as const }))]
      .filter((x) => x.q.documentNumber && x.q.sentAt).sort((a, b) => b.q.sentAt!.getTime() - a.q.sentAt!.getTime()).map((x) => quotation(x.q, x.ref, x.t))
    return { quotations, invoices: mine.map((i) => this.customerView(i, lines.get(i.id) ?? [])) }
  }

  async customerInvoice(number: string, userId: string): Promise<CustomerInvoice> {
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.number, number.toUpperCase()))
    if (!inv || inv.customerUserId !== userId || inv.status === "DRAFT") throw notFound("Invoice")
    return this.customerView(inv, (await this.linesOf([inv.id])).get(inv.id) ?? [])
  }

  /** Staff who issue documents see all; others see the product line they can already read. */
  private readable(inv: Inv, actor: Actor): boolean {
    return actor.permissions.has("commercial_document.issue") || actor.permissions.has(inv.requestType === "CARGO" ? "cargo_request.read.any" : "flight_request.read.any")
  }

  private async staffItems(all: Inv[], actor: Actor, detail: boolean): Promise<StaffInvoice[]> {
    const rows = all.filter((r) => this.readable(r, actor))
    const see = actor.permissions.has("pricing.read.internal")
    const lines = detail ? await this.linesOf(rows.map((r) => r.id)) : new Map<string, (typeof invoiceLines.$inferSelect)[]>()
    const hist = detail && rows.length ? await this.db.select({ h: invoiceStatusHistory, name: users.displayName }).from(invoiceStatusHistory).leftJoin(users, eq(users.id, invoiceStatusHistory.actorUserId)).where(inArray(invoiceStatusHistory.invoiceId, rows.map((r) => r.id))).orderBy(asc(invoiceStatusHistory.createdAt)) : []
    return Promise.all(rows.map(async (inv) => {
      const m = (amountMinor: number) => (see ? { amountMinor, currency: inv.currency } : null)
      const ticketedAt = detail && inv.status === "DRAFT" ? await this.ticketedAt(this.db, inv) : null
      const acts = detail ? (["issue", "cancel"] as const).flatMap((command) => {
        if (!INVOICE_TRANSITIONS[command].from.includes(inv.status)) return []
        const ev = evaluate(INVOICE_TRANSITIONS, command, this.facts(inv, ticketedAt), staffActor(actor))
        return [ev.ok ? { command, allowed: true } : { command, allowed: false, reason: ev.reason }]
      }) : []
      return {
        id: inv.id, number: inv.number, status: inv.status, requestRef: inv.requestRef as StaffInvoice["requestRef"], productType: inv.requestType === "CARGO" ? "CARGO" as const : "FLIGHT" as const, currency: inv.currency,
        lines: (lines.get(inv.id) ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unitAmount: m(l.unitAmountMinor), amount: m(l.amountMinor) })), total: m(inv.totalMinor),
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
