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
  conditions: { change: Tri<unknown>; refund: Tri<unknown> }
  segmentCount: number
}): string[] {
  const out: string[] = []
  for (let i = 0; i < option.segmentCount; i++) {
    const b = option.baggage.find((x) => x.segmentIndex === i)
    if (!b || b.checked.status === "UNKNOWN") out.push(`baggage[${i}].checked`)
  }
  if (option.conditions.change.status === "UNKNOWN") out.push("conditions.change")
  if (option.conditions.refund.status === "UNKNOWN") out.push("conditions.refund")
  return out
}
