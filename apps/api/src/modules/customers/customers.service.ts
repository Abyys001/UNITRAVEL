import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import type { CustomerVerification, MyDetails, TravellerInput, TravellerView, UpdateDetailsBody } from "@unitravel/contracts"
import { customerProfiles, type Db, type DbOrTx, documents, travellerDocuments, travellers, userIdentities, users, verificationReviews } from "@unitravel/db"
import { canonicalMaterial, evaluate, type MachineActor, type MaterialValues, materialChanges, normaliseMaterial, statusAfterMaterialChange, VERIFICATION_TRANSITIONS } from "@unitravel/domain"

import { constantTimeEqual, decryptField, encryptField, keyedHash } from "../../core/crypto"
import { AppError } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { DocumentsService, isIdentityType } from "../documents/documents.service"
import { OutboxService } from "../platform/outbox.service"

type Traveller = typeof travellers.$inferSelect
type TravellerDoc = typeof travellerDocuments.$inferSelect
type DocRow = typeof documents.$inferSelect
type Review = typeof verificationReviews.$inferSelect

const NO_VERIFICATION: CustomerVerification = { status: "UNVERIFIED", confirmedAt: null, reviewHash: null, reason: null, scan: null }
const asCustomer = (userId: string): MachineActor => ({ kind: "CUSTOMER", userId, permissions: new Set(), isOwner: true })
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Traveller profiles (ch. 11.6): Latin names exactly as in the passport, optional Persian name, encrypted document
 * numbers (only last4 in clear). Passport data is requested when a quote is accepted, not at search time.
 * Verification of a document (ADR-0005): the state machine is in packages/domain; this service supplies the facts.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly documents: DocumentsService) {}

  // ---------------- verification helpers ----------------

  materialOf(t: Traveller, d: TravellerDoc): MaterialValues {
    return normaliseMaterial({ number: decryptField(d.numberCiphertext), givenNames: t.givenNames, surname: t.surname, dateOfBirth: t.dateOfBirth, nationality: t.nationality, issuingCountry: d.issuingCountry, expiryDate: d.expiryDate, scanDocumentId: d.scanDocumentId })
  }

  /** Keyed hash of exactly the material values and the scan; the customer confirms it and the reviewer decides against it. */
  valuesHash(t: Traveller, d: TravellerDoc): string {
    return keyedHash(canonicalMaterial(this.materialOf(t, d)), "identity-values")
  }

  private verificationView(t: Traveller, d: TravellerDoc, scan: DocRow | undefined, review: Review | undefined): CustomerVerification {
    const reasoned = d.verificationStatus === "REJECTED" || d.verificationStatus === "CORRECTION_REQUIRED"
    return {
      status: d.verificationStatus, confirmedAt: d.customerConfirmedAt?.toISOString() ?? null, reviewHash: this.valuesHash(t, d),
      reason: reasoned && review?.reasonCode ? { code: review.reasonCode as NonNullable<CustomerVerification["reason"]>["code"], text: review.reasonText ?? "" } : null,
      scan: scan && !scan.erasedAt ? { documentId: scan.id, filename: scan.filename, scanStatus: scan.scanStatus } : null,
    }
  }

  view(t: Traveller, d: TravellerDoc | undefined, scan?: DocRow, review?: Review): TravellerView {
    const live = d && !d.erasedAt ? d : undefined
    const document = live ? { type: live.type, last4: live.numberLast4, issuingCountry: live.issuingCountry, expiryDate: live.expiryDate } : null
    return {
      id: t.id, title: t.title, givenNames: t.givenNames, surname: t.surname, nameFa: t.nameFa, dateOfBirth: t.dateOfBirth, genderOnDocument: t.genderOnDocument,
      nationality: t.nationality, relationship: t.relationship, document, documentComplete: !!document && document.expiryDate > today(),
      verification: live ? this.verificationView(t, live, scan, review) : NO_VERIFICATION,
    }
  }

  async list(ownerUserId: string): Promise<TravellerView[]> {
    const rows = await this.db.select().from(travellers).where(and(eq(travellers.ownerUserId, ownerUserId), isNull(travellers.deletedAt))).orderBy(travellers.createdAt, travellers.id)
    return this.withDocs(rows)
  }

  async byIds(ids: string[], tx: DbOrTx = this.db): Promise<TravellerView[]> {
    if (!ids.length) return []
    const rows = await tx.select().from(travellers).where(inArray(travellers.id, ids))
    return this.withDocs(rows, tx)
  }

  private async withDocs(rows: Traveller[], tx: DbOrTx = this.db) {
    const docs = rows.length ? await tx.select().from(travellerDocuments).where(inArray(travellerDocuments.travellerId, rows.map((r) => r.id))).orderBy(desc(travellerDocuments.createdAt)) : []
    const live = rows.map((t) => docs.find((d) => d.travellerId === t.id && !d.erasedAt))
    const scanIds = live.flatMap((d) => (d?.scanDocumentId ? [d.scanDocumentId] : []))
    const scans = scanIds.length ? await tx.select().from(documents).where(inArray(documents.id, scanIds)) : []
    const reviews = rows.length ? await tx.select().from(verificationReviews).where(inArray(verificationReviews.travellerId, rows.map((r) => r.id))).orderBy(desc(verificationReviews.createdAt)) : []
    return rows.map((t, i) => this.view(t, live[i], scans.find((s) => s.id === live[i]?.scanDocumentId), reviews.find((r) => r.travellerId === t.id)))
  }

  /** Ownership is checked on every lookup; a miss is 404, never 403 (ch. 25.6). */
  async owned(ownerUserId: string, id: string, tx: DbOrTx = this.db): Promise<Traveller> {
    const [t] = await tx.select().from(travellers).where(and(eq(travellers.id, id), eq(travellers.ownerUserId, ownerUserId), isNull(travellers.deletedAt)))
    if (!t) throw new AppError("NOT_FOUND", "Traveller not found")
    return t
  }

  async activeDocument(tx: DbOrTx, travellerId: string, lock = false): Promise<TravellerDoc | undefined> {
    const q = tx.select().from(travellerDocuments).where(and(eq(travellerDocuments.travellerId, travellerId), isNull(travellerDocuments.erasedAt))).orderBy(desc(travellerDocuments.createdAt)).limit(1)
    const [d] = lock ? await q.for("update") : await q
    return d
  }

  // ---------------- traveller CRUD ----------------

  /** Ch. 23 `travellers.relationship`: a customer has one SELF traveller (the "my details" passport owner). Existing duplicates are tolerated; `details()` takes the earliest. */
  private async assertNoOtherSelf(tx: DbOrTx, ownerUserId: string, exceptId?: string) {
    const rows = await tx.select({ id: travellers.id }).from(travellers).where(and(eq(travellers.ownerUserId, ownerUserId), eq(travellers.relationship, "SELF"), isNull(travellers.deletedAt)))
    if (rows.some((r) => r.id !== exceptId)) throw new AppError("SELF_TRAVELLER_EXISTS", "You already have a traveller marked as yourself")
  }

  async create(ownerUserId: string, input: TravellerInput, ctx: { requestId?: string; ip?: string }) {
    return this.uow.run(async (tx) => {
      if (input.relationship === "SELF") await this.assertNoOtherSelf(tx, ownerUserId)
      const [t] = await tx.insert(travellers).values({ ownerUserId, title: input.title, givenNames: input.givenNames.toUpperCase(), surname: input.surname.toUpperCase(), nameFa: input.nameFa ?? null, dateOfBirth: input.dateOfBirth, genderOnDocument: input.genderOnDocument, nationality: input.nationality, relationship: input.relationship }).returning()
      if (input.document) await this.saveDocument(tx, t!.id, input.document)
      await this.audit.record(tx, { actorUserId: ownerUserId, actorKind: "CUSTOMER", action: "traveller.created", entityType: "traveller", entityId: t!.id, after: { nationality: input.nationality, hasDocument: !!input.document }, ip: ctx.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "traveller", aggregateId: t!.id, eventType: "traveller.updated", payload: { travellerId: t!.id, ownerUserId } })
      return (await this.byIds([t!.id], tx))[0]!
    })
  }

  async update(ownerUserId: string, id: string, input: Partial<TravellerInput>, ctx: { requestId?: string; ip?: string }) {
    return this.uow.run(async (tx) => {
      const current = await this.owned(ownerUserId, id, tx)
      if (input.relationship === "SELF" && current.relationship !== "SELF") await this.assertNoOtherSelf(tx, ownerUserId, id)
      const before = await this.materialSnapshot(tx, current)
      const patch: Partial<typeof travellers.$inferInsert> = {}
      if (input.title) patch.title = input.title
      if (input.givenNames) patch.givenNames = input.givenNames.toUpperCase()
      if (input.surname) patch.surname = input.surname.toUpperCase()
      if (input.nameFa !== undefined) patch.nameFa = input.nameFa
      if (input.dateOfBirth) patch.dateOfBirth = input.dateOfBirth
      if (input.genderOnDocument) patch.genderOnDocument = input.genderOnDocument
      if (input.nationality) patch.nationality = input.nationality
      if (input.relationship) patch.relationship = input.relationship
      if (Object.keys(patch).length) await tx.update(travellers).set(patch).where(eq(travellers.id, id))
      if (input.document) await this.saveDocument(tx, id, input.document)
      await this.afterMaterialEdit(tx, id, before, ownerUserId, ctx)
      await this.audit.record(tx, { actorUserId: ownerUserId, actorKind: "CUSTOMER", action: "traveller.updated", entityType: "traveller", entityId: id, after: { fields: Object.keys(patch), document: !!input.document }, ip: ctx.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "traveller", aggregateId: id, eventType: "traveller.updated", payload: { travellerId: id, ownerUserId } })
      return (await this.byIds([id], tx))[0]!
    })
  }

  async remove(ownerUserId: string, id: string) {
    await this.uow.run(async (tx) => {
      await this.owned(ownerUserId, id, tx)
      const docs = await tx.select().from(travellerDocuments).where(eq(travellerDocuments.travellerId, id))
      await tx.update(travellers).set({ deletedAt: new Date() }).where(eq(travellers.id, id))
      await tx.update(travellerDocuments).set({ numberCiphertext: "erased", numberLast4: "0000", erasedAt: new Date() }).where(eq(travellerDocuments.travellerId, id))
      await this.eraseScans(tx, docs.flatMap((d) => (d.scanDocumentId ? [d.scanDocumentId] : [])))
      await this.audit.record(tx, { actorUserId: ownerUserId, actorKind: "CUSTOMER", action: "traveller.deleted", entityType: "traveller", entityId: id })
    })
  }

  private async eraseScans(tx: DbOrTx, ids: string[]) {
    if (!ids.length) return
    for (const s of await tx.select().from(documents).where(and(inArray(documents.id, ids), isNull(documents.erasedAt)))) await this.documents.erase(tx, s)
  }

  private async saveDocument(tx: DbOrTx, travellerId: string, d: NonNullable<TravellerInput["document"]>) {
    const number = d.number.toUpperCase()
    const prior = await this.activeDocument(tx, travellerId)
    // Saving the same document again changes nothing and keeps its verification.
    if (prior && prior.type === d.type && prior.issuingCountry === d.issuingCountry && prior.expiryDate === d.expiryDate && decryptField(prior.numberCiphertext) === number) return
    const enc = encryptField(number)
    if (prior) await tx.update(travellerDocuments).set({ numberCiphertext: "erased", erasedAt: new Date() }).where(eq(travellerDocuments.id, prior.id))
    // The replacement row inherits the verification state and the scan; afterMaterialEdit decides what the edit does to them.
    const carry = prior ? { verificationStatus: prior.verificationStatus, scanDocumentId: prior.scanDocumentId, customerConfirmedAt: prior.customerConfirmedAt, confirmedValuesHash: prior.confirmedValuesHash, submittedAt: prior.submittedAt, verifiedAt: prior.verifiedAt } : {}
    await tx.insert(travellerDocuments).values({ travellerId, type: d.type, numberCiphertext: enc.ciphertext, numberLast4: number.slice(-4), issuingCountry: d.issuingCountry, expiryDate: d.expiryDate, keyId: enc.keyId, ...carry })
  }

  // ---------------- material changes (ADR-0005 V2) ----------------

  private async materialSnapshot(tx: DbOrTx, t: Traveller) {
    const d = await this.activeDocument(tx, t.id)
    return d ? this.materialOf(t, d) : null
  }

  /**
   * After any edit: if a material field moved, a VERIFIED record falls back to SUBMITTED (the save, preceded by the
   * clients' review step, re-confirms the new values); a SUBMITTED record keeps waiting with the confirmation re-bound
   * to the new values; the other states lose their confirmation and wait for the customer to confirm again.
   */
  private async afterMaterialEdit(tx: DbOrTx, travellerId: string, before: MaterialValues | null, userId: string, ctx: { requestId?: string; ip?: string }) {
    if (!before) return
    const [t] = await tx.select().from(travellers).where(eq(travellers.id, travellerId))
    const d = await this.activeDocument(tx, travellerId, true)
    if (!t || !d) return
    const changed = materialChanges(before, this.materialOf(t, d))
    if (!changed.length) return
    const rebind = d.verificationStatus === "VERIFIED" || d.verificationStatus === "SUBMITTED"
    let next = d.verificationStatus
    if (d.verificationStatus === "VERIFIED") {
      const ev = evaluate(VERIFICATION_TRANSITIONS, "material_change", { status: d.verificationStatus, hasCleanScan: true, confirmationCurrent: true }, asCustomer(userId))
      next = ev.ok ? ev.to : statusAfterMaterialChange(d.verificationStatus)
    }
    const now = new Date()
    await tx.update(travellerDocuments).set(rebind
      ? { verificationStatus: next, customerConfirmedAt: now, confirmedValuesHash: this.valuesHash(t, d), submittedAt: next === d.verificationStatus ? d.submittedAt : now, verifiedAt: null }
      : { customerConfirmedAt: null, confirmedValuesHash: null }).where(eq(travellerDocuments.id, d.id))
    await this.audit.record(tx, { actorUserId: userId, actorKind: "CUSTOMER", action: "identity.material_change", entityType: "traveller_document", entityId: d.id, contextRef: null, before: { status: d.verificationStatus }, after: { status: next, fields: changed }, ip: ctx.ip, requestId: ctx.requestId })
  }

  // ---------------- my details, scan, confirm ----------------

  async details(userId: string): Promise<MyDetails> {
    const [p] = await this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))
    const ids = await this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), isNull(userIdentities.revokedAt)))
    const mine = (await this.list(userId)).find((t) => t.relationship === "SELF") ?? null
    return {
      givenNamesLatin: p?.givenNamesLatin ?? null, surnameLatin: p?.surnameLatin ?? null, nameFa: p?.nameFa ?? null, contactTimePref: p?.contactTimePref ?? null,
      address: p?.addressLine1 && p.addressCity && p.addressPostcode && p.addressCountry ? { line1: p.addressLine1, line2: p.addressLine2, city: p.addressCity, postcode: p.addressPostcode, country: p.addressCountry } : null,
      identities: ids.map((i) => ({ id: i.id, type: i.type, value: i.valueNormalised, verified: !!i.verifiedAt })),
      self: mine,
    }
  }

  async updateDetails(userId: string, body: UpdateDetailsBody, ctx: { requestId?: string; ip?: string }) {
    await this.uow.run(async (tx) => {
      const patch: Partial<typeof customerProfiles.$inferInsert> = {}
      for (const k of ["givenNamesLatin", "surnameLatin", "nameFa", "contactTimePref"] as const) if (body[k] !== undefined) patch[k] = body[k]
      if (body.address !== undefined) {
        const a = body.address
        Object.assign(patch, { addressLine1: a?.line1 ?? null, addressLine2: a?.line2 ?? null, addressCity: a?.city ?? null, addressPostcode: a?.postcode ?? null, addressCountry: a?.country ?? null })
      }
      if (body.givenNamesLatin && body.surnameLatin) await tx.update(users).set({ displayName: `${body.givenNamesLatin} ${body.surnameLatin}` }).where(eq(users.id, userId))
      if (Object.keys(patch).length) await tx.insert(customerProfiles).values({ userId, ...patch }).onConflictDoUpdate({ target: customerProfiles.userId, set: patch })
      await this.audit.record(tx, { actorUserId: userId, actorKind: "CUSTOMER", action: "user.profile_updated", entityType: "user", entityId: userId, after: { fields: Object.keys(body) }, ip: ctx.ip, requestId: ctx.requestId })
    })
    return this.details(userId)
  }

  /** Links a clean passport scan the customer uploaded to the traveller's current document; replacing a scan is a material change. */
  async attachScan(userId: string, travellerId: string, documentId: string, ctx: { requestId?: string; ip?: string }) {
    return this.uow.run(async (tx) => {
      const t = await this.owned(userId, travellerId, tx)
      const [scan] = await tx.select().from(documents).where(eq(documents.id, documentId))
      if (!scan || scan.createdBy !== userId || scan.ownerUserId !== userId || !isIdentityType(scan.type) || scan.erasedAt) throw new AppError("NOT_FOUND", "Upload not found")
      if (scan.scanStatus !== "CLEAN") throw new AppError("VALIDATION_FAILED", scan.scanStatus === "PENDING" ? "The scan is still being checked" : "The scan failed the checks; upload another", [{ path: "documentId", code: "SCAN_NOT_CLEAN" }])
      const d = await this.activeDocument(tx, travellerId, true)
      if (!d) throw new AppError("VALIDATION_FAILED", "Add the passport details before the scan", [{ path: "document", code: "REQUIRED" }])
      if (d.scanDocumentId === scan.id) return (await this.byIds([travellerId], tx))[0]!
      const before = this.materialOf(t, d)
      await tx.update(travellerDocuments).set({ scanDocumentId: scan.id }).where(eq(travellerDocuments.id, d.id))
      await this.afterMaterialEdit(tx, travellerId, before, userId, ctx)
      // Data minimisation: the scan that was replaced is deleted, not kept beside the new one.
      if (d.scanDocumentId) await this.eraseScans(tx, [d.scanDocumentId])
      await this.audit.record(tx, { actorUserId: userId, actorKind: "CUSTOMER", action: "identity.scan_attached", entityType: "traveller_document", entityId: d.id, after: { documentId: scan.id, replaced: !!d.scanDocumentId }, ip: ctx.ip, requestId: ctx.requestId })
      return (await this.byIds([travellerId], tx))[0]!
    })
  }

  /** Review then confirm: the customer sends back the hash of what they reviewed; any change since answers 409. */
  async confirmIdentity(userId: string, travellerId: string, reviewHash: string, ctx: { requestId?: string; ip?: string }) {
    return this.uow.run(async (tx) => {
      const t = await this.owned(userId, travellerId, tx)
      const d = await this.activeDocument(tx, travellerId, true)
      if (!d) throw new AppError("VALIDATION_FAILED", "Add the passport details first", [{ path: "document", code: "REQUIRED" }])
      const hash = this.valuesHash(t, d)
      if (!constantTimeEqual(hash, reviewHash)) throw new AppError("VERSION_CONFLICT", "Your details changed; review them again")
      if (d.expiryDate <= today()) throw new AppError("VALIDATION_FAILED", "This document has expired", [{ path: "document.expiryDate", code: "EXPIRED" }])
      const [scan] = d.scanDocumentId ? await tx.select().from(documents).where(eq(documents.id, d.scanDocumentId)) : []
      const ev = evaluate(VERIFICATION_TRANSITIONS, "confirm", { status: d.verificationStatus, hasCleanScan: !!scan && scan.scanStatus === "CLEAN" && !scan.erasedAt, confirmationCurrent: true }, asCustomer(userId))
      if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
      const now = new Date()
      await tx.update(travellerDocuments).set({ verificationStatus: ev.to, customerConfirmedAt: now, confirmedValuesHash: hash, submittedAt: now, verifiedAt: null }).where(eq(travellerDocuments.id, d.id))
      await this.audit.record(tx, { actorUserId: userId, actorKind: "CUSTOMER", action: "identity.submitted", entityType: "traveller_document", entityId: d.id, before: { status: ev.from }, after: { status: ev.to }, ip: ctx.ip, requestId: ctx.requestId })
      return (await this.byIds([travellerId], tx))[0]!
    })
  }

  /** The only decryption path in v1: the audited Reveal action (ch. 28.3). */
  async reveal(travellerId: string, staff: { userId: string; ip: string }, requestId: string, contextRef?: string) {
    return this.uow.run(async (tx) => {
      const [d] = await tx.select().from(travellerDocuments).where(and(eq(travellerDocuments.travellerId, travellerId), isNull(travellerDocuments.erasedAt))).orderBy(desc(travellerDocuments.createdAt)).limit(1)
      if (!d) throw new AppError("NOT_FOUND", "No document on file")
      await this.audit.record(tx, { actorUserId: staff.userId, actorKind: "STAFF", action: "customer.document_revealed", entityType: "traveller_document", entityId: d.id, contextRef: contextRef ?? null, ip: staff.ip, requestId })
      return { type: d.type, number: decryptField(d.numberCiphertext), issuingCountry: d.issuingCountry, expiryDate: d.expiryDate }
    })
  }

  /** Staff customer context (ch. 15.2 "Customer"): profile with PII permission, verified identities, contact log. */
  async context(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId))
    if (!u) throw new AppError("NOT_FOUND")
    const [p] = await this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))
    const ids = await this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), isNull(userIdentities.revokedAt)))
    return {
      id: u.id, displayName: u.displayName, preferredLocale: u.preferredLocale, timezone: u.timezone, profile: p ?? null,
      identities: ids.map((i) => ({ type: i.type, value: i.valueNormalised, verifiedAt: i.verifiedAt, isPrimary: i.isPrimary })),
      travellers: await this.list(userId),
    }
  }
}
