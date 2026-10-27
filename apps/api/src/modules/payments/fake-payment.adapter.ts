import { randomBytes } from "node:crypto"

import type { Redis } from "ioredis"
import Stripe from "stripe"

import { AppError } from "../../core/errors"
import { sandboxAllowed } from "../../core/env"
import type { CreateSessionInput, PaymentProvider, ProviderSession, RefundInput } from "./payment-port"
import { verifyStripeSignature } from "./stripe.adapter"

const TTL = 2 * 24 * 3600
const key = (id: string) => `fake:pay:${id}`
/** Per process: the simulation endpoint and the webhook verification run in the API process. */
let secret: string | undefined

export type FakeEventKind = "paid" | "async_pending" | "async_succeeded" | "async_failed" | "expired" | "refunded" | "dispute"

interface FakeState { status: "open" | "complete" | "expired"; paymentStatus: "paid" | "unpaid"; amountMinor: number; currency: string; pi: string; expiresAt: string; clientSecret: string; invoiceId: string; refundedMinor: number }

/**
 * FAKE payment adapter for local development and end-to-end tests (ADR-0007 P12). It refuses to run unless
 * APP_ENV=local, like the FAKE flight adapter (ADR-0014). Sessions live in Valkey; a "payment" is only a
 * signed Stripe-shaped event delivered to the same webhook code as the real thing.
 */
export class FakePaymentAdapter implements PaymentProvider {
  readonly id = "FAKE" as const
  readonly publishableKey = null

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
