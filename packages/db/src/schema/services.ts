import { index, jsonb, pgEnum, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { id, rowVersion, timestamps, tstz } from "./columns"
import { userIdentities, users } from "./identity"

export const serviceRequestType = pgEnum("service_request_type", ["VISA", "TOUR_CALLBACK", "CIP", "INSURANCE", "HOTEL", "STAY", "TRAIN", "BUS"])
export const serviceRequestStatus = pgEnum("service_request_status", [
  "SUBMITTED", "COMPLIANCE_HOLD", "IN_PROGRESS", "QUOTED", "CONFIRMED", "COMPLETED", "CANCELLED", "CLOSED_NO_RESPONSE", "DECLINED",
])

/**
 * ADR-0015: one generic request type for visa, tours, CIP, insurance and (later) hotel, stay, train and bus requests.
 * Status history, messages, internal notes, quotes and commercial documents reuse the shared request tables with
 * request_type = 'SERVICE' (see migration 0010), so a service request is quoted, invoiced and screened like the others.
 */
export const serviceRequests = pgTable("service_requests", {
  id: id(),
  ref: varchar({ length: 12 }).notNull().unique(),
  type: serviceRequestType().notNull(),
  status: serviceRequestStatus().notNull().default("SUBMITTED"),
  customerUserId: uuid().notNull().references(() => users.id),
  contactIdentityId: uuid().notNull().references(() => userIdentities.id),
  contactPhoneSnapshot: varchar({ length: 16 }).notNull(),
  /** Validated per type by SERVICE_DETAILS (packages/contracts/src/services.ts). */
  details: jsonb().$type<Record<string, unknown>>().notNull(),
  submittedVia: text({ enum: ["WEB", "MOBILE", "CONSOLE"] }).notNull().default("WEB"),
  submittedLocale: text({ enum: ["en", "fa"] }).notNull().default("en"),
  assigneeUserId: uuid().references(() => users.id),
  slaDueAt: tstz(),
  version: rowVersion(),
  submittedAt: tstz().notNull().defaultNow(),
  closedAt: tstz(),
  ...timestamps,
}, (t) => [
  index("sr_queue_idx").on(t.status, t.slaDueAt),
  index("sr_customer_idx").on(t.customerUserId, t.submittedAt),
  index("sr_assignee_idx").on(t.assigneeUserId, t.status),
  index("sr_type_idx").on(t.type, t.status),
])

