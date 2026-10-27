import type { ServiceQuoteLine } from "@unitravel/contracts"
import type { Tx } from "@unitravel/db"

import { AppError } from "../../core/errors"

/**
 * HOOK for the customer club (ADR-0016, spec section 4.4): the club engineer replaces the body of this function.
 *
 * It runs inside the send_quote transaction for every quote that contains a CLUB_DISCOUNT line and must throw
 * VALIDATION_FAILED unless each line names an ACTIVE benefit that belongs to the customer (or their tier), applies to
 * SERVICE or ANY, is inside its validity window and, above the refund threshold, is approved. A line may never reduce a
 * supplier price; it is its own line (spec rules). Until the club exists the flag cannot be turned on usefully, so a line
 * is refused rather than accepted unchecked.
 */
export async function validateClubDiscountLines(_tx: Tx, _customerUserId: string, lines: readonly ServiceQuoteLine[], clubEnabled: boolean): Promise<void> {
  const discounts = lines.filter((l) => l.kind === "CLUB_DISCOUNT")
  if (!discounts.length) return
  if (!clubEnabled) throw new AppError("VALIDATION_FAILED", "Customer club is not enabled", [{ path: "lines", code: "CLUB_DISABLED" }])
  throw new AppError("VALIDATION_FAILED", "Customer club benefits cannot be applied yet", [{ path: "lines", code: "CLUB_NOT_AVAILABLE" }])
}
