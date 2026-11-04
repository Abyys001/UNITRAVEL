import { z } from "zod"

import { Iata, IsoDate, IsoDateTime, Uuid } from "./common"
import { RiskFlag } from "./enums"

// ADR-0034: the scheduled flight catalog. Customers read only stored, customer-safe snapshots; nothing on a public path
// can start a provider call. Prices exist only in admin DTOs (ADR-0029: indicative, staff-only).

export const SLOT_STATUSES = ["NEVER", "FRESH", "AGING", "STALE", "EMPTY", "ERROR"] as const
export const SlotStatus = z.enum(SLOT_STATUSES)
export type SlotStatus = z.infer<typeof SlotStatus>

export const USAGE_PURPOSES = ["refresh", "admin_revalidate", "admin_search", "smoke"] as const
export const UsagePurpose = z.enum(USAGE_PURPOSES)
export type UsagePurpose = z.infer<typeof UsagePurpose>

/** A freshness tier: departures up to `maxDaysOut` days ahead target one refresh every `intervalHours`. */
export const CatalogTier = z.object({
  name: z.string().min(1).max(8),
  maxDaysOut: z.number().int().min(0).max(365),
  intervalHours: z.number().min(1).max(24 * 60),
  weight: z.number().min(0).max(10),
})
export type CatalogTier = z.infer<typeof CatalogTier>

/** Write-time self-transfer combinations, e.g. IKA→IST + IST→LHR stored as IKA→LHR (brief: "Connections"). */
export const CatalogConnectionPair = z.object({ from: Iata, via: Iata, to: Iata, enabled: z.boolean().default(true) })
export const CatalogConnectionRules = z.object({
  hubs: z.array(z.object({ iata: Iata, enabled: z.boolean() })).max(10),
  minLayoverMin: z.number().int().min(30).max(24 * 60),
  maxLayoverMin: z.number().int().min(30).max(48 * 60),
  sameAirport: z.boolean(),
  allowOvernight: z.boolean(),
  dayOffsets: z.array(z.number().int().min(0).max(2)).min(1).max(3),
  pairs: z.array(CatalogConnectionPair).max(20),
}).refine((c) => c.maxLayoverMin >= c.minLayoverMin, { message: "Maximum layover must be at least the minimum", path: ["maxLayoverMin"] })
export type CatalogConnectionRules = z.infer<typeof CatalogConnectionRules>

export const CatalogSettings = z.object({
  paused: z.boolean(),
  monthlyBudgetUsd: z.number().min(0).max(10_000),
  safetyMarginUsd: z.number().min(0).max(1_000),
  adminReserveUsd: z.number().min(0).max(1_000),
  releaseReserveHours: z.number().int().min(0).max(240),
  refreshTicksPerDay: z.number().int().min(1).max(48),
  maxSlotsPerRun: z.number().int().min(1).max(200),
  defaultMaxResults: z.number().int().min(1).max(100),
  defaultHorizonDays: z.number().int().min(1).max(330),
  tiers: z.array(CatalogTier).min(1).max(6),
  minRefreshIntervalHours: z.number().min(0).max(24 * 30),
  hideAfterDays: z.number().int().min(1).max(60),
  emptyBackoffAfter: z.number().int().min(1).max(10),
  emptyBackoffMax: z.number().int().min(1).max(64),
  errorSkipAfter: z.number().int().min(1).max(10),
  errorSkipHours: z.number().min(1).max(24 * 7),
  demandHalfLifeDays: z.number().min(0.5).max(90),
  market: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Raised by the daily reconcile when Apify reports more spend than our ledger (spec §4.6). */
  costCorrection: z.number().min(1).max(5),
  revalidateMaxResults: z.number().int().min(1).max(100),
  connections: CatalogConnectionRules,
})
export type CatalogSettings = z.infer<typeof CatalogSettings>
export const CatalogSettingsPatch = CatalogSettings.partial()
export type CatalogSettingsPatch = z.infer<typeof CatalogSettingsPatch>

/** Owner's build brief, 2026-11-04 (overrides spec §8 where they differ). */
export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  paused: false,
  monthlyBudgetUsd: 5,
  safetyMarginUsd: 0.2,
  adminReserveUsd: 0.75,
  releaseReserveHours: 12,
  refreshTicksPerDay: 6,
  maxSlotsPerRun: 40,
  defaultMaxResults: 3,
  defaultHorizonDays: 14,
  tiers: [
    { name: "T0", maxDaysOut: 2, intervalHours: 8, weight: 1.5 },
    { name: "T1", maxDaysOut: 7, intervalHours: 24, weight: 1.2 },
    { name: "T2", maxDaysOut: 14, intervalHours: 72, weight: 1.0 },
    { name: "T3", maxDaysOut: 365, intervalHours: 14 * 24, weight: 0.6 },
  ],
  minRefreshIntervalHours: 4,
  hideAfterDays: 7,
  emptyBackoffAfter: 2,
  emptyBackoffMax: 8,
  errorSkipAfter: 3,
  errorSkipHours: 24,
  demandHalfLifeDays: 7,
  market: "GB",
  currency: "USD",
  costCorrection: 1,
  revalidateMaxResults: 30,
  connections: {
    hubs: [{ iata: "IST", enabled: true }, { iata: "SAW", enabled: false }],
    minLayoverMin: 240,
    maxLayoverMin: 360,
    sameAirport: true,
    allowOvernight: false,
    dayOffsets: [0, 1],
    pairs: [{ from: "IKA", via: "IST", to: "LHR", enabled: true }],
  },
}

export const DEFAULT_WATCHLIST = [
  { origin: "IKA", destination: "IST", horizonDays: 14, maxResults: 3 },
  { origin: "IST", destination: "LHR", horizonDays: 14, maxResults: 5 },
] as const

export const WatchRouteInput = z.object({
  origin: Iata,
  destination: Iata,
  enabled: z.boolean().default(true),
  horizonDays: z.number().int().min(1).max(330).default(14),
  /** Null uses the default. `maxResults` is run-level at Apify, so routes with different values go in different runs. */
  maxResults: z.number().int().min(1).max(100).nullable().default(null),
  priorityWeight: z.number().min(0).max(10).default(1),
  note: z.string().trim().max(300).default(""),
}).refine((r) => r.origin !== r.destination, { message: "Origin and destination must differ", path: ["destination"] })
export const WatchRoutePatch = z.object({
  enabled: z.boolean(), horizonDays: z.number().int().min(1).max(330), maxResults: z.number().int().min(1).max(100).nullable(),
  priorityWeight: z.number().min(0).max(10), note: z.string().trim().max(300),
}).partial()
export const WatchRoute = z.object({
  id: Uuid, origin: Iata, destination: Iata, enabled: z.boolean(), horizonDays: z.number().int(), maxResults: z.number().int().nullable(),
  priorityWeight: z.number(), note: z.string(), kind: z.enum(["DIRECT", "COMBINED"]),
})
export type WatchRoute = z.infer<typeof WatchRoute>

// ---------- Public (customer) shapes: an allowlist. No amount, currency, fare, baggage or provider field exists here. ----------

const PublicPoint = z.object({ iata: Iata, local: z.string(), terminal: z.string().optional() })
export const PublicLeg = z.object({
  carrier: z.string(),
  flightNumber: z.string(),
  operatingCarrier: z.string().optional(),
  from: PublicPoint,
  to: PublicPoint,
  durationMin: z.number().int().nonnegative(),
  aircraft: z.string().optional(),
})
export type PublicLeg = z.infer<typeof PublicLeg>

export const PublicItinerary = z.object({
  id: Uuid,
  origin: Iata,
  destination: Iata,
  departureDate: IsoDate,
  departLocal: z.string(),
  arriveLocal: z.string(),
  durationMin: z.number().int().nonnegative(),
  stops: z.number().int().nonnegative(),
  carriers: z.array(z.string()),
  flightNumbers: z.array(z.string()),
  selfTransfer: z.boolean(),
  layovers: z.array(z.object({ at: Iata, minutes: z.number().int(), flags: z.array(RiskFlag) })),
  riskFlags: z.array(RiskFlag),
  /** ADR-0031 I3/I5: an Iran lane on REVIEW. The customer sees the review notice; a request goes to COMPLIANCE_HOLD. */
  complianceReview: z.boolean(),
  fetchedAt: IsoDateTime,
})
export type PublicItinerary = z.infer<typeof PublicItinerary>

export const PublicItineraryDetail = PublicItinerary.extend({
  legs: z.array(PublicLeg),
  isCurrent: z.boolean(),
  lastSeenAt: IsoDateTime,
})
export type PublicItineraryDetail = z.infer<typeof PublicItineraryDetail>

/** Spec §6.4 states. `UNAVAILABLE` is the old NO_SOURCES case: the catalog itself (Redis and Postgres) cannot be read. */
export const CATALOG_STATES = ["RESULTS", "STALE", "EMPTY", "NOT_TRACKED", "UNAVAILABLE"] as const
export const CatalogState = z.enum(CATALOG_STATES)
export type CatalogState = z.infer<typeof CatalogState>

export const CatalogSearchQuery = z.object({
  from: Iata,
  to: Iata,
  date: IsoDate,
  flex: z.coerce.number().int().min(0).max(3).default(0),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]).default("economy"),
  adults: z.coerce.number().int().min(1).max(9).default(1),
})
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuery>

export const CatalogDateGroup = z.object({
  date: IsoDate,
  state: CatalogState,
  fetchedAt: IsoDateTime.nullable(),
  results: z.array(PublicItinerary),
})
export type CatalogDateGroup = z.infer<typeof CatalogDateGroup>

export const CatalogSearchResponse = z.object({
  tracked: z.boolean(),
  state: CatalogState,
  origin: Iata,
  destination: Iata,
  date: IsoDate,
  fetchedAt: IsoDateTime.nullable(),
  results: z.array(PublicItinerary),
  /** The requested date plus ±flex neighbours. */
  dates: z.array(CatalogDateGroup),
  /** Dates within the horizon that have flights, for the empty state. */
  nearbyDates: z.array(IsoDate),
  /** True when the party or cabin differs from the catalog's (1 adult, economy): the team confirms for the party. */
  partyNote: z.boolean(),
})
export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponse>

export const PublicCatalogRoute = z.object({ origin: Iata, destination: Iata, selfTransfer: z.boolean(), firstDate: IsoDate, lastDate: IsoDate })
export const CatalogRoutesResponse = z.object({ routes: z.array(PublicCatalogRoute) })
export type CatalogRoutesResponse = z.infer<typeof CatalogRoutesResponse>

// ---------- Admin shapes (prices allowed; permission catalog.read / catalog.manage) ----------

export const CatalogUsage = z.object({
  cycleStart: IsoDateTime.nullable(),
  cycleEnd: IsoDateTime.nullable(),
  spentUsd: z.number(),
  spentSource: z.enum(["apify", "ledger"]),
  ledgerUsd: z.number(),
  projectedUsd: z.number(),
  budgetUsd: z.number(),
  availableUsd: z.number(),
  reserveLeftUsd: z.number(),
  reserveReleased: z.boolean(),
  rowsPerDay: z.number(),
  runsPerDay: z.number(),
  costCorrection: z.number(),
  paused: z.boolean(),
  pauseReason: z.string().nullable(),
  accountCapUsd: z.number().nullable(),
  lastTick: z.object({ at: IsoDateTime, outcome: z.string(), tickBudgetUsd: z.number(), slots: z.number().int() }).nullable(),
  nextTickAt: IsoDateTime.nullable(),
  schemaAlert: z.string().nullable(),
  overBudget: z.boolean(),
})
export type CatalogUsage = z.infer<typeof CatalogUsage>

export const CoverageSlot = z.object({
  id: Uuid, date: IsoDate, status: SlotStatus, tier: z.string(), lastFetchedAt: IsoDateTime.nullable(), nextDueAt: IsoDateTime,
  resultCount: z.number().int(), demand: z.number(), consecutiveEmpty: z.number().int(), consecutiveErrors: z.number().int(), lastError: z.string().nullable(),
})
export const CatalogCoverage = z.object({
  routes: z.array(z.object({ route: WatchRoute, slots: z.array(CoverageSlot) })),
  untracked: z.array(z.object({ origin: Iata, destination: Iata, demand: z.number() })),
  /** Setup problems staff must fix, e.g. `NO_IR_LANE_POLICY`: without the FLIGHT:IR:* lane row Iran results would show without the review notice (ADR-0034). */
  warnings: z.array(z.string()).optional(),
})
export type CatalogCoverage = z.infer<typeof CatalogCoverage>

export const BudgetEstimate = z.object({ rowsPerDay: z.number(), runsPerDay: z.number(), monthlyUsd: z.number(), spendableUsd: z.number(), overBudget: z.boolean() })
export type BudgetEstimate = z.infer<typeof BudgetEstimate>

export const SlotRefreshQuote = z.object({ slotId: Uuid, estimatedUsd: z.number(), reserveLeftUsd: z.number(), confirmToken: z.string() })
export type SlotRefreshQuote = z.infer<typeof SlotRefreshQuote>
export const SlotRefreshConfirm = z.object({ confirmToken: z.string().min(10) })

export const AdminCatalogResult = PublicItineraryDetail.extend({
  price: z.object({ amountMinor: z.number().int(), currency: z.string(), previousAmountMinor: z.number().int().nullable(), changedAt: IsoDateTime.nullable() }).nullable(),
})
export type AdminCatalogResult = z.infer<typeof AdminCatalogResult>

// ---------- Admin responses added with the API (additive) ----------

export const CatalogSettingsResponse = z.object({ settings: CatalogSettings, estimate: BudgetEstimate })
export type CatalogSettingsResponse = z.infer<typeof CatalogSettingsResponse>
export const WatchRoutesResponse = z.object({ routes: z.array(WatchRoute) })
export const CatalogResultsResponse = z.object({ results: z.array(AdminCatalogResult) })
export const CatalogPauseBody = z.object({ reason: z.string().trim().max(200).optional() })
/** `POST /v1/admin/integrations/apify/test`: Apify's free `/users/me/limits`; never the token. */
export const ApifyIntegrationTest = z.object({ ok: z.boolean(), cycleEnd: IsoDateTime.nullable(), monthlyUsageUsd: z.number().nullable(), maxMonthlyUsageUsd: z.number().nullable() })
export type ApifyIntegrationTest = z.infer<typeof ApifyIntegrationTest>
export const ApifyApplyCapResult = z.object({ ok: z.boolean(), maxMonthlyUsageUsd: z.number() })
