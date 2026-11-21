import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import type Stripe from "stripe"

import type { StripeInvoiceStatus, StripeInvoiceView } from "@unitravel/contracts"
import { type Db, invoiceLines, invoices, stripeCustomers, stripeInvoices, type Tx, userIdentities, users } from "@unitravel/db"

import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { Queues } from "../../core/queues"
import { scrubMessage } from "../../core/safe-error"
import { WorkerRegistry } from "../../core/workers"
import { AuditService } from "../audit/audit.service"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import type { PaymentProvider, ProviderInvoice } from "./payment-port"
import { type Outcome, PaymentsService } from "./payments.service"

type Row = typeof stripeInvoices.$inferSelect
type Inv = typeof invoices.$inferSelect
const LIVE: StripeInvoiceStatus[] = ["CREATING", "DRAFT", "OPEN", "PAID"]
const STATUS: Record<ProviderInvoice["status"], StripeInvoiceStatus> = { draft: "DRAFT", open: "OPEN", paid: "PAID", void: "VOID", uncollectible: "UNCOLLECTIBLE" }
const iso = (d: Date | null) => d?.toISOString() ?? null
/** A Stripe error's type and message are safe to show (they never contain the key); anything else is reduced to its kind. */
export function providerError(err: unknown): string {
  const e = err as { type?: string; message?: string; code?: string; statusCode?: number }
  if (err instanceof AppError) return (err.detail ?? err.code).slice(0, 300)
  if (typeof e?.type === "string" && e.type.startsWith("Stripe")) return scrubMessage(`${e.type}${e.code ? ` (${e.code})` : ""}: ${e.message ?? ""}`).slice(0, 300)
  return `${err instanceof Error ? err.name : "Error"}: the provider call failed`
}

/**
 * ADR-0039 D4: Stripe Invoicing as the payment instrument of an issued invoice. Our invoice keeps its number, state
 * machine and frozen amounts; a Stripe Invoice is created from its lines (server side, idempotent), finalized, checked
 * against our total, and settled through `PaymentsService.recordOnlinePayment` when Stripe reports it paid.
 * Creation needs the same online-payment eligibility as Checkout (flag, ONLINE_PAYMENT policy, expiry): no bypass (rule 5).
 */
@Injectable()
export class StripeInvoicesService implements OnModuleInit {
  private readonly log = new Logger("StripeInvoices")

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly workers: WorkerRegistry,
    private readonly queues: Queues,
  ) {}

  async onModuleInit() {
    this.payments.onInvoiceEvents((tx, event) => this.onEvent(tx, event))
    // invoice.issued → create; invoice.cancelled / invoice.expired → void (outbox.dispatcher EVENT_ROUTES).
    this.workers.register("payments.stripe", (job) => this.onDomainEvent(job.data as DispatchedEvent), 2)
    // Missed webhooks and invoices cancelled while Stripe was unreachable are caught here.
    this.workers.registerJob("maintenance", "payments.stripe-invoices-sync", () => this.syncOpen())
    await this.queues.get("maintenance").upsertJobScheduler("stripe-invoices-sync-every-10m", { every: 10 * 60_000 }, { name: "payments.stripe-invoices-sync" }).catch(() => undefined)
  }

  private async adapter(): Promise<PaymentProvider | null> {
    return (await this.payments.provider()).adapter
  }

  private accountKey(a: PaymentProvider) {
    return a.id === "FAKE" ? "fake" : a.connectedAccountId ?? "platform"
  }

  private async rows(invoiceId: string, tx: Tx | Db = this.db) {
    return tx.select().from(stripeInvoices).where(eq(stripeInvoices.invoiceId, invoiceId)).orderBy(desc(stripeInvoices.attempt))
  }

  // ---------------- staff view ----------------

  async view(invoiceId: string): Promise<StripeInvoiceView> {
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, invoiceId))
    if (!inv) throw notFound("Invoice")
    const { id: provider, adapter } = await this.payments.provider()
    const rows = await this.rows(invoiceId)
    const live = rows.find((r) => LIVE.includes(r.status))
    const cur = live ?? rows[0] ?? null
    const eligibility = await this.payments.eligibility(inv)
    const supports = !!adapter?.invoicing
    const money = (v: number | null) => (v == null ? null : { amountMinor: v, currency: cur!.currency })
    const dashboard = (r: Row) => !r.stripeInvoiceId || r.accountKey === "fake" ? null
      : `https://dashboard.stripe.com/${r.accountKey === "platform" ? "" : `${r.accountKey}/`}${r.mode === "test" ? "test/" : ""}invoices/${r.stripeInvoiceId}`
    return {
      invoiceId, provider: adapter ? provider : null, mode: "test", supportsInvoicing: supports, eligibility,
      current: cur ? {
        id: cur.id, attempt: cur.attempt, status: cur.status, stripeInvoiceId: cur.stripeInvoiceId, stripeCustomerId: cur.stripeCustomerId,
        amountDue: money(cur.amountDueMinor), amountPaid: money(cur.amountPaidMinor), hostedInvoiceUrl: cur.hostedInvoiceUrl, invoicePdfUrl: cur.invoicePdfUrl,
        dashboardUrl: dashboard(cur), lastError: cur.lastError, finalizedAt: iso(cur.finalizedAt), paidAt: iso(cur.paidAt), voidedAt: iso(cur.voidedAt), syncedAt: iso(cur.syncedAt),
      } : null,
      history: rows.map((r) => ({ id: r.id, attempt: r.attempt, status: r.status, stripeInvoiceId: r.stripeInvoiceId, lastError: r.lastError, createdAt: r.createdAt.toISOString() })),
      canCreate: inv.status === "ISSUED" && eligibility.offered && supports && (!live || live.status === "CREATING" || live.status === "DRAFT"),
    }
  }

  /** The open Stripe invoice's payment page, for the customer pay page (null when there is none). */
  async openHostedUrl(invoiceId: string): Promise<string | null> {
    const [r] = await this.db.select({ url: stripeInvoices.hostedInvoiceUrl }).from(stripeInvoices).where(and(eq(stripeInvoices.invoiceId, invoiceId), eq(stripeInvoices.status, "OPEN")))
    return r?.url ?? null
  }

  // ---------------- create ----------------

  /**
   * Creates (or resumes) the Stripe invoice of an ISSUED invoice: customer, draft, one item per line, finalize, then the
   * amount check. Safe to call twice: a live attempt is resumed, and every Stripe call carries an idempotency key.
   */
  async ensure(invoiceId: string, actor: { userId: string; ip?: string } | null): Promise<StripeInvoiceView> {
    const adapter = await this.adapter()
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, invoiceId))
    if (!inv) throw notFound("Invoice")
    let row = (await this.rows(invoiceId)).find((r) => LIVE.includes(r.status))
    if (row?.status === "OPEN" || row?.status === "PAID") return this.view(invoiceId)
    if (!row) {
      if (inv.status !== "ISSUED") throw new AppError("INVALID_TRANSITION", `Only an ISSUED invoice gets a Stripe invoice (this one is ${inv.status})`)
      const elig = await this.payments.eligibility(inv)
      if (!elig.offered) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", `Online payment is not offered for this invoice (${elig.reasons.join(", ")})`, undefined, { reasons: elig.reasons })
      if (!adapter?.invoicing) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", "The active payment provider cannot issue Stripe invoices", undefined, { reasons: ["NOT_CONFIGURED"] })
      const last = (await this.rows(invoiceId))[0]
      const [created] = await this.db.insert(stripeInvoices).values({ invoiceId, accountKey: this.accountKey(adapter), attempt: (last?.attempt ?? 0) + 1, currency: inv.currency, createdBy: actor?.userId ?? null })
        .onConflictDoNothing().returning()
      // A parallel call won the one-live-attempt index; carry on with its row.
      row = created ?? (await this.rows(invoiceId)).find((r) => LIVE.includes(r.status))
      if (!row) throw new AppError("VERSION_CONFLICT", "Another Stripe invoice attempt changed; reload")
    }
    if (!adapter?.invoicing) throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", "The active payment provider cannot issue Stripe invoices", undefined, { reasons: ["NOT_CONFIGURED"] })
    try {
      await this.build(adapter, inv, row, actor)
    } catch (err) {
      const message = providerError(err)
      await this.db.update(stripeInvoices).set({ status: "FAILED", lastError: message, syncedAt: new Date() }).where(eq(stripeInvoices.id, row.id))
      await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor?.userId ?? null, actorKind: actor ? "STAFF" : "SYSTEM", action: "payment.stripe_invoice_failed", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number: inv.number, attempt: row!.attempt, error: message }, ip: actor?.ip }))
      // A failed draft would never be paid; remove it so the next attempt starts clean.
      const draft = (await this.db.select({ id: stripeInvoices.stripeInvoiceId }).from(stripeInvoices).where(eq(stripeInvoices.id, row.id)))[0]?.id
      if (draft) await adapter.invoicing.discard(draft).catch(() => undefined)
      this.log.warn({ invoice: inv.id, attempt: row.attempt, err: message }, "stripe invoice not created")
      throw new AppError("ONLINE_PAYMENT_NOT_OFFERED", `Stripe invoice not created: ${message}`, undefined, { reasons: [] })
    }
    return this.view(invoiceId)
  }

  private async build(adapter: PaymentProvider, inv: Inv, row: Row, actor: { userId: string; ip?: string } | null) {
    const invoicing = adapter.invoicing!
    const customerId = row.stripeCustomerId ?? await this.customerFor(adapter, inv.customerUserId)
    let providerInvoiceId = row.stripeInvoiceId
    if (!providerInvoiceId) {
      const created = await invoicing.createInvoice({
        customerId, currency: inv.currency, dueDate: inv.expiresAt!, invoiceId: inv.id, invoiceNumber: inv.number!,
        stripeNumber: row.attempt === 1 ? inv.number : `${inv.number}-${row.attempt}`, description: `Uni Travel invoice ${inv.number} (${inv.requestRef})`,
        idempotencyKey: `sinv-${row.id}`,
      })
      providerInvoiceId = created.id
      await this.db.update(stripeInvoices).set({ stripeInvoiceId: created.id, stripeCustomerId: customerId, status: "DRAFT", syncedAt: new Date() }).where(eq(stripeInvoices.id, row.id))
    }
    const lines = await this.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(invoiceLines.position)
    for (const l of lines) {
      await invoicing.addItem({ customerId, providerInvoiceId, amountMinor: l.amountMinor, currency: inv.currency, description: (l.quantity > 1 ? `${l.description} × ${l.quantity}` : l.description).slice(0, 250), lineId: l.id, idempotencyKey: `sii-${row.id}-${l.id}` })
    }
    const fin = await invoicing.finalize(providerInvoiceId, `sfin-${row.id}`)
    // Our total is the record: a Stripe invoice that would collect a different amount is voided, never offered.
    if (fin.amountDue !== inv.totalMinor || fin.currency !== inv.currency) {
      await invoicing.discard(providerInvoiceId)
      throw new AppError("VALIDATION_FAILED", `Stripe totals ${fin.amountDue} ${fin.currency} but the invoice is ${inv.totalMinor} ${inv.currency}; the Stripe invoice was voided`)
    }
    const now = new Date()
    await this.uow.run(async (tx) => {
      await tx.update(stripeInvoices).set({ status: STATUS[fin.status], amountDueMinor: fin.amountDue, amountPaidMinor: fin.amountPaid, hostedInvoiceUrl: fin.hostedInvoiceUrl, invoicePdfUrl: fin.invoicePdf, lastError: null, finalizedAt: now, syncedAt: now }).where(eq(stripeInvoices.id, row.id))
      await this.audit.record(tx, { actorUserId: actor?.userId ?? null, actorKind: actor ? "STAFF" : "SYSTEM", action: "payment.stripe_invoice_created", entityType: "invoice", entityId: inv.id, contextRef: inv.requestRef, after: { number: inv.number, stripeInvoiceId: providerInvoiceId, attempt: row.attempt, amountMinor: fin.amountDue, currency: fin.currency, provider: adapter.id }, ip: actor?.ip })
    })
  }

  /** One Stripe Customer per user, account and mode; created on first use with the verified email only. */
  private async customerFor(adapter: PaymentProvider, userId: string): Promise<string> {
    const accountKey = this.accountKey(adapter)
    const [known] = await this.db.select().from(stripeCustomers).where(and(eq(stripeCustomers.userId, userId), eq(stripeCustomers.accountKey, accountKey), eq(stripeCustomers.mode, "test")))
    if (known) return known.stripeCustomerId
    const [u] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, userId))
    const [email] = await this.db.select({ v: userIdentities.valueNormalised }).from(userIdentities)
      .where(and(eq(userIdentities.userId, userId), eq(userIdentities.type, "EMAIL"), isNull(userIdentities.revokedAt), sql`${userIdentities.verifiedAt} is not null`)).limit(1)
    const c = await adapter.invoicing!.ensureCustomer({ userId, email: email?.v ?? null, name: u?.name ?? "Customer", idempotencyKey: `cus-${userId}-${accountKey}` })
    await this.db.insert(stripeCustomers).values({ userId, accountKey, stripeCustomerId: c.id }).onConflictDoNothing()
    return c.id
  }

  // ---------------- void ----------------

  /** Our invoice was cancelled or expired: the open Stripe invoice must not be payable any more. */
  async discardFor(invoiceId: string, reason: string): Promise<void> {
    const adapter = await this.adapter()
    const live = (await this.rows(invoiceId)).filter((r) => r.status === "CREATING" || r.status === "DRAFT" || r.status === "OPEN")
    for (const r of live) {
      let ok = !r.stripeInvoiceId
      if (r.stripeInvoiceId && adapter?.invoicing) {
        const after = await adapter.invoicing.discard(r.stripeInvoiceId)
        // Paid at Stripe in the meantime: the webhook or the sync settles it (and opens a mismatch case on a cancelled invoice).
        ok = !after || after.status === "void"
      }
      if (!ok) continue
      await this.uow.run(async (tx) => {
        await tx.update(stripeInvoices).set({ status: "VOID", voidedAt: new Date(), syncedAt: new Date() }).where(eq(stripeInvoices.id, r.id))
        await this.audit.record(tx, { actorKind: "SYSTEM", action: "payment.stripe_invoice_voided", entityType: "invoice", entityId: invoiceId, after: { stripeInvoiceId: r.stripeInvoiceId, reason } })
      })
    }
  }

  private async onDomainEvent(e: DispatchedEvent) {
    const p = e.payload as { invoiceId?: string }
    if (!p.invoiceId) return
    if (e.type === "invoice.issued") {
      // Automatic for invoices staff create directly (ADR-0039 D4) and only when online payment is offered; quote-based invoices
      // keep Embedded Checkout (ADR-0007) unless staff create a Stripe invoice on the invoice page.
      const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, p.invoiceId))
      const adapter = await this.adapter()
      if (!inv || inv.origin !== "DIRECT" || inv.status !== "ISSUED" || !adapter?.invoicing || !(await this.payments.eligibility(inv)).offered) return
      await this.ensure(inv.id, null).catch((err) => this.log.warn({ invoice: inv.id, err: providerError(err) }, "automatic stripe invoice failed"))
      return
    }
    if (e.type === "invoice.cancelled" || e.type === "invoice.expired") await this.discardFor(p.invoiceId, e.type)
  }

  // ---------------- webhook and sync ----------------

  private async apply(tx: Tx, row: Row, pi: ProviderInvoice, provider: PaymentProvider["id"], source: string): Promise<Outcome> {
    const now = new Date()
    const status = STATUS[pi.status]
    let outcome: Outcome = "PROCESSED"
    if (status === "PAID" && row.status !== "PAID") {
      if (!pi.paymentIntentId) return "IGNORED"
      outcome = await this.payments.recordOnlinePayment(tx, row.invoiceId, { amountMinor: pi.amountPaid, currency: pi.currency, paymentIntentId: pi.paymentIntentId, payerName: null }, provider, source)
    }
    await tx.update(stripeInvoices).set({
      status, amountDueMinor: pi.amountDue, amountPaidMinor: pi.amountPaid, hostedInvoiceUrl: pi.hostedInvoiceUrl ?? row.hostedInvoiceUrl, invoicePdfUrl: pi.invoicePdf ?? row.invoicePdfUrl,
      paymentIntentId: pi.paymentIntentId ?? row.paymentIntentId, syncedAt: now,
      ...(status === "PAID" && !row.paidAt ? { paidAt: now } : {}), ...(status === "VOID" && !row.voidedAt ? { voidedAt: now } : {}),
    }).where(eq(stripeInvoices.id, row.id))
    return outcome
  }

  /** Webhook (inside the event's transaction): the row is found by Stripe's id; the invoice is re-read with its payments for the PaymentIntent. */
  private async onEvent(tx: Tx, event: Stripe.Event): Promise<Outcome> {
    const obj = event.data.object as Stripe.Invoice
    if (!obj.id) return "IGNORED"
    const [row] = await tx.select().from(stripeInvoices).where(eq(stripeInvoices.stripeInvoiceId, obj.id)).for("update")
    if (!row) return "IGNORED"
    const adapter = await this.adapter()
    if (event.type === "invoice.payment_failed") {
      await tx.update(stripeInvoices).set({ lastError: "The last payment attempt failed at Stripe", syncedAt: new Date() }).where(eq(stripeInvoices.id, row.id))
      return "PROCESSED"
    }
    const fresh = adapter?.invoicing ? await adapter.invoicing.retrieve(obj.id) : null
    if (!fresh || !adapter) return "IGNORED"
    return this.apply(tx, row, fresh, adapter.id, `stripe-invoice ${event.type}`)
  }

  /**
   * Every 10 minutes: Stripe's state for open invoices (missed webhooks), voids for invoices no longer ISSUED, and the
   * automatic create for direct invoices that missed it (policies and flags are cached per process for a few seconds,
   * so an invoice issued right after online payment was allowed can be skipped by the issue-time job).
   */
  async syncOpen(): Promise<{ checked: number; created: number }> {
    const adapter = await this.adapter()
    if (!adapter?.invoicing) return { checked: 0, created: 0 }
    let created = 0
    const missing = await this.db.select().from(invoices).where(and(eq(invoices.origin, "DIRECT"), eq(invoices.status, "ISSUED"), sql`${invoices.issuedAt} > now() - interval '7 days'`,
      sql`not exists (select 1 from stripe_invoices s where s.invoice_id = ${invoices.id})`)).limit(50)
    for (const inv of missing) {
      if (!(await this.payments.eligibility(inv)).offered) continue
      try { await this.ensure(inv.id, null); created++ } catch (err) { this.log.warn({ invoice: inv.id, err: providerError(err) }, "catch-up stripe invoice failed") }
    }
    const rows = await this.db.select({ r: stripeInvoices, status: invoices.status }).from(stripeInvoices).innerJoin(invoices, eq(invoices.id, stripeInvoices.invoiceId))
      .where(and(inArray(stripeInvoices.status, ["OPEN", "DRAFT", "CREATING"]), lt(stripeInvoices.updatedAt, new Date(Date.now() - 5 * 60_000)))).limit(200)
    for (const { r, status } of rows) {
      try {
        if (status !== "ISSUED") { await this.discardFor(r.invoiceId, `sync: invoice ${status}`); continue }
        if (!r.stripeInvoiceId || r.accountKey !== this.accountKey(adapter)) continue
        const pi = await adapter.invoicing.retrieve(r.stripeInvoiceId)
        if (pi) await this.uow.run(async (tx) => { const [locked] = await tx.select().from(stripeInvoices).where(eq(stripeInvoices.id, r.id)).for("update"); if (locked) await this.apply(tx, locked, pi, adapter.id, "stripe-invoice sync") })
      } catch (err) {
        this.log.warn({ row: r.id, err: providerError(err) }, "stripe invoice sync failed")
      }
    }
    return { checked: rows.length, created }
  }

  /** Staff "Refresh from Stripe" on one invoice. */
  async sync(invoiceId: string): Promise<StripeInvoiceView> {
    const adapter = await this.adapter()
    const row = (await this.rows(invoiceId)).find((r) => LIVE.includes(r.status))
    if (adapter?.invoicing && row?.stripeInvoiceId) {
      const pi = await adapter.invoicing.retrieve(row.stripeInvoiceId)
      if (pi) await this.uow.run(async (tx) => { const [locked] = await tx.select().from(stripeInvoices).where(eq(stripeInvoices.id, row.id)).for("update"); if (locked) await this.apply(tx, locked, pi, adapter.id, "stripe-invoice manual sync") })
    }
    return this.view(invoiceId)
  }
}
