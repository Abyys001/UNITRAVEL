import type { AtolMode, PaymentStatus, Tri } from "@unitravel/contracts"

export interface PaymentRecordFacts {
  amountMinor: number
  currency: string
  status: "RECORDED" | "VERIFIED" | "REJECTED" | "REFUNDED"
}

/**
 * Payment status is computed from verified records against the accepted quote total — never set by hand
 * (ch. 13.2). Refunds: REFUND_PENDING while a refund is recorded but not all money is returned.
 */
export function computePaymentStatus(records: PaymentRecordFacts[], acceptedTotalMinor: number | null, refundPending = false): PaymentStatus {
  const verified = records.filter((r) => r.status === "VERIFIED").reduce((s, r) => s + r.amountMinor, 0)
  const refunded = records.filter((r) => r.status === "REFUNDED").reduce((s, r) => s + r.amountMinor, 0)
  if (refunded > 0 && verified - refunded <= 0) return "REFUNDED"
  if (refundPending) return "REFUND_PENDING"
  if (verified <= 0) return "NONE"
  if (acceptedTotalMinor === null || verified < acceptedTotalMinor) return "PARTIAL"
  return "PAID"
}

export type PaymentStage = "BEFORE_RESERVATION" | "RESERVED" | "AT_TICKETING"

/** Chapter 27.6 — whether the ATOL mode allows taking money at this stage. */
export function atolAllowsPayment(mode: AtolMode, stage: PaymentStage): { ok: true } | { ok: false; reason: string } {
  if (mode === "PAY_ON_TICKETING" && stage !== "AT_TICKETING") {
    return { ok: false, reason: "ATOL mode PAY_ON_TICKETING: payments can only be recorded in the same step as issued tickets" }
  }
  return { ok: true }
}

export function needsSecondVerifier(amountMinor: number, thresholdMinor: number): boolean {
  return amountMinor > thresholdMinor
}

/** Attribute paths that are still UNKNOWN on a quote option; sending is blocked while any remain (ch. 12.5, 15.5). */
export function unknownQuoteFields(option: {
  baggage: { segmentIndex: number; checked: Tri<unknown>; cabin: Tri<unknown> }[]
  conditions: { change: Tri<{ allowed: boolean; penalty?: { amountMinor: number } }>; refund: Tri<{ allowed: boolean; penalty?: { amountMinor: number } }> }
  segmentCount: number
}): string[] {
  const out: string[] = []
  for (let i = 0; i < option.segmentCount; i++) {
    const b = option.baggage.find((x) => x.segmentIndex === i)
    if (!b || b.checked.status === "UNKNOWN") out.push(`baggage[${i}].checked`)
  }
  for (const k of ["change", "refund"] as const) {
    const c = option.conditions[k]
    if (c.status === "UNKNOWN") out.push(`conditions.${k}`)
    // "Allowed with a fee" and no amount would be sent as a zero fee (ADR-0008 W7).
    else if (c.value.allowed && c.value.penalty && !(c.value.penalty.amountMinor > 0)) out.push(`conditions.${k}.penalty`)
  }
  return out
}

const FLIGHT_PAYABLE = ["ACCEPTED", "RESERVED", "TICKETED"]
/** Cargo is payable once the quote is accepted, through fulfilment and until completed (ADR-0008 W2). */
export const CARGO_PAYABLE = ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "EXCEPTION"]

export interface PaymentRecordingState { allowed: boolean; reason?: string; suggestedAmount: { amountMinor: number; currency: string } | null }

/**
 * Whether staff may record an offline payment now, and the amount still outstanding (ADR-0008 W8). Mirrors the
 * checks `recordPayment` runs, so the console offers the action only when it will succeed.
 * `recordedMinor` is every non-rejected record on the request.
 */
export function paymentRecordingState(i: { product: "FLIGHT" | "CARGO"; status: string; atolMode: AtolMode; acceptedTotal: { amountMinor: number; currency: string } | null; recordedMinor: number }): PaymentRecordingState {
  const suggestedAmount = i.acceptedTotal ? { amountMinor: Math.max(0, i.acceptedTotal.amountMinor - i.recordedMinor), currency: i.acceptedTotal.currency } : null
  if (!(i.product === "CARGO" ? CARGO_PAYABLE : FLIGHT_PAYABLE).includes(i.status)) return { allowed: false, reason: "Payments are recorded after the customer has accepted a quote", suggestedAmount }
  if (i.product === "FLIGHT" && i.status !== "TICKETED") {
    const atol = atolAllowsPayment(i.atolMode, "RESERVED")
    if (!atol.ok) return { allowed: false, reason: "ATOL mode PAY_ON_TICKETING: the payment is recorded in the Record tickets step, not before", suggestedAmount }
  }
  return { allowed: true, suggestedAmount }
}
