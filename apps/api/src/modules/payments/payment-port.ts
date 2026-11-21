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

/** ADR-0039 D4: a Stripe Invoice as our code sees it (amounts in minor units, currency upper case). */
export interface ProviderInvoice {
  id: string
  status: "draft" | "open" | "paid" | "uncollectible" | "void"
  amountDue: number
  amountPaid: number
  currency: string
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
  /** From the invoice's payments; null until paid (or on a retrieve without the payments list). */
  paymentIntentId: string | null
  customerId: string | null
  /** `metadata.invoiceId`: our invoice. */
  invoiceId: string | null
}

export interface CreateInvoiceInput {
  customerId: string
  currency: string
  dueDate: Date
  invoiceId: string
  invoiceNumber: string
  /** Number printed by Stripe; our own on the first attempt so customer and staff see one number. */
  stripeNumber: string | null
  description: string
  idempotencyKey: string
}

export interface InvoiceItemInput { customerId: string; providerInvoiceId: string; amountMinor: number; currency: string; description: string; lineId: string; idempotencyKey: string }

/** ADR-0039 D4: Stripe Invoicing. Optional on the port: only adapters that implement it can issue Stripe invoices. */
export interface ProviderInvoicing {
  ensureCustomer(i: { userId: string; email: string | null; name: string; idempotencyKey: string }): Promise<{ id: string }>
  createInvoice(i: CreateInvoiceInput): Promise<ProviderInvoice>
  addItem(i: InvoiceItemInput): Promise<void>
  finalize(providerInvoiceId: string, idempotencyKey: string): Promise<ProviderInvoice>
  retrieve(providerInvoiceId: string): Promise<ProviderInvoice | null>
  /** Voids an open invoice or deletes a draft; a paid or already void invoice is returned unchanged. */
  discard(providerInvoiceId: string): Promise<ProviderInvoice | null>
}

export interface PaymentProvider {
  readonly id: PaymentProviderId
  readonly publishableKey: string | null
  /** Stripe Connect: the account charges are made on; null for a plain account (ADR-0028 D11). */
  readonly connectedAccountId: string | null
  createSession(input: CreateSessionInput): Promise<ProviderSession>
  retrieveSession(providerSessionId: string): Promise<ProviderSession | null>
  createRefund(input: RefundInput): Promise<{ id: string }>
  /** Verifies the signature on the raw body (never on re-serialised JSON) and returns the event; throws SIGNATURE_INVALID. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event
  health(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
  readonly invoicing?: ProviderInvoicing
}
