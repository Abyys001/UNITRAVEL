import type Stripe from "stripe"

import type { PaymentProviderId } from "@unitravel/contracts"

/** ADR-0007: the payment port. Two adapters implement it: Stripe (test mode) and FAKE (local and test only). */
export interface CreateSessionInput {
  invoiceId: string
  invoiceNumber: string
  amountMinor: number
  currency: string
  expiresAt: Date
  returnUrl: string
  /** `inv-<invoiceId>-<attempt>`: a retry after a crash returns the same session (P4). */
  idempotencyKey: string
}

export interface ProviderSession {
  id: string
  /** Provider status: `open` can still be paid, `complete` was submitted, `expired` is closed. */
  status: "open" | "complete" | "expired"
  paymentStatus: "paid" | "unpaid" | "no_payment_required"
  clientSecret: string | null
  amountTotal: number | null
  currency: string | null
  paymentIntentId: string | null
  expiresAt: Date | null
  payerName: string | null
}

export interface RefundInput { paymentIntentId: string; amountMinor: number; idempotencyKey: string; refundId: string }

export interface PaymentProvider {
  readonly id: PaymentProviderId
  readonly publishableKey: string | null
  createSession(input: CreateSessionInput): Promise<ProviderSession>
  retrieveSession(providerSessionId: string): Promise<ProviderSession | null>
  createRefund(input: RefundInput): Promise<{ id: string }>
  /** Verifies the signature on the raw body (never on re-serialised JSON) and returns the event; throws SIGNATURE_INVALID. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event
  health(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}
