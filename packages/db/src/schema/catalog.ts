import { bigint, boolean, char, date, index, integer, jsonb, numeric, pgTable, primaryKey, real, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import type { CapturedBaggage, CapturedCondition, FareStatus, FareType, FareVerification, NormalisedOffer, PublicItinerary, PublicItineraryDetail, SyncRunStatus, UsageSource } from "@unitravel/contracts"

import { createdAt, id, timestamps, tstz } from "./columns"
import { users } from "./identity"
import { providerRuns } from "./suppliers"

// ADR-0034: the scheduled flight catalog. Customers read `catalog_public_snapshots` only; results and pricing are staff-side.

export const flightWatchlistRoutes = pgTable("flight_watchlist_routes", {
  id: id(),
  origin: varchar({ length: 3 }).notNull(),
  destination: varchar({ length: 3 }).notNull(),
  /** COMBINED routes are never sent to Apify; they are built at write time from two DIRECT feeder routes via `viaHub`. */
  kind: text({ enum: ["DIRECT", "COMBINED"] }).notNull().default("DIRECT"),
  viaHub: varchar({ length: 3 }),
  enabled: boolean().notNull().default(true),
  horizonDays: integer().notNull().default(14),
  maxResults: integer(),
  market: varchar({ length: 2 }),
  currency: varchar({ length: 3 }),
  priorityWeight: real().notNull().default(1),
  note: text().notNull().default(""),
  ...timestamps,
}, (t) => [uniqueIndex("flight_watchlist_routes_pair_uq").on(t.origin, t.destination)])

export const catalogSlots = pgTable("catalog_slots", {
  id: id(),
  routeId: uuid().notNull().references(() => flightWatchlistRoutes.id, { onDelete: "cascade" }),
  departureDate: date({ mode: "string" }).notNull(),
  lastFetchedAt: tstz(),
  nextDueAt: tstz().notNull().defaultNow(),
  status: text({ enum: ["NEVER", "FRESH", "AGING", "STALE", "EMPTY", "ERROR"] }).notNull().default("NEVER"),
  lastResultCount: integer().notNull().default(0),
  /** Most recent first, at most three: the pacer's expected-rows average. */
  recentCounts: integer().array().notNull().default(sql`'{}'::integer[]`),
  consecutiveEmpty: integer().notNull().default(0),
  consecutiveErrors: integer().notNull().default(0),
  lastErrorAt: tstz(),
  lastError: text(),
  notices: jsonb().$type<string[]>().notNull().default([]),
  demandScore: real().notNull().default(0),
  version: integer().notNull().default(0),
  ...timestamps,
}, (t) => [uniqueIndex("catalog_slots_route_date_uq").on(t.routeId, t.departureDate), index("catalog_slots_due_idx").on(t.nextDueAt)])

export const flightResults = pgTable("flight_results", {
  id: id(),
  /** Null once the departure date has passed and the slot is rolled away; the row stays as history. */
  slotId: uuid().references(() => catalogSlots.id, { onDelete: "set null" }),
  origin: varchar({ length: 3 }).notNull(),
  destination: varchar({ length: 3 }).notNull(),
  departureDate: date({ mode: "string" }).notNull(),
  /** Flight numbers joined + first departure + cabin (Apify reference §6.1); for a self-transfer, both legs' keys. */
  identityKey: varchar({ length: 300 }).notNull(),
  selfTransfer: boolean().notNull().default(false),
  complianceReview: boolean().notNull().default(false),
  /** The normalised provider offer (DIRECT only). Staff side; never served on a public path. */
  offer: jsonb().$type<NormalisedOffer>(),
  /** The customer-safe view, built by the allowlist serializer at write time. */
  detail: jsonb().$type<Omit<PublicItineraryDetail, "id" | "isCurrent" | "lastSeenAt">>().notNull(),
  firstSeenAt: tstz().notNull().defaultNow(),
  lastSeenAt: tstz().notNull().defaultNow(),
  isCurrent: boolean().notNull().default(true),
  /** ADR-0037 D2: FEED rows are replaced by each refresh; STAFF rows are recorded by hand and survive it. */
  capture: text({ enum: ["FEED", "STAFF"] }).notNull().default("FEED"),
  capturedBy: uuid().references(() => users.id),
  sourceRecordId: text(),
  verification: text({ enum: ["RECORDED", "VERIFIED"] }).$type<FareVerification>(),
  /** Staff-only context of a capture; never part of a customer view. */
  requestRef: varchar({ length: 12 }),
  captureNote: text(),
  ...timestamps,
}, (t) => [
  uniqueIndex("flight_results_slot_identity_uq").on(t.slotId, t.identityKey),
  index("flight_results_slot_current_idx").on(t.slotId).where(sql`${t.isCurrent}`),
  index("flight_results_route_date_current_idx").on(t.origin, t.destination, t.departureDate).where(sql`${t.isCurrent}`),
])

/** The two feeder results a self-transfer result was built from. */
export const flightResultLegs = pgTable("flight_result_legs", {
  resultId: uuid().notNull().references(() => flightResults.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  legResultId: uuid().notNull().references(() => flightResults.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.resultId, t.position] }), index("flight_result_legs_leg_idx").on(t.legResultId)])

/** Indicative fare, staff only (ADR-0029). Never read on a customer path. */
export const flightResultPricing = pgTable("flight_result_pricing", {
  resultId: uuid().primaryKey().references(() => flightResults.id, { onDelete: "cascade" }),
  amountMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  previousAmountMinor: bigint({ mode: "number" }),
  priceChangedAt: tstz(),
  ...timestamps,
})

export const catalogPublicSnapshots = pgTable("catalog_public_snapshots", {
  slotId: uuid().primaryKey().references(() => catalogSlots.id, { onDelete: "cascade" }),
  version: integer().notNull(),
  payload: jsonb().$type<PublicItinerary[]>().notNull(),
  fetchedAt: tstz(),
  builtAt: tstz().notNull().defaultNow(),
})

/**
 * One row per metered run (refresh, admin revalidation, staff search, smoke). Kept for at least a full billing cycle;
 * not subject to the 14-day payload retention of `provider_calls`.
 */
export const providerUsageLedger = pgTable("provider_usage_ledger", {
  id: id(),
  provider: varchar({ length: 40 }).notNull(),
  purpose: text({ enum: ["refresh", "admin_revalidate", "admin_search", "smoke"] }).notNull(),
  providerRunId: uuid().references(() => providerRuns.id, { onDelete: "set null" }),
  apifyRunId: varchar({ length: 64 }),
  slotIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  maxResults: integer().notNull(),
  rowsBilled: integer().notNull().default(0),
  estCostUsd: numeric({ precision: 10, scale: 4 }).notNull().default("0"),
  maxChargeUsd: numeric({ precision: 10, scale: 4 }).notNull().default("0"),
  actualCostUsd: numeric({ precision: 10, scale: 4 }),
  /** FlightAPI (ADR-0035) is billed in credits, not dollars; Apify rows leave this 0. */
  credits: integer().notNull().default(0),
  /** Staff revalidation context and outcome for runs that have no `provider_runs` row (FlightAPI). */
  meta: jsonb().$type<Record<string, unknown>>(),
  status: text({ enum: ["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "TIMED-OUT", "ABORTED"] }).notNull().default("RUNNING"),
  startedAt: tstz().notNull().defaultNow(),
  finishedAt: tstz(),
  error: text(),
  createdAt: createdAt(),
}, (t) => [index("provider_usage_ledger_started_idx").on(t.provider, t.startedAt)])

// ADR-0036: the Aviation Edge schedule layer. Separate from offers (rule 3): no price, no availability. Merged with the priced
// snapshot on read; a priced itinerary wins over a schedule row for the same flights.

/** Schedule-layer state and customer snapshot per catalog slot. */
export const catalogScheduleSlots = pgTable("catalog_schedule_slots", {
  slotId: uuid().primaryKey().references(() => catalogSlots.id, { onDelete: "cascade" }),
  provider: varchar({ length: 40 }).notNull(),
  status: text({ enum: ["NEVER", "FRESH", "EMPTY", "ERROR"] }).notNull().default("NEVER"),
  lastFetchedAt: tstz(),
  nextDueAt: tstz().notNull().defaultNow(),
  lastResultCount: integer().notNull().default(0),
  consecutiveErrors: integer().notNull().default(0),
  lastError: text(),
  notices: jsonb().$type<string[]>().notNull().default([]),
  version: integer().notNull().default(0),
  /** Allowlisted customer view, every item `basis: "SCHEDULE"`. */
  payload: jsonb().$type<PublicItinerary[]>().notNull().default([]),
  ...timestamps,
}, (t) => [index("catalog_schedule_slots_due_idx").on(t.nextDueAt)])

/** One scheduled flight (or schedule-built self-transfer) per slot and identity `flightNumbers|departLocal`. */
export const flightSchedules = pgTable("flight_schedules", {
  id: id(),
  slotId: uuid().references(() => catalogSlots.id, { onDelete: "set null" }),
  provider: varchar({ length: 40 }).notNull(),
  origin: varchar({ length: 3 }).notNull(),
  destination: varchar({ length: 3 }).notNull(),
  departureDate: date({ mode: "string" }).notNull(),
  identityKey: varchar({ length: 300 }).notNull(),
  selfTransfer: boolean().notNull().default(false),
  complianceReview: boolean().notNull().default(false),
  detail: jsonb().$type<Omit<PublicItineraryDetail, "id" | "isCurrent" | "lastSeenAt">>().notNull(),
  /** Provider fields we keep for staff (e.g. predicted gate, ICAO codes). Never served on a public path. */
  providerData: jsonb().$type<Record<string, unknown>>(),
  firstSeenAt: tstz().notNull().defaultNow(),
  lastSeenAt: tstz().notNull().defaultNow(),
  isCurrent: boolean().notNull().default(true),
  ...timestamps,
}, (t) => [
  uniqueIndex("flight_schedules_slot_identity_uq").on(t.slotId, t.identityKey),
  index("flight_schedules_slot_current_idx").on(t.slotId).where(sql`${t.isCurrent}`),
])

/** ADR-0037 D3: one bookable class option of a staff-captured result. Price, fare type, basis and rules are staff-only (ADR-0004). */
export const flightResultFares = pgTable("flight_result_fares", {
  id: id(),
  resultId: uuid().notNull().references(() => flightResults.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  cabin: text().notNull(),
  bookingClasses: text().array().notNull(),
  /** One per segment, exactly as written ("9" means UNKNOWN, never a count). */
  seatsRaw: text().array().notNull(),
  fareBasis: text().array().notNull().default(sql`'{}'::text[]`),
  fareType: varchar({ length: 8 }).$type<FareType>().notNull(),
  fareTypeRaw: text(),
  baseMinor: bigint({ mode: "number" }),
  taxesMinor: bigint({ mode: "number" }),
  totalMinor: bigint({ mode: "number" }).notNull(),
  currency: char({ length: 3 }).notNull(),
  baggage: jsonb().$type<CapturedBaggage[]>().notNull(),
  /** Change and refund tri-state plus the staff-only rules text and who confirmed it. */
  conditions: jsonb().$type<{ change: CapturedCondition; refund: CapturedCondition; rulesText?: string; confirmedBy?: string; confirmedAt?: string }>().notNull(),
  ticketingDeadline: date({ mode: "string" }),
  status: text({ enum: ["LIVE", "STALE", "EXPIRED", "RETIRED"] }).$type<FareStatus>().notNull().default("LIVE"),
  observedAt: tstz().notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("flight_result_fares_result_position_uq").on(t.resultId, t.position),
  index("flight_result_fares_deadline_live_idx").on(t.ticketingDeadline).where(sql`${t.status} = 'LIVE'`),
  index("flight_result_fares_live_idx").on(t.resultId).where(sql`${t.status} = 'LIVE'`),
])

/** ADR-0037 D8: append-only log of Scan Hits readings entered by staff. Nothing is seeded or decremented automatically. */
export const flightBuilderUsageObservations = pgTable("flight_builder_usage_observations", {
  id: id(),
  observedAt: tstz().notNull(),
  bookings: integer().notNull(),
  scanHits: integer().notNull(),
  warningThreshold: integer().notNull().default(45),
  criticalThreshold: integer().notNull().default(50),
  remainingReported: integer(),
  source: text({ enum: ["MANUAL", "REPORTED", "ESTIMATED"] }).$type<UsageSource>().notNull(),
  observerUserId: uuid().notNull().references(() => users.id),
  note: text(),
  createdAt: createdAt(),
}, (t) => [index("fb_usage_observed_idx").on(t.observedAt)])

/** ADR-0037 D9: every refresh attempt. While no adapter and no authorisation exist, each row is BLOCKED and no call was made. */
export const flightBuilderSyncRuns = pgTable("flight_builder_sync_runs", {
  id: id(),
  trigger: text({ enum: ["MANUAL", "SCHEDULED"] }).notNull(),
  scope: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: text({ enum: ["BLOCKED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"] }).$type<SyncRunStatus>().notNull(),
  blockedReason: text(),
  imported: integer().notNull().default(0),
  updated: integer().notNull().default(0),
  skipped: integer().notNull().default(0),
  errors: integer().notNull().default(0),
  errorDetail: jsonb(),
  actorUserId: uuid().references(() => users.id),
  startedAt: tstz().notNull().defaultNow(),
  finishedAt: tstz(),
}, (t) => [index("fb_sync_runs_started_idx").on(t.startedAt)])
