import { z } from "zod"

import { IsoDateTime, Money, Uuid } from "./common"
import { OnlinePaymentEligibility, PaymentProviderId } from "./payments"

// ADR-0039 D4: the Stripe Invoice that collects one of our invoices. Our invoice stays the record; this mirrors Stripe.

export const STRIPE_INVOICE_STATUSES = ["CREATING", "DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE", "FAILED"] as const
export const StripeInvoiceStatus = z.enum(STRIPE_INVOICE_STATUSES)
export type StripeInvoiceStatus = z.infer<typeof StripeInvoiceStatus>

/** Invoice events the webhook handles in addition to Checkout and charge events (Developer Panel checklist). */
export const STRIPE_INVOICE_EVENTS = ["invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible", "invoice.updated"] as const

export const StripeInvoiceAttempt = z.object({
  id: Uuid,
  attempt: z.number().int(),
  status: StripeInvoiceStatus,
  stripeInvoiceId: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: IsoDateTime,
})

export const StripeInvoiceView = z.object({
  invoiceId: Uuid,
  provider: PaymentProviderId.nullable(),
  mode: z.enum(["test", "live"]),
  /** False when the active adapter cannot issue Stripe invoices (no keys). */
  supportsInvoicing: z.boolean(),
  /** Online payment checks for this invoice (flag, ONLINE_PAYMENT policy, expiry, provider); a Stripe invoice is created only when offered. */
  eligibility: OnlinePaymentEligibility,
  /** The live attempt (CREATING, DRAFT, OPEN or PAID), else the latest one. */
  current: z.object({
    id: Uuid,
    attempt: z.number().int(),
    status: StripeInvoiceStatus,
    stripeInvoiceId: z.string().nullable(),
    stripeCustomerId: z.string().nullable(),
    amountDue: Money.nullable(),
    amountPaid: Money.nullable(),
    hostedInvoiceUrl: z.string().nullable(),
    invoicePdfUrl: z.string().nullable(),
    /** Stripe Dashboard link (test mode); null for the FAKE adapter. */
    dashboardUrl: z.string().nullable(),
    lastError: z.string().nullable(),
    finalizedAt: IsoDateTime.nullable(),
    paidAt: IsoDateTime.nullable(),
    voidedAt: IsoDateTime.nullable(),
    syncedAt: IsoDateTime.nullable(),
  }).nullable(),
  history: z.array(StripeInvoiceAttempt),
  /** Staff may create (or retry) now: issued, eligible, invoicing supported and no live attempt. */
  canCreate: z.boolean(),
})
export type StripeInvoiceView = z.infer<typeof StripeInvoiceView>
