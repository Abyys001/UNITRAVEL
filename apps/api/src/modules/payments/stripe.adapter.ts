import Stripe from "stripe"

import { canEnterStripeMode } from "@unitravel/domain"

import { AppError } from "../../core/errors"
import type { CreateInvoiceInput, CreateSessionInput, InvoiceItemInput, PaymentProvider, ProviderInvoice, ProviderInvoicing, ProviderSession, RefundInput } from "./payment-port"

/** Shared by the Stripe and FAKE adapters, so the simulated path exercises the production verification code. */
export function verifyStripeSignature(rawBody: Buffer, signature: string | undefined, secret: string): Stripe.Event {
  if (!signature) throw new AppError("SIGNATURE_INVALID", "Missing Stripe-Signature header")
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch {
    throw new AppError("SIGNATURE_INVALID", "The signature could not be verified")
  }
}

export function toProviderSession(s: Stripe.Checkout.Session): ProviderSession {
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null
  return {
    id: s.id, status: s.status === "complete" ? "complete" : s.status === "expired" ? "expired" : "open", paymentStatus: s.payment_status as ProviderSession["paymentStatus"],
    clientSecret: s.client_secret ?? null, amountTotal: s.amount_total ?? null, currency: s.currency ? s.currency.toUpperCase() : null, paymentIntentId: pi,
    expiresAt: s.expires_at ? new Date(s.expires_at * 1000) : null, payerName: s.customer_details?.name ?? null,
  }
}

/** API `2026-09-30.endive` (stripe 23): an Invoice has no `payment_intent`; the PaymentIntent is on `payments.data[].payment`. */
export function toProviderInvoice(i: Stripe.Invoice): ProviderInvoice {
  const pay = i.payments?.data.find((p) => p.status === "paid") ?? i.payments?.data[0]
  const pi = pay?.payment.payment_intent
  return {
    id: i.id!, status: (i.status ?? "draft") as ProviderInvoice["status"], amountDue: i.amount_due, amountPaid: i.amount_paid, currency: i.currency.toUpperCase(),
    hostedInvoiceUrl: i.hosted_invoice_url ?? null, invoicePdf: i.invoice_pdf ?? null, paymentIntentId: typeof pi === "string" ? pi : pi?.id ?? null,
    customerId: typeof i.customer === "string" ? i.customer : i.customer?.id ?? null, invoiceId: i.metadata?.invoiceId ?? null,
  }
}

export interface StripeKeys { secretKey: string; publishableKey: string | null; webhookSecret: string; connectedAccountId?: string | null }

/** A valid signature only proves Stripe sent it: an event from any other connected account of the platform is not ours (ADR-0028 D11). */
export function assertEventAccount(event: Stripe.Event, connectedAccountId: string | null): void {
  if ((event.account ?? null) !== connectedAccountId) throw new AppError("SIGNATURE_INVALID", "The event belongs to another Stripe account")
}

/** Test mode only: live keys are refused at construction (ADR-0007 P1). The secret key never leaves this class. */
export class StripeAdapter implements PaymentProvider {
  readonly id = "STRIPE" as const
  private readonly stripe: Stripe

  constructor(private readonly keys: StripeKeys) {
    if (!canEnterStripeMode(/^(sk|rk)_live_/.test(keys.secretKey) ? "live" : "test").ok) throw new AppError("LIVE_MODE_BLOCKED", "Live Stripe keys are blocked (ADR-0007 P1)")
    this.stripe = new Stripe(keys.secretKey, { maxNetworkRetries: 1, timeout: 15_000, appInfo: { name: "UniTravel", version: "1.0.0" } })
  }

  get publishableKey() { return this.keys.publishableKey }
  get connectedAccountId() { return this.keys.connectedAccountId ?? null }
  private get onAccount() { return this.connectedAccountId ? { stripeAccount: this.connectedAccountId } : {} }

  async createSession(i: CreateSessionInput): Promise<ProviderSession> {
    const s = await this.stripe.checkout.sessions.create({
      // The value the installed SDK (stripe 23) defines for embedded checkout.
      ui_mode: "embedded_page",
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: i.currency.toLowerCase(), unit_amount: i.amountMinor, product_data: { name: `Uni Travel invoice ${i.invoiceNumber}` } } }],
      return_url: i.returnUrl,
      expires_at: Math.floor(i.expiresAt.getTime() / 1000),
      client_reference_id: i.invoiceNumber,
      metadata: { invoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber },
      payment_intent_data: { metadata: { invoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber } },
    }, { idempotencyKey: i.idempotencyKey, ...this.onAccount })
    return toProviderSession(s)
  }

  async retrieveSession(id: string): Promise<ProviderSession | null> {
    try {
      return toProviderSession(await this.stripe.checkout.sessions.retrieve(id, undefined, this.onAccount))
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404) return null
      throw err
    }
  }

  async createRefund(i: RefundInput): Promise<{ id: string }> {
    const r = await this.stripe.refunds.create({ payment_intent: i.paymentIntentId, amount: i.amountMinor, metadata: { refundRequestId: i.refundId } }, { idempotencyKey: i.idempotencyKey, ...this.onAccount })
    return { id: r.id }
  }

  /** ADR-0039 D4: server-side Stripe Invoicing. Every create carries an idempotency key, so a retry never duplicates. */
  readonly invoicing: ProviderInvoicing = {
    ensureCustomer: async (c) => {
      const cu = await this.stripe.customers.create({ name: c.name, ...(c.email ? { email: c.email } : {}), metadata: { userId: c.userId } }, { idempotencyKey: c.idempotencyKey, ...this.onAccount })
      return { id: cu.id }
    },
    createInvoice: async (i: CreateInvoiceInput) => toProviderInvoice(await this.stripe.invoices.create({
      customer: i.customerId, currency: i.currency.toLowerCase(), collection_method: "send_invoice", due_date: Math.floor(i.dueDate.getTime() / 1000),
      // We finalize ourselves after adding the lines; Stripe must not send its own emails or finalize early (our email carries the link).
      auto_advance: false, pending_invoice_items_behavior: "exclude", description: i.description,
      ...(i.stripeNumber ? { number: i.stripeNumber } : {}),
      metadata: { invoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber },
    }, { idempotencyKey: i.idempotencyKey, ...this.onAccount })),
    addItem: async (i: InvoiceItemInput) => {
      await this.stripe.invoiceItems.create({ customer: i.customerId, invoice: i.providerInvoiceId, amount: i.amountMinor, currency: i.currency.toLowerCase(), description: i.description, metadata: { lineId: i.lineId } }, { idempotencyKey: i.idempotencyKey, ...this.onAccount })
    },
    finalize: async (id, idempotencyKey) => toProviderInvoice(await this.stripe.invoices.finalizeInvoice(id, { auto_advance: false, expand: ["payments"] }, { idempotencyKey, ...this.onAccount })),
    retrieve: async (id) => {
      try {
        return toProviderInvoice(await this.stripe.invoices.retrieve(id, { expand: ["payments"] }, this.onAccount))
      } catch (err) {
        if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404) return null
        throw err
      }
    },
    discard: async (id) => {
      const cur = await this.invoicing.retrieve(id)
      if (!cur) return null
      if (cur.status === "draft") { await this.stripe.invoices.del(id, undefined, this.onAccount); return { ...cur, status: "void" } }
      if (cur.status === "open" || cur.status === "uncollectible") return toProviderInvoice(await this.stripe.invoices.voidInvoice(id, undefined, this.onAccount))
      return cur
    },
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const event = verifyStripeSignature(rawBody, signature, this.keys.webhookSecret)
    assertEventAccount(event, this.connectedAccountId)
    return event
  }

  async health() {
    const t = Date.now()
    try {
      await this.stripe.balance.retrieve(undefined, this.onAccount)
      return { ok: true, latencyMs: Date.now() - t, detail: "Stripe test API reachable" }
    } catch (err) {
      // The message of a Stripe error never contains the key; only its type and status are shown.
      const e = err as { type?: string; statusCode?: number }
      return { ok: false, latencyMs: Date.now() - t, detail: `Stripe call failed: ${e.type ?? "error"}${e.statusCode ? ` (${e.statusCode})` : ""}` }
    }
  }
}
