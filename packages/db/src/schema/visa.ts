import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import type { Conflict, Evidence, VisaFacts } from "@unitravel/contracts"

import { id, rowVersion, timestamps, tstz } from "./columns"
import { users } from "./identity"

// ADR-0033: visa eligibility checker. Document types and trusted sources are staff data; rules are the requirements
// database with their evidence; research runs are the history. Staff changes are recorded in audit_log.

export const travelDocumentTypes = pgTable("travel_document_types", {
  code: varchar({ length: 40 }).primaryKey(),
  name: jsonb().$type<{ en: string; fa: string }>().notNull(),
  description: jsonb().$type<{ en: string; fa: string }>().notNull(),
  category: text({ enum: ["NATIONAL_PASSPORT", "BRITISH_NATIONALITY_PASSPORT", "REFUGEE", "STATELESS", "OTHER_NON_NATIONAL"] }).notNull(),
  issuingCountry: varchar({ length: 2 }),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(100),
  version: rowVersion(),
  ...timestamps,
})

export const visaTrustedSources = pgTable("visa_trusted_sources", {
  id: id(),
  country: varchar({ length: 2 }),
  url: varchar({ length: 500 }).notNull(),
  title: varchar({ length: 200 }).notNull(),
  kind: text({ enum: ["GOVUK_FTA", "DESTINATION_IMMIGRATION", "OFFICIAL_VISA_PORTAL", "EMBASSY_CONSULATE", "OTHER_GOVERNMENT", "IATA", "THIRD_PARTY"] }).notNull(),
  active: boolean().notNull().default(true),
  notes: text(),
  lastFetchedAt: tstz(),
  lastStatus: varchar({ length: 40 }),
  createdBy: uuid().references(() => users.id),
  updatedBy: uuid().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
}, (t) => [uniqueIndex("visa_trusted_sources_url_uq").on(t.country, t.url), index("visa_trusted_sources_country_idx").on(t.country, t.active)])

export const visaRules = pgTable("visa_rules", {
  id: id(),
  destination: varchar({ length: 2 }).notNull(),
  documentType: varchar({ length: 40 }).notNull().references(() => travelDocumentTypes.code),
  issuingCountry: varchar({ length: 2 }).notNull(),
  purpose: text({ enum: ["VISIT", "TRANSIT"] }).notNull(),
  status: text({ enum: ["VISA_FREE", "EVISA", "ETA", "VISA_ON_ARRIVAL", "VISA_REQUIRED", "TRANSIT_VISA", "SPECIAL_PERMISSION", "NOT_ACCEPTED", "UNCONFIRMED"] }).notNull(),
  facts: jsonb().$type<VisaFacts>().notNull(),
  verification: text({ enum: ["VERIFIED", "UNVERIFIED", "CONFLICT", "OVERRIDDEN"] }).notNull(),
  origin: text({ enum: ["RESEARCH", "MANUAL"] }).notNull(),
  evidence: jsonb().$type<Evidence[]>().notNull().default([]),
  conflicts: jsonb().$type<Conflict[]>().notNull().default([]),
  verifiedAt: tstz(),
  expiresAt: tstz(),
  overrideReason: text(),
  updatedBy: uuid().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
}, (t) => [
  uniqueIndex("visa_rules_key_uq").on(t.destination, t.documentType, t.issuingCountry, t.purpose),
  index("visa_rules_review_idx").on(t.verification, t.expiresAt),
])

export const visaResearchRuns = pgTable("visa_research_runs", {
  id: id(),
  destination: varchar({ length: 2 }).notNull(),
  documentType: varchar({ length: 40 }).notNull(),
  issuingCountry: varchar({ length: 2 }).notNull(),
  purpose: text({ enum: ["VISIT", "TRANSIT"] }).notNull(),
  trigger: text({ enum: ["CHECK", "FRESH", "STALE", "STAFF"] }).notNull(),
  status: text({ enum: ["QUEUED", "RUNNING", "DONE", "FAILED", "NOT_CONFIGURED"] }).notNull().default("QUEUED"),
  ruleId: uuid().references(() => visaRules.id),
  resultStatus: varchar({ length: 24 }),
  resultVerification: varchar({ length: 16 }),
  fetches: jsonb().$type<Array<{ url: string; status: string; ms: number; chars: number | null }>>().notNull().default([]),
  droppedClaims: integer().notNull().default(0),
  model: varchar({ length: 60 }),
  inputTokens: integer(),
  outputTokens: integer(),
  error: text(),
  requestedBy: uuid().references(() => users.id),
  startedAt: tstz(),
  finishedAt: tstz(),
  ...timestamps,
}, (t) => [index("visa_research_runs_status_idx").on(t.status, t.createdAt), index("visa_research_runs_key_idx").on(t.destination, t.documentType, t.createdAt)])

/** Write-only Anthropic key for the research step (ADR-0033 point 9). Never selected for a response. */
export const visaResearchCredentials = pgTable("visa_research_credentials", {
  id: varchar({ length: 20 }).primaryKey(),
  ciphertext: text().notNull(),
  keyId: varchar({ length: 40 }).notNull(),
  rotatedAt: tstz().notNull().defaultNow(),
  rotatedBy: uuid().references(() => users.id),
})
