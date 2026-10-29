import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"

import { id, rowVersion, timestamps, tstz, createdAt } from "./columns"
import { users } from "./identity"

// ADR-0017: content system (migration 0012). One row per kind + locale + slug. Revisions are insert-only snapshots.

export const cmsEntries = pgTable("cms_entries", {
  id: id(),
  kind: text({ enum: ["ARTICLE", "GUIDE", "LEGAL", "PAGE"] }).notNull(),
  locale: varchar({ length: 2 }).notNull(),
  slug: varchar({ length: 80 }).notNull(),
  title: varchar({ length: 160 }).notNull(),
  summary: varchar({ length: 400 }).notNull().default(""),
  bodyMd: text().notNull(),
  category: varchar({ length: 40 }),
  tags: jsonb().$type<string[]>().notNull().default([]),
  featuredImage: varchar({ length: 300 }),
  imageAlt: varchar({ length: 200 }),
  seoTitle: varchar({ length: 70 }),
  seoDescription: varchar({ length: 170 }),
  relatedServices: jsonb().$type<string[]>().notNull().default([]),
  claimsToVerify: jsonb().$type<string[]>().notNull().default([]),
  status: text({ enum: ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] }).notNull().default("DRAFT"),
  publishAt: tstz(),
  publishedAt: tstz(),
  authorId: uuid().notNull().references(() => users.id),
  version: rowVersion(),
  ...timestamps,
}, (t) => [
  uniqueIndex("cms_entries_slug_uq").on(t.kind, t.locale, t.slug),
  index("cms_entries_list_idx").on(t.kind, t.locale, t.status, t.publishedAt),
])

export const cmsRevisions = pgTable("cms_revisions", {
  id: id(),
  entryId: uuid().notNull().references(() => cmsEntries.id),
  version: integer().notNull(),
  status: text().notNull(),
  title: varchar({ length: 160 }).notNull(),
  snapshot: jsonb().notNull(),
  changedBy: uuid().notNull().references(() => users.id),
  note: varchar({ length: 300 }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("cms_revisions_entry_version_uq").on(t.entryId, t.version, t.status)])

/** Slug changes keep the old address alive (301). */
export const cmsRedirects = pgTable("cms_redirects", {
  id: id(),
  kind: text().notNull(),
  locale: varchar({ length: 2 }).notNull(),
  fromSlug: varchar({ length: 80 }).notNull(),
  toSlug: varchar({ length: 80 }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("cms_redirects_from_uq").on(t.kind, t.locale, t.fromSlug)])

export const glossaryTerms = pgTable("glossary_terms", {
  id: id(),
  slug: varchar({ length: 80 }).notNull().unique(),
  termFa: varchar({ length: 120 }).notNull(),
  termEn: varchar({ length: 120 }).notNull(),
  explanationFa: text().notNull(),
  explanationEn: text().notNull().default(""),
  category: text({ enum: ["FLIGHT", "BAGGAGE", "CLASS", "HOTEL", "ROOM", "MEAL"] }).notNull(),
  related: jsonb().$type<string[]>().notNull().default([]),
  service: varchar({ length: 16 }),
  status: text({ enum: ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] }).notNull().default("DRAFT"),
  ...timestamps,
}, (t) => [index("glossary_terms_cat_idx").on(t.category, t.status)])
