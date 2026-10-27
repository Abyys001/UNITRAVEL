import { boolean, index, integer, jsonb, numeric, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, timestamps, tstz } from "./columns"
import { requestType } from "./requests"

// Chapter 23.9 — compliance.
export const sanctionLists = pgTable("sanction_lists", {
  id: id(),
  listId: text({ enum: ["UK", "OFAC_SDN", "OFAC_NON_SDN", "EU"] }).notNull(),
  sourceUrl: text().notNull(),
  versionHash: varchar({ length: 64 }).notNull(),
  fetchedAt: tstz().notNull().defaultNow(),
  entryCount: integer().notNull(),
  status: text({ enum: ["ACTIVE", "SUPERSEDED", "FAILED"] }).notNull(),
  error: text(),
}, (t) => [index("sanction_lists_list_idx").on(t.listId, t.fetchedAt)])

export const sanctionEntries = pgTable("sanction_entries", {
  id: id(),
  listVersionId: uuid().notNull().references(() => sanctionLists.id),
  listId: text({ enum: ["UK", "OFAC_SDN", "OFAC_NON_SDN", "EU"] }).notNull(),
  externalId: varchar({ length: 80 }).notNull(),
  type: text({ enum: ["PERSON", "ENTITY", "VESSEL", "AIRCRAFT"] }).notNull(),
  names: jsonb().$type<{ primary: string; aliases: string[]; nonLatin: string[] }>().notNull(),
  dob: text().array().notNull().default([]),
  nationalities: text().array().notNull().default([]),
  identifiers: jsonb().$type<{ type: string; value: string }[]>().notNull().default([]),
  programmes: text().array().notNull().default([]),
  /** Normalised name tokens for the matcher's candidate lookup (GIN + trigram indexes in the migration). */
  searchTokens: text().array().notNull(),
  searchText: text().notNull(),
}, (t) => [index("sanction_entries_version_idx").on(t.listVersionId)])

export const screenings = pgTable("screenings", {
  id: id(),
  subjectType: text({ enum: ["CUSTOMER", "TRAVELLER", "PAYER", "SHIPPER", "CONSIGNEE", "PARTNER", "CARRIER", "GOODS"] }).notNull(),
  subjectRef: varchar({ length: 80 }).notNull(),
  subjectName: varchar({ length: 240 }).notNull(),
  contextRef: varchar({ length: 40 }),
  listsVersion: jsonb().$type<Record<string, string>>().notNull(),
  result: text({ enum: ["CLEAR", "POSSIBLE_MATCH", "MATCH"] }).notNull(),
  candidatesConsidered: integer().notNull().default(0),
  thresholds: jsonb().$type<{ match: number; review: number }>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("screenings_subject_idx").on(t.subjectType, t.subjectRef), index("screenings_context_idx").on(t.contextRef)])

export const screeningHits = pgTable("screening_hits", {
  id: id(),
  screeningId: uuid().notNull().references(() => screenings.id),
  entryId: uuid().notNull().references(() => sanctionEntries.id),
  score: numeric({ precision: 5, scale: 4, mode: "number" }).notNull(),
  matchedName: varchar({ length: 240 }).notNull(),
  reasons: jsonb().$type<string[]>().notNull(),
})

export const compliancePolicies = pgTable("compliance_policies", {
  id: id(),
  type: text({ enum: ["CARRIER", "AIRPORT", "COUNTRY_ROUTE", "GOODS_CATEGORY", "KEYWORD", "LANE", "ONLINE_PAYMENT", "SERVICE"] }).notNull(),
  key: varchar({ length: 120 }).notNull(),
  action: text({ enum: ["BLOCK", "REVIEW", "ALLOW"] }).notNull(),
  reason: text().notNull(),
  counselReference: varchar({ length: 120 }),
  version: integer().notNull().default(1),
  status: text({ enum: ["PENDING_APPROVAL", "ACTIVE", "RETIRED", "REJECTED", "WITHDRAWN"] }).notNull().default("PENDING_APPROVAL"),
  createdBy: uuid().notNull(),
  approvedBy: uuid(),
  approvedAt: tstz(),
  effectiveFrom: tstz().notNull().defaultNow(),
  seededPendingCounsel: boolean().notNull().default(false),
  ...timestamps,
}, (t) => [index("policies_type_idx").on(t.type, t.status)])

export const complianceCases = pgTable("compliance_cases", {
  id: id(),
  requestType: requestType().notNull(),
  requestId: uuid().notNull(),
  requestRef: varchar({ length: 12 }).notNull(),
  trigger: text({ enum: ["SCREENING", "POLICY", "LANE", "GOODS"] }).notNull(),
  status: text({ enum: ["OPEN", "RELEASED", "DECLINED", "ESCALATED"] }).notNull().default("OPEN"),
  summary: text().notNull(),
  evidence: jsonb().$type<{ kind: string; label: string; detail: string; score?: number }[]>().notNull(),
  screeningIds: uuid().array().notNull().default([]),
  requiresFourEyes: boolean().notNull().default(false),
  assignedTo: uuid(),
  openedAt: tstz().notNull().defaultNow(),
  decidedAt: tstz(),
  ...timestamps,
}, (t) => [index("cases_status_idx").on(t.status, t.openedAt), index("cases_request_idx").on(t.requestType, t.requestId)])

/** Immutable. Corrections are new decisions that reference the earlier one (ch. 27.5). */
export const complianceDecisions = pgTable("compliance_decisions", {
  id: id(),
  caseId: uuid().notNull().references(() => complianceCases.id),
  decision: text({ enum: ["RELEASE", "DECLINE", "ESCALATE", "OVERRIDE"] }).notNull(),
  reason: text().notNull(),
  reasonCode: varchar({ length: 40 }),
  counselReference: varchar({ length: 120 }),
  decidedBy: uuid().notNull(),
  secondApprover: uuid(),
  supersedes: uuid(),
  createdAt: createdAt(),
})
