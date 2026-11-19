import type { FbConnectionState, Freshness, SeatsReported, SyncGateReason, UsageLevel } from "@unitravel/contracts"

// ADR-0037. Pure rules for the Flight Builder staff-capture source; no provider is ever called from here.

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** No automated adapter exists in the repository (ADR-0037 D1), so the sync gate can never open. */
export const FB_ADAPTER_PRESENT = false
const CONNECTED_CHECK_MS = 24 * HOUR_MS
const USAGE_STALE_MS = 7 * DAY_MS

export interface FbAuthorisationFacts { revokedAt: Date | null; expiresAt: Date | null }

export interface FbConnectionFacts {
  enabled: boolean
  credentialsSet: boolean
  panelUrlSet: boolean
  /** Latest scan hits per booking ÷ the indicative per-booking limit (1 = at the limit); null when unknown. */
  usageRatio: number | null
  authorisation: FbAuthorisationFacts | null
  credentialsInvalidAt: Date | null
  /** Last authorised, verified check. No code path writes one today. */
  verifiedCheckAt: Date | null
}

export function authorisationActive(a: FbAuthorisationFacts | null, now: Date): boolean {
  return a !== null && a.revokedAt === null && (a.expiresAt === null || a.expiresAt.getTime() > now.getTime())
}

export function fbConnectionState(f: FbConnectionFacts, now: Date): FbConnectionState {
  if (!f.enabled) return "DISABLED"
  if (!f.credentialsSet || !f.panelUrlSet) return "NOT_CONFIGURED"
  if (f.usageRatio !== null && f.usageRatio >= 1) return "ACCESS_RESTRICTED"
  if (!authorisationActive(f.authorisation, now)) return "AUTHORIZATION_PENDING"
  if (f.credentialsInvalidAt) return "AUTH_FAILED"
  if (f.verifiedCheckAt && now.getTime() - f.verifiedCheckAt.getTime() <= CONNECTED_CHECK_MS) return "CONNECTED"
  return "CONFIGURED"
}

export interface SyncGateFacts {
  enabled: boolean
  authorisation: FbAuthorisationFacts | null
  adapterPresent: boolean
  usageRatio: number | null
}

export function syncGate(f: SyncGateFacts, now: Date): { allowed: boolean; reason: SyncGateReason | null } {
  if (!f.enabled) return { allowed: false, reason: "DISABLED" }
  if (!authorisationActive(f.authorisation, now)) return { allowed: false, reason: "NOT_AUTHORISED" }
  if (!f.adapterPresent) return { allowed: false, reason: "NO_ADAPTER" }
  if (f.usageRatio !== null && f.usageRatio >= 1) return { allowed: false, reason: "QUOTA_CRITICAL" }
  return { allowed: true, reason: null }
}

export interface FreshnessSettings { freshHours: number; staleHours: number }


/** The deadline timezone is UNKNOWN, so a fare expires at 00:00 UTC of the deadline date (errs early). */
export function fareFreshness(observedAt: Date, deadline: string | null, now: Date, s: FreshnessSettings): Freshness {
  if (deadline && now.getTime() >= Date.parse(`${deadline}T00:00:00Z`)) return "EXPIRED"
  const age = now.getTime() - observedAt.getTime()
  if (age < s.freshHours * HOUR_MS) return "FRESH"
  if (age < s.staleHours * HOUR_MS) return "AGING"
  return "STALE"
}

/** True when the ticketing deadline is still ahead but within `hours` of now. */
export function deadlineWarning(deadline: string | null, now: Date, hours: number): boolean {
  if (!deadline) return false
  const at = Date.parse(`${deadline}T00:00:00Z`)
  return at > now.getTime() && at - now.getTime() <= hours * HOUR_MS
}

export interface UsageObservationFacts {
  observedAt: Date
  bookings: number
  scanHits: number
  warningThreshold: number
  criticalThreshold: number
}

export interface UsageSummaryResult {
  /** Scan hits per booking, as the panel's Scan Hits page counts it; 0 when bookings are unknown (level UNKNOWN). */
  ratio: number
  /** ratio ÷ critical threshold (1 = at the indicative limit); null when there are no bookings to divide by. */
  limitShare: number | null
  level: UsageLevel
  headroomEstimate: number
  estimateLabel: "ESTIMATED"
  stale: boolean
  observedAt: Date
}

/**
 * The panel's thresholds are scan hits *per booking* (warning 45, indicative limit 50), so the level uses
 * scan hits ÷ bookings at the latest observation. One search can consume more than one hit, so nothing is
 * decremented automatically: every figure is what a person recorded.
 */
export function usageSummary(observations: readonly UsageObservationFacts[], now: Date): UsageSummaryResult | null {
  if (observations.length === 0) return null
  const latest = observations.reduce((a, b) => (b.observedAt.getTime() > a.observedAt.getTime() ? b : a))
  const perBooking = latest.bookings > 0 ? latest.scanHits / latest.bookings : null
  const level: UsageLevel =
    perBooking === null ? "UNKNOWN" : perBooking >= latest.criticalThreshold ? "CRITICAL" : perBooking >= latest.warningThreshold ? "WARNING" : "OK"
  return {
    ratio: perBooking ?? 0,
    limitShare: perBooking !== null && latest.criticalThreshold > 0 ? perBooking / latest.criticalThreshold : null,
    level,
    headroomEstimate: Math.max(0, latest.criticalThreshold * latest.bookings - latest.scanHits),
    estimateLabel: "ESTIMATED",
    stale: now.getTime() - latest.observedAt.getTime() > USAGE_STALE_MS,
    observedAt: latest.observedAt,
  }
}

/** The panel's "9" is a cap whose meaning is UNKNOWN: it is flagged, never read as a count. */
export function seatsReported(raw: string): SeatsReported {
  const t = raw.trim()
  if (!/^\d$/.test(t)) return { raw, count: null, atCap: false }
  const n = Number(t)
  return { raw, count: n === 9 ? null : n, atCap: n === 9 }
}
