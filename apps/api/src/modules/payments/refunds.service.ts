import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { z } from "zod"

import type { PaymentProviderId, RefundRejectBody, RefundRequestBody, RefundView, StaffInvoicePayments } from "@unitravel/contracts"
import { type Db, invoices, paymentRecords, paymentSessions, refundRequests, users } from "@unitravel/db"
import { evaluate, needsSecondVerifier, type RefundCommand, REFUND_TRANSITIONS } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { ConfigService } from "../config/config.service"
import { OutboxService } from "../platform/outbox.service"
import { staffActor, SYSTEM } from "../requests/requests.service"
import { PaymentsService } from "./payments.service"

type Refund = typeof refundRequests.$inferSelect

/**
 * Refunds of card payments (ADR-0007 P10). Up to the existing four-eyes threshold the requester's own request goes to
 * the provider; above it a different staff member approves. The invoice and the payment record change only when the
 * verified `charge.refunded` event arrives, never on the API response.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
  ) {}

  private threshold() { return this.config.get("WORKFLOW").paymentFourEyesThresholdMinor }

  async request(invoiceId: string, body: z.infer<typeof RefundRequestBody>, actor: Actor): Promise<RefundView> {
    const created = await this.uow.run(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update")
      if (!inv) throw notFound("Invoice")
      if (inv.status !== "PAID") throw new AppError("INVALID_TRANSITION", `Only a PAID invoice can be refunded (this one is ${inv.status})`)
      const [p] = await tx.select().from(paymentRecords).where(and(eq(paymentRecords.invoiceId, inv.id), eq(paymentRecords.method, "CARD_ONLINE"), eq(paymentRecords.status, "VERIFIED"))).for("update")
      if (!p?.providerRef) throw new AppError("INVALID_TRANSITION", "There is no online card payment on this invoice; refund offline payments outside the system")
      const open = await tx.select().from(refundRequests).where(and(eq(refundRequests.paymentRecordId, p.id), inArray(refundRequests.status, ["PENDING_APPROVAL", "SUBMITTED"])))
      const remaining = p.amountMinor - p.refundedMinor - open.reduce((s, r) => s + r.amountMinor, 0)
      const amount = body.amountMinor ?? remaining
      if (remaining <= 0) throw new AppError("INVALID_TRANSITION", "Nothing is left to refund on this payment")
      if (amount < 1 || amount > remaining) throw new AppError("VALIDATION_FAILED", `The refund must be between 0.01 and ${(remaining / 100).toFixed(2)} ${inv.currency}`)
      const [row] = await tx.insert(refundRequests).values({ invoiceId: inv.id, paymentRecordId: p.id, amountMinor: amount, currency: p.currency, reasonCode: body.reasonCode, note: body.note ?? null, requestedBy: actor.userId }).returning()
      // The threshold applies to the running total of refunds on this payment that no second person approved (the
      // requester's own submissions), so splitting one refund into several small ones cannot avoid the second approver
      // (ch. 13.7). Amounts a different person approved do not count.
      const earlier = await tx.select({ amountMinor: refundRequests.amountMinor, requestedBy: refundRequests.requestedBy, approvedBy: refundRequests.approvedBy }).from(refundRequests).where(and(eq(refundRequests.paymentRecordId, p.id), inArray(refundRequests.status, ["SUBMITTED", "COMPLETED"])))
      const selfApproved = earlier.filter((r) => r.approvedBy === r.requestedBy).reduce((s, r) => s + r.amountMinor, 0)
      const four = needsSecondVerifier(amount + selfApproved, this.threshold())
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "refund.requested", entityType: "refund_request", entityId: row!.id, contextRef: inv.requestRef, after: { invoice: inv.number, amountMinor: amount, currency: p.currency, reasonCode: body.reasonCode, fourEyes: four } })
      return { row: row!, four }
    })
    if (!created.four) await this.advance(created.row.id, "submit", actor)
    return (await this.views([created.row.id]))[0]!
  }

  async approve(id: string, actor: Actor): Promise<RefundView> {
    await this.advance(id, "approve", actor)
    return (await this.views([id]))[0]!
  }

  async reject(id: string, body: z.infer<typeof RefundRejectBody>, actor: Actor): Promise<RefundView> {
    await this.uow.run(async (tx) => {
      const r = await this.lock(tx, id)
      const ev = this.evaluateFor(r, "reject", actor)
      await tx.update(refundRequests).set({ status: ev.to, approvedBy: actor.userId, decidedAt: new Date(), failure: body.note }).where(eq(refundRequests.id, r.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "refund.rejected", entityType: "refund_request", entityId: r.id, contextRef: r.invoiceId, after: { note: body.note } })
    })
    return (await this.views([id]))[0]!
  }

  private async lock(tx: Parameters<Parameters<UnitOfWork["run"]>[0]>[0], id: string): Promise<Refund> {
    const [r] = await tx.select().from(refundRequests).where(eq(refundRequests.id, id)).for("update")
    if (!r) throw notFound("Refund request")
    return r
  }

  private evaluateFor(r: Refund, command: RefundCommand, actor: Actor) {
    const ev = evaluate(REFUND_TRANSITIONS, command, { status: r.status, requestedBy: r.requestedBy, actorId: actor.userId, amountMinor: r.amountMinor, thresholdMinor: this.threshold() }, staffActor(actor))
    if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : r.requestedBy === actor.userId && command === "approve" ? "FOUR_EYES_REQUIRED" : "INVALID_TRANSITION", ev.reason)
    return ev
  }

  /** `submit` (author, within the threshold) or `approve` (a different person above it), then the provider call. */
  private async advance(id: string, command: "submit" | "approve", actor: Actor) {
    const r = await this.uow.run(async (tx) => {
      const row = await this.lock(tx, id)
      const ev = this.evaluateFor(row, command, actor)
      await tx.update(refundRequests).set({ status: ev.to, approvedBy: actor.userId, decidedAt: new Date() }).where(eq(refundRequests.id, row.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: command === "approve" ? "refund.approved" : "refund.submitted", entityType: "refund_request", entityId: row.id, contextRef: row.invoiceId, after: { amountMinor: row.amountMinor, currency: row.currency } })
      return row
    })
    await this.sendToProvider(r)
  }

  private async sendToProvider(r: Refund) {
    const [p] = await this.db.select().from(paymentRecords).where(eq(paymentRecords.id, r.paymentRecordId))
    try {
      const adapter = await this.payments.adapterFor(p!.provider as PaymentProviderId)
      const res = await adapter.createRefund({ paymentIntentId: p!.providerRef!, amountMinor: r.amountMinor, idempotencyKey: `refund-${r.id}`, refundId: r.id })
      await this.db.update(refundRequests).set({ providerRefundId: res.id }).where(eq(refundRequests.id, r.id))
    } catch (err) {
      const e = err as { code?: string; type?: string; detail?: string }
      const failure = (e instanceof AppError ? e.detail : [e.type, e.code].filter(Boolean).join(" ")) || "The provider refused the refund"
      await this.uow.run(async (tx) => {
        const row = await this.lock(tx, r.id)
        const ev = evaluate(REFUND_TRANSITIONS, "fail", { status: row.status, requestedBy: row.requestedBy, amountMinor: row.amountMinor, thresholdMinor: this.threshold() }, SYSTEM)
        if (!ev.ok) return
        await tx.update(refundRequests).set({ status: ev.to, failure: failure.slice(0, 300) }).where(eq(refundRequests.id, r.id))
        await this.audit.record(tx, { actorKind: "SYSTEM", action: "refund.failed", entityType: "refund_request", entityId: r.id, contextRef: r.invoiceId, after: { failure } })
      })
    }
  }

  // ---------------- views ----------------

  private async views(ids: string[], withAmounts = true): Promise<RefundView[]> {
    const rows = ids.length ? await this.db.select().from(refundRequests).where(inArray(refundRequests.id, ids)).orderBy(asc(refundRequests.createdAt)) : []
    return this.toViews(rows, withAmounts)
  }

  private async toViews(rows: Refund[], withAmounts: boolean): Promise<RefundView[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.approvedBy].filter((x): x is string => !!x)))]
    const names = new Map((ids.length ? await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, u.name]))
    return rows.map((r) => ({
      id: r.id, status: r.status, amount: withAmounts ? { amountMinor: r.amountMinor, currency: r.currency } : null, reasonCode: r.reasonCode, note: r.note,
      requestedBy: names.get(r.requestedBy) ?? r.requestedBy, approvedBy: r.approvedBy ? names.get(r.approvedBy) ?? r.approvedBy : null,
      // Within-threshold requests are submitted at once, so a pending one always waits for a second person.
      needsSecondApprover: r.status === "PENDING_APPROVAL", failure: r.failure, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
    }))
  }

  /** Payment status of an invoice for the Admin Panel; amounts follow `pricing.read.internal` like the invoice itself (ADR-0004). */
  async staffView(invoiceId: string, actor: Actor): Promise<StaffInvoicePayments> {
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, invoiceId))
    if (!inv) throw notFound("Invoice")
    const amounts = actor.permissions.has("pricing.read.internal")
    const online = await this.payments.eligibility(inv)
    const sessions = await this.db.select().from(paymentSessions).where(eq(paymentSessions.invoiceId, inv.id)).orderBy(asc(paymentSessions.attempt))
    const pays = await this.db.select().from(paymentRecords).where(eq(paymentRecords.invoiceId, inv.id)).orderBy(asc(paymentRecords.createdAt))
    const refunds = await this.db.select().from(refundRequests).where(eq(refundRequests.invoiceId, inv.id)).orderBy(asc(refundRequests.createdAt))
    return {
      invoiceId: inv.id, online, provider: (await this.payments.provider()).adapter?.id ?? null,
      sessions: sessions.map((s) => ({ id: s.id, provider: s.provider, status: s.status, expiresAt: s.expiresAt.toISOString(), createdAt: s.createdAt.toISOString() })),
      payments: pays.map((p) => ({ id: p.id, method: p.method, amount: amounts ? { amountMinor: p.amountMinor, currency: p.currency } : null, refunded: amounts ? { amountMinor: p.refundedMinor, currency: p.currency } : null, status: p.status, receivedAt: p.receivedAt.toISOString(), providerRef: p.providerRef ? `${p.providerRef.slice(0, 7)}…${p.providerRef.slice(-4)}` : null })),
      refunds: await this.toViews(refunds, amounts),
      refundThreshold: amounts ? { amountMinor: this.threshold(), currency: inv.currency } : null,
    }
  }
}
