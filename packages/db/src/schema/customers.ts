import { date, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { id, timestamps, tstz } from "./columns"
import { users } from "./identity"

// Chapter 23.4 — customers.
export const customerProfiles = pgTable("customer_profiles", {
  userId: uuid().primaryKey().references(() => users.id),
  givenNamesLatin: varchar({ length: 80 }),
  surnameLatin: varchar({ length: 80 }),
  nameFa: varchar({ length: 120 }),
  contactTimePref: varchar({ length: 80 }),
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
  erasedAt: tstz(),
  ...timestamps,
}, (t) => [index("traveller_documents_traveller_idx").on(t.travellerId)])
