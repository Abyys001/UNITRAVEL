import type { FlightRequestStatus, Money, PriceBreakdown } from "@unitravel/contracts"

/**
 * Staff amendment of a flight request's trip and travellers (ADR-0013 A2). From RESERVED on the PNR is the truth
 * and changes go through after-sales; in QUOTED/ACCEPTED the open quote keeps describing what it described.
 */
export const AMENDABLE_STATUSES: readonly FlightRequestStatus[] = ["NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED"]
const WITH_OPEN_QUOTE: readonly FlightRequestStatus[] = ["QUOTED", "ACCEPTED"]

export interface AmendState { allowed: boolean; needsAcknowledge: boolean; reason?: string }

export function amendState(status: FlightRequestStatus): AmendState {
  if (!AMENDABLE_STATUSES.includes(status)) {
    const reason = status === "SUBMITTED" || status === "COMPLIANCE_HOLD" ? "Wait for compliance screening to finish"
      : status === "RESERVED" || status === "TICKETED" ? "A reservation exists: use after-sales for changes"
      : `A ${status} request cannot be amended`
    return { allowed: false, needsAcknowledge: false, reason }
  }
  return { allowed: true, needsAcknowledge: WITH_OPEN_QUOTE.includes(status) }
}

/** Fare + taxes + service fee + extras − discount, in minor units (ADR-0013 A5). The server's total; the client's is only checked against it. */
export function priceBreakdownTotal(pb: Omit<PriceBreakdown, "total">): number {
  return pb.fare.amountMinor + pb.taxes.amountMinor + pb.serviceFee.amountMinor + (pb.extras ?? []).reduce((n, e) => n + e.amount.amountMinor, 0) - (pb.discount?.amount.amountMinor ?? 0)
}

/** Why a price breakdown cannot be sent, or null. Paths are relative to the breakdown. */
export function priceBreakdownIssue(pb: PriceBreakdown, currency: string): { path: string; code: string; message: string } | null {
  const all: [string, Money][] = [["fare", pb.fare], ["taxes", pb.taxes], ["serviceFee", pb.serviceFee], ...(pb.extras ?? []).map((e, i): [string, Money] => [`extras[${i}].amount`, e.amount]), ...(pb.discount ? [["discount.amount", pb.discount.amount] as [string, Money]] : []), ["total", pb.total]]
  for (const [path, m] of all) if (m.currency !== currency) return { path, code: "CURRENCY", message: "All prices must be in the quote currency" }
  for (const [path, m] of all.slice(0, 3)) if (m.amountMinor < 0) return { path, code: "NEGATIVE", message: "Amounts cannot be negative" }
  const beforeDiscount = priceBreakdownTotal({ ...pb, discount: undefined })
  if (pb.discount && pb.discount.amount.amountMinor > beforeDiscount) return { path: "discount.amount", code: "DISCOUNT_TOO_LARGE", message: "The discount is larger than the price" }
  const total = priceBreakdownTotal(pb)
  if (total <= 0) return { path: "total", code: "NOT_POSITIVE", message: "The total must be greater than zero" }
  if (total !== pb.total.amountMinor) return { path: "total", code: "SUM", message: "Fare + taxes + service fee + extras - discount must equal the total" }
  return null
}
