import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import type { TravellerInput, TravellerView } from "@unitravel/contracts"
import { customerProfiles, type Db, type DbOrTx, travellerDocuments, travellers, userIdentities, users } from "@unitravel/db"

import { decryptField, encryptField } from "../../core/crypto"
import { AppError } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { OutboxService } from "../platform/outbox.service"

type Traveller = typeof travellers.$inferSelect
type TravellerDoc = typeof travellerDocuments.$inferSelect

/**
 * Traveller profiles (ch. 11.6): Latin names exactly as in the passport, optional Persian name, encrypted document
 * numbers (only last4 in clear). Passport data is requested when a quote is accepted, not at search time.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  view(t: Traveller, d: TravellerDoc | undefined): TravellerView {
    const document = d && !d.erasedAt ? { type: d.type, last4: d.numberLast4, issuingCountry: d.issuingCountry, expiryDate: d.expiryDate } : null
    return {
      id: t.id, title: t.title, givenNames: t.givenNames, surname: t.surname, nameFa: t.nameFa, dateOfBirth: t.dateOfBirth, genderOnDocument: t.genderOnDocument,
      nationality: t.nationality, relationship: t.relationship, document, documentComplete: !!document && document.expiryDate > new Date().toISOString().slice(0, 10),
    }
  }

  async list(ownerUserId: string): Promise<TravellerView[]> {
    const rows = await this.db.select().from(travellers).where(and(eq(travellers.ownerUserId, ownerUserId), isNull(travellers.deletedAt))).orderBy(travellers.createdAt)
    return this.withDocs(rows)
  }

  async byIds(ids: string[], tx: DbOrTx = this.db): Promise<TravellerView[]> {
    if (!ids.length) return []
    const rows = await tx.select().from(travellers).where(inArray(travellers.id, ids))
    return this.withDocs(rows, tx)
  }

  private async withDocs(rows: Traveller[], tx: DbOrTx = this.db) {
    const docs = rows.length ? await tx.select().from(travellerDocuments).where(inArray(travellerDocuments.travellerId, rows.map((r) => r.id))).orderBy(desc(travellerDocuments.createdAt)) : []
    return rows.map((t) => this.view(t, docs.find((d) => d.travellerId === t.id && !d.erasedAt)))
  }

  /** Ownership is checked on every lookup; a miss is 404, never 403 (ch. 25.6). */
  async owned(ownerUserId: string, id: string, tx: DbOrTx = this.db): Promise<Traveller> {
    const [t] = await tx.select().from(travellers).where(and(eq(travellers.id, id), eq(travellers.ownerUserId, ownerUserId), isNull(travellers.deletedAt)))
    if (!t) throw new AppError("NOT_FOUND", "Traveller not found")
    return t
  }

  async create(ownerUserId: string, input: TravellerInput, ctx: { requestId?: string; ip?: string }) {
    return this.uow.run(async (tx) => {
      const [t] = await tx.insert(travellers).values({ ownerUserId, title: input.title, givenNames: input.givenNames.toUpperCase(), surname: input.surname.toUpperCase(), nameFa: input.nameFa ?? null, dateOfBirth: input.dateOfBirth, genderOnDocument: input.genderOnDocument, nationality: input.nationality, relationship: input.relationship }).returning()
      if (input.document) await this.saveDocument(tx, t!.id, input.document)
      await this.audit.record(tx, { actorUserId: ownerUserId, actorKind: "CUSTOMER", action: "traveller.created", entityType: "traveller", entityId: t!.id, after: { nationality: input.nationality, hasDocument: !!input.document }, ip: ctx.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "traveller", aggregateId: t!.id, eventType: "traveller.updated", payload: { travellerId: t!.id, ownerUserId } })
      return (await this.byIds([t!.id], tx))[0]!
    })
  }

  async update(ownerUserId: string, id: string, input: Partial<TravellerInput>, ctx: { requestId?: string; ip?: string }) {
    return this.uow.run(async (tx) => {
      await this.owned(ownerUserId, id, tx)
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
      await this.audit.record(tx, { actorUserId: ownerUserId, actorKind: "CUSTOMER", action: "traveller.updated", entityType: "traveller", entityId: id, after: { fields: Object.keys(patch), document: !!input.document }, ip: ctx.ip, requestId: ctx.requestId })
      await this.outbox.add(tx, { aggregateType: "traveller", aggregateId: id, eventType: "traveller.updated", payload: { travellerId: id, ownerUserId } })
      return (await this.byIds([id], tx))[0]!
    })
  }

  async remove(ownerUserId: string, id: string) {
    await this.uow.run(async (tx) => {
      await this.owned(ownerUserId, id, tx)
      await tx.update(travellers).set({ deletedAt: new Date() }).where(eq(travellers.id, id))
      await tx.update(travellerDocuments).set({ numberCiphertext: "erased", numberLast4: "0000", erasedAt: new Date() }).where(eq(travellerDocuments.travellerId, id))
      await this.audit.record(tx, { actorUserId: ownerUserId, actorKind: "CUSTOMER", action: "traveller.deleted", entityType: "traveller", entityId: id })
    })
  }

  private async saveDocument(tx: DbOrTx, travellerId: string, d: NonNullable<TravellerInput["document"]>) {
    const number = d.number.toUpperCase()
    const enc = encryptField(number)
    await tx.update(travellerDocuments).set({ numberCiphertext: "erased", erasedAt: new Date() }).where(and(eq(travellerDocuments.travellerId, travellerId), isNull(travellerDocuments.erasedAt)))
    await tx.insert(travellerDocuments).values({ travellerId, type: d.type, numberCiphertext: enc.ciphertext, numberLast4: number.slice(-4), issuingCountry: d.issuingCountry, expiryDate: d.expiryDate, keyId: enc.keyId })
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
