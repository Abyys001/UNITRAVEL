import { boolean, index, integer, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, rowVersion, timestamps, tstz } from "./columns"
import { users } from "./identity"
import { invoices } from "./invoices"

// ADR-0016: customer club (migration 0011). Benefits reach money only as a staff-built quote line; the ledger is
// insert-only (trigger in the migration), like the audit log.

export const loyaltyTiers = pgTable("loyalty_tiers", {
  id: id(),
  code: varchar({ length: 24 }).notNull().unique(),
  nameEn: varchar({ length: 60 }).notNull(),
  nameFa: varchar({ length: 60 }).notNull(),
  active: boolean().notNull().default(true),
  ...timestamps,
})

export const loyaltyMembers = pgTable("loyalty_members", {
  userId: uuid().primaryKey().references(() => users.id),
  tierId: uuid().notNull().references(() => loyaltyTiers.id),
  status: text({ enum: ["ACTIVE", "SUSPENDED", "REMOVED"] }).notNull().default("ACTIVE"),
  joinedAt: tstz().notNull().defaultNow(),
  addedBy: uuid().notNull().references(() => users.id),
  note: text(),
  version: rowVersion(),
  ...timestamps,
}, (t) => [index("loyalty_members_tier_idx").on(t.tierId, t.status)])

export const loyaltyBenefits = pgTable("loyalty_benefits", {
  id: id(),
  kind: text({ enum: ["DISCOUNT_PERCENT", "DISCOUNT_FIXED", "BONUS_CREDIT", "PERK"] }).notNull(),
  /** Percent for DISCOUNT_PERCENT; minor units for DISCOUNT_FIXED and BONUS_CREDIT; 0 for PERK. */
  value: integer().notNull(),
  currency: varchar({ length: 3 }),
  appliesTo: text({ enum: ["FLIGHT", "CARGO", "SERVICE", "ANY"] }).notNull(),
  tierId: uuid().references(() => loyaltyTiers.id),
  userId: uuid().references(() => users.id),
  description: jsonb().$type<{ en: string; fa: string }>().notNull(),
  validFrom: tstz().notNull(),
  validTo: tstz().notNull(),
  status: text({ enum: ["PENDING_APPROVAL", "ACTIVE", "EXPIRED", "REVOKED"] }).notNull(),
  createdBy: uuid().notNull().references(() => users.id),
  approvedBy: uuid().references(() => users.id),
  approvedAt: tstz(),
  revokedBy: uuid().references(() => users.id),
  revokedAt: tstz(),
  revokeReason: text(),
  ...timestamps,
}, (t) => [index("loyalty_benefits_user_idx").on(t.userId, t.status), index("loyalty_benefits_tier_idx").on(t.tierId, t.status)])

export const loyaltyLedger = pgTable("loyalty_ledger", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  kind: text({ enum: ["GRANTED", "USED", "EXPIRED", "REVERSED"] }).notNull(),
  amountMinor: integer().notNull(),
  currency: varchar({ length: 3 }).notNull(),
  reason: text().notNull(),
  actorUserId: uuid().notNull().references(() => users.id),
  benefitId: uuid().references(() => loyaltyBenefits.id),
  invoiceId: uuid().references(() => invoices.id),
  createdAt: createdAt(),
}, (t) => [index("loyalty_ledger_user_idx").on(t.userId, t.createdAt)])
