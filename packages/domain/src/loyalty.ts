import type { ServiceQuoteLine } from "@unitravel/contracts"

// ADR-0016: customer club rules, free of framework and database code so they can be property-tested.
// A benefit reaches money only as its own quote line; supplier prices and issued invoices are never touched.

export type BenefitKind = "DISCOUNT_PERCENT" | "DISCOUNT_FIXED" | "BONUS_CREDIT" | "PERK"
export type BenefitStatus = "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED"
export type AppliesTo = "FLIGHT" | "CARGO" | "SERVICE" | "ANY"
export type MemberStatus = "ACTIVE" | "SUSPENDED" | "REMOVED"
export type LedgerKind = "GRANTED" | "USED" | "EXPIRED" | "REVERSED"

/** A percentage discount above this needs a second approver (ADR-0016). */
export const PERCENT_APPROVAL_LIMIT = 10

/**
 * Four eyes (ADR-0016): fixed discounts and bonus credit above the existing payment four-eyes threshold, and any
 * percentage above 10, start PENDING_APPROVAL. Perks carry no money and never need a second approver.
 */
export function benefitNeedsApproval(kind: BenefitKind, value: number, thresholdMinor: number): boolean {
  if (kind === "DISCOUNT_PERCENT") return value > PERCENT_APPROVAL_LIMIT
  if (kind === "DISCOUNT_FIXED" || kind === "BONUS_CREDIT") return value > thresholdMinor
  return false
}

/** Stored status plus the clock: an ACTIVE benefit past its end reads as EXPIRED, one not started yet is not usable. */
export function effectiveBenefitStatus(b: { status: BenefitStatus; validTo: Date }, now: Date): BenefitStatus {
  return b.status === "ACTIVE" && b.validTo <= now ? "EXPIRED" : b.status
}

export interface BenefitFacts {
  id: string
  kind: BenefitKind
  value: number
  currency: string | null
  appliesTo: AppliesTo
  tierId: string | null
  userId: string | null
  status: BenefitStatus
  validFrom: Date
  validTo: Date
}

export interface MemberFacts {
  userId: string
  tierId: string
  status: MemberStatus
}

export type ClubLineCheck = { ok: true } | { ok: false; code: string; message: string }

const fail = (code: string, message: string): ClubLineCheck => ({ ok: false, code, message })

/**
 * Checks one CLUB_DISCOUNT line of a quote for `product` against the benefit it names and the customer's membership.
 * `grossMinor` is the sum of the quote's positive lines (what a percentage applies to).
 */
export function checkClubDiscountLine(
  line: Pick<ServiceQuoteLine, "kind" | "amount" | "benefitId">,
  ctx: { customerUserId: string; member: MemberFacts | null; benefit: BenefitFacts | null; product: Exclude<AppliesTo, "ANY">; grossMinor: number; now: Date },
): ClubLineCheck {
  if (line.kind !== "CLUB_DISCOUNT") return { ok: true }
  const { member, benefit, now } = ctx
  if (!member || member.userId !== ctx.customerUserId || member.status !== "ACTIVE") return fail("NOT_A_MEMBER", "The customer is not an active club member")
  if (!benefit || benefit.id !== line.benefitId) return fail("BENEFIT_UNKNOWN", "The benefit does not exist")
  const belongs = benefit.userId ? benefit.userId === ctx.customerUserId : benefit.tierId === member.tierId
  if (!belongs) return fail("BENEFIT_NOT_THEIRS", "The benefit does not belong to this customer or their tier")
  if (benefit.status !== "ACTIVE") return fail(benefit.status === "PENDING_APPROVAL" ? "BENEFIT_NOT_APPROVED" : "BENEFIT_INACTIVE", "The benefit is not active")
  if (now < benefit.validFrom || now >= benefit.validTo) return fail("BENEFIT_OUT_OF_DATE", "The benefit is outside its validity window")
  if (benefit.appliesTo !== "ANY" && benefit.appliesTo !== ctx.product) return fail("BENEFIT_WRONG_PRODUCT", "The benefit does not apply to this product")
  if (benefit.kind === "DISCOUNT_FIXED") {
    if (benefit.currency !== line.amount.currency) return fail("BENEFIT_WRONG_CURRENCY", "The discount is in another currency")
    if (line.amount.amountMinor > benefit.value) return fail("DISCOUNT_TOO_LARGE", "The discount is larger than the benefit")
    return { ok: true }
  }
  if (benefit.kind === "DISCOUNT_PERCENT") {
    const cap = Math.floor((ctx.grossMinor * benefit.value) / 100)
    if (line.amount.amountMinor > cap) return fail("DISCOUNT_TOO_LARGE", "The discount is larger than the benefit's percentage")
    return { ok: true }
  }
  // Bonus credit is used on an invoice through the ledger, and a perk has no amount: neither becomes a quote line.
  return fail("BENEFIT_NOT_A_DISCOUNT", "Only discount benefits can be a quote line")
}

/** Credit balance per currency: GRANTED adds; USED, EXPIRED and REVERSED subtract. */
export function ledgerBalance(entries: readonly { kind: LedgerKind; amountMinor: number; currency: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries) out[e.currency] = (out[e.currency] ?? 0) + (e.kind === "GRANTED" ? e.amountMinor : -e.amountMinor)
  return out
}

/** A debit (USED, EXPIRED, REVERSED) may never take a balance below zero: credit has no cash value and no overdraft. */
export function canDebit(balance: Record<string, number>, currency: string, amountMinor: number): boolean {
  return amountMinor > 0 && (balance[currency] ?? 0) >= amountMinor
}
