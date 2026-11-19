import { z } from "zod"

import { CarrierCode, Iata, IsoDate, IsoDateTime, Uuid } from "./common"
import { Cabin } from "./enums"
import { SegmentBaggage } from "./offer"

// ADR-0037: Flight Builder is a staff-capture source. Nothing here describes a provider call; staff record what they saw on the panel.

export const FareType = z.enum(["PUB", "NEGO", "TOP", "VFR", "OTHER"])
export type FareType = z.infer<typeof FareType>
export const FB_CONNECTION_STATES = ["DISABLED", "NOT_CONFIGURED", "AUTHORIZATION_PENDING", "CONFIGURED", "CONNECTED", "AUTH_FAILED", "ACCESS_RESTRICTED"] as const
export const FbConnectionState = z.enum(FB_CONNECTION_STATES)
export type FbConnectionState = z.infer<typeof FbConnectionState>
export const SyncMode = z.enum(["DISABLED", "MANUAL", "SCHEDULED"])
export type SyncMode = z.infer<typeof SyncMode>
export const SyncInterval = z.enum(["HOURLY", "DAILY", "WEEKLY"])
export type SyncInterval = z.infer<typeof SyncInterval>
export const UsageSource = z.enum(["MANUAL", "REPORTED", "ESTIMATED"])
export type UsageSource = z.infer<typeof UsageSource>
export const FareStatus = z.enum(["LIVE", "STALE", "EXPIRED", "RETIRED"])
export type FareStatus = z.infer<typeof FareStatus>
export const Freshness = z.enum(["FRESH", "AGING", "STALE", "EXPIRED"])
export type Freshness = z.infer<typeof Freshness>
export const UsageLevel = z.enum(["OK", "WARNING", "CRITICAL", "UNKNOWN"])
export type UsageLevel = z.infer<typeof UsageLevel>
export const SyncRunStatus = z.enum(["BLOCKED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"])
export type SyncRunStatus = z.infer<typeof SyncRunStatus>
export const SyncGateReason = z.enum(["NOT_AUTHORISED", "NO_ADAPTER", "DISABLED", "QUOTA_CRITICAL"])
export type SyncGateReason = z.infer<typeof SyncGateReason>
export const FareVerification = z.enum(["RECORDED", "VERIFIED"])
export type FareVerification = z.infer<typeof FareVerification>

/** The panel's seat figure as written. "9" is a cap whose meaning is UNKNOWN, so it is never read as a count. */
export const SeatsReported = z.object({ raw: z.string(), count: z.number().int().min(0).max(9).nullable(), atCap: z.boolean() })
export type SeatsReported = z.infer<typeof SeatsReported>

/** Customers see the baggage wording, so it may not carry money: a typed price would otherwise reach them (ADR-0004). */
const NO_MONEY = /[£$€¥₺﷼]|\b(GBP|USD|EUR|TRY|IRR|IRT|AMD|AED|RIAL|TOMAN)\b/i
export const CapturedBaggage = SegmentBaggage.extend({
  sourceText: z.string().max(300).refine((v) => !NO_MONEY.test(v), { message: "Baggage wording is shown to customers and must not contain an amount of money" }).optional(),
})
export type CapturedBaggage = z.infer<typeof CapturedBaggage>

export const CapturedConditionState = z.enum(["KNOWN_ALLOWED", "NOT_ALLOWED", "UNKNOWN"])
export type CapturedConditionState = z.infer<typeof CapturedConditionState>
const minor = z.number().int().nonnegative()
export const CapturedCondition = z.object({ state: CapturedConditionState, penaltyMinor: minor.optional(), sourceText: z.string().max(500).optional() })
export type CapturedCondition = z.infer<typeof CapturedCondition>

const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)

export const FlightBuilderSegmentInput = z.object({
  carrier: CarrierCode,
  flightNumber: z.string().regex(/^\d{1,4}[A-Z]?$/),
  operatingCarrier: CarrierCode.optional(),
  from: Iata,
  to: Iata,
  departLocal: LocalDateTime,
  arriveLocal: LocalDateTime,
  departTz: z.string().min(3).optional(),
  arriveTz: z.string().min(3).optional(),
  aircraft: z.string().max(40).optional(),
  durationMin: z.number().int().nonnegative().optional(),
})
export type FlightBuilderSegmentInput = z.infer<typeof FlightBuilderSegmentInput>

export const FlightBuilderFareInput = z
  .object({
    cabin: Cabin,
    bookingClasses: z.array(z.string().regex(/^[A-Z]$/)).min(1),
    /** Raw strings, one per segment, kept exactly as written. */
    seats: z.array(z.string().max(8)).min(1),
    fareBasis: z.array(z.string().max(20)).default([]),
    fareType: FareType,
    fareTypeRaw: z.string().max(40).optional(),
    baseMinor: minor.optional(),
    taxesMinor: minor.optional(),
    totalMinor: minor,
    currency: z.string().regex(/^[A-Z]{3}$/),
    baggage: z.array(CapturedBaggage).min(1),
    change: CapturedCondition,
    refund: CapturedCondition,
    rulesText: z.string().max(8000).optional(),
    ticketingDeadline: IsoDate.optional(),
  })
  .superRefine((f, ctx) => {
    if (f.baseMinor !== undefined && f.taxesMinor !== undefined && f.baseMinor + f.taxesMinor !== f.totalMinor)
      ctx.addIssue({ code: "custom", path: ["totalMinor"], message: "Base plus taxes must equal the total" })
  })
export type FlightBuilderFareInput = z.infer<typeof FlightBuilderFareInput>

export const FlightBuilderCaptureInput = z
  .object({
    observedAt: IsoDateTime,
    sourceRecordId: z.string().max(80).optional(),
    segments: z.array(FlightBuilderSegmentInput).min(1).max(6),
    fares: z.array(FlightBuilderFareInput).min(1).max(12),
    note: z.string().max(1000).optional(),
    requestRef: z.string().max(40).optional(),
  })
  .superRefine((c, ctx) => {
    const n = c.segments.length
    c.fares.forEach((f, i) => {
      for (const key of ["bookingClasses", "seats", "baggage"] as const)
        if (f[key].length !== n) ctx.addIssue({ code: "custom", path: ["fares", i, key], message: `Needs one entry per segment (${n})` })
      if (f.fareBasis.length !== 0 && f.fareBasis.length !== n) ctx.addIssue({ code: "custom", path: ["fares", i, "fareBasis"], message: `Needs one entry per segment (${n}) or none` })
    })
  })
export type FlightBuilderCaptureInput = z.infer<typeof FlightBuilderCaptureInput>

/** Customer conditions: the tri-state only, never a penalty amount (ADR-0004). */
export const PublicCondition = z.object({ state: CapturedConditionState }).strict()
export type PublicCondition = z.infer<typeof PublicCondition>

/** Customer view of one bookable class option. Ordered by cabin then class, never by price. */
export const PublicFare = z
  .object({
    id: Uuid,
    cabin: Cabin,
    bookingClasses: z.array(z.string()),
    seats: z.array(SeatsReported),
    baggage: z.array(CapturedBaggage),
    conditions: z.object({ change: PublicCondition, refund: PublicCondition }).strict(),
    ticketingDeadline: IsoDate.nullable(),
    deadlineWarning: z.boolean(),
    observedAt: IsoDateTime,
    freshness: Freshness,
  })
  .strict()
export type PublicFare = z.infer<typeof PublicFare>

const staffFareShape = {
  id: Uuid,
  position: z.number().int().nonnegative(),
  cabin: Cabin,
  bookingClasses: z.array(z.string()),
  seats: z.array(SeatsReported),
  fareBasis: z.array(z.string()),
  fareType: FareType,
  fareTypeRaw: z.string().nullable(),
  baggage: z.array(CapturedBaggage),
  change: CapturedCondition,
  refund: CapturedCondition,
  rulesText: z.string().nullable(),
  ticketingDeadline: IsoDate.nullable(),
  status: FareStatus,
  freshness: Freshness,
  deadlineWarning: z.boolean(),
  observedAt: IsoDateTime,
}
/** Staff fare with supplier price: needs `pricing.read.internal` (ADR-0004). */
export const StaffFare = z.object({
  ...staffFareShape,
  baseMinor: z.number().int().nullable(),
  taxesMinor: z.number().int().nullable(),
  totalMinor: z.number().int(),
  currency: z.string(),
})
export type StaffFare = z.infer<typeof StaffFare>
/** Same without any price field (caller lacks `pricing.read.internal`). Penalty amounts are prices too, so they are dropped. */
export const StaffFareNoPrice = z.object({
  ...staffFareShape,
  change: CapturedCondition.omit({ penaltyMinor: true }),
  refund: CapturedCondition.omit({ penaltyMinor: true }),
})
export type StaffFareNoPrice = z.infer<typeof StaffFareNoPrice>

export const StaffFlightBuilderOption = z.object({
  resultId: Uuid,
  segments: z.array(FlightBuilderSegmentInput),
  fares: z.array(z.union([StaffFare, StaffFareNoPrice])),
  capture: z.enum(["FEED", "STAFF"]),
  capturedBy: z.string().nullable(),
  sourceRecordId: z.string().nullable(),
  verification: FareVerification.nullable(),
  observedAt: IsoDateTime,
  isCurrent: z.boolean(),
  requestRef: z.string().nullable(),
  note: z.string().nullable(),
})
export type StaffFlightBuilderOption = z.infer<typeof StaffFlightBuilderOption>

export const FlightBuilderSettings = z.object({
  enabled: z.boolean().default(false),
  panelUrl: z.string().url().max(300).refine((u) => {
    try {
      const p = new URL(u)
      return p.protocol === "https:" && !p.username && !p.password
    } catch { return false }
  }, { message: "Must be an https URL without credentials" }).nullable().default(null),
  syncMode: SyncMode.default("DISABLED"),
  syncInterval: SyncInterval.default("DAILY"),
  freshHours: z.number().int().min(1).max(168).default(6),
  staleHours: z.number().int().min(1).max(720).default(24),
  deadlineWarnHours: z.number().int().min(1).max(720).default(48),
})
export type FlightBuilderSettings = z.infer<typeof FlightBuilderSettings>
export const FlightBuilderSettingsPatch = FlightBuilderSettings.partial()
export type FlightBuilderSettingsPatch = z.infer<typeof FlightBuilderSettingsPatch>

export const ProviderAuthorisationInput = z.object({
  documentRef: z.string().min(3).max(200),
  grantedByName: z.string().min(2).max(120),
  grantedAt: IsoDateTime,
  scope: z.string().min(3).max(500),
  maxSearchesPerDay: z.number().int().positive().optional(),
  expiresAt: IsoDateTime.optional(),
})
export type ProviderAuthorisationInput = z.infer<typeof ProviderAuthorisationInput>
export const ProviderAuthorisationView = ProviderAuthorisationInput.extend({
  id: Uuid,
  providerId: z.string(),
  recordedBy: z.string(),
  recordedAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
  revokedBy: z.string().nullable(),
  revokedReason: z.string().nullable(),
  maxSearchesPerDay: z.number().int().positive().nullable(),
  expiresAt: IsoDateTime.nullable(),
})
export type ProviderAuthorisationView = z.infer<typeof ProviderAuthorisationView>
export const ProviderAuthorisationRevokeInput = z.object({ reason: z.string().min(3).max(500) })

export const UsageObservationInput = z
  .object({
    observedAt: IsoDateTime,
    bookings: z.number().int().nonnegative(),
    scanHits: z.number().int().nonnegative(),
    warningThreshold: z.number().int().positive().default(45),
    criticalThreshold: z.number().int().positive().default(50),
    remainingReported: z.number().int().nonnegative().optional(),
    source: UsageSource.default("MANUAL"),
    note: z.string().max(500).optional(),
  })
  .refine((o) => o.warningThreshold <= o.criticalThreshold, { path: ["warningThreshold"], message: "Warning must not exceed critical" })
export type UsageObservationInput = z.infer<typeof UsageObservationInput>
export const UsageObservationView = z.object({
  id: Uuid,
  observedAt: IsoDateTime,
  bookings: z.number().int(),
  scanHits: z.number().int(),
  warningThreshold: z.number().int(),
  criticalThreshold: z.number().int(),
  remainingReported: z.number().int().nullable(),
  source: UsageSource,
  observerUserId: z.string(),
  note: z.string().nullable(),
  createdAt: IsoDateTime,
})
export type UsageObservationView = z.infer<typeof UsageObservationView>

export const UsageSummary = z.object({
  /** Scan hits per booking at the latest observation (0 when bookings are unknown; level is then UNKNOWN). */
  ratio: z.number(),
  /** ratio ÷ the indicative per-booking limit; null when there are no bookings. */
  limitShare: z.number().nullable(),
  level: UsageLevel,
  headroomEstimate: z.number().int().nonnegative(),
  estimateLabel: z.literal("ESTIMATED"),
  stale: z.boolean(),
  observedAt: IsoDateTime,
})
export type UsageSummary = z.infer<typeof UsageSummary>
export const FlightBuilderUsage = z.object({ observations: z.array(UsageObservationView), latest: UsageSummary.nullable() })
export type FlightBuilderUsage = z.infer<typeof FlightBuilderUsage>

export const SyncRunView = z.object({
  id: Uuid,
  trigger: z.enum(["MANUAL", "SCHEDULED"]),
  scope: z.record(z.string(), z.unknown()),
  status: SyncRunStatus,
  blockedReason: z.string().nullable(),
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.number().int(),
  actorUserId: z.string().nullable(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
})
export type SyncRunView = z.infer<typeof SyncRunView>

export const RefreshRequest = z.object({
  scope: z.object({
    from: Iata,
    to: Iata,
    dates: z.array(IsoDate).min(1).max(31),
    cabin: Cabin.optional(),
  }),
  confirm: z.literal(true),
})
export type RefreshRequest = z.infer<typeof RefreshRequest>

export const FlightBuilderStatus = z.object({
  state: FbConnectionState,
  gate: z.object({ allowed: z.boolean(), reason: SyncGateReason.nullable() }),
  credentials: z.object({ set: z.boolean(), last4: z.string().max(4).nullable(), rotatedAt: IsoDateTime.nullable(), rotatedBy: z.string().nullable(), invalidAt: IsoDateTime.nullable(), testedAt: IsoDateTime.nullable() }),
  settings: FlightBuilderSettings,
  lastRun: SyncRunView.nullable(),
  latestUsage: UsageSummary.nullable(),
  authorisation: ProviderAuthorisationView.nullable(),
})
export type FlightBuilderStatus = z.infer<typeof FlightBuilderStatus>
