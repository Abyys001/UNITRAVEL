import { z } from "zod"

import { CountryCode, IsoDate, IsoDateTime, LocalisedText, page, Uuid } from "./common"

// ADR-0033: visa eligibility and travel document checker. Nationality, document type, issuing country and residence are
// separate facts; a UK-issued document never borrows British-citizen rules. Every answer carries its sources and the
// date it was checked, and anything not proven by an official source is UNCONFIRMED.

/** Seeded document types (data in `travel_document_types`; staff may add more, so the API takes any code). */
export const SEEDED_DOCUMENT_TYPES = [
  "GB_CITIZEN_PASSPORT", "GB_BNO_PASSPORT", "GB_BOTC_PASSPORT", "GB_BOC_PASSPORT", "GB_SUBJECT_PASSPORT", "GB_BPP_PASSPORT",
  "GB_REFUGEE_TRAVEL_DOC", "GB_CERTIFICATE_OF_TRAVEL", "GB_STATELESS_TRAVEL_DOC", "NATIONAL_PASSPORT", "OTHER_TRAVEL_DOC",
] as const
export const DocumentTypeCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/)

/** National passports are keyed by issuing country; every other document by its own type and issuer. */
export const DOCUMENT_CATEGORIES = ["NATIONAL_PASSPORT", "BRITISH_NATIONALITY_PASSPORT", "REFUGEE", "STATELESS", "OTHER_NON_NATIONAL"] as const
export const DocumentCategory = z.enum(DOCUMENT_CATEGORIES)

export const VISA_STATUSES = ["VISA_FREE", "EVISA", "ETA", "VISA_ON_ARRIVAL", "VISA_REQUIRED", "TRANSIT_VISA", "SPECIAL_PERMISSION", "NOT_ACCEPTED", "UNCONFIRMED"] as const
export const VisaStatus = z.enum(VISA_STATUSES)
export type VisaStatus = z.infer<typeof VisaStatus>

export const VISA_COLOURS = ["GREEN", "BLUE", "ORANGE", "RED", "GREY"] as const
export const VisaColour = z.enum(VISA_COLOURS)
export type VisaColour = z.infer<typeof VisaColour>

export const VERIFICATION_STATES = ["VERIFIED", "UNVERIFIED", "CONFLICT", "OVERRIDDEN"] as const
export const VerificationState = z.enum(VERIFICATION_STATES)
export type VerificationState = z.infer<typeof VerificationState>

export const RULE_PURPOSES = ["VISIT", "TRANSIT"] as const
export const RulePurpose = z.enum(RULE_PURPOSES)
export type RulePurpose = z.infer<typeof RulePurpose>

export const TRAVEL_PURPOSES = ["TOURISM", "BUSINESS", "FAMILY", "STUDY", "MEDICAL", "TRANSIT", "OTHER"] as const
export const TravelPurpose = z.enum(TRAVEL_PURPOSES)

/** 1 is most authoritative. Tiers 1-5 are official government sources; 6-7 never decide a status. */
export const SOURCE_KINDS = ["GOVUK_FTA", "DESTINATION_IMMIGRATION", "OFFICIAL_VISA_PORTAL", "EMBASSY_CONSULATE", "OTHER_GOVERNMENT", "IATA", "THIRD_PARTY"] as const
export const SourceKind = z.enum(SOURCE_KINDS)
export type SourceKind = z.infer<typeof SourceKind>
export const SOURCE_TIER: Record<SourceKind, number> = {
  GOVUK_FTA: 1, DESTINATION_IMMIGRATION: 2, OFFICIAL_VISA_PORTAL: 3, EMBASSY_CONSULATE: 4, OTHER_GOVERNMENT: 5, IATA: 6, THIRD_PARTY: 7,
}
export const OFFICIAL_TIER_MAX = 5

export const ENTRIES = ["SINGLE", "MULTIPLE", "DOUBLE"] as const
export const Entries = z.enum(ENTRIES)

/** Tri-state: true, false, or null = UNKNOWN. */
const Tri = z.boolean().nullable()
const Text = (max: number) => z.string().trim().min(1).max(max).nullable()

/** The facts a rule can hold. Every field is nullable; null is UNKNOWN and is shown as "not confirmed". */
export const VisaFacts = z.object({
  status: VisaStatus,
  documentAccepted: Tri,
  maxStay: Text(200),
  entries: Entries.nullable(),
  passportValidity: Text(300),
  blankPages: Text(200),
  applyOnline: Tri,
  embassyAppointment: Tri,
  fee: Text(300),
  processingTime: Text(300),
  applicationUrl: z.url().max(500).nullable(),
  conditions: z.array(z.string().trim().min(1).max(500)).max(20),
  /** Airport transit only: whether an airside transit without a visa is allowed (null = UNKNOWN). */
  airsideTransitWithoutVisa: Tri,
})
export type VisaFacts = z.infer<typeof VisaFacts>

export const EMPTY_FACTS: VisaFacts = {
  status: "UNCONFIRMED", documentAccepted: null, maxStay: null, entries: null, passportValidity: null, blankPages: null, applyOnline: null,
  embassyAppointment: null, fee: null, processingTime: null, applicationUrl: null, conditions: [], airsideTransitWithoutVisa: null,
}

/** One source's contribution: what it claims, which documents its text covers, and the quotes that prove it. */
export const Evidence = z.object({
  url: z.url(),
  title: z.string().max(300),
  kind: SourceKind,
  tier: z.number().int().min(1).max(7),
  official: z.boolean(),
  /** Where the URL came from: a staff-trusted source, a link on the GOV.UK page, a domain-restricted search, or staff. */
  origin: z.enum(["TRUSTED", "GOVUK_LINK", "SEARCH", "STAFF"]),
  fetchedAt: IsoDateTime,
  sourceUpdatedAt: IsoDateTime.nullable(),
  /** Document types the quoted text explicitly covers. */
  covers: z.array(DocumentTypeCode).max(20),
  claims: VisaFacts.partial(),
  quotes: z.array(z.string().min(1).max(1200)).min(1).max(12),
})
export type Evidence = z.infer<typeof Evidence>

export const Conflict = z.object({ field: z.string(), values: z.array(z.object({ url: z.url(), value: z.unknown() })) })
export type Conflict = z.infer<typeof Conflict>

/** Lookup key of a rule. `nationality` is set only for NATIONAL_PASSPORT keys (it equals the issuing country). */
export const RuleKey = z.object({
  destination: CountryCode,
  documentType: DocumentTypeCode,
  issuingCountry: CountryCode,
  purpose: RulePurpose,
})
export type RuleKey = z.infer<typeof RuleKey>

// ---------------- public ----------------

export const TravelDocumentTypeView = z.object({
  code: DocumentTypeCode,
  name: LocalisedText,
  description: LocalisedText,
  category: DocumentCategory,
  /** Fixed issuer (GB for the UK documents); null = the traveller chooses. */
  issuingCountry: CountryCode.nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
})
export type TravelDocumentTypeView = z.infer<typeof TravelDocumentTypeView>

export const TRANSIT_MODES = ["AIRSIDE", "LEAVE_TRANSIT_ZONE", "CHANGE_AIRPORT"] as const
export const TransitMode = z.enum(TRANSIT_MODES)

export const VisaCheckBody = z.object({
  documentType: DocumentTypeCode,
  issuingCountry: CountryCode,
  /** Citizenship, if the traveller has one; never inferred from residence or from the document's issuer. */
  nationality: CountryCode.nullable().default(null),
  residenceCountry: CountryCode.nullable().default(null),
  /** Free text, e.g. "UK indefinite leave to remain". Only ever a possible condition; it never changes the document type. */
  residencePermit: z.string().trim().max(120).nullable().default(null),
  destination: CountryCode,
  transits: z.array(z.object({ country: CountryCode, mode: TransitMode })).max(4).default([]),
  departureDate: IsoDate,
  returnDate: IsoDate.nullable().default(null),
  purpose: TravelPurpose,
  /** Ask for a new research run even if a fresh rule exists (signed-in only, rate-limited). */
  fresh: z.boolean().default(false),
}).refine((b) => !b.returnDate || b.returnDate >= b.departureDate, { message: "The return date must be on or after the departure date", path: ["returnDate"] })
  .refine((b) => !b.transits.some((t) => t.country === b.destination), { message: "A transit country cannot be the destination", path: ["transits"] })
export type VisaCheckBody = z.infer<typeof VisaCheckBody>

export const EvidenceView = Evidence.pick({ url: true, title: true, kind: true, official: true, origin: true, fetchedAt: true, sourceUpdatedAt: true, quotes: true })
export type EvidenceView = z.infer<typeof EvidenceView>

export const LEG_STATES = ["READY", "RESEARCHING", "FAILED"] as const

/** The answer for one country of the trip (destination or a transit country). */
export const VisaLegResult = z.object({
  role: z.enum(["DESTINATION", "TRANSIT"]),
  country: CountryCode,
  transitMode: TransitMode.nullable(),
  state: z.enum(LEG_STATES),
  /** What the customer sees: CONFLICT or unverified rows show as UNCONFIRMED. */
  facts: VisaFacts,
  colour: VisaColour,
  verification: VerificationState.nullable(),
  verifiedAt: IsoDateTime.nullable(),
  stale: z.boolean(),
  sources: z.array(EvidenceView),
  /** Official pages to read even when nothing could be confirmed (GOV.UK, trusted destination sources). */
  /** `kind` lets the page show a localised label; `title` is the source's own (English) title. */
  officialLinks: z.array(z.object({ url: z.url(), title: z.string(), kind: z.enum(["GOVUK", "TRUSTED", "APPLICATION"]) })),
  /** Plain-language warnings: GOV.UK covers British citizens only, conflict, stale, passport validity against the dates, etc. */
  notices: z.array(z.enum([
    "GOVUK_BRITISH_CITIZEN_ONLY", "CONFLICTING_SOURCES", "STALE", "NOT_CONFIGURED", "RESEARCH_FAILED", "RESIDENCE_NOT_CITIZENSHIP",
    "TRANSIT_LEAVES_AIRSIDE", "THIRD_PARTY_ONLY", "LONG_STAY_PURPOSE", "SAME_COUNTRY",
  ])),
})
export type VisaLegResult = z.infer<typeof VisaLegResult>

export const VisaCheckView = z.object({
  id: Uuid,
  createdAt: IsoDateTime,
  input: z.object({
    documentType: DocumentTypeCode, documentName: LocalisedText, issuingCountry: CountryCode, nationality: CountryCode.nullable(), residenceCountry: CountryCode.nullable(),
    residencePermit: z.string().nullable(), destination: CountryCode, departureDate: IsoDate, returnDate: IsoDate.nullable(), purpose: TravelPurpose,
  }),
  complete: z.boolean(),
  /** A fresh verification was asked for but refused by the ten-minute limit; the answer shown is the cached one. */
  freshLimited: z.boolean(),
  legs: z.array(VisaLegResult),
  /** Worst colour of the trip, for the summary banner. */
  overall: VisaColour,
})
export type VisaCheckView = z.infer<typeof VisaCheckView>

// ---------------- staff ----------------

export const VisaRuleView = RuleKey.extend({
  id: Uuid,
  facts: VisaFacts,
  verification: VerificationState,
  origin: z.enum(["RESEARCH", "MANUAL"]),
  evidence: z.array(Evidence),
  conflicts: z.array(Conflict),
  verifiedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  overrideReason: z.string().nullable(),
  updatedBy: Uuid.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type VisaRuleView = z.infer<typeof VisaRuleView>

export const VisaRuleQuery = z.object({
  destination: CountryCode.optional(),
  documentType: DocumentTypeCode.optional(),
  verification: VerificationState.optional(),
  status: VisaStatus.optional(),
  stale: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type VisaRuleQuery = z.infer<typeof VisaRuleQuery>
export const VisaRulePage = page(VisaRuleView)

/**
 * Staff edit. `verification: OVERRIDDEN` needs a reason and at least one official source URL (enforced by the domain gate).
 * `VERIFIED` marks the researched answer as checked by a person. Every change is audited.
 */
export const VisaRulePatch = z.object({
  version: z.number().int().positive(),
  facts: VisaFacts.partial().optional(),
  verification: z.enum(["VERIFIED", "OVERRIDDEN", "UNVERIFIED"]).optional(),
  reason: z.string().trim().min(5).max(1000).optional(),
  officialUrls: z.array(z.url()).max(10).optional(),
  expiresAt: IsoDateTime.nullable().optional(),
})
export type VisaRulePatch = z.infer<typeof VisaRulePatch>

export const VisaRuleCreate = RuleKey.extend({
  facts: VisaFacts,
  reason: z.string().trim().min(5).max(1000),
  officialUrls: z.array(z.url()).min(1).max(10),
  expiresAt: IsoDateTime.nullable().default(null),
})
export type VisaRuleCreate = z.infer<typeof VisaRuleCreate>

export const TrustedSourceView = z.object({
  id: Uuid,
  /** null = applies to every destination (e.g. a global ETA portal list). */
  country: CountryCode.nullable(),
  url: z.url(),
  title: z.string(),
  kind: SourceKind,
  tier: z.number().int(),
  official: z.boolean(),
  active: z.boolean(),
  notes: z.string().nullable(),
  lastFetchedAt: IsoDateTime.nullable(),
  lastStatus: z.string().nullable(),
  version: z.number().int(),
  updatedAt: IsoDateTime,
})
export type TrustedSourceView = z.infer<typeof TrustedSourceView>
export const TrustedSourceBody = z.object({
  country: CountryCode.nullable(),
  url: z.url().max(500).refine((u) => u.startsWith("https://"), { message: "Use an https:// address" }),
  title: z.string().trim().min(2).max(200),
  kind: SourceKind,
  notes: z.string().trim().max(1000).nullable().default(null),
})
export type TrustedSourceBody = z.infer<typeof TrustedSourceBody>
export const TrustedSourcePatch = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(2).max(200).optional(),
  kind: SourceKind.optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})
export type TrustedSourcePatch = z.infer<typeof TrustedSourcePatch>

export const TravelDocumentTypeBody = z.object({
  code: DocumentTypeCode,
  name: z.object({ en: z.string().trim().min(2).max(120), fa: z.string().trim().min(2).max(120) }),
  description: z.object({ en: z.string().trim().max(600), fa: z.string().trim().max(600) }),
  category: DocumentCategory,
  issuingCountry: CountryCode.nullable(),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
})
export type TravelDocumentTypeBody = z.infer<typeof TravelDocumentTypeBody>
export const TravelDocumentTypePatch = z.object({
  version: z.number().int().positive(),
  name: TravelDocumentTypeBody.shape.name.optional(),
  description: TravelDocumentTypeBody.shape.description.optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})
export type TravelDocumentTypePatch = z.infer<typeof TravelDocumentTypePatch>
export const StaffDocumentTypeView = TravelDocumentTypeView.extend({ version: z.number().int() })
export type StaffDocumentTypeView = z.infer<typeof StaffDocumentTypeView>

export const RUN_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "NOT_CONFIGURED"] as const
export const RunStatus = z.enum(RUN_STATUSES)
export const RUN_TRIGGERS = ["CHECK", "FRESH", "STALE", "STAFF"] as const

export const ResearchRunView = RuleKey.extend({
  id: Uuid,
  trigger: z.enum(RUN_TRIGGERS),
  status: RunStatus,
  ruleId: Uuid.nullable(),
  resultStatus: VisaStatus.nullable(),
  resultVerification: VerificationState.nullable(),
  fetches: z.array(z.object({ url: z.string(), status: z.string(), ms: z.number().int(), chars: z.number().int().nullable() })),
  droppedClaims: z.number().int(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  error: z.string().nullable(),
  requestedBy: Uuid.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
})
export type ResearchRunView = z.infer<typeof ResearchRunView>
export const ResearchRunQuery = z.object({
  status: RunStatus.optional(),
  destination: CountryCode.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export const ResearchRunPage = page(ResearchRunView)

export const VisaOverview = z.object({
  rules: z.number().int(),
  byVerification: z.record(VerificationState, z.number().int()),
  stale: z.number().int(),
  conflicts: z.number().int(),
  failedRuns24h: z.number().int(),
  runs24h: z.number().int(),
  researchConfigured: z.boolean(),
  staleDestinations: z.array(z.object({ destination: CountryCode, rules: z.number().int(), oldestVerifiedAt: IsoDateTime.nullable() })),
})
export type VisaOverview = z.infer<typeof VisaOverview>

export const ResearchRequestBody = RuleKey
export const VisaAuditEntry = z.object({
  id: z.string(), occurredAt: IsoDateTime, action: z.string(), entityType: z.string(), entityId: z.string().nullable(), actorUserId: Uuid.nullable(),
  before: z.unknown(), after: z.unknown(),
})
export type VisaAuditEntry = z.infer<typeof VisaAuditEntry>
export const VisaAuditPage = page(VisaAuditEntry)
