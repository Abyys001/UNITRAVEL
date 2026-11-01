import { boolean, index, integer, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"

import { id, rowVersion, timestamps, tstz } from "./columns"
import { users } from "./identity"

// ADR-0021: staff-curated, indicative listings for buses, trains and stays. A price column exists only together with
// price_quoted (CHECK in migration 0017); there is no way to store an unquoted price.
export const curatedListings = pgTable("curated_listings", {
  id: id(),
  vertical: text({ enum: ["BUS", "TRAIN", "STAY"] }).notNull(),
  status: text({ enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] }).notNull().default("DRAFT"),
  title: jsonb().$type<{ en: string; fa: string }>().notNull(),
  summary: jsonb().$type<{ en: string; fa: string }>().notNull(),
  fromPlace: varchar({ length: 80 }),
  toPlace: varchar({ length: 80 }).notNull(),
  operator: varchar({ length: 80 }),
  priceQuoted: boolean().notNull().default(false),
  priceMinor: integer(),
  currency: varchar({ length: 3 }),
  validUntil: tstz(),
  sortOrder: integer().notNull().default(100),
  createdBy: uuid().notNull().references(() => users.id),
  updatedBy: uuid().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
}, (t) => [index("curated_listings_public_idx").on(t.vertical, t.status, t.sortOrder)])
