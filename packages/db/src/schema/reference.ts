import { boolean, doublePrecision, pgTable, text, varchar } from "drizzle-orm/pg-core"

import { timestamps } from "./columns"

// Chapter 23.5 — reference data keyed by natural codes.
export const countries = pgTable("countries", {
  code: varchar({ length: 2 }).primaryKey(),
  nameEn: varchar({ length: 80 }).notNull(),
  nameFa: varchar({ length: 80 }).notNull(),
  regionTags: text().array().notNull().default([]),
  ...timestamps,
})

export const cities = pgTable("cities", {
  code: varchar({ length: 3 }).primaryKey(),
  nameEn: varchar({ length: 80 }).notNull(),
  nameFa: varchar({ length: 80 }).notNull(),
  country: varchar({ length: 2 }).notNull().references(() => countries.code),
  regionTags: text().array().notNull().default([]),
  ...timestamps,
})

export const airports = pgTable("airports", {
  iata: varchar({ length: 3 }).primaryKey(),
  icao: varchar({ length: 4 }),
  nameEn: varchar({ length: 120 }).notNull(),
  nameFa: varchar({ length: 120 }).notNull(),
  cityCode: varchar({ length: 3 }),
  country: varchar({ length: 2 }).notNull().references(() => countries.code),
  /** Mandatory IANA zone: the engine refuses airports without one. */
  tz: varchar({ length: 64 }).notNull(),
  lat: doublePrecision(),
  lon: doublePrecision(),
  metroCode: varchar({ length: 3 }),
  active: boolean().notNull().default(true),
  source: varchar({ length: 80 }),
  ...timestamps,
})

export const airlines = pgTable("airlines", {
  iata: varchar({ length: 3 }).primaryKey(),
  icao: varchar({ length: 3 }),
  /** 3-digit ticket prefix used to validate ticket numbers. */
  accountingCode: varchar({ length: 3 }),
  name: varchar({ length: 120 }).notNull(),
  country: varchar({ length: 2 }).notNull(),
  active: boolean().notNull().default(true),
  source: varchar({ length: 80 }),
  ...timestamps,
})

export const aircraftTypes = pgTable("aircraft_types", {
  code: varchar({ length: 4 }).primaryKey(),
  name: varchar({ length: 120 }).notNull(),
  ...timestamps,
})
