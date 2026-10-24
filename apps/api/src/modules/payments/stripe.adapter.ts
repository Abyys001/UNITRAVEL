import Stripe from "stripe"

import { canEnterStripeMode } from "@unitravel/domain"

import { AppError } from "../../core/errors"
import type { CreateSessionInput, PaymentProvider, ProviderSession, RefundInput } from "./payment-port"

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

export interface StripeKeys { secretKey: string; publishableKey: string | null; webhookSecret: string }

/** Test mode only: live keys are refused at construction (ADR-0007 P1). The secret key never leaves this class. */
export class StripeAdapter implements PaymentProvider {
  readonly id = "STRIPE" as const
  private readonly stripe: Stripe

  constructor(private readonly keys: StripeKeys) {
    if (!canEnterStripeMode(/^(sk|rk)_live_/.test(keys.secretKey) ? "live" : "test").ok) throw new AppError("LIVE_MODE_BLOCKED", "Live Stripe keys are blocked (ADR-0007 P1)")
    this.stripe = new Stripe(keys.secretKey, { maxNetworkRetries: 1, timeout: 15_000, appInfo: { name: "UniTravel", version: "1.0.0" } })
  }

  get publishableKey() { return this.keys.publishableKey }

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
    }, { idempotencyKey: i.idempotencyKey })
    return toProviderSession(s)
  }

  async retrieveSession(id: string): Promise<ProviderSession | null> {
    try {
      return toProviderSession(await this.stripe.checkout.sessions.retrieve(id))
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404) return null
      throw err
    }
  }

  async createRefund(i: RefundInput): Promise<{ id: string }> {
    const r = await this.stripe.refunds.create({ payment_intent: i.paymentIntentId, amount: i.amountMinor, metadata: { refundRequestId: i.refundId } }, { idempotencyKey: i.idempotencyKey })
    return { id: r.id }
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    return verifyStripeSignature(rawBody, signature, this.keys.webhookSecret)
  }

  async health() {
    const t = Date.now()
    try {
      await this.stripe.balance.retrieve()
      return { ok: true, latencyMs: Date.now() - t, detail: "Stripe test API reachable" }
    } catch (err) {
      // The message of a Stripe error never contains the key; only its type and status are shown.
      const e = err as { type?: string; statusCode?: number }
      return { ok: false, latencyMs: Date.now() - t, detail: `Stripe call failed: ${e.type ?? "error"}${e.statusCode ? ` (${e.statusCode})` : ""}` }
    }
  }
}
