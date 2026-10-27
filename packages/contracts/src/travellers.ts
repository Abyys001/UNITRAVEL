import { z } from "zod"

import { CountryCode, IsoDate, IsoDateTime, Uuid } from "./common"
import { DocumentKind, Gender, ScanStatus, Title, TravellerRelationship, VerificationDecision, VerificationReasonCode, VerificationStatus } from "./enums"

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

/** PATCH body: every field optional and no defaults. `TravellerInput.partial()` keeps `.default("SELF")` in Zod 4 and would rewrite the relationship (ADR-0013 A9). */
export const TravellerPatch = TravellerInput.extend({ relationship: TravellerRelationship }).partial()
export type TravellerPatch = z.infer<typeof TravellerPatch>

/**
 * What a customer may see of a verification (ADR-0005): the state, when they confirmed, and the reason the
 * reviewer wrote for them. Never the reviewer, never an internal note.
 */
export const CustomerVerification = z.object({
  status: VerificationStatus,
  confirmedAt: IsoDateTime.nullable(),
  /** Hash of the values on screen; sent back on confirm so a change under review is caught (409). */
  reviewHash: z.string().length(64).nullable(),
  reason: z.object({ code: VerificationReasonCode, text: z.string() }).nullable(),
  scan: z.object({ documentId: Uuid, filename: z.string(), scanStatus: ScanStatus }).nullable(),
})
export type CustomerVerification = z.infer<typeof CustomerVerification>

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
  verification: CustomerVerification,
})
export type TravellerView = z.infer<typeof TravellerView>

/** Residential address: optional everywhere (owner decision 9); a flow that needs it asks for it. */
export const AddressInput = z.object({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1).max(80),
  postcode: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9][A-Za-z0-9 \-]*$/, "Letters, digits, space or hyphen"),
  country: CountryCode,
})
export type AddressInput = z.infer<typeof AddressInput>

/** My details: the profile fields a customer edits directly. A null address clears it. */
export const UpdateDetailsBody = z.object({
  givenNamesLatin: LatinName.optional(),
  surnameLatin: LatinName.optional(),
  nameFa: z.string().trim().max(120).nullable().optional(),
  contactTimePref: z.string().trim().max(80).nullable().optional(),
  address: AddressInput.nullable().optional(),
})
export type UpdateDetailsBody = z.infer<typeof UpdateDetailsBody>

export const MyDetails = z.object({
  givenNamesLatin: z.string().nullable(),
  surnameLatin: z.string().nullable(),
  nameFa: z.string().nullable(),
  contactTimePref: z.string().nullable(),
  address: AddressInput.nullable(),
  identities: z.array(z.object({ id: Uuid, type: z.enum(["PHONE", "EMAIL"]), value: z.string(), verified: z.boolean() })),
  /** The traveller profile for the account holder (relationship SELF), if any; others are on /v1/me/travellers. */
  self: TravellerView.nullable(),
})
export type MyDetails = z.infer<typeof MyDetails>

export const ConfirmIdentityBody = z.object({ reviewHash: z.string().length(64) })
export const AttachScanBody = z.object({ documentId: Uuid })

/** Staff verification queue and detail (ADR-0005). */
export const VerificationQueueItem = z.object({
  id: Uuid,
  travellerId: Uuid,
  travellerName: z.string(),
  nationality: z.string(),
  documentType: DocumentKind,
  submittedAt: IsoDateTime,
})
export type VerificationQueueItem = z.infer<typeof VerificationQueueItem>

export const VerificationDetail = z.object({
  id: Uuid,
  status: VerificationStatus,
  reviewHash: z.string().length(64).nullable(),
  confirmedAt: IsoDateTime.nullable(),
  traveller: z.object({
    id: Uuid, givenNames: z.string(), surname: z.string(), nameFa: z.string().nullable(), dateOfBirth: IsoDate, nationality: z.string(),
    genderOnDocument: Gender, ownerUserId: Uuid,
  }),
  document: z.object({ type: DocumentKind, last4: z.string(), issuingCountry: z.string(), expiryDate: IsoDate }),
  scan: z.object({ documentId: Uuid, filename: z.string(), mime: z.string(), uploadedAt: IsoDateTime }).nullable(),
  history: z.array(z.object({ decision: VerificationDecision, reasonCode: VerificationReasonCode.nullable(), reasonText: z.string().nullable(), reviewerName: z.string(), at: IsoDateTime })),
})
export type VerificationDetail = z.infer<typeof VerificationDetail>

export const DecideVerificationBody = z.object({
  decision: VerificationDecision,
  reviewHash: z.string().length(64),
  reasonCode: VerificationReasonCode.optional(),
  /** Written for the customer; shown to them as is. */
  reasonText: z.string().trim().max(300).optional(),
}).superRefine((v, ctx) => {
  if (v.decision !== "VERIFIED" && !v.reasonCode) ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "A reason is required" })
  if (v.decision !== "VERIFIED" && !v.reasonText) ctx.addIssue({ code: "custom", path: ["reasonText"], message: "Write the message the customer will see" })
})
export type DecideVerificationBody = z.infer<typeof DecideVerificationBody>
