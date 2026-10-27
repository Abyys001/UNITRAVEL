import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, lt, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import type Stripe from "stripe"

import type { CheckoutSessionView, CustomerPaymentState, OnlinePaymentEligibility, PaymentProviderId } from "@unitravel/contracts"
import { type Db, invoices, paymentConfig, paymentRecords, paymentSessions, refundRequests, stripeEvents, type Tx, users } from "@unitravel/db"
import { canEnterStripeMode, checkoutExpiry, onlinePaymentEligibility, sessionNext, type SessionCommand, settlementCheck } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import { env, sandboxAllowed } from "../../core/env"
import type { Actor } from "../../core/http/decorators"
import { DB, REDIS, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import { BookingsService } from "../bookings/bookings.service"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { InvoicesService } from "../invoices/invoices.service"
import { VendorCredentialsService } from "../notifications/vendor-credentials.service"
import { TimersService } from "../platform/timers.service"
import { OutboxService } from "../platform/outbox.service"
import { SYSTEM } from "../requests/requests.service"
import { FakePaymentAdapter } from "./fake-payment.adapter"
import type { PaymentProvider, ProviderSession } from "./payment-port"
import { StripeAdapter } from "./stripe.adapter"
import { productOf } from "../invoices/product"

type Inv = typeof invoices.$inferSelect
type SessionRow = typeof paymentSessions.$inferSelect
type Outcome = "PROCESSED" | "IGNORED" | "MISMATCH"
interface Paid { amountMinor: number; currency: string; paymentIntentId: string; payerName: string | null }

export const STRIPE_VENDOR = "stripe:test"
const TIMER = "payment.reconcile"
const timerKey = (id: string) => `ps:${id}`
/** Reconcile a little after the session's expiry, when no webhook can arrive any more. */
const RECONCILE_GRACE_MS = 2 * 60_000
const OVERDUE_MS = 30 * 60_000
const fmt = (minor: number, cur: string) => `${(minor / 100).toFixed(2)} ${cur}`
const piOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null)

/**
 * Online card payment (ADR-0007). The amount comes from the invoice, the browser only ever gets a client secret, and
 * only a verified provider event (or the reconciliation job reading the provider) records a payment and settles
 * the invoice, through the Phase C seam (`InvoicesService.markPaid`).
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly log = new Logger("Payments")
  private cached?: { at: number; provider: PaymentProvider | null; id: PaymentProviderId }

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly invoices: InvoicesService,
    private readonly bookings: BookingsService,
    private readonly compliance: ComplianceService,
    private readonly vendors: VendorCredentialsService,
    private readonly timers: TimersService,
    private readonly queues: Queues,
    private readonly workers: WorkerRegistry,
  ) {}

  async onModuleInit() {
    this.timers.onTimer(TIMER, (d) => this.reconcileSession(String(d.sessionId)))
    this.timers.onReconcile(() => this.reconcileTimers())
    this.workers.registerJob("maintenance", "payments.reconcile", () => this.reconcileOverdue())
    await this.queues.get("maintenance").upsertJobScheduler("payments-reconcile-every-10m", { every: 10 * 60_000 }, { name: "payments.reconcile" }).catch(() => undefined)
  }

  // ---------------- provider ----------------

  invalidateProvider() { this.cached = undefined }

  async configRow() {
    const [row] = await this.db.select().from(paymentConfig).where(eq(paymentConfig.key, "stripe"))
    return row ?? { key: "stripe", provider: "STRIPE" as const, mode: "test" as const, pendingMode: null, pendingBy: null, pendingAt: null, updatedBy: null, updatedAt: new Date() }
  }

  /** The configured provider, or null when it cannot be used (no keys, FAKE or test mode outside local, live mode). */
  async provider(): Promise<{ id: PaymentProviderId; adapter: PaymentProvider | null }> {
    if (this.cached && Date.now() - this.cached.at < 10_000) return { id: this.cached.id, adapter: this.cached.provider }
    const cfg = await this.configRow()
    let adapter: PaymentProvider | null = null
    if (canEnterStripeMode(cfg.mode, !sandboxAllowed()).ok) {
      if (cfg.provider === "FAKE") {
        if (sandboxAllowed()) adapter = new FakePaymentAdapter(this.redis)
      } else {
        const c = await this.vendors.get(STRIPE_VENDOR)
        if (c?.secretKey && c.webhookSecret) adapter = new StripeAdapter({ secretKey: c.secretKey, publishableKey: c.publishableKey ?? null, webhookSecret: c.webhookSecret })
      }
    }
    this.cached = { at: Date.now(), provider: adapter, id: cfg.provider }
    return { id: cfg.provider, adapter }
  }

  /** The adapter that took a payment, for refunds and reconciliation (the active provider may have changed since). */
  async adapterFor(id: PaymentProviderId): Promise<PaymentProvider> {
    const p = await this.provider()
    if (!p.adapter || p.id !== id) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", `The ${id} provider is not active; switch the provider in the Developer Panel first`)
    return p.adapter
  }

  async fake(): Promise<FakePaymentAdapter | null> {
    const p = await this.provider()
    return p.adapter instanceof FakePaymentAdapter ? p.adapter : null
  }

  // ---------------- eligibility ----------------

  async eligibility(inv: Pick<Inv, "status" | "requestType" | "currency" | "totalMinor" | "customerUserId" | "expiresAt">, now = new Date()): Promise<OnlinePaymentEligibility> {
    const reasons: OnlinePaymentEligibility["reasons"] = []
    if (!this.config.flag("payments.online.enabled")) reasons.push("FLAG_OFF")
    if (inv.status !== "ISSUED") reasons.push("NOT_ISSUED")
    const policy = onlinePaymentEligibility(await this.compliance.onlinePaymentPolicies(), { product: productOf(inv.requestType), currency: inv.currency, totalMinor: inv.totalMinor, customerUserId: inv.customerUserId })
    reasons.push(...policy.reasons)
    if (inv.expiresAt && !checkoutExpiry(inv.expiresAt, now)) reasons.push("EXPIRES_TOO_SOON")
    if (!(await this.provider()).adapter) reasons.push("NOT_CONFIGURED")
    return { offered: reasons.length === 0, reasons }
  }

  // ---------------- customer ----------------

  private async ownInvoice(number: string, userId: string): Promise<Inv> {
    const [inv] = await this.db.select().from(invoices).where(and(eq(invoices.number, number), eq(invoices.customerUserId, userId)))
    if (!inv || inv.status === "DRAFT") throw notFound("Invoice")
    return inv
  }

  /** Reads our database only: the redirect from the provider is never proof of payment (ADR-0007 P7). */
  async state(number: string, actor: Actor): Promise<CustomerPaymentState> {
    const inv = await this.ownInvoice(number, actor.userId)
    const [last] = await this.db.select().from(paymentSessions).where(eq(paymentSessions.invoiceId, inv.id)).orderBy(desc(paymentSessions.createdAt)).limit(1)
    const elig = await this.eligibility(inv)
    return {
      invoiceNumber: inv.number!, requestRef: inv.requestRef, invoiceStatus: inv.status as "ISSUED", total: { amountMinor: inv.totalMinor, currency: inv.currency }, expiresAt: inv.expiresAt!.toISOString(),
      offered: elig.offered, reasons: elig.reasons, provider: (await this.provider()).adapter?.id ?? null,
      session: last ? { status: last.status, expiresAt: last.expiresAt.toISOString() } : null,
      processing: inv.status === "ISSUED" && !!last && last.status === "OPEN" && !!last.paymentIntentId,
      paidAt: inv.paidAt?.toISOString() ?? null,
    }
  }

  /** One reusable open session per invoice (P4). Amount and currency are the invoice's; the body of the request carries nothing. */
  async checkout(number: string, actor: Actor): Promise<CheckoutSessionView> {
    const inv0 = await this.ownInvoice(number, actor.userId)
    const elig = await this.eligibility(inv0)
    if (!elig.offered) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", `Online payment is not offered for this invoice (${elig.reasons.join(", ")})`, undefined, { reasons: elig.reasons })
    const { adapter } = await this.provider()
    if (!adapter) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", "Online payment is not configured")
    const now = new Date()

    const out = await this.uow.run(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, inv0.id)).for("update")
      if (!inv || inv.status !== "ISSUED") throw new AppError("INVALID_TRANSITION", "This invoice can no longer be paid")
      const sessions = await tx.select().from(paymentSessions).where(eq(paymentSessions.invoiceId, inv.id)).orderBy(asc(paymentSessions.attempt))
      const open = sessions.find((s) => s.status === "OPEN")
      if (open) {
        const live = open.provider === adapter.id ? await adapter.retrieveSession(open.providerSessionId) : null
        if (live?.status === "open" && live.clientSecret) return { row: open, secret: live.clientSecret, created: false }
        if (live?.status === "complete") throw new AppError("INVALID_TRANSITION", "A payment for this invoice is already being processed")
        // Closed at the provider (expired, or another provider is active now): close ours and start over.
        await this.closeSession(tx, open, "expire")
      }
      const expiresAt = checkoutExpiry(inv.expiresAt!, now)
      if (!expiresAt) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", "Too little time is left on this invoice", undefined, { reasons: ["EXPIRES_TOO_SOON"] })
      const attempt = (sessions.at(-1)?.attempt ?? 0) + 1
      const returnUrl = `${env().PUBLIC_WEB_URL}/${actor.locale}/billing/${inv.number}/pay/return?session_id={CHECKOUT_SESSION_ID}`
      const created = await adapter.createSession({ invoiceId: inv.id, invoiceNumber: inv.number!, amountMinor: inv.totalMinor, currency: inv.currency, expiresAt, returnUrl, idempotencyKey: `inv-${inv.id}-${attempt}` })
      if (!created.clientSecret) throw new AppError("INTERNAL", "The provider returned no client secret")
      const [row] = await tx.insert(paymentSessions).values({
        invoiceId: inv.id, provider: adapter.id, mode: "test", providerSessionId: created.id, amountMinor: inv.totalMinor, currency: inv.currency, attempt, expiresAt, createdBy: actor.userId,
      }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "payment.session_created", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number: inv.number, provider: adapter.id, attempt, expiresAt: expiresAt.toISOString() } })
      return { row: row!, secret: created.clientSecret, created: true }
    })
    if (out.created) await this.timers.schedule(TIMER, timerKey(out.row.id), new Date(out.row.expiresAt.getTime() + RECONCILE_GRACE_MS), { sessionId: out.row.id })
    return { provider: adapter.id, clientSecret: out.secret, publishableKey: adapter.publishableKey, expiresAt: out.row.expiresAt.toISOString(), invoiceNumber: number }
  }

  /** Staff resend the payment link: the customer gets the invoice message again, whose link opens the page with the Pay button (ADR-0007 P18). */
  async resendLink(invoiceId: string, actor: Actor) {
    await this.uow.run(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update")
      if (!inv) throw notFound("Invoice")
      if (inv.status !== "ISSUED") throw new AppError("INVALID_TRANSITION", `Only an ISSUED invoice can be paid (this one is ${inv.status})`)
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "payment.link_resent", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number: inv.number }, ip: actor.ip })
      await this.outbox.add(tx, { aggregateType: "invoice", aggregateId: inv.id, eventType: "invoice.issued", payload: { invoiceId: inv.id, number: inv.number, ref: inv.requestRef, customerUserId: inv.customerUserId, expiresAt: inv.expiresAt!.toISOString(), productType: inv.requestType } })
    })
    return { ok: true }
  }

  private async closeSession(tx: Tx, s: SessionRow, command: SessionCommand, extra: Partial<typeof paymentSessions.$inferInsert> = {}): Promise<boolean> {
    const next = sessionNext(s.status, command, SYSTEM)
    if (!next) return false
    await tx.update(paymentSessions).set({ status: next, ...(next === "COMPLETE" ? { completedAt: new Date() } : {}), ...extra }).where(eq(paymentSessions.id, s.id))
    s.status = next
    return true
  }

  // ---------------- webhook ----------------

  /** Entry point of `POST /v1/webhooks/stripe` (also used by the FAKE simulator): verify, record once, process. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true; duplicate?: true }> {
    const { adapter } = await this.provider()
    if (!adapter) throw new AppError("SIGNATURE_INVALID", "No webhook secret is configured")
    const event = adapter.verifyWebhook(rawBody, signature)
    try {
      const processed = await this.uow.run(async (tx) => {
        const o = event.data.object as unknown as { id?: string }
        // A first delivery inserts; a retry of a FAILED event updates it; a PROCESSED duplicate returns no row and is a no-op.
        const [claimed] = await tx.insert(stripeEvents).values({ id: event.id, type: event.type, mode: event.livemode ? "live" : "test", outcome: "IGNORED", objectId: o.id ?? null })
          .onConflictDoUpdate({ target: stripeEvents.id, set: { outcome: "IGNORED", error: null, receivedAt: new Date() }, setWhere: eq(stripeEvents.outcome, "FAILED") }).returning({ id: stripeEvents.id })
        if (!claimed) return false
        const outcome = await this.dispatch(tx, event)
        await tx.update(stripeEvents).set({ outcome, processedAt: new Date() }).where(eq(stripeEvents.id, event.id))
        return true
      })
      return processed ? { received: true } : { received: true, duplicate: true }
    } catch (err) {
      // The effects rolled back; keep a FAILED row (no secrets, no payload) so the Developer Panel shows it and the retry runs again.
      // Only the kind of failure: a database error message can carry the query parameters (payer name, ids).
      const message = err instanceof AppError ? (err.detail ?? err.code).slice(0, 200) : `${err instanceof Error ? err.name : "Error"}${(err as { cause?: { code?: string } }).cause?.code ? ` (database ${(err as { cause: { code: string } }).cause.code})` : ""}`
      await this.db.insert(stripeEvents).values({ id: event.id, type: event.type, mode: event.livemode ? "live" : "test", outcome: "FAILED", error: message, objectId: (event.data.object as { id?: string }).id ?? null })
        .onConflictDoUpdate({ target: stripeEvents.id, set: { outcome: "FAILED", error: message }, setWhere: eq(stripeEvents.outcome, "FAILED") }).catch(() => undefined)
      this.log.error({ event: event.id, type: event.type, err: message }, "webhook processing failed")
      throw new AppError("INTERNAL", "Event processing failed; it will be retried")
    }
  }

  private async dispatch(tx: Tx, event: Stripe.Event): Promise<Outcome> {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return this.onSessionPaid(tx, event.data.object as Stripe.Checkout.Session, event.type)
      case "checkout.session.async_payment_failed":
        return this.onSessionClosed(tx, event.data.object as Stripe.Checkout.Session, "fail")
      case "checkout.session.expired":
        return this.onSessionClosed(tx, event.data.object as Stripe.Checkout.Session, "expire")
      case "charge.refunded":
        return this.onChargeRefunded(tx, event.data.object as Stripe.Charge)
      case "charge.dispute.created": case "charge.dispute.updated": case "charge.dispute.closed": case "charge.dispute.funds_withdrawn": case "charge.dispute.funds_reinstated":
        return this.onDispute(tx, event.data.object as Stripe.Dispute, event.type)
      default:
        return "IGNORED"
    }
  }

  private async sessionByProviderId(tx: Tx, providerSessionId: string): Promise<SessionRow | undefined> {
    const [s] = await tx.select().from(paymentSessions).where(eq(paymentSessions.providerSessionId, providerSessionId)).for("update")
    return s
  }

  private async onSessionPaid(tx: Tx, obj: Stripe.Checkout.Session, type: string): Promise<Outcome> {
    const s = await this.sessionByProviderId(tx, obj.id)
    if (!s) return "IGNORED"
    const pi = piOf(obj.payment_intent)
    if (obj.payment_status === "unpaid" && type === "checkout.session.completed") {
      // Asynchronous method: the money has not arrived yet; wait for async_payment_succeeded or failed.
      if (pi) await tx.update(paymentSessions).set({ paymentIntentId: pi }).where(eq(paymentSessions.id, s.id))
      return "PROCESSED"
    }
    if (obj.payment_status !== "paid" || !pi || obj.amount_total == null || !obj.currency) return "IGNORED"
    return this.settle(tx, s, { amountMinor: obj.amount_total, currency: obj.currency.toUpperCase(), paymentIntentId: pi, payerName: obj.customer_details?.name ?? null }, "webhook")
  }

  private async onSessionClosed(tx: Tx, obj: Stripe.Checkout.Session, command: "fail" | "expire"): Promise<Outcome> {
    const s = await this.sessionByProviderId(tx, obj.id)
    if (!s) return "IGNORED"
    if (await this.closeSession(tx, s, command)) {
      const [inv] = await tx.select({ ref: invoices.requestRef }).from(invoices).where(eq(invoices.id, s.invoiceId))
      await this.audit.record(tx, { actorKind: "SYSTEM", action: command === "fail" ? "payment.session_failed" : "payment.session_expired", entityType: "invoice", entityId: s.invoiceId, contextRef: inv?.ref, after: { provider: s.provider } })
    }
    return "PROCESSED"
  }

  /** The one place a verified card payment becomes a payment record and a PAID invoice (webhook and reconciliation alike). */
  private async settle(tx: Tx, s: SessionRow, paid: Paid, source: "webhook" | "reconciliation"): Promise<Outcome> {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, s.invoiceId)).for("update")
    if (!inv) throw notFound("Invoice")
    const [existing] = await tx.select({ id: paymentRecords.id }).from(paymentRecords).where(eq(paymentRecords.providerRef, paid.paymentIntentId))
    if (existing) { await this.closeSession(tx, s, "complete", { paymentIntentId: paid.paymentIntentId }); return "PROCESSED" }

    const mismatch = settlementCheck(inv, paid) === "MISMATCH"
    if (mismatch || inv.status !== "ISSUED") {
      await this.closeSession(tx, s, "mismatch", { paymentIntentId: paid.paymentIntentId })
      const why = mismatch ? `Paid ${fmt(paid.amountMinor, paid.currency)} but the invoice is ${fmt(inv.totalMinor, inv.currency)}` : `Payment arrived for an invoice that is ${inv.status}`
      const c = await this.compliance.openCase(tx, {
        requestType: productOf(inv.requestType), requestId: inv.requestId, requestRef: inv.requestRef, trigger: "POLICY",
        summary: "Card payment does not match its invoice; ops decision needed (usually a refund)",
        evidence: [{ kind: "PAYMENT_MISMATCH", label: `Invoice ${inv.number}`, detail: `${why}. PaymentIntent ${paid.paymentIntentId}, provider ${s.provider}, ${source}.` }],
      })
      await this.audit.record(tx, { actorKind: "SYSTEM", action: "payment.mismatch", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number: inv.number, expectedMinor: inv.totalMinor, paidMinor: paid.amountMinor, paidCurrency: paid.currency, invoiceStatus: inv.status, caseId: c.id, source } })
      return "MISMATCH"
    }

    const [u] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, inv.customerUserId))
    const payer = (paid.payerName ?? u?.name ?? "Card payer").slice(0, 120).padEnd(2, " ")
    // Screening a payer after the money moved cannot undo it; a hit opens a case and the payment is still recorded (ADR-0007 P9).
    const scr = await this.compliance.screen(tx, { subjectType: "PAYER", subjectRef: `${inv.requestId}:${payer}`, name: payer, contextRef: inv.requestRef })
    if (scr.result !== "CLEAR") {
      await this.compliance.openCase(tx, { requestType: productOf(inv.requestType), requestId: inv.requestId, requestRef: inv.requestRef, trigger: "SCREENING", summary: "Card payer needs a compliance decision", evidence: scr.hits.map((h) => ({ kind: "PAYER_MATCH", label: `${payer} ↔ ${h.matchedName}`, detail: `${h.listId} ${h.externalId}`, score: h.score })), screeningIds: [scr.screeningId] })
    }
    const now = new Date()
    const [rec] = await tx.insert(paymentRecords).values({
      requestType: inv.requestType, requestId: inv.requestId, amountMinor: paid.amountMinor, currency: paid.currency, method: "CARD_ONLINE", receivedAt: now, externalReference: paid.paymentIntentId.slice(0, 80),
      payerName: payer, payerScreeningId: scr.screeningId, status: "VERIFIED", recordedBy: null, verifiedBy: null, verifiedAt: now, invoiceId: inv.id, provider: s.provider, providerRef: paid.paymentIntentId,
    }).returning()
    await this.closeSession(tx, s, "complete", { paymentIntentId: paid.paymentIntentId })
    if (inv.requestType === "FLIGHT") await this.bookings.afterOnlinePayment(tx, inv.requestId)
    await this.audit.record(tx, { actorKind: "SYSTEM", action: "payment.online_received", entityType: "payment_record", entityId: rec!.id, contextRef: inv.requestRef, after: { invoice: inv.number, amountMinor: paid.amountMinor, currency: paid.currency, provider: s.provider, source } })
    await this.invoices.markPaid(tx, inv.id, `Card payment (${s.provider}, ${source})`)
    return "PROCESSED"
  }

  private async onChargeRefunded(tx: Tx, charge: Stripe.Charge): Promise<Outcome> {
    const pi = piOf(charge.payment_intent)
    if (!pi) return "IGNORED"
    const [p] = await tx.select().from(paymentRecords).where(eq(paymentRecords.providerRef, pi)).for("update")
    if (!p) return "IGNORED"
    const refunded = Math.min(charge.amount_refunded, p.amountMinor)
    if (refunded <= p.refundedMinor) return "PROCESSED"
    const full = refunded >= p.amountMinor
    await tx.update(paymentRecords).set({ refundedMinor: refunded, ...(full ? { status: "REFUNDED" as const } : {}) }).where(eq(paymentRecords.id, p.id))
    // Requests the provider has now covered (oldest first) are complete.
    let covered = refunded
    const sent = await tx.select().from(refundRequests).where(and(eq(refundRequests.paymentRecordId, p.id), eq(refundRequests.status, "SUBMITTED"))).orderBy(asc(refundRequests.createdAt))
    for (const r of sent) {
      if (r.amountMinor > covered) break
      covered -= r.amountMinor
      await tx.update(refundRequests).set({ status: "COMPLETED" }).where(eq(refundRequests.id, r.id))
      await this.audit.record(tx, { actorKind: "SYSTEM", action: "refund.completed", entityType: "refund_request", entityId: r.id, contextRef: p.invoiceId, after: { amountMinor: r.amountMinor } })
    }
    const [inv] = p.invoiceId ? await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId)) : []
    await this.audit.record(tx, { actorKind: "SYSTEM", action: "payment.refunded", entityType: "payment_record", entityId: p.id, contextRef: inv?.requestRef, after: { refundedMinor: refunded, full } })
    if (full && inv) {
      await this.invoices.markRefunded(tx, inv.id, `Card payment refunded (${p.provider})`)
      if (inv.requestType === "FLIGHT") await this.bookings.afterOnlinePayment(tx, inv.requestId)
    }
    return "PROCESSED"
  }

  /** A dispute changes no state by itself; it opens a case for staff and is audited (ADR-0007 P8). */
  private async onDispute(tx: Tx, d: Stripe.Dispute, type: string): Promise<Outcome> {
    const pi = piOf(d.payment_intent)
    const [p] = pi ? await tx.select().from(paymentRecords).where(eq(paymentRecords.providerRef, pi)) : []
    const [inv] = p?.invoiceId ? await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId)) : []
    if (!p || !inv) return "IGNORED"
    await this.audit.record(tx, { actorKind: "SYSTEM", action: `payment.${type.replace("charge.", "").replace(".", "_")}`, entityType: "payment_record", entityId: p.id, contextRef: inv.requestRef, after: { dispute: d.id, reason: d.reason, status: d.status, amountMinor: d.amount } })
    if (type === "charge.dispute.created") {
      await this.compliance.openCase(tx, {
        requestType: productOf(inv.requestType), requestId: inv.requestId, requestRef: inv.requestRef, trigger: "POLICY", summary: "Card dispute opened by the cardholder's bank",
        evidence: [{ kind: "CARD_DISPUTE", label: `Invoice ${inv.number}`, detail: `Dispute ${d.id}, reason ${d.reason}, ${fmt(d.amount, d.currency.toUpperCase())}. Respond in the Stripe Dashboard before the deadline.` }],
      })
    }
    return "PROCESSED"
  }

  // ---------------- reconciliation (ADR-0007 P15) ----------------

  private fromProvider(ps: ProviderSession): Paid | null {
    return ps.status === "complete" && ps.paymentStatus === "paid" && ps.paymentIntentId && ps.amountTotal != null && ps.currency
      ? { amountMinor: ps.amountTotal, currency: ps.currency, paymentIntentId: ps.paymentIntentId, payerName: ps.payerName }
      : null
  }

  /** Asks the provider what became of a session whose webhook may have been missed; same handler as the webhook. */
  async reconcileSession(id: string): Promise<"settled" | "closed" | "waiting" | "skipped"> {
    const [row] = await this.db.select().from(paymentSessions).where(eq(paymentSessions.id, id))
    if (!row || row.status !== "OPEN") return "skipped"
    const adapter = await this.adapterFor(row.provider)
    const ps = await adapter.retrieveSession(row.providerSessionId)
    if (!ps) return "waiting"
    const paid = this.fromProvider(ps)
    return this.uow.run(async (tx) => {
      const s = await this.sessionByProviderId(tx, row.providerSessionId)
      if (!s || s.status !== "OPEN") return "skipped"
      if (paid) {
        const o = await this.settle(tx, s, paid, "reconciliation")
        await this.audit.record(tx, { actorKind: "SYSTEM", action: "payment.reconciled", entityType: "invoice", entityId: s.invoiceId, after: { provider: s.provider, outcome: o } })
        return "settled"
      }
      if (ps.status === "expired" || (ps.status === "open" && s.expiresAt.getTime() + RECONCILE_GRACE_MS <= Date.now())) {
        await this.closeSession(tx, s, "expire")
        return "closed"
      }
      return "waiting"
    })
  }

  /** Runs even when the feature flag is off: money may already have moved. */
  async reconcileOverdue(): Promise<{ checked: number; settled: number }> {
    const rows = await this.db.select({ id: paymentSessions.id }).from(paymentSessions).where(and(eq(paymentSessions.status, "OPEN"), lt(paymentSessions.createdAt, new Date(Date.now() - OVERDUE_MS))))
    let settled = 0
    for (const r of rows) {
      try { if ((await this.reconcileSession(r.id)) === "settled") settled++ } catch (err) { this.log.warn({ session: r.id, err: String(err) }, "reconcile failed") }
    }
    return { checked: rows.length, settled }
  }

  async reconcileTimers(): Promise<number> {
    const open = await this.db.select().from(paymentSessions).where(eq(paymentSessions.status, "OPEN"))
    let added = 0
    for (const s of open) if (await this.timers.ensure(TIMER, timerKey(s.id), new Date(s.expiresAt.getTime() + RECONCILE_GRACE_MS), { sessionId: s.id })) added++
    return added
  }

  /** Counts for the Developer Panel. */
  async counts() {
    const [f] = await this.db.select({ n: sql<number>`count(*)::int` }).from(stripeEvents).where(eq(stripeEvents.outcome, "FAILED"))
    const [o] = await this.db.select({ n: sql<number>`count(*)::int` }).from(paymentSessions).where(eq(paymentSessions.status, "OPEN"))
    return { failedEvents: f?.n ?? 0, openSessions: o?.n ?? 0 }
  }
}
