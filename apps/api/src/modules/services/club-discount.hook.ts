import { and, eq, inArray } from "drizzle-orm"

import type { ServiceQuoteLine } from "@unitravel/contracts"
import { loyaltyBenefits, loyaltyMembers, type Tx } from "@unitravel/db"
import { checkClubDiscountLine } from "@unitravel/domain"

import { AppError } from "../../core/errors"

/**
 * Customer club check for service quotes (ADR-0016, spec §4.4). Runs inside the send_quote transaction for every quote
 * that contains a CLUB_DISCOUNT line and refuses the quote unless each line names an ACTIVE, approved benefit of the
 * customer (or their tier) that applies to SERVICE or ANY, is inside its validity window and covers the amount. The
 * line is its own line: it never changes a supplier price. Rules: `checkClubDiscountLine` in packages/domain.
 */
export async function validateClubDiscountLines(tx: Tx, customerUserId: string, lines: readonly ServiceQuoteLine[], clubEnabled: boolean): Promise<void> {
  const discounts = lines.filter((l) => l.kind === "CLUB_DISCOUNT")
  if (!discounts.length) return
  if (!clubEnabled) throw new AppError("VALIDATION_FAILED", "Customer club is not enabled", [{ path: "lines", code: "CLUB_DISABLED" }])
  const ids = [...new Set(discounts.map((l) => l.benefitId).filter((x): x is string => !!x))]
  // Lock the member and the named benefits so a revoke or approval cannot race the quote.
  const [member] = await tx.select().from(loyaltyMembers).where(eq(loyaltyMembers.userId, customerUserId)).for("share")
  const benefits = ids.length ? await tx.select().from(loyaltyBenefits).where(and(inArray(loyaltyBenefits.id, ids))).for("share") : []
  const grossMinor = lines.filter((l) => l.kind !== "CLUB_DISCOUNT").reduce((s, l) => s + l.amount.amountMinor, 0)
  const now = new Date()
  const errors: { path: string; code: string }[] = []
  lines.forEach((line, i) => {
    if (line.kind !== "CLUB_DISCOUNT") return
    const r = checkClubDiscountLine(line, { customerUserId, member: member ?? null, benefit: benefits.find((b) => b.id === line.benefitId) ?? null, product: "SERVICE", grossMinor, now })
    if (!r.ok) errors.push({ path: `lines.${i}`, code: r.code })
  })
  // One benefit may be used once per quote, so a fixed discount cannot be stacked by repeating the line.
  if (ids.length !== discounts.length) errors.push({ path: "lines", code: "BENEFIT_REPEATED" })
  if (errors.length) throw new AppError("VALIDATION_FAILED", "A club discount line is not valid for this customer", errors)
}
