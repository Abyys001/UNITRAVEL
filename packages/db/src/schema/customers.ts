import { date, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { createdAt, id, timestamps, tstz } from "./columns"
import { users } from "./identity"
import { documents } from "./platform"

// Chapter 23.4 — customers.
export const customerProfiles = pgTable("customer_profiles", {
  userId: uuid().primaryKey().references(() => users.id),
  givenNamesLatin: varchar({ length: 80 }),
  surnameLatin: varchar({ length: 80 }),
  nameFa: varchar({ length: 120 }),
  contactTimePref: varchar({ length: 80 }),
  // Optional residential address (owner decision 9, ADR-0005 V10).
  addressLine1: varchar({ length: 120 }),
  addressLine2: varchar({ length: 120 }),
  addressCity: varchar({ length: 80 }),
  addressPostcode: varchar({ length: 12 }),
  addressCountry: varchar({ length: 2 }),
  termsVersion: varchar({ length: 20 }),
  privacyVersion: varchar({ length: 20 }),
  marketingConsentAt: tstz(),
  ...timestamps,
})

export const travellers = pgTable("travellers", {
  id: id(),
  ownerUserId: uuid().notNull().references(() => users.id),
  title: text({ enum: ["MR", "MRS", "MS", "MISS", "MSTR", "DR"] }).notNull(),
  givenNames: varchar({ length: 80 }).notNull(),
  surname: varchar({ length: 80 }).notNull(),
  nameFa: varchar({ length: 120 }),
  dateOfBirth: date({ mode: "string" }).notNull(),
  genderOnDocument: text({ enum: ["M", "F", "X"] }).notNull(),
  nationality: varchar({ length: 2 }).notNull(),
  relationship: text({ enum: ["SELF", "FAMILY", "OTHER"] }).notNull().default("SELF"),
  deletedAt: tstz(),
  ...timestamps,
}, (t) => [index("travellers_owner_idx").on(t.ownerUserId)])

/** Field-level AES-256-GCM; only last4 is stored in clear (ch. 28.3). */
export const travellerDocuments = pgTable("traveller_documents", {
  id: id(),
  travellerId: uuid().notNull().references(() => travellers.id),
  type: text({ enum: ["PASSPORT", "NATIONAL_ID"] }).notNull(),
  numberCiphertext: text().notNull(),
  numberLast4: varchar({ length: 4 }).notNull(),
  issuingCountry: varchar({ length: 2 }).notNull(),
  expiryDate: date({ mode: "string" }).notNull(),
  keyId: varchar({ length: 40 }).notNull(),
  // ADR-0005: verification of this document. The state machine is in packages/domain.
  verificationStatus: text({ enum: ["UNVERIFIED", "SUBMITTED", "VERIFIED", "REJECTED", "CORRECTION_REQUIRED"] }).notNull().default("UNVERIFIED"),
  scanDocumentId: uuid().references(() => documents.id),
  customerConfirmedAt: tstz(),
  /** Keyed hash of the material values the customer confirmed; a reviewer decides against the same hash. */
  confirmedValuesHash: varchar({ length: 64 }),
  submittedAt: tstz(),
  verifiedAt: tstz(),
  erasedAt: tstz(),
  ...timestamps,
}, (t) => [index("traveller_documents_traveller_idx").on(t.travellerId), index("traveller_documents_verification_idx").on(t.verificationStatus)])

/** Insert-only (ADR-0005 V4): one row per staff decision; the reason text is the message written for the customer. */
export const verificationReviews = pgTable("verification_reviews", {
  id: id(),
  travellerDocumentId: uuid().notNull().references(() => travellerDocuments.id),
  travellerId: uuid().notNull().references(() => travellers.id),
  decision: text({ enum: ["VERIFIED", "REJECTED", "CORRECTION_REQUIRED"] }).notNull(),
  reasonCode: varchar({ length: 40 }),
  reasonText: text(),
  reviewerUserId: uuid().notNull().references(() => users.id),
  valueHash: varchar({ length: 64 }).notNull(),
  scanDocumentId: uuid().references(() => documents.id),
  createdAt: createdAt(),
}, (t) => [index("verification_reviews_document_idx").on(t.travellerDocumentId)])
