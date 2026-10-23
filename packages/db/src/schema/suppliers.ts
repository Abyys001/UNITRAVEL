import { bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, uuid, varchar } from "drizzle-orm/pg-core"

import type { Itinerary, NormalisedOffer, SearchQuery } from "@unitravel/contracts"

import { createdAt, id, timestamps, tstz, uuidv7 } from "./columns"
import { users } from "./identity"

// Chapter 23.6 — suppliers and search.
export const providers = pgTable("providers", {
  id: varchar({ length: 40 }).primaryKey(),
  name: varchar({ length: 80 }).notNull(),
  environment: text({ enum: ["test", "production"] }).notNull().default("test"),
  enabled: boolean().notNull().default(false),
  priority: integer().notNull().default(1),
  capabilities: jsonb().$type<{ search: boolean; price: boolean; seatMap: boolean; order: boolean }>().notNull(),
  limits: jsonb().$type<{ timeoutMs: number; maxConcurrent: number; rps: number; dailyBudget: number; lookToBookAlert: number }>().notNull(),
  markets: jsonb().$type<{ pointOfSale: string; currency: string; originRegions: string[]; destinationRegions: string[] }>().notNull(),
  shadowMode: boolean().notNull().default(false),
  version: integer().notNull().default(1),
  ...timestamps,
})

/** Never selected by any query that serves an HTTP response (ch. 23.6). Envelope-encrypted. */
export const providerCredentials = pgTable("provider_credentials", {
  providerId: varchar({ length: 40 }).notNull().references(() => providers.id),
  environment: text({ enum: ["test", "production"] }).notNull(),
  ciphertext: text().notNull(),
  keyId: varchar({ length: 40 }).notNull(),
  rotatedAt: tstz().notNull().defaultNow(),
  rotatedBy: uuid(),
}, (t) => [primaryKey({ columns: [t.providerId, t.environment] })])

/** Partitioned by month in the migration; payloads live in object storage for 14 days. */
export const providerCalls = pgTable("provider_calls", {
  id: uuid().notNull().$defaultFn(() => uuidv7()),
  providerId: varchar({ length: 40 }).notNull(),
  operation: varchar({ length: 40 }).notNull(),
  searchId: uuid(),
  requestId: varchar({ length: 128 }),
  status: text({ enum: ["OK", "ERROR"] }).notNull(),
  errorCode: varchar({ length: 40 }),
  durationMs: integer().notNull(),
  sizeBytes: integer(),
  offers: integer(),
  payloadKey: varchar({ length: 300 }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.id, t.createdAt] }), index("provider_calls_provider_idx").on(t.providerId, t.createdAt)])

export const searches = pgTable("searches", {
  id: id(),
  userId: uuid().references(() => users.id),
  actorKind: text({ enum: ["CUSTOMER", "STAFF", "ANONYMOUS"] }).notNull(),
  anonKey: varchar({ length: 128 }),
  query: jsonb().$type<SearchQuery>().notNull(),
  status: text({ enum: ["RUNNING", "COMPLETE", "PARTIAL", "FAILED"] }).notNull().default("RUNNING"),
  ruleVersion: integer().notNull(),
  hubsVersion: integer().notNull(),
  engineVersion: varchar({ length: 40 }).notNull(),
  stats: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  /** Normalised supplier responses per call, kept for the rule simulator (cached data only, ch. 16.2 §4). */
  collected: jsonb().$type<{ call: unknown; offers: NormalisedOffer[]; error?: string }[]>().notNull().default([]),
  locale: text({ enum: ["en", "fa"] }).notNull().default("en"),
  expiresAt: tstz().notNull(),
  completedAt: tstz(),
  ...timestamps,
}, (t) => [index("searches_user_idx").on(t.userId, t.createdAt)])

export const searchResults = pgTable("search_results", {
  id: id(),
  searchId: uuid().notNull().references(() => searches.id, { onDelete: "cascade" }),
  itineraryKey: varchar({ length: 40 }).notNull(),
  rank: integer().notNull(),
  tabs: text().array().notNull(),
  construction: text({ enum: ["THROUGH", "SELF_TRANSFER", "GATEWAY"] }).notNull(),
  itinerary: jsonb().$type<Itinerary>().notNull(),
  priceTotalMinor: bigint({ mode: "number" }).notNull(),
  currency: varchar({ length: 3 }).notNull(),
  durationMin: integer().notNull(),
  riskFlags: text().array().notNull(),
  score: numeric({ precision: 8, scale: 4 }).notNull(),
  scoreComponents: jsonb().notNull(),
  createdAt: createdAt(),
}, (t) => [index("search_results_search_idx").on(t.searchId, t.rank), index("search_results_key_idx").on(t.itineraryKey)])

/** Immutable (INSERT/SELECT only for app_rw): the itinerary the customer chose, frozen at submission. */
export const offerSnapshots = pgTable("offer_snapshots", {
  id: id(),
  searchResultId: uuid(),
  searchId: uuid(),
  itinerary: jsonb().$type<Itinerary>().notNull(),
  components: jsonb().$type<{ provider: string; offerId: string; rung: string; fetchedAt: string }[]>().notNull(),
  priceAtSubmitMinor: bigint({ mode: "number" }).notNull(),
  priceRevalidatedMinor: bigint({ mode: "number" }),
  currency: varchar({ length: 3 }).notNull(),
  revalidatedAt: tstz(),
  ruleVersion: integer().notNull(),
  engineVersion: varchar({ length: 40 }).notNull(),
  contentHash: varchar({ length: 64 }).notNull(),
  createdAt: createdAt(),
})
