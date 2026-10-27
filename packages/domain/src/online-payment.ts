import type { OnlinePaymentEligibility, OnlinePaymentPolicy, OnlinePaymentReason, PaymentSessionStatus, RefundStatus, StripeMode } from "@unitravel/contracts"

import { type TransitionTable, evaluate, type MachineActor } from "./machine"
import { needsSecondVerifier } from "./payments"

// ADR-0007: online card payment rules. Framework-free; the API supplies facts and persists the result.

/**
 * Live mode is BLOCKED on Stripe's written approval and counsel (owner decision 1). Nothing at run time can change
 * this: a later ADR edits the constant. The API, the credential writer and the adapter factory all consult it.
 */
export const ONLINE_PAYMENT_LIVE_ENABLED = false as boolean

/** `deployed` is true on staging and production: there only live data exists, so test mode is refused (ADR-0014). */
export function canEnterStripeMode(mode: StripeMode, deployed = false): { ok: true } | { ok: false; reason: string } {
  if (mode === "live" && !ONLINE_PAYMENT_LIVE_ENABLED) return { ok: false, reason: "Live mode is blocked: Stripe's written approval and counsel's advice are outstanding (ADR-0007 P1)" }
  if (mode === "test" && deployed) return { ok: false, reason: "Stripe test mode only runs with APP_ENV=local; deployed hosts use live data only (ADR-0014)" }
  return { ok: true }
}

/** Stripe's Checkout Session limits: at least 30 minutes, at most 24 hours from creation. */
export const CHECKOUT_MIN_MS = 30 * 60_000
export const CHECKOUT_MAX_MS = 24 * 3600_000

/** Session expiry: never later than the invoice's, never beyond Stripe's maximum; null when too little time is left (P5). */
export function checkoutExpiry(invoiceExpiresAt: Date, now: Date): Date | null {
  const remaining = invoiceExpiresAt.getTime() - now.getTime()
  if (remaining < CHECKOUT_MIN_MS) return null
  return new Date(now.getTime() + Math.min(remaining, CHECKOUT_MAX_MS))
}

export interface EligibilityFacts {
  product: "FLIGHT" | "CARGO" | "SERVICE"
  currency: string
  totalMinor: number
  customerUserId: string
}

/** Default deny (P11): product and currency each need an ALLOW; any matching BLOCK wins; `max_minor` ALLOW caps the amount. */
export function onlinePaymentEligibility(policies: readonly OnlinePaymentPolicy[], f: EligibilityFacts): OnlinePaymentEligibility {
  const reasons: OnlinePaymentReason[] = []
  const has = (key: string, action: "ALLOW" | "BLOCK") => policies.some((p) => p.key === key && p.action === action)
  if ([`product:${f.product}`, `currency:${f.currency}`, `customer:${f.customerUserId}`].some((k) => has(k, "BLOCK"))) reasons.push("BLOCKED")
  if (!has(`product:${f.product}`, "ALLOW")) reasons.push("NO_PRODUCT_POLICY")
  if (!has(`currency:${f.currency}`, "ALLOW")) reasons.push("NO_CURRENCY_POLICY")
  const caps = policies.filter((p) => p.action === "ALLOW" && p.key.startsWith("max_minor:")).map((p) => Number(p.key.slice(10)))
  if (caps.length && f.totalMinor > Math.min(...caps)) reasons.push("OVER_LIMIT")
  return { offered: reasons.length === 0, reasons }
}

// ---- payment session machine ----
export type SessionCommand = "complete" | "expire" | "fail" | "mismatch"
export interface SessionFacts { status: PaymentSessionStatus }

export const SESSION_TRANSITIONS: TransitionTable<PaymentSessionStatus, SessionFacts, SessionCommand> = {
  complete: { from: ["OPEN", "EXPIRED"], to: "COMPLETE", actor: "SYSTEM" },
  expire: { from: ["OPEN"], to: "EXPIRED", actor: "SYSTEM" },
  fail: { from: ["OPEN"], to: "FAILED", actor: "SYSTEM" },
  mismatch: { from: ["OPEN", "EXPIRED"], to: "MISMATCH", actor: "SYSTEM" },
}

/** A verified payment can arrive for a session we already marked EXPIRED (late webhook); everything else is terminal. */
export function sessionNext(status: PaymentSessionStatus, command: SessionCommand, actor: MachineActor): PaymentSessionStatus | null {
  const ev = evaluate(SESSION_TRANSITIONS, command, { status }, actor)
  return ev.ok ? ev.to : null
}

/** The paid amount must equal the invoice total in the invoice currency (P8). */
export function settlementCheck(invoice: { totalMinor: number; currency: string }, paid: { amountMinor: number; currency: string }): "OK" | "MISMATCH" {
  return invoice.totalMinor === paid.amountMinor && invoice.currency.toUpperCase() === paid.currency.toUpperCase() ? "OK" : "MISMATCH"
}

// ---- refund request machine (four-eyes above the existing threshold, P10) ----
export type RefundCommand = "submit" | "approve" | "reject" | "complete" | "fail"
export interface RefundFacts { status: RefundStatus; requestedBy: string; actorId?: string; amountMinor: number; thresholdMinor: number }

const differentPerson = (f: RefundFacts): string | null => (f.actorId && f.actorId === f.requestedBy ? "A different staff member must approve this refund" : null)

export const REFUND_TRANSITIONS: TransitionTable<RefundStatus, RefundFacts, RefundCommand> = {
  // Within the threshold the author's own request goes straight to the provider.
  submit: { from: ["PENDING_APPROVAL"], to: "SUBMITTED", actor: "STAFF", permissions: ["payment.refund.request"], guard: (f) => (needsSecondVerifier(f.amountMinor, f.thresholdMinor) ? "Above the four-eyes threshold: a second person must approve" : null) },
  approve: { from: ["PENDING_APPROVAL"], to: "SUBMITTED", actor: "STAFF", permissions: ["payment.refund.approve"], guard: differentPerson },
  reject: { from: ["PENDING_APPROVAL"], to: "REJECTED", actor: "STAFF", permissions: ["payment.refund.approve"] },
  complete: { from: ["SUBMITTED"], to: "COMPLETED", actor: "SYSTEM" },
  fail: { from: ["SUBMITTED"], to: "FAILED", actor: "SYSTEM" },
}
