import { createHash } from "node:crypto"

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, exists, ilike, inArray, lt, ne, or, type SQL, sql } from "drizzle-orm"

import type {
  BrandLogoUploadBody, CodeIntegrityResult, CreateTicketDocumentBody, CustomerTicketDocument, IssueTicketDocumentBody, ReissueTicketDocumentBody, ReplaceTicketDocumentBody,
  ResendTicketDocumentBody, RevokeTicketDocumentBody, Segment, Slice, TicketDocumentCommand, TicketDocumentRecords, TicketDocumentSearchQuery, TicketDocumentStaffDetail,
  TicketDocumentStaffSummary, TicketFileWhich, TicketOriginalUploadBody, TicketSegmentView, WrapperMode, WrapperReason,
} from "@unitravel/contracts"
import {
  auditLog, type Db, type DbOrTx, documents, flightRequests, notificationDeliveries, notifications, quoteOptions, quotes, requestTravellers, reservations, type TicketCover,
  ticketDocuments, ticketDocumentTravellers, tickets, type Tx, userIdentities, users,
} from "@unitravel/db"
import { allowedCommands, evaluate, originalIntact, TICKET_DOCUMENT_TRANSITIONS, type TicketDocumentCommandName, type TicketDocumentFacts } from "@unitravel/domain"

import { decryptField, encryptField } from "../../core/crypto"
import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { safeError } from "../../core/safe-error"
import { isWriteOnceKey, ObjectStorage, WRITE_ONCE_PREFIX } from "../../core/storage"
import { AuditService } from "../audit/audit.service"
import { BookingsService } from "../bookings/bookings.service"
import { ConfigService } from "../config/config.service"
import { DocumentsService } from "../documents/documents.service"
import { NotificationsService } from "../notifications/notifications.service"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { RequestsService, staffActor, SYSTEM } from "../requests/requests.service"
import { buildBrandedPdf } from "./branded-pdf"
import { decodePdf, type DecodeResult, inspectPdf, renderCodeCrop, verifyWrapper } from "./code-integrity"

type Td = typeof ticketDocuments.$inferSelect
type Req = typeof flightRequests.$inferSelect
type Doc = typeof documents.$inferSelect
/** Row shape of the lastDelivery subquery; json_build_object returns timestamps as Postgres text, normalised in summaries(). */
type LastDeliveryRow = Omit<NonNullable<TicketDocumentStaffSummary["lastDelivery"]>, "at"> & { at: string }

/** A ticket document can be drafted once the customer has accepted an option (records may follow in the wizard, D5). */
const DRAFTABLE: readonly Req["status"][] = ["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED"]
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const mask = (email: string) => `${email.slice(0, 2)}••@${email.split("@")[1] ?? ""}`
const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/**
 * ADR-0038: issued ticket documents. The provider's PDF is stored write-once and checked against its sha256 before every
 * read; the branded wrapper is verified code by code before issue; records are made only through the existing commands.
 */
@Injectable()
export class TicketDocumentsService implements OnModuleInit {
  private readonly log = new Logger("TicketDocuments")

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly docs: DocumentsService,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly bookings: BookingsService,
    private readonly requests: RequestsService,
    private readonly reference: ReferenceService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // D6: both files go with the email. The original is re-verified like any other read (D2); a file that is not part of a
    // live version of the recipient's own request is never attached (the delivery then fails rather than mislead).
    this.notifications.onAttachment(async (documentId, userId) => {
      const d = await this.docs.get(documentId)
      if (!d || d.ownerUserId !== userId || (d.type !== "TICKET_ORIGINAL" && d.type !== "TICKET_BRANDED")) throw new Error("Ticket attachment not available")
      const [td] = await this.db.select().from(ticketDocuments).where(and(d.type === "TICKET_ORIGINAL" ? eq(ticketDocuments.originalDocumentId, d.id) : eq(ticketDocuments.brandedDocumentId, d.id), inArray(ticketDocuments.status, ["ISSUED"]))).limit(1)
      if (!td) throw new Error("Ticket document is no longer issued")
      const content = d.type === "TICKET_ORIGINAL" ? await this.readOriginal(td, null) : await this.readBranded(td, null)
      return { filename: d.filename, content, contentType: "application/pdf" }
    }, "ticket-document")
  }

  // ---------------- reads with integrity checks (D2) ----------------

  private async integrityAlert(td: Pick<Td, "id" | "requestId">, which: TicketFileWhich, actorUserId: string | null, detail: Record<string, unknown>) {
    this.log.error({ ticketDocumentId: td.id, which, ...detail }, "ticket document integrity alert")
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId, actorKind: "SYSTEM", action: "ticket_document.integrity_alert", entityType: "ticket_document", entityId: td.id, after: { which, ...detail } }))
      .catch((err) => this.log.error({ err: safeError(err) }, "integrity alert audit failed"))
    return new AppError("INTEGRITY_ALERT", "The stored file failed its integrity check and is not served")
  }

  /** The original as stored, only when its sha256 equals the value recorded at upload; otherwise fail closed and audit. */
  async readOriginal(td: Pick<Td, "id" | "requestId" | "originalDocumentId" | "originalSha256">, actorUserId: string | null): Promise<Buffer> {
    const d = await this.docs.get(td.originalDocumentId)
    if (!d || d.erasedAt || d.scanStatus !== "CLEAN") throw notFound("Document")
    const bytes = await this.storage.get(d.storageKey)
    const actual = sha256(bytes)
    if (!originalIntact(td.originalSha256, actual) || d.sha256 !== td.originalSha256) throw await this.integrityAlert(td, "original", actorUserId, { expected: td.originalSha256, actual })
    return bytes
  }

  async readBranded(td: Pick<Td, "id" | "requestId" | "brandedDocumentId" | "brandedSha256">, actorUserId: string | null): Promise<Buffer> {
    const d = td.brandedDocumentId ? await this.docs.get(td.brandedDocumentId) : undefined
    if (!d || d.erasedAt) throw notFound("Document")
    const bytes = await this.storage.get(d.storageKey)
    const actual = sha256(bytes)
    if (!originalIntact(td.brandedSha256, actual)) throw await this.integrityAlert(td, "branded", actorUserId, { expected: td.brandedSha256, actual })
    return bytes
  }

  // ---------------- uploads ----------------

  private async draftableRequest(ref: string, tx: DbOrTx = this.db) {
    const r = await this.requests.byRef(ref, tx)
    if (!DRAFTABLE.includes(r.status)) throw new AppError("INVALID_TRANSITION", `Ticket documents need an accepted option; the request is ${r.status}`)
    return r
  }

  /** D2: staff upload on the customer's behalf, PDF only, 10 MB, under the write-once prefix; the scan worker checks it. */
  async createOriginalUpload(body: TicketOriginalUploadBody, actor: Actor) {
    const r = await this.draftableRequest(body.requestRef)
    return this.docs.createUpload({
      ownerUserId: r.customerUserId, filename: body.filename, mime: body.mime, size: body.size, type: "TICKET_ORIGINAL", requestType: "FLIGHT", requestId: r.id, visibility: "INTERNAL",
      createdBy: actor.userId, accept: { "application/pdf": [".pdf"] }, keyPrefix: WRITE_ONCE_PREFIX,
    })
  }

  private async ownUpload(id: string, actor: Actor, type: "TICKET_ORIGINAL" | "BRAND_LOGO") {
    const d = await this.docs.get(id)
    if (!d || d.type !== type || d.createdBy !== actor.userId) throw notFound("Upload")
    return d
  }

  async completeUpload(id: string, actor: Actor, type: "TICKET_ORIGINAL" | "BRAND_LOGO" = "TICKET_ORIGINAL") {
    await this.ownUpload(id, actor, type)
    return this.docs.complete(id, actor.userId)
  }

  async uploadStatus(id: string, actor: Actor, type: "TICKET_ORIGINAL" | "BRAND_LOGO" = "TICKET_ORIGINAL") {
    const d = await this.ownUpload(id, actor, type)
    return { documentId: d.id, scanStatus: d.scanStatus, filename: d.filename }
  }

  /** D7: the cover logo (owner/developer); then set settings.company.logoDocumentId. Rasterised server-side, never served. */
  createLogoUpload(body: BrandLogoUploadBody, actor: Actor) {
    return this.docs.createUpload({ ownerUserId: null, filename: body.filename, mime: body.mime, size: body.size, type: "BRAND_LOGO", visibility: "INTERNAL", createdBy: actor.userId, accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/svg+xml": [".svg"] }, maxBytes: 2 * 1024 * 1024 })
  }

  private async logo(): Promise<{ bytes: Buffer; mime: string } | null> {
    const id = this.config.settings().company.logoDocumentId
    if (!id) return null
    const d = await this.docs.get(id)
    if (!d || d.type !== "BRAND_LOGO" || d.scanStatus !== "CLEAN" || d.erasedAt) return null
    return { bytes: await this.storage.get(d.storageKey), mime: d.mime }
  }

  // ---------------- records and cover ----------------

  private async recordsState(tx: DbOrTx, r: Req, travellerIds: string[]) {
    const [reservation] = await tx.select().from(reservations).where(and(eq(reservations.requestId, r.id), inArray(reservations.status, ["HELD", "CONFIRMED"]))).orderBy(desc(reservations.createdAt)).limit(1)
    const issued = travellerIds.length ? await tx.select().from(tickets).where(and(eq(tickets.requestId, r.id), eq(tickets.status, "ISSUED"), inArray(tickets.travellerId, travellerIds))) : []
    const byTraveller = new Map(issued.map((t) => [t.travellerId, t]))
    return { reservation, tickets: byTraveller, complete: !!reservation && travellerIds.every((id) => byTraveller.has(id)) }
  }

  private async acceptedSlices(tx: DbOrTx, r: Req): Promise<Slice[]> {
    const [row] = await tx.select({ itinerary: quoteOptions.itinerary }).from(quotes).innerJoin(quoteOptions, eq(quoteOptions.id, quotes.acceptedOptionId)).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).limit(1)
    return ((row?.itinerary as { slices?: Slice[] } | undefined)?.slices) ?? []
  }

  /** What the cover shows: recorded facts first, then the records the wizard will run, then the values staff typed. */
  private async buildCover(tx: DbOrTx, r: Req, travellerIds: string[], input: { notes?: string | null; overrides?: CreateTicketDocumentBody["overrides"]; records?: TicketDocumentRecords | null }): Promise<TicketCover> {
    const state = await this.recordsState(tx, r, travellerIds)
    const rt = await tx.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
    const missing = travellerIds.filter((id) => !rt.some((t) => t.travellerId === id))
    if (missing.length) throw new AppError("VALIDATION_FAILED", "Every traveller must be on this request", missing.map((id) => ({ path: "travellerIds", code: "NOT_ON_REQUEST", message: id })))
    const [customer] = await tx.select({ name: users.displayName, locale: users.preferredLocale }).from(users).where(eq(users.id, r.customerUserId))
    const slices: Slice[] = (state.reservation?.segments as Slice[] | undefined) ?? input.records?.reservation?.slices ?? (await this.acceptedSlices(tx, r))
    const ticketFor = (travellerId: string) => state.tickets.get(travellerId)?.ticketNumber
      ?? input.records?.tickets?.tickets.find((t) => t.travellerId === travellerId)?.ticketNumber
      ?? input.overrides?.ticketNumbers?.find((t) => t.travellerId === travellerId)?.ticketNumber ?? null
    return {
      pnr: state.reservation?.recordLocator ?? input.records?.reservation?.recordLocator ?? input.overrides?.pnr ?? null,
      passengers: travellerIds.map((id) => {
        const n = rt.find((t) => t.travellerId === id)!.nameSnapshot
        return { travellerId: id, name: `${n.givenNames} ${n.surname}`.toUpperCase(), ticketNumber: ticketFor(id) }
      }),
      segments: slices.flatMap((s) => s.segments).map((g: Segment) => ({
        carrier: g.marketing.carrier, flightNumber: g.marketing.flightNumber, origin: g.origin.iata, destination: g.destination.iata,
        departureLocal: g.departure.local ?? null, departureUtc: g.departure.utc, arrivalLocal: g.arrival?.local ?? null, arrivalUtc: g.arrival?.utc ?? null,
      })),
      customerName: customer?.name ?? "",
      notes: input.notes?.trim() || null,
      locale: customer?.locale ?? r.submittedLocale,
    }
  }

  private async originalForDraft(id: string, r: Req): Promise<Doc> {
    const d = await this.docs.get(id)
    if (!d || d.type !== "TICKET_ORIGINAL" || d.requestType !== "FLIGHT" || d.requestId !== r.id || !isWriteOnceKey(d.storageKey) || d.erasedAt) throw notFound("Document")
    if (d.scanStatus === "PENDING") throw new AppError("VALIDATION_FAILED", "The file is still being checked", [{ path: "originalDocumentId", code: "SCAN_PENDING" }])
    if (d.scanStatus !== "CLEAN" || !d.sha256) throw new AppError("VALIDATION_FAILED", "The file failed the virus check", [{ path: "originalDocumentId", code: "SCAN_FAILED" }])
    return d
  }

  /**
   * D3 + D4: builds the wrapper (FULL unless the original is signed or encrypted), verifies every code, and falls back
   * to COVER_ONLY when FULL does not reproduce the codes byte for byte. The version is then stored with its result.
   */
  private async buildVersion(input: {
    r: Req; original: Doc; kind: Td["kind"]; travellerIds: string[]; notes?: string | null; overrides?: CreateTicketDocumentBody["overrides"]; records?: TicketDocumentRecords | null
    passengerEmail?: string | null; supersedes?: Td; reason?: string; actor: Actor; requestId: string
  }): Promise<string> {
    const { r, original, actor } = input
    const originalBytes = await this.storage.get(original.storageKey)
    if (!originalIntact(original.sha256, sha256(originalBytes))) {
      throw await this.integrityAlert({ id: input.supersedes?.id ?? original.id, requestId: r.id }, "original", actor.userId, { documentId: original.id, expected: original.sha256, actual: sha256(originalBytes) })
    }
    const cover = await this.buildCover(this.db, r, input.travellerIds, { notes: input.notes, overrides: input.overrides, records: input.records })
    const inspected = await inspectPdf(originalBytes)
    let originalDecode: DecodeResult
    try {
      originalDecode = await decodePdf(originalBytes)
    } catch (err) {
      this.log.warn({ err: safeError(err), documentId: original.id }, "original PDF not readable")
      throw new AppError("VALIDATION_FAILED", "The PDF could not be read. Upload the provider's file without a password.", [{ path: "originalDocumentId", code: "PDF_UNREADABLE" }])
    }
    const company = this.config.settings().company
    const logo = await this.logo()
    const issuedOn = new Date().toISOString().slice(0, 10)
    const ticketNumbers = cover.passengers.map((p) => p.ticketNumber).filter((t): t is string => !!t)
    const attempt = async (mode: WrapperMode, reason: WrapperReason | null) => {
      const built = await buildBrandedPdf({ original: originalBytes, originalFilename: original.filename, mode, kind: input.kind, requestRef: r.ref, cover, company, logo, issuedOn })
      const verification = await verifyWrapper({ original: originalBytes, branded: built.bytes, mode, reason, coverPages: built.coverPages, originalDecode, pnr: cover.pnr, ticketNumbers, inspected })
      return { ...built, verification }
    }
    let result: Awaited<ReturnType<typeof attempt>>
    if (inspected.signed || inspected.encrypted) result = await attempt("COVER_ONLY", inspected.signed ? "SIGNED" : "ENCRYPTED")
    else {
      try {
        result = await attempt("FULL", null)
        if (!result.verification.allMatched) {
          this.log.warn({ requestRef: r.ref, missing: result.verification.missing.length }, "FULL wrapper did not reproduce every code; cover only")
          result = await attempt("COVER_ONLY", "INTEGRITY_FAILED")
        }
      } catch (err) {
        this.log.warn({ err: safeError(err), requestRef: r.ref }, "provider pages could not be copied; cover only")
        result = await attempt("COVER_ONLY", "UNREADABLE")
      }
    }
    return this.uow.run(async (tx) => {
      const chainId = input.supersedes?.chainId ?? crypto.randomUUID()
      const [last] = input.supersedes ? await tx.select({ v: sql<number>`max(${ticketDocuments.version})::int` }).from(ticketDocuments).where(eq(ticketDocuments.chainId, chainId)) : [{ v: 0 }]
      const version = (last?.v ?? 0) + 1
      const branded = await this.docs.storeGenerated(tx, {
        ownerUserId: r.customerUserId, requestType: "FLIGHT", requestId: r.id, type: "TICKET_BRANDED", filename: `UniTravel-${input.kind === "BOARDING_PASS" ? "boarding-pass" : "e-ticket"}-${r.ref}-v${version}.pdf`,
        body: result.bytes, createdBy: actor.userId, visibility: "INTERNAL",
      })
      const [td] = await tx.insert(ticketDocuments).values({
        requestId: r.id, chainId, version, supersedesId: input.supersedes?.id ?? null, kind: input.kind, status: "DRAFT", originalDocumentId: original.id, originalSha256: original.sha256!,
        brandedDocumentId: branded.id, brandedSha256: branded.sha256, wrapperMode: result.verification.wrapperMode, verification: result.verification, cover, pendingRecords: input.records ?? null,
        notes: cover.notes, reason: input.reason ?? null, passengerEmailEnc: input.passengerEmail ? encryptField(input.passengerEmail).ciphertext : null, createdBy: actor.userId,
      }).returning()
      await tx.insert(ticketDocumentTravellers).values(cover.passengers.map((p) => ({ ticketDocumentId: td!.id, travellerId: p.travellerId, name: p.name })))
      await this.audit.record(tx, {
        actorUserId: actor.userId, actorKind: "STAFF", action: input.supersedes ? (input.supersedes.originalDocumentId === original.id ? "ticket_document.reissued" : "ticket_document.replaced") : "ticket_document.drafted",
        entityType: "ticket_document", entityId: td!.id, contextRef: r.ref, ip: actor.ip, requestId: input.requestId,
        after: { version, kind: input.kind, wrapperMode: result.verification.wrapperMode, wrapperReason: result.verification.wrapperReason, allMatched: result.verification.allMatched, codes: result.verification.codesOriginal.length, textWarnings: result.verification.textWarnings, supersedesId: input.supersedes?.id ?? null, reason: input.reason ?? null, originalSha256: original.sha256, passengerEmail: input.passengerEmail ? mask(input.passengerEmail) : null },
      })
      return td!.id
    })
  }

  // ---------------- staff commands ----------------

  async createDraft(body: CreateTicketDocumentBody, actor: Actor, requestId: string) {
    const r = await this.draftableRequest(body.requestRef)
    const original = await this.originalForDraft(body.originalDocumentId, r)
    const [used] = await this.db.select({ id: ticketDocuments.id }).from(ticketDocuments).where(and(eq(ticketDocuments.originalDocumentId, original.id), ne(ticketDocuments.status, "REVOKED"))).limit(1)
    if (used) throw new AppError("VALIDATION_FAILED", "This file already belongs to a ticket document; reissue that one instead", [{ path: "originalDocumentId", code: "ALREADY_USED" }])
    const id = await this.buildVersion({ r, original, kind: body.kind, travellerIds: [...new Set(body.travellerIds)], notes: body.notes, overrides: body.overrides, records: body.records, passengerEmail: body.passengerEmail, actor, requestId })
    return this.detail(id, actor)
  }

  private async load(id: string, tx: DbOrTx = this.db, forUpdate = false) {
    const q = tx.select().from(ticketDocuments).where(eq(ticketDocuments.id, id))
    const [td] = forUpdate ? await q.for("update") : await q
    if (!td) throw notFound("Ticket document")
    const [r] = await tx.select().from(flightRequests).where(eq(flightRequests.id, td.requestId))
    return { td, r: r! }
  }

  private check(command: TicketDocumentCommandName, facts: TicketDocumentFacts, actor: Actor | "SYSTEM") {
    const res = evaluate(TICKET_DOCUMENT_TRANSITIONS, command, facts, actor === "SYSTEM" ? SYSTEM : staffActor(actor))
    if (!res.ok) throw new AppError(res.code, res.reason)
    return res.to
  }

  /** The cover must show what was recorded: a PNR or ticket number that differs (or is missing) means a new draft. */
  private coverMismatch(cover: TicketCover, state: Awaited<ReturnType<TicketDocumentsService["recordsState"]>>): string | null {
    const pnr = state.reservation?.recordLocator ?? null
    if (pnr && cover.pnr !== pnr) return `The cover shows PNR ${cover.pnr ?? "none"} but the reservation is ${pnr}`
    for (const p of cover.passengers) {
      const t = state.tickets.get(p.travellerId)?.ticketNumber
      if (t && p.ticketNumber !== t) return `The cover shows ticket ${p.ticketNumber ?? "none"} for ${p.name} but ${t} is recorded`
    }
    return null
  }

  async issue(id: string, body: IssueTicketDocumentBody, actor: Actor, requestId: string) {
    let { td, r } = await this.load(id)
    if (td.status !== "DRAFT") this.check("issue", { status: td.status }, actor)
    // D4 first: nothing (not even records) happens for a version whose codes did not verify.
    if (!td.verification.allMatched) throw new AppError("CODE_INTEGRITY_FAILED", "A code in the original is missing or altered in the branded file", undefined, { missing: td.verification.missing })
    // Everything the dialog decides (permission, acknowledgement) is checked before any record is written.
    this.check("issue", { status: td.status, codesMatch: true, textWarnings: td.verification.textWarnings, textWarningsAcknowledged: body.acknowledgeTextWarnings }, actor)
    const travellerIds = (await this.db.select({ id: ticketDocumentTravellers.travellerId }).from(ticketDocumentTravellers).where(eq(ticketDocumentTravellers.ticketDocumentId, td.id))).map((t) => t.id)
    let state = await this.recordsState(this.db, r, travellerIds)
    const records = body.records ?? td.pendingRecords
    // D5: missing records go through the existing commands with all their validation; tickets are never written here.
    if (!state.complete && records) {
      if (!state.reservation && records.reservation) await this.bookings.recordReservation(r.ref, records.reservation, actor, undefined, requestId)
      state = await this.recordsState(this.db, r, travellerIds)
      const needTickets = travellerIds.some((t) => !state.tickets.has(t))
      if (needTickets && records.tickets) {
        const reservationId = records.tickets.reservationId ?? state.reservation?.id
        if (!reservationId) throw new AppError("VALIDATION_FAILED", "Record the reservation first", [{ path: "records.reservation", code: "REQUIRED" }])
        await this.bookings.recordTickets(r.ref, { reservationId, tickets: records.tickets.tickets, payment: records.tickets.payment, creditOverride: records.tickets.creditOverride }, actor, undefined, requestId)
      }
      ;({ td, r } = await this.load(id))
      state = await this.recordsState(this.db, r, travellerIds)
    }
    this.check("issue", { status: td.status, codesMatch: td.verification.allMatched, recordsComplete: state.complete, textWarnings: td.verification.textWarnings, textWarningsAcknowledged: body.acknowledgeTextWarnings }, actor)
    const mismatch = this.coverMismatch(td.cover, state)
    if (mismatch) throw new AppError("VALIDATION_FAILED", `${mismatch}. Revoke this draft and create a new one.`, [{ path: "cover", code: "COVER_MISMATCH" }])
    // Both stored files must still be the verified bytes.
    await this.readOriginal(td, actor.userId)
    await this.readBranded(td, actor.userId)
    const passengerEmail = body.passengerEmail ?? (td.passengerEmailEnc ? decryptField(td.passengerEmailEnc) : null)
    await this.uow.run(async (tx) => {
      const { td: locked } = await this.load(id, tx, true)
      this.check("issue", { status: locked.status, codesMatch: locked.verification.allMatched, recordsComplete: true, textWarnings: false }, actor)
      if (locked.supersedesId) {
        const { td: old } = await this.load(locked.supersedesId, tx, true)
        if (old.status === "ISSUED") {
          this.check("supersede", { status: old.status }, "SYSTEM")
          await tx.update(ticketDocuments).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(eq(ticketDocuments.id, old.id))
          await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "ticket_document.superseded", entityType: "ticket_document", entityId: old.id, contextRef: r.ref, after: { by: locked.id, version: locked.version }, ip: actor.ip, requestId })
        }
      }
      await tx.update(ticketDocuments).set({ status: "ISSUED", issuedBy: actor.userId, issuedAt: new Date(), reservationId: state.reservation?.id ?? null, textWarningsAcknowledgedBy: locked.verification.textWarnings ? actor.userId : null }).where(eq(ticketDocuments.id, id))
      const scope = { requestType: "FLIGHT" as const, requestId: r.id, customerUserId: r.customerUserId, staffUserId: actor.userId }
      await this.docs.publish(tx, locked.originalDocumentId, scope)
      await this.docs.publish(tx, locked.brandedDocumentId!, scope)
      // D1: tickets.documentId keeps pointing at the current branded file.
      for (const [travellerId, t] of state.tickets) {
        await tx.update(tickets).set({ documentId: locked.brandedDocumentId }).where(eq(tickets.id, t.id))
        await tx.update(ticketDocumentTravellers).set({ ticketId: t.id }).where(and(eq(ticketDocumentTravellers.ticketDocumentId, id), eq(ticketDocumentTravellers.travellerId, travellerId)))
      }
      const ticketNumbers = [...state.tickets.values()].map((t) => t.ticketNumber)
      await this.audit.record(tx, {
        actorUserId: actor.userId, actorKind: "STAFF", action: "ticket_document.issued", entityType: "ticket_document", entityId: id, contextRef: r.ref, ip: actor.ip, requestId,
        after: { version: locked.version, ticketNumbers, pnr: locked.cover.pnr, wrapperMode: locked.wrapperMode, textWarningsAcknowledged: locked.verification.textWarnings, passengerEmail: passengerEmail ? mask(passengerEmail) : null },
      })
      await this.outbox.add(tx, {
        aggregateType: "flight_request", aggregateId: r.id, eventType: "ticket_document.issued",
        payload: { ticketDocumentId: id, requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, ticketNumbers, attachments: [locked.brandedDocumentId!, locked.originalDocumentId], passengerEmailEnc: passengerEmail ? encryptField(passengerEmail).ciphertext : null },
      })
    })
    return this.detail(id, actor)
  }

  async resend(id: string, body: ResendTicketDocumentBody, actor: Actor, requestId: string) {
    const { td, r } = await this.load(id)
    this.check("resend", { status: td.status }, actor)
    await this.readOriginal(td, actor.userId)
    const ticketNumbers = td.cover.passengers.map((p) => p.ticketNumber).filter((t): t is string => !!t)
    await this.uow.run(async (tx) => {
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "ticket_document.resent", entityType: "ticket_document", entityId: id, contextRef: r.ref, ip: actor.ip, requestId, after: { toAccount: body.toAccount, passengerEmail: body.passengerEmail ? mask(body.passengerEmail) : null } })
      await this.outbox.add(tx, {
        aggregateType: "flight_request", aggregateId: r.id, eventType: "ticket_document.resent",
        payload: { ticketDocumentId: id, requestId: r.id, ref: r.ref, customerUserId: r.customerUserId, ticketNumbers, attachments: [td.brandedDocumentId!, td.originalDocumentId], passengerEmailEnc: body.passengerEmail ? encryptField(body.passengerEmail).ciphertext : null, toAccount: body.toAccount },
      })
    })
    return this.detail(id, actor)
  }

  /** A new provider file: the next version as a DRAFT; issuing it supersedes this one (the customer keeps a valid ticket meanwhile). */
  async replace(id: string, body: ReplaceTicketDocumentBody, actor: Actor, requestId: string) {
    const { td, r } = await this.load(id)
    this.check("replace", { status: td.status, reason: body.reason }, actor)
    if (body.originalDocumentId === td.originalDocumentId) throw new AppError("VALIDATION_FAILED", "Upload the new file first; to rebuild from the same file use reissue", [{ path: "originalDocumentId", code: "SAME_FILE" }])
    const original = await this.originalForDraft(body.originalDocumentId, r)
    const travellerIds = body.travellerIds ?? td.cover.passengers.map((p) => p.travellerId)
    const newId = await this.buildVersion({ r, original, kind: body.kind ?? td.kind, travellerIds, notes: body.notes ?? td.notes, overrides: body.overrides, supersedes: td, reason: body.reason, actor, requestId })
    return this.detail(newId, actor)
  }

  /** The same original, rebuilt (records, settings or logo changed): the next version as a DRAFT. */
  async reissue(id: string, body: ReissueTicketDocumentBody, actor: Actor, requestId: string) {
    const { td, r } = await this.load(id)
    this.check("reissue", { status: td.status, reason: body.reason }, actor)
    const original = await this.docs.get(td.originalDocumentId)
    if (!original) throw notFound("Document")
    const newId = await this.buildVersion({ r, original, kind: td.kind, travellerIds: td.cover.passengers.map((p) => p.travellerId), notes: body.notes ?? td.notes, overrides: body.overrides, supersedes: td, reason: body.reason, actor, requestId })
    return this.detail(newId, actor)
  }

  async revoke(id: string, body: RevokeTicketDocumentBody, actor: Actor, requestId: string) {
    await this.uow.run(async (tx) => {
      const { td, r } = await this.load(id, tx, true)
      this.check("revoke", { status: td.status, reason: body.reason }, actor)
      await tx.update(ticketDocuments).set({ status: "REVOKED", revokedBy: actor.userId, revokedAt: new Date(), revokedReason: body.reason }).where(eq(ticketDocuments.id, id))
      if (td.status === "ISSUED" && td.brandedDocumentId) await tx.update(tickets).set({ documentId: null }).where(and(eq(tickets.requestId, r.id), eq(tickets.documentId, td.brandedDocumentId)))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "ticket_document.revoked", entityType: "ticket_document", entityId: id, contextRef: r.ref, ip: actor.ip, requestId, after: { from: td.status, reason: body.reason } })
      await this.outbox.add(tx, { aggregateType: "flight_request", aggregateId: r.id, eventType: "ticket_document.revoked", payload: { ticketDocumentId: id, requestId: r.id, ref: r.ref } })
    })
    return this.detail(id, actor)
  }

  // ---------------- staff reads ----------------

  private summaries(rows: { td: Td; ref: string; customerId: string; customerName: string; lastDelivery: LastDeliveryRow | null }[]): TicketDocumentStaffSummary[] {
    return rows.map(({ td, ref, customerId, customerName, lastDelivery }) => ({
      id: td.id, chainId: td.chainId, version: td.version, kind: td.kind, status: td.status, requestRef: ref, customer: { id: customerId, name: customerName },
      passengers: td.cover.passengers, pnr: td.cover.pnr, wrapperMode: td.wrapperMode, allMatched: td.verification.allMatched, textWarnings: td.verification.textWarnings,
      lastDelivery: lastDelivery ? { status: lastDelivery.status, channel: lastDelivery.channel, at: new Date(lastDelivery.at).toISOString() } : null,
      issuedAt: td.issuedAt?.toISOString() ?? null, createdAt: td.createdAt.toISOString(),
    }))
  }

  private baseQuery() {
    // Correlated subquery on the partial index deliveries_ticket_document_idx: one round trip for the whole page, no N+1.
    const nd = notificationDeliveries
    const lastDelivery = sql<LastDeliveryRow | null>`(select json_build_object('status', ${nd.status}, 'channel', ${nd.channel}, 'at', coalesce(${nd.deliveredAt}, ${nd.sentAt}, ${nd.createdAt}))
      from ${nd} where ${nd.ticketDocumentId} = ${ticketDocuments.id} and ${nd.channel} <> 'INBOX' order by ${nd.createdAt} desc limit 1)`
    return this.db.select({ td: ticketDocuments, ref: flightRequests.ref, customerId: users.id, customerName: users.displayName, lastDelivery }).from(ticketDocuments)
      .innerJoin(flightRequests, eq(flightRequests.id, ticketDocuments.requestId)).innerJoin(users, eq(users.id, flightRequests.customerUserId))
  }

  async search(q: TicketDocumentSearchQuery) {
    const passenger = (v: string) => exists(this.db.select({ x: sql`1` }).from(ticketDocumentTravellers).where(and(eq(ticketDocumentTravellers.ticketDocumentId, ticketDocuments.id), ilike(ticketDocumentTravellers.name, likeEscape(v)))))
    const customer = (v: string) => or(ilike(users.displayName, likeEscape(v)), exists(this.db.select({ x: sql`1` }).from(userIdentities).where(and(eq(userIdentities.userId, users.id), ilike(userIdentities.valueNormalised, likeEscape(v.toLowerCase()))))))
    const pnr = (v: string) => sql`${ticketDocuments.cover}->>'pnr' ilike ${likeEscape(v)}`
    const ticket = (v: string) => sql`exists (select 1 from jsonb_array_elements(${ticketDocuments.cover}->'passengers') p where p->>'ticketNumber' like ${likeEscape(v.replace(/\D/g, ""))})`
    const where: (SQL | undefined)[] = [
      q.status ? eq(ticketDocuments.status, q.status) : undefined,
      q.kind ? eq(ticketDocuments.kind, q.kind) : undefined,
      q.requestRef ? ilike(flightRequests.ref, likeEscape(q.requestRef)) : undefined,
      q.passenger ? passenger(q.passenger) : undefined,
      q.customer ? customer(q.customer) : undefined,
      q.pnr ? pnr(q.pnr) : undefined,
      q.ticketNumber && q.ticketNumber.replace(/\D/g, "") ? ticket(q.ticketNumber) : undefined,
      q.q ? or(passenger(q.q), customer(q.q), pnr(q.q), ilike(flightRequests.ref, likeEscape(q.q)), ...(q.q.replace(/\D/g, "").length >= 3 ? [ticket(q.q)] : [])) : undefined,
      q.cursor ? lt(ticketDocuments.createdAt, new Date(q.cursor)) : undefined,
    ]
    const rows = await this.baseQuery().where(and(...where)).orderBy(desc(ticketDocuments.createdAt)).limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    return { items: this.summaries(page), nextCursor: rows.length > q.limit ? page.at(-1)!.td.createdAt.toISOString() : null }
  }

  async forRequest(ref: string) {
    const r = await this.requests.byRef(ref)
    const rows = await this.baseQuery().where(eq(ticketDocuments.requestId, r.id)).orderBy(desc(ticketDocuments.createdAt))
    return { items: this.summaries(rows) }
  }

  private segmentViews(cover: TicketCover): TicketSegmentView[] {
    return cover.segments.map((s) => ({ ...s, airlineName: this.reference.airline(s.carrier)?.name ?? null }))
  }

  async detail(id: string, actor: Actor): Promise<TicketDocumentStaffDetail> {
    const [row] = await this.baseQuery().where(eq(ticketDocuments.id, id))
    if (!row) throw notFound("Ticket document")
    const { td } = row
    const [r] = await this.db.select().from(flightRequests).where(eq(flightRequests.id, td.requestId))
    const chain = await this.baseQuery().where(eq(ticketDocuments.chainId, td.chainId)).orderBy(ticketDocuments.version)
    const successor = chain.find((c) => c.td.supersedesId === td.id && c.td.status !== "REVOKED")
    const travellerIds = td.cover.passengers.map((p) => p.travellerId)
    const state = await this.recordsState(this.db, r!, travellerIds)
    const deliveries = await this.db.select({ d: notificationDeliveries, event: notifications.eventType }).from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId)).where(eq(notificationDeliveries.ticketDocumentId, id)).orderBy(desc(notificationDeliveries.createdAt))
    const trail = await this.db.select({ a: auditLog, name: users.displayName }).from(auditLog).leftJoin(users, sql`${users.id} = ${auditLog.actorUserId}`)
      .where(and(eq(auditLog.entityType, "ticket_document"), eq(auditLog.entityId, id))).orderBy(desc(auditLog.occurredAt)).limit(200)
    const facts: TicketDocumentFacts = { status: td.status, codesMatch: td.verification.allMatched }
    const commands = allowedCommands(TICKET_DOCUMENT_TRANSITIONS, facts, staffActor(actor), ["issue", "resend", "replace", "reissue", "revoke"])
    return {
      ...this.summaries([row])[0]!,
      originalDocumentId: td.originalDocumentId, brandedDocumentId: td.brandedDocumentId, originalSha256: td.originalSha256, brandedSha256: td.brandedSha256,
      supersedesId: td.supersedesId, supersededById: successor?.td.id ?? null, notes: td.notes, reason: td.reason, revokedReason: td.revokedReason,
      passengerEmailOnFile: !!td.passengerEmailEnc, pendingRecords: !!td.pendingRecords, recordsComplete: state.complete, verification: td.verification as CodeIntegrityResult,
      segments: this.segmentViews(td.cover), versions: this.summaries(chain),
      deliveries: deliveries.filter((x) => x.d.channel !== "INBOX").map(({ d, event }) => ({
        id: d.id, event: event === "ticket.resent" ? "ticket.resent" : "ticket.issued", channel: d.channel as "EMAIL" | "SMS" | "PUSH", recipient: d.recipient, destination: d.destination, status: d.status,
        error: d.error, sentAt: d.sentAt?.toISOString() ?? null, deliveredAt: d.deliveredAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString(),
      })),
      audit: trail.map(({ a, name }) => ({ action: a.action, actorName: name ?? null, at: a.occurredAt.toISOString(), detail: (a.after as Record<string, unknown> | null) ?? null })),
      commands: commands.map((c) => ({ command: c.command as TicketDocumentCommand, allowed: c.allowed, ...(c.reason ? { reason: c.reason } : {}) })),
    }
  }

  private async fileDoc(td: Td, which: TicketFileWhich) {
    const d = await this.docs.get(which === "original" ? td.originalDocumentId : td.brandedDocumentId ?? "")
    if (!d) throw notFound("Document")
    return d
  }

  /** Staff read of either file (any status), sha-checked and audited before the URL is issued. */
  async staffFile(id: string, which: TicketFileWhich, actor: Actor, requestId: string) {
    const { td } = await this.load(id)
    const d = await this.fileDoc(td, which)
    if (which === "original") await this.readOriginal(td, actor.userId)
    else await this.readBranded(td, actor.userId)
    await this.docs.auditStaffDownload(d, actor.userId, actor.ip, requestId)
    return this.docs.downloadUrl(d)
  }

  async preview(id: string, actor: Actor, requestId: string) {
    const { td } = await this.load(id)
    return { original: await this.staffFile(id, "original", actor, requestId), branded: td.brandedDocumentId ? await this.staffFile(id, "branded", actor, requestId) : null }
  }

  // ---------------- customer ----------------

  private customerView(td: Td, ref: string, files: { original: string; branded: string | null }): CustomerTicketDocument {
    const segments = this.segmentViews(td.cover)
    return {
      id: td.id, version: td.version, kind: td.kind, requestRef: ref,
      airlines: [...new Set(segments.map((s) => s.carrier))].map((code) => ({ code, name: this.reference.airline(code)?.name ?? null })),
      segments, pnr: td.cover.pnr, passengers: td.cover.passengers, wrapperMode: td.wrapperMode,
      codes: td.verification.codesOriginal.map((c, index) => ({ index, format: c.format, page: c.page })),
      files: { original: { filename: files.original }, branded: files.branded ? { filename: files.branded } : null },
      issuedAt: td.issuedAt!.toISOString(),
    }
  }

  private async withFiles(rows: { td: Td; ref: string }[]) {
    const ids = rows.flatMap((r) => [r.td.originalDocumentId, r.td.brandedDocumentId].filter((x): x is string => !!x))
    const names = new Map((ids.length ? await this.db.select({ id: documents.id, filename: documents.filename }).from(documents).where(inArray(documents.id, ids)) : []).map((d) => [d.id, d.filename]))
    return rows.map(({ td, ref }) => this.customerView(td, ref, { original: names.get(td.originalDocumentId) ?? "original.pdf", branded: td.brandedDocumentId ? names.get(td.brandedDocumentId) ?? null : null }))
  }

  async customerList(actor: Actor, requestRef?: string) {
    const rows = await this.db.select({ td: ticketDocuments, ref: flightRequests.ref }).from(ticketDocuments).innerJoin(flightRequests, eq(flightRequests.id, ticketDocuments.requestId))
      .where(and(eq(flightRequests.customerUserId, actor.userId), eq(ticketDocuments.status, "ISSUED"), requestRef ? eq(flightRequests.ref, requestRef.toUpperCase()) : undefined))
      .orderBy(desc(ticketDocuments.issuedAt))
    return { items: await this.withFiles(rows) }
  }

  /** Ownership on every lookup: another customer's id, or a version that is not issued, answers 404. */
  private async owned(id: string, actor: Actor) {
    const [row] = await this.db.select({ td: ticketDocuments, ref: flightRequests.ref, customerUserId: flightRequests.customerUserId }).from(ticketDocuments)
      .innerJoin(flightRequests, eq(flightRequests.id, ticketDocuments.requestId)).where(eq(ticketDocuments.id, id))
    if (!row || row.customerUserId !== actor.userId || row.td.status !== "ISSUED") throw notFound("Ticket document")
    return row
  }

  async customerDetail(id: string, actor: Actor) {
    const row = await this.owned(id, actor)
    return (await this.withFiles([row]))[0]!
  }

  /** `inline` lets the portal open the boarding pass in the browser instead of saving it. */
  async customerFile(id: string, which: TicketFileWhich, actor: Actor, requestId: string, disposition: "attachment" | "inline" = "attachment") {
    const { td, ref } = await this.owned(id, actor)
    if (which === "branded" && !td.brandedDocumentId) throw notFound("Document")
    const d = await this.fileDoc(td, which)
    if (which === "original") await this.readOriginal(td, actor.userId)
    else await this.readBranded(td, actor.userId)
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "ticket_document.downloaded", entityType: "ticket_document", entityId: td.id, contextRef: ref, ip: actor.ip, requestId, after: { which, documentId: d.id, disposition } }))
    return this.docs.downloadUrl(d, disposition)
  }

  /** D4: an enlarged PNG crop of the ORIGINAL page around a decoded code; the symbol is rendered, never re-encoded. */
  async customerCodeCrop(id: string, index: number, actor: Actor, requestId: string) {
    const { td, ref } = await this.owned(id, actor)
    const code = td.verification.codesOriginal[index]
    if (!code) throw notFound("Code")
    const bytes = await this.readOriginal(td, actor.userId)
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "CUSTOMER", action: "ticket_document.code_viewed", entityType: "ticket_document", entityId: td.id, contextRef: ref, ip: actor.ip, requestId, after: { index, format: code.format } }))
    return renderCodeCrop(bytes, code)
  }
}
