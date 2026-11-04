import type { ProviderSession } from "./payment-port"

/** ADR-0007 P15: what a daily comparison of our sessions with the provider can find. Report only; nothing here changes state. */
export const DRIFT_KINDS = ["MISSING_AT_PROVIDER", "PAID_AT_PROVIDER", "AMOUNT_MISMATCH", "OPEN_EXPIRED_AT_PROVIDER", "CLOSED_OPEN_AT_PROVIDER"] as const
export type DriftKind = (typeof DRIFT_KINDS)[number]

export interface DriftSession { status: "OPEN" | "COMPLETE" | "EXPIRED" | "FAILED" | "MISMATCH"; amountMinor: number; currency: string }

/** The invoice is ISSUED (the sweep only looks at those), so a paid session at the provider means a webhook was missed. */
export function compareSession(local: DriftSession, remote: ProviderSession | null): DriftKind | null {
  if (!remote) return "MISSING_AT_PROVIDER"
  if (remote.status === "complete" && remote.paymentStatus === "paid") return "PAID_AT_PROVIDER"
  if ((remote.amountTotal != null && remote.amountTotal !== local.amountMinor) || (remote.currency != null && remote.currency.toUpperCase() !== local.currency.toUpperCase())) return "AMOUNT_MISMATCH"
  if (local.status === "OPEN" && remote.status === "expired") return "OPEN_EXPIRED_AT_PROVIDER"
  if (local.status !== "OPEN" && remote.status === "open") return "CLOSED_OPEN_AT_PROVIDER"
  return null
}

export interface DriftFinding { invoiceId: string; invoice: string | null; sessionId: string; kind: DriftKind }
export type DriftReport =
  | { skipped: "FLAG_OFF" | "NO_PROVIDER" }
  | { skipped?: undefined; checked: number; errors: number; mismatches: DriftFinding[] }
