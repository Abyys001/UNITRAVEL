import { z } from "zod"

import { CarrierCode, CursorQuery, Iata, IsoDateTime, page, Reference, Uuid } from "./common"
import { DeliveryStatus } from "./enums"
import { PaymentBody, ReservationBody, TicketInput } from "./requests"

// ADR-0038: issued ticket documents. The provider's PDF is the original (write-once, sha256-checked); the branded file
// wraps it with our cover. Both are always offered; codes are never re-encoded.

export const TICKET_DOCUMENT_KINDS = ["E_TICKET", "BOARDING_PASS"] as const
export const TicketDocumentKind = z.enum(TICKET_DOCUMENT_KINDS)
export type TicketDocumentKind = z.infer<typeof TicketDocumentKind>

export const TICKET_DOCUMENT_STATUSES = ["DRAFT", "ISSUED", "SUPERSEDED", "REVOKED"] as const
export const TicketDocumentStatus = z.enum(TICKET_DOCUMENT_STATUSES)
export type TicketDocumentStatus = z.infer<typeof TicketDocumentStatus>

/** FULL: cover + the provider's pages (copied unchanged) + the original attached. COVER_ONLY: the cover alone (D3). */
export const WrapperMode = z.enum(["FULL", "COVER_ONLY"])
export type WrapperMode = z.infer<typeof WrapperMode>
/** Why the wrapper fell back to COVER_ONLY; null when FULL. */
export const WrapperReason = z.enum(["SIGNED", "ENCRYPTED", "INTEGRITY_FAILED", "UNREADABLE"])
export type WrapperReason = z.infer<typeof WrapperReason>

/** Region of a page, as fractions of the page width and height from the top-left corner (resolution independent). */
export const PageBox = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) })
export type PageBox = z.infer<typeof PageBox>

/** One machine-readable code decoded from a rendered page. `bytesBase64` is the exact payload, compared byte for byte. */
export const DecodedCode = z.object({
  /** zxing format name: QRCode, PDF417, Aztec, DataMatrix, Code128, … */
  format: z.string(),
  /** 1-based page of the file it was read from. */
  page: z.number().int().min(1),
  bytesBase64: z.string(),
  /** Text interpretation, for staff display only (never used to compare). */
  text: z.string(),
  box: PageBox,
})
export type DecodedCode = z.infer<typeof DecodedCode>

export const TextMatch = z.object({ value: z.string(), found: z.boolean() })
export type TextMatch = z.infer<typeof TextMatch>

/** D4: stored on every version. Issue is blocked unless `allMatched`; text mismatches are warnings staff acknowledge. */
export const CodeIntegrityResult = z.object({
  codesOriginal: z.array(DecodedCode),
  codesBranded: z.array(DecodedCode),
  /** Every code of the original was found in the branded file with identical bytes (trivially true when the original has none). */
  allMatched: z.boolean(),
  /** Codes of the original that the branded file lacks (index into codesOriginal). */
  missing: z.array(z.number().int().min(0)),
  signed: z.boolean(),
  encrypted: z.boolean(),
  wrapperMode: WrapperMode,
  wrapperReason: WrapperReason.nullable(),
  textMatches: z.object({ pnr: TextMatch.nullable(), ticketNumbers: z.array(TextMatch) }),
  /** True when any entered PNR or ticket number was not found in the original's text. */
  textWarnings: z.boolean(),
  /** Render scales tried (pdf.js viewport scale; 1 = 72 dpi). */
  scales: z.array(z.number()),
  pages: z.object({ original: z.number().int(), branded: z.number().int() }),
  checkedAt: IsoDateTime,
})
export type CodeIntegrityResult = z.infer<typeof CodeIntegrityResult>

// ---------------- staff inputs ----------------

export const TICKET_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024

/** Staff upload on the customer's behalf: PDF only, at most 10 MB, stored write-once under tickets/original/. */
export const TicketOriginalUploadBody = z.object({
  requestRef: Reference,
  filename: z.string().trim().min(1).max(200).regex(/\.pdf$/i, "The file must be a PDF"),
  mime: z.literal("application/pdf"),
  size: z.number().int().positive().max(TICKET_ORIGINAL_MAX_BYTES),
})
export type TicketOriginalUploadBody = z.infer<typeof TicketOriginalUploadBody>

export const UploadSession = z.object({
  documentId: Uuid,
  uploadUrl: z.string(),
  method: z.literal("PUT"),
  /** Send exactly these headers with the PUT. */
  headers: z.record(z.string(), z.string()),
  expiresInSeconds: z.number().int(),
})
export type UploadSession = z.infer<typeof UploadSession>

export const UploadStatus = z.object({ documentId: Uuid, scanStatus: z.enum(["PENDING", "CLEAN", "INFECTED"]), filename: z.string() })
export type UploadStatus = z.infer<typeof UploadStatus>

const Pnr = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/)
const TicketNumber = z.string().regex(/^\d{13}$/)

/**
 * D5: the reservation and tickets to record first when the request has none. They go through the existing
 * record_reservation and record_tickets commands with all their validation; nothing is written directly.
 */
export const TicketDocumentRecords = z.object({
  reservation: ReservationBody.optional(),
  /** `reservationId` may be left out when `reservation` is recorded in the same step. */
  tickets: z.object({
    reservationId: Uuid.optional(),
    tickets: z.array(TicketInput.omit({ receiptDocumentId: true })).min(1),
    payment: PaymentBody.optional(),
    creditOverride: z.object({ reason: z.string().min(5) }).optional(),
  }).optional(),
})
export type TicketDocumentRecords = z.infer<typeof TicketDocumentRecords>

/** Values printed on the cover when the request has no records yet (and matched against the PDF text). */
export const CoverOverrides = z.object({
  pnr: Pnr.optional(),
  ticketNumbers: z.array(z.object({ travellerId: Uuid, ticketNumber: TicketNumber })).max(9).optional(),
})
export type CoverOverrides = z.infer<typeof CoverOverrides>

export const CreateTicketDocumentBody = z.object({
  requestRef: Reference,
  /** A CLEAN upload from POST /v1/admin/ticket-documents/uploads for the same request. */
  originalDocumentId: Uuid,
  kind: TicketDocumentKind,
  /** Travellers of the request covered by this PDF (one PDF may cover several). */
  travellerIds: z.array(Uuid).min(1).max(9),
  /** Extra information printed on the cover (both languages read it as typed). */
  notes: z.string().trim().max(1000).optional(),
  overrides: CoverOverrides.optional(),
  /** Optional second recipient for the issue email (stored encrypted, audited masked). */
  passengerEmail: z.email().max(254).optional(),
  records: TicketDocumentRecords.optional(),
})
export type CreateTicketDocumentBody = z.infer<typeof CreateTicketDocumentBody>

export const IssueTicketDocumentBody = z.object({
  /** Required when the PNR or a ticket number was not found in the PDF text (D4 warnings). */
  acknowledgeTextWarnings: z.boolean().default(false),
  passengerEmail: z.email().max(254).optional(),
  /** Overrides the records stored with the draft. */
  records: TicketDocumentRecords.optional(),
})
export type IssueTicketDocumentBody = z.infer<typeof IssueTicketDocumentBody>

export const ResendTicketDocumentBody = z.object({
  /** Send to the customer account holder again (default true). */
  toAccount: z.boolean().default(true),
  passengerEmail: z.email().max(254).optional(),
}).refine((b) => b.toAccount || !!b.passengerEmail, { message: "Choose at least one recipient", path: ["toAccount"] })
export type ResendTicketDocumentBody = z.infer<typeof ResendTicketDocumentBody>

/** A new provider PDF for an issued version: creates the next version as a DRAFT; issuing it supersedes this one. */
export const ReplaceTicketDocumentBody = z.object({
  originalDocumentId: Uuid,
  reason: z.string().trim().min(5).max(500),
  kind: TicketDocumentKind.optional(),
  travellerIds: z.array(Uuid).min(1).max(9).optional(),
  notes: z.string().trim().max(1000).optional(),
  overrides: CoverOverrides.optional(),
})
export type ReplaceTicketDocumentBody = z.infer<typeof ReplaceTicketDocumentBody>

/** Regenerates the branded file from the same original (new cover data, settings or logo) as the next DRAFT version. */
export const ReissueTicketDocumentBody = z.object({
  reason: z.string().trim().min(5).max(500),
  notes: z.string().trim().max(1000).optional(),
  overrides: CoverOverrides.optional(),
})
export type ReissueTicketDocumentBody = z.infer<typeof ReissueTicketDocumentBody>

export const RevokeTicketDocumentBody = z.object({ reason: z.string().trim().min(5).max(500) })
export type RevokeTicketDocumentBody = z.infer<typeof RevokeTicketDocumentBody>

export const TicketDocumentSearchQuery = CursorQuery.extend({
  /** Free text over passenger name, customer name or email, PNR, ticket number and request reference. */
  q: z.string().trim().max(80).optional(),
  passenger: z.string().trim().max(80).optional(),
  customer: z.string().trim().max(120).optional(),
  pnr: z.string().trim().max(8).optional(),
  ticketNumber: z.string().trim().max(14).optional(),
  requestRef: z.string().trim().max(12).optional(),
  status: TicketDocumentStatus.optional(),
  kind: TicketDocumentKind.optional(),
})
export type TicketDocumentSearchQuery = z.infer<typeof TicketDocumentSearchQuery>

export const TicketFileWhich = z.enum(["original", "branded"])
export type TicketFileWhich = z.infer<typeof TicketFileWhich>

// ---------------- views ----------------

export const SignedFile = z.object({ url: z.string(), expiresInSeconds: z.number().int() })
export type SignedFile = z.infer<typeof SignedFile>

export const TicketPreview = z.object({ original: SignedFile, branded: SignedFile.nullable() })
export type TicketPreview = z.infer<typeof TicketPreview>

export const TicketSegmentView = z.object({
  carrier: CarrierCode,
  airlineName: z.string().nullable(),
  flightNumber: z.string(),
  origin: Iata,
  destination: Iata,
  /** Local wall-clock times as recorded ("YYYY-MM-DDTHH:mm"); arrival is null when the record has none. */
  departureLocal: z.string().nullable(),
  departureUtc: IsoDateTime,
  arrivalLocal: z.string().nullable(),
  arrivalUtc: IsoDateTime.nullable(),
})
export type TicketSegmentView = z.infer<typeof TicketSegmentView>

export const TicketPassengerView = z.object({ travellerId: Uuid, name: z.string(), ticketNumber: z.string().nullable() })
export type TicketPassengerView = z.infer<typeof TicketPassengerView>

export const TicketDeliveryView = z.object({
  id: Uuid,
  event: z.enum(["ticket.issued", "ticket.resent"]),
  channel: z.enum(["EMAIL", "SMS", "PUSH"]),
  recipient: z.enum(["ACCOUNT", "PASSENGER"]),
  /** Masked destination once sent (for example "neda••le"); null while queued. */
  destination: z.string().nullable(),
  status: DeliveryStatus,
  error: z.string().nullable(),
  sentAt: IsoDateTime.nullable(),
  deliveredAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
})
export type TicketDeliveryView = z.infer<typeof TicketDeliveryView>

export const TicketAuditEntry = z.object({ action: z.string(), actorName: z.string().nullable(), at: IsoDateTime, detail: z.record(z.string(), z.unknown()).nullable() })
export type TicketAuditEntry = z.infer<typeof TicketAuditEntry>

export const TicketDocumentStaffSummary = z.object({
  id: Uuid,
  chainId: Uuid,
  version: z.number().int().min(1),
  kind: TicketDocumentKind,
  status: TicketDocumentStatus,
  requestRef: z.string(),
  customer: z.object({ id: Uuid, name: z.string() }),
  passengers: z.array(TicketPassengerView),
  pnr: z.string().nullable(),
  wrapperMode: WrapperMode,
  allMatched: z.boolean(),
  textWarnings: z.boolean(),
  /** Latest external send (email, SMS or push) of this version; `at` is when it last changed state. Null before any send. */
  lastDelivery: z.object({ status: DeliveryStatus, channel: TicketDeliveryView.shape.channel, at: IsoDateTime }).nullable(),
  issuedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
})
export type TicketDocumentStaffSummary = z.infer<typeof TicketDocumentStaffSummary>

export const TicketDocumentCommand = z.enum(["issue", "resend", "replace", "reissue", "revoke"])
export type TicketDocumentCommand = z.infer<typeof TicketDocumentCommand>

export const TicketDocumentStaffDetail = TicketDocumentStaffSummary.extend({
  originalDocumentId: Uuid,
  brandedDocumentId: Uuid.nullable(),
  originalSha256: z.string(),
  brandedSha256: z.string().nullable(),
  supersedesId: Uuid.nullable(),
  supersededById: Uuid.nullable(),
  notes: z.string().nullable(),
  reason: z.string().nullable(),
  revokedReason: z.string().nullable(),
  /** True when a passenger email is stored with the draft (the address itself is never returned). */
  passengerEmailOnFile: z.boolean(),
  /** The draft carries records to run on issue (D5). */
  pendingRecords: z.boolean(),
  /** Whether the request already has an active reservation and ISSUED tickets for every covered traveller. */
  recordsComplete: z.boolean(),
  verification: CodeIntegrityResult,
  segments: z.array(TicketSegmentView),
  versions: z.array(TicketDocumentStaffSummary),
  deliveries: z.array(TicketDeliveryView),
  audit: z.array(TicketAuditEntry),
  commands: z.array(z.object({ command: TicketDocumentCommand, allowed: z.boolean(), reason: z.string().optional() })),
})
export type TicketDocumentStaffDetail = z.infer<typeof TicketDocumentStaffDetail>

export const TicketDocumentStaffPage = page(TicketDocumentStaffSummary)
export type TicketDocumentStaffPage = z.infer<typeof TicketDocumentStaffPage>

/** A decoded code the portal can show enlarged: GET /v1/ticket-documents/:id/codes/:index returns a PNG crop of the original page. */
export const TicketCodeRef = z.object({ index: z.number().int().min(0), format: z.string(), page: z.number().int().min(1) })
export type TicketCodeRef = z.infer<typeof TicketCodeRef>

/** Customer view (only ISSUED versions of the customer's own requests). */
export const CustomerTicketDocument = z.object({
  id: Uuid,
  version: z.number().int(),
  kind: TicketDocumentKind,
  requestRef: z.string(),
  airlines: z.array(z.object({ code: CarrierCode, name: z.string().nullable() })),
  segments: z.array(TicketSegmentView),
  pnr: z.string().nullable(),
  passengers: z.array(TicketPassengerView),
  wrapperMode: WrapperMode,
  codes: z.array(TicketCodeRef),
  /** Download with GET /v1/ticket-documents/:id/files/:which; the original is always offered. */
  files: z.object({ original: z.object({ filename: z.string() }), branded: z.object({ filename: z.string() }).nullable() }),
  issuedAt: IsoDateTime,
})
export type CustomerTicketDocument = z.infer<typeof CustomerTicketDocument>

export const CustomerTicketDocumentList = z.object({ items: z.array(CustomerTicketDocument) })
export type CustomerTicketDocumentList = z.infer<typeof CustomerTicketDocumentList>

export const CustomerTicketDocumentQuery = z.object({ requestRef: z.string().trim().max(12).optional() })

/** Owner/developer upload of the cover logo (PNG, JPEG or SVG, at most 2 MB); then set settings.company.logoDocumentId. */
export const BrandLogoUploadBody = z.object({
  filename: z.string().trim().min(1).max(200),
  mime: z.enum(["image/png", "image/jpeg", "image/svg+xml"]),
  size: z.number().int().positive().max(2 * 1024 * 1024),
})
export type BrandLogoUploadBody = z.infer<typeof BrandLogoUploadBody>
