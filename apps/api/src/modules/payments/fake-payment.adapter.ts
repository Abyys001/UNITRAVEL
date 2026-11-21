import { randomBytes } from "node:crypto"

import type { Redis } from "ioredis"
import Stripe from "stripe"

import { AppError } from "../../core/errors"
import { sandboxAllowed } from "../../core/env"
import type { CreateSessionInput, PaymentProvider, ProviderInvoice, ProviderInvoicing, ProviderSession, RefundInput } from "./payment-port"
import { verifyStripeSignature } from "./stripe.adapter"

const TTL = 2 * 24 * 3600
const key = (id: string) => `fake:pay:${id}`
/** Per process: the simulation endpoint and the webhook verification run in the API process. */
let secret: string | undefined

export type FakeEventKind = "paid" | "async_pending" | "async_succeeded" | "async_failed" | "expired" | "refunded" | "dispute"

interface FakeInvoice { invoice: ProviderInvoice; items: Record<string, number> }
const invKey = (id: string) => `fake:inv:${id}`

interface FakeState { status: "open" | "complete" | "expired"; paymentStatus: "paid" | "unpaid"; amountMinor: number; currency: string; pi: string; expiresAt: string; clientSecret: string; invoiceId: string; refundedMinor: number }

/**
 * FAKE payment adapter for local development and end-to-end tests (ADR-0007 P12). It refuses to run unless
 * APP_ENV=local, like the FAKE flight adapter (ADR-0014). Sessions live in Valkey; a "payment" is only a
 * signed Stripe-shaped event delivered to the same webhook code as the real thing.
 */
export class FakePaymentAdapter implements PaymentProvider {
  readonly id = "FAKE" as const
  readonly publishableKey = null
  readonly connectedAccountId = null

  constructor(private readonly redis: Redis) {
    if (!sandboxAllowed()) throw new Error("The FAKE payment adapter only runs with APP_ENV=local (ADR-0007 P12, ADR-0014)")
    secret ??= `whsec_fake_${randomBytes(24).toString("hex")}`
  }

  private async load(id: string): Promise<FakeState | null> {
    const raw = await this.redis.get(key(id))
    return raw ? (JSON.parse(raw) as FakeState) : null
  }

  private async save(id: string, s: FakeState) { await this.redis.set(key(id), JSON.stringify(s), "EX", TTL) }

  private view(id: string, s: FakeState): ProviderSession {
    const expired = s.status === "open" && Date.parse(s.expiresAt) <= Date.now()
    return {
      id, status: expired ? "expired" : s.status, paymentStatus: s.paymentStatus, clientSecret: s.status === "open" ? s.clientSecret : null,
      amountTotal: s.amountMinor, currency: s.currency, paymentIntentId: s.status === "complete" || s.paymentStatus === "paid" ? s.pi : null, expiresAt: new Date(s.expiresAt), payerName: "FAKE Payer",
    }
  }

  async createSession(i: CreateSessionInput): Promise<ProviderSession> {
    // Same idempotency contract as Stripe: the key names the session.
    const id = `cs_test_fake_${i.idempotencyKey.replace(/[^A-Za-z0-9]/g, "").slice(-40)}`
    const existing = await this.load(id)
    if (existing) return this.view(id, existing)
    const s: FakeState = { status: "open", paymentStatus: "unpaid", amountMinor: i.amountMinor, currency: i.currency, pi: `pi_fake_${randomBytes(8).toString("hex")}`, expiresAt: i.expiresAt.toISOString(), clientSecret: `${id}_secret_${randomBytes(12).toString("hex")}`, invoiceId: i.invoiceId, refundedMinor: 0 }
    await this.save(id, s)
    return this.view(id, s)
  }

  async retrieveSession(id: string): Promise<ProviderSession | null> {
    const s = await this.load(id)
    return s ? this.view(id, s) : null
  }

  async createRefund(i: RefundInput): Promise<{ id: string }> {
    return { id: `re_fake_${i.idempotencyKey.replace(/[^A-Za-z0-9]/g, "").slice(-24)}` }
  }

  private async loadInv(id: string): Promise<FakeInvoice | null> {
    const raw = await this.redis.get(invKey(id))
    return raw ? (JSON.parse(raw) as FakeInvoice) : null
  }

  private async saveInv(f: FakeInvoice) { await this.redis.set(invKey(f.invoice.id), JSON.stringify(f), "EX", TTL) }

  /** ADR-0039 D4: Stripe Invoicing simulated in Valkey with the same idempotency contract (the key names the object). */
  readonly invoicing: ProviderInvoicing = {
    ensureCustomer: async (c) => ({ id: `cus_fake_${c.idempotencyKey.replace(/[^A-Za-z0-9]/g, "").slice(-24)}` }),
    createInvoice: async (i) => {
      const id = `in_fake_${i.idempotencyKey.replace(/[^A-Za-z0-9]/g, "").slice(-40)}`
      const existing = await this.loadInv(id)
      if (existing) return existing.invoice
      const f: FakeInvoice = { invoice: { id, status: "draft", amountDue: 0, amountPaid: 0, currency: i.currency.toUpperCase(), hostedInvoiceUrl: null, invoicePdf: null, paymentIntentId: null, customerId: i.customerId, invoiceId: i.invoiceId }, items: {} }
      await this.saveInv(f)
      return f.invoice
    },
    addItem: async (i) => {
      const f = await this.loadInv(i.providerInvoiceId)
      if (!f || f.invoice.status !== "draft") throw new AppError("INVALID_TRANSITION", "FAKE invoice is not a draft")
      f.items[i.idempotencyKey] = i.amountMinor
      f.invoice.amountDue = Object.values(f.items).reduce((a, b) => a + b, 0)
      await this.saveInv(f)
    },
    finalize: async (id) => {
      const f = await this.loadInv(id)
      if (!f) throw new AppError("NOT_FOUND", "Unknown FAKE invoice")
      if (f.invoice.status === "draft") Object.assign(f.invoice, { status: "open", hostedInvoiceUrl: `https://invoice.stripe.test/fake/${id}`, invoicePdf: `https://invoice.stripe.test/fake/${id}.pdf` })
      await this.saveInv(f)
      return f.invoice
    },
    retrieve: async (id) => (await this.loadInv(id))?.invoice ?? null,
    discard: async (id) => {
      const f = await this.loadInv(id)
      if (!f) return null
      if (f.invoice.status === "draft" || f.invoice.status === "open") { f.invoice.status = "void"; await this.saveInv(f) }
      return f.invoice
    },
  }

  /** Signs a Stripe-shaped `invoice.paid` (or `invoice.payment_failed`) event for a FAKE invoice; the caller delivers it to the webhook. */
  async simulateInvoice(providerInvoiceId: string, kind: "paid" | "payment_failed", o: { amountMinor?: number; eventId?: string } = {}): Promise<{ payload: string; signature: string; eventId: string }> {
    const f = await this.loadInv(providerInvoiceId)
    if (!f) throw new AppError("NOT_FOUND", "Unknown FAKE invoice")
    const eventId = o.eventId ?? `evt_fake_${randomBytes(10).toString("hex")}`
    if (kind === "paid") Object.assign(f.invoice, { status: "paid", amountPaid: o.amountMinor ?? f.invoice.amountDue, paymentIntentId: f.invoice.paymentIntentId ?? `pi_fake_${randomBytes(8).toString("hex")}` })
    await this.saveInv(f)
    const object = { id: f.invoice.id, object: "invoice", status: f.invoice.status, amount_due: f.invoice.amountDue, amount_paid: f.invoice.amountPaid, currency: f.invoice.currency.toLowerCase(), customer: f.invoice.customerId, metadata: { invoiceId: f.invoice.invoiceId }, hosted_invoice_url: f.invoice.hostedInvoiceUrl, invoice_pdf: f.invoice.invoicePdf }
    const payload = JSON.stringify({ id: eventId, object: "event", type: `invoice.${kind}`, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } })
    return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: secret! }), eventId }
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    return verifyStripeSignature(rawBody, signature, secret!)
  }

  async health() { return { ok: true, latencyMs: 1, detail: "FAKE payment adapter (local/test only)" } }

  /**
   * Builds a Stripe-shaped event for a session and signs it with Stripe's own header format. The caller delivers it
   * to the webhook handler; nothing here changes an invoice.
   */
  async simulate(providerSessionId: string, kind: FakeEventKind, o: { amountMinor?: number; currency?: string; eventId?: string } = {}): Promise<{ payload: string; signature: string; eventId: string }> {
    const s = await this.load(providerSessionId)
    if (!s) throw new AppError("NOT_FOUND", "Unknown FAKE session")
    const eventId = o.eventId ?? `evt_fake_${randomBytes(10).toString("hex")}`
    const amount = o.amountMinor ?? s.amountMinor
    const currency = (o.currency ?? s.currency).toLowerCase()
    const session = (extra: Record<string, unknown>) => ({ id: providerSessionId, object: "checkout.session", amount_total: amount, currency, payment_intent: s.pi, metadata: { invoiceId: s.invoiceId }, customer_details: { name: "FAKE Payer" }, ...extra })
    let type: string
    let object: Record<string, unknown>
    switch (kind) {
      case "paid": case "async_succeeded":
        type = kind === "paid" ? "checkout.session.completed" : "checkout.session.async_payment_succeeded"
        object = session({ status: "complete", payment_status: "paid" })
        s.status = "complete"; s.paymentStatus = "paid"; s.amountMinor = amount
        break
      case "async_pending": type = "checkout.session.completed"; object = session({ status: "complete", payment_status: "unpaid" }); s.status = "complete"; break
      case "async_failed": type = "checkout.session.async_payment_failed"; object = session({ status: "complete", payment_status: "unpaid" }); break
      case "expired": type = "checkout.session.expired"; object = session({ status: "expired", payment_status: "unpaid" }); s.status = "expired"; break
      case "refunded": type = "charge.refunded"; s.refundedMinor = o.amountMinor ?? s.amountMinor; object = { id: `ch_fake_${s.pi.slice(8)}`, object: "charge", payment_intent: s.pi, amount: s.amountMinor, amount_refunded: s.refundedMinor, currency }; break
      case "dispute": type = "charge.dispute.created"; object = { id: `dp_fake_${s.pi.slice(8)}`, object: "dispute", payment_intent: s.pi, charge: `ch_fake_${s.pi.slice(8)}`, amount, currency, reason: "fraudulent", status: "needs_response" }; break
    }
    await this.save(providerSessionId, s)
    const payload = JSON.stringify({ id: eventId, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } })
    return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: secret! }), eventId }
  }
}
