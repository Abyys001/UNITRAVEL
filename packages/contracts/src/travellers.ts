import { z } from "zod"

import { CountryCode, IsoDate, Uuid } from "./common"
import { DocumentKind, Gender, Title, TravellerRelationship } from "./enums"

const LatinName = z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z '\-]*$/, "Latin letters exactly as in the passport")

export const TravellerDocumentInput = z.object({
  type: DocumentKind.default("PASSPORT"),
  number: z.string().trim().min(5).max(20).regex(/^[A-Z0-9]+$/i),
  issuingCountry: CountryCode,
  expiryDate: IsoDate,
})

export const TravellerInput = z.object({
  title: Title,
  givenNames: LatinName,
  surname: LatinName,
  nameFa: z.string().trim().max(120).nullable().optional(),
  dateOfBirth: IsoDate,
  genderOnDocument: Gender,
  nationality: CountryCode,
  relationship: TravellerRelationship.default("SELF"),
  document: TravellerDocumentInput.optional(),
})
export type TravellerInput = z.infer<typeof TravellerInput>

export const TravellerView = z.object({
  id: Uuid,
  title: Title,
  givenNames: z.string(),
  surname: z.string(),
  nameFa: z.string().nullable(),
  dateOfBirth: IsoDate,
  genderOnDocument: Gender,
  nationality: z.string(),
  relationship: TravellerRelationship,
  /** Passport numbers are never returned in clear; staff use the audited Reveal action. */
  document: z.object({ type: DocumentKind, last4: z.string(), issuingCountry: z.string(), expiryDate: IsoDate }).nullable(),
  documentComplete: z.boolean(),
})
export type TravellerView = z.infer<typeof TravellerView>
