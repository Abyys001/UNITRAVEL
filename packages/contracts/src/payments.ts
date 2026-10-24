import { z } from "zod"

import { IsoDateTime, Money, Reference, Uuid } from "./common"

// ADR-0007: Stripe Embedded Checkout, test mode only. Cards never touch our systems; the browser gets a client secret.
export const PAYMENT_PROVIDERS = ["STRIPE", "FAKE"] as const
export const PaymentProviderId = z.enum(PAYMENT_PROVIDERS)
export type PaymentProviderId = z.infer<typeof PaymentProviderId>

/** Live is BLOCKED (ADR-0007 P1): the schema for a mode request accepts the word so the refusal is explicit and audited. */
export const StripeMode = z.enum(["test", "live"])
export type StripeMode = z.infer<typeof StripeMode>

// ---- eligibility policy (compliance data, policy type ONLINE_PAYMENT) ----
export const ONLINE_PAYMENT_REASONS = ["FLAG_OFF", "NOT_ISSUED", "NO_PRODUCT_POLICY", "NO_CURRENCY_POLICY", "BLOCKED", "OVER_LIMIT", "EXPIRES_TOO_SOON", "NOT_CONFIGURED"] as const
export const OnlinePaymentReason = z.enum(ONLINE_PAYMENT_REASONS)
export type OnlinePaymentReason = z.infer<typeof OnlinePaymentReason>

/** Keys a policy of type ONLINE_PAYMENT may carry. */
export const OnlinePaymentPolicyKey = z.string().regex(/^(product:(FLIGHT|CARGO)|currency:[A-Z]{3}|max_minor:\d{1,12}|customer:[0-9a-f-]{36})$/)

export const OnlinePaymentPolicy = z.object({ key: OnlinePaymentPolicyKey, action: z.enum(["ALLOW", "BLOCK"]) })
export type OnlinePaymentPolicy = z.infer<typeof OnlinePaymentPolicy>

export const OnlinePaymentEligibility = z.object({ offered: z.boolean(), reasons: z.array(OnlinePaymentReason) })
export type OnlinePaymentEligibility = z.infer<typeof OnlinePaymentEligibility>

// ---- customer ----
export const PaymentSessionStatus = z.enum(["OPEN", "COMPLETE", "EXPIRED", "FAILED", "MISMATCH"])
export type PaymentSessionStatus = z.infer<typeof PaymentSessionStatus>

/** Returned to the browser: the client secret and the publishable key only, never a secret key (ADR-0007 P3). */
export const CheckoutSessionView = z.object({
  provider: PaymentProviderId,
  clientSecret: z.string().min(1),
  publishableKey: z.string().nullable(),
  expiresAt: IsoDateTime,
  invoiceNumber: z.string(),
})
export type CheckoutSessionView = z.infer<typeof CheckoutSessionView>

/** What the pay and return pages read. Built from our database; the redirect from Stripe is never proof of payment. */
export const CustomerPaymentState = z.object({
  invoiceNumber: z.string(),
  requestRef: Reference,
  invoiceStatus: z.enum(["ISSUED", "PAID", "CANCELLED", "REFUNDED"]),
  total: Money,
  expiresAt: IsoDateTime,
  offered: z.boolean(),
  reasons: z.array(OnlinePaymentReason),
  provider: PaymentProviderId.nullable(),
  session: z.object({ status: PaymentSessionStatus, expiresAt: IsoDateTime }).nullable(),
  /** The card payment has been taken but the invoice is not settled yet (asynchronous method, or waiting for the webhook). */
  processing: z.boolean(),
  paidAt: IsoDateTime.nullable(),
})
export type CustomerPaymentState = z.infer<typeof CustomerPaymentState>

// ---- Stripe events and refunds (staff) ----
export const StripeEventOutcome = z.enum(["PROCESSED", "IGNORED", "FAILED", "MISMATCH"])
export const StripeEventView = z.object({
  id: z.string(), type: z.string(), mode: z.string(), outcome: StripeEventOutcome, error: z.string().nullable(),
  receivedAt: IsoDateTime, processedAt: IsoDateTime.nullable(),
})
export type StripeEventView = z.infer<typeof StripeEventView>

export const REFUND_REASONS = ["CUSTOMER_REQUEST", "DUPLICATE", "AMOUNT_MISMATCH", "SERVICE_NOT_DELIVERED", "OTHER"] as const
export const RefundReason = z.enum(REFUND_REASONS)
export const RefundStatus = z.enum(["PENDING_APPROVAL", "SUBMITTED", "COMPLETED", "REJECTED", "FAILED"])
export type RefundStatus = z.infer<typeof RefundStatus>

/** Leaving the amount out refunds what is still refundable. */
export const RefundRequestBody = z.object({
  amountMinor: z.number().int().min(1).optional(),
  reasonCode: RefundReason,
  note: z.string().trim().max(500).optional(),
}).refine((b) => b.reasonCode !== "OTHER" || !!b.note, { message: "Explain why", path: ["note"] })
export type RefundRequestBody = z.infer<typeof RefundRequestBody>
export const RefundRejectBody = z.object({ note: z.string().trim().min(3).max(500) })

export const RefundView = z.object({
  id: Uuid, status: RefundStatus, amount: Money.nullable(), reasonCode: RefundReason, note: z.string().nullable(),
  requestedBy: z.string(), approvedBy: z.string().nullable(), needsSecondApprover: z.boolean(), failure: z.string().nullable(),
  createdAt: IsoDateTime, decidedAt: IsoDateTime.nullable(),
})
export type RefundView = z.infer<typeof RefundView>

/** Amounts are null for staff without `pricing.read.internal`, as on the invoice itself (ADR-0004). */
export const StaffInvoicePayments = z.object({
  invoiceId: Uuid,
  online: OnlinePaymentEligibility,
  provider: PaymentProviderId.nullable(),
  sessions: z.array(z.object({ id: Uuid, provider: PaymentProviderId, status: PaymentSessionStatus, expiresAt: IsoDateTime, createdAt: IsoDateTime })),
  payments: z.array(z.object({ id: Uuid, method: z.string(), amount: Money.nullable(), refunded: Money.nullable(), status: z.string(), receivedAt: IsoDateTime, providerRef: z.string().nullable() })),
  refunds: z.array(RefundView),
  refundThreshold: Money.nullable(),
})
export type StaffInvoicePayments = z.infer<typeof StaffInvoicePayments>

// ---- Developer Panel ----
export const StripeCredentialsBody = z.object({
  /** `live` parses so the refusal is explicit and audited (ADR-0007 P1); the API never stores a live credential. */
  mode: StripeMode,
  secretKey: z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9_]{8,200}$/).optional(),
  publishableKey: z.string().regex(/^pk_(test|live)_[A-Za-z0-9_]{8,200}$/).optional(),
  webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9_+/=]{8,200}$/).optional(),
}).refine((b) => !!(b.secretKey || b.publishableKey || b.webhookSecret), { message: "Provide at least one value" })
export type StripeCredentialsBody = z.infer<typeof StripeCredentialsBody>

export const PaymentConfigPatchBody = z.object({ provider: PaymentProviderId })
export const StripeModeRequestBody = z.object({ mode: StripeMode, note: z.string().trim().min(3).max(300).optional() })

export const PaymentsConfigView = z.object({
  provider: PaymentProviderId,
  mode: StripeMode,
  /** Always true until a later ADR changes the domain constant (ADR-0007 P1). */
  liveBlocked: z.boolean(),
  flagEnabled: z.boolean(),
  fakeAvailable: z.boolean(),
  webhookUrl: z.string(),
  credentials: z.object({ secretKey: z.boolean(), publishableKey: z.boolean(), webhookSecret: z.boolean(), rotatedAt: IsoDateTime.nullable() }),
  pendingModeRequest: z.object({ mode: StripeMode, requestedBy: z.string(), requestedAt: IsoDateTime }).nullable(),
  events: z.array(StripeEventView),
  failedEvents: z.number().int(),
  openSessions: z.number().int(),
})
export type PaymentsConfigView = z.infer<typeof PaymentsConfigView>

export const PaymentHealthView = z.object({ ok: z.boolean(), provider: PaymentProviderId, latencyMs: z.number(), detail: z.string() })
export type PaymentHealthView = z.infer<typeof PaymentHealthView>
