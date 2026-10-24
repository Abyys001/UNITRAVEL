import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, isNull } from "drizzle-orm"

import type { DecideVerificationBody, VerificationDetail, VerificationQueueItem } from "@unitravel/contracts"
import { type Db, documents, travellerDocuments, travellers, users, verificationReviews } from "@unitravel/db"
import { evaluate, type MachineActor, VERIFICATION_TRANSITIONS, type VerificationCommand } from "@unitravel/domain"

import { constantTimeEqual } from "../../core/crypto"
import { AppError, notFound } from "../../core/errors"
import { DB, UnitOfWork } from "../../core/infra.module"
import type { Actor } from "../../core/http/decorators"
import { AuditService } from "../audit/audit.service"
import { DocumentsService } from "../documents/documents.service"
import { OutboxService } from "../platform/outbox.service"
import { CustomersService } from "./customers.service"

const COMMAND: Record<DecideVerificationBody["decision"], VerificationCommand> = { VERIFIED: "verify", REJECTED: "reject", CORRECTION_REQUIRED: "require_correction" }

/** Staff side of ADR-0005: queue, side-by-side detail, and the decision. The scan itself is fetched through the audited download route. */
@Injectable()
export class IdentityVerificationService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly customers: CustomersService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly docs: DocumentsService) {}

  async queue(): Promise<VerificationQueueItem[]> {
    const rows = await this.db.select({ d: travellerDocuments, t: travellers }).from(travellerDocuments).innerJoin(travellers, eq(travellers.id, travellerDocuments.travellerId))
      .where(and(eq(travellerDocuments.verificationStatus, "SUBMITTED"), isNull(travellerDocuments.erasedAt), isNull(travellers.deletedAt))).orderBy(asc(travellerDocuments.submittedAt))
    return rows.map(({ d, t }) => ({ id: d.id, travellerId: t.id, travellerName: `${t.givenNames} ${t.surname}`, nationality: t.nationality, documentType: d.type, submittedAt: (d.submittedAt ?? d.updatedAt).toISOString() }))
  }

  private async load(id: string, lock = false) {
    const q = this.db.select({ d: travellerDocuments, t: travellers }).from(travellerDocuments).innerJoin(travellers, eq(travellers.id, travellerDocuments.travellerId)).where(and(eq(travellerDocuments.id, id), isNull(travellerDocuments.erasedAt)))
    const [row] = lock ? await q.for("update") : await q
    if (!row) throw notFound("Verification")
    return row
  }

  async detail(id: string): Promise<VerificationDetail> {
    const { d, t } = await this.load(id)
    const [scan] = d.scanDocumentId ? await this.db.select().from(documents).where(eq(documents.id, d.scanDocumentId)) : []
    const history = await this.db.select({ r: verificationReviews, name: users.displayName }).from(verificationReviews).innerJoin(users, eq(users.id, verificationReviews.reviewerUserId)).where(eq(verificationReviews.travellerId, t.id)).orderBy(desc(verificationReviews.createdAt)).limit(20)
    return {
      id: d.id, status: d.verificationStatus, reviewHash: this.customers.valuesHash(t, d), confirmedAt: d.customerConfirmedAt?.toISOString() ?? null,
      traveller: { id: t.id, givenNames: t.givenNames, surname: t.surname, nameFa: t.nameFa, dateOfBirth: t.dateOfBirth, nationality: t.nationality, genderOnDocument: t.genderOnDocument, ownerUserId: t.ownerUserId },
      document: { type: d.type, last4: d.numberLast4, issuingCountry: d.issuingCountry, expiryDate: d.expiryDate },
      scan: scan && !scan.erasedAt && scan.scanStatus === "CLEAN" ? { documentId: scan.id, filename: scan.filename, mime: scan.mime, uploadedAt: scan.createdAt.toISOString() } : null,
      history: history.map(({ r, name }) => ({ decision: r.decision, reasonCode: r.reasonCode as VerificationDetail["history"][number]["reasonCode"], reasonText: r.reasonText, reviewerName: name, at: r.createdAt.toISOString() })),
    }
  }

  /**
   * Inline view of the scan for the side-by-side screen: audited like a download, and only for holders of both
   * `identity.verify` (route) and `customer.read.documents` (here), so the broad review permission alone never opens a scan.
   */
  async scanBytes(id: string, actor: Actor, requestId: string) {
    if (!actor.permissions.has("customer.read.documents")) throw new AppError("FORBIDDEN", "Requires customer.read.documents")
    const { d } = await this.load(id)
    const [scan] = d.scanDocumentId ? await this.db.select().from(documents).where(eq(documents.id, d.scanDocumentId)) : []
    if (!scan) throw notFound("Scan")
    await this.docs.auditStaffDownload(scan, actor.userId, actor.ip, requestId)
    return { body: await this.docs.readBytes(scan), mime: scan.mime }
  }

  async decide(id: string, body: DecideVerificationBody, actor: Actor, requestId: string) {
    return this.uow.run(async (tx) => {
      const [row] = await tx.select({ d: travellerDocuments, t: travellers }).from(travellerDocuments).innerJoin(travellers, eq(travellers.id, travellerDocuments.travellerId)).where(and(eq(travellerDocuments.id, id), isNull(travellerDocuments.erasedAt))).for("update")
      if (!row) throw notFound("Verification")
      const { d, t } = row
      const current = this.customers.valuesHash(t, d)
      // The reviewer decides on exactly what they saw and what the customer confirmed; anything else means reload.
      if (!d.confirmedValuesHash || !constantTimeEqual(current, body.reviewHash) || !constantTimeEqual(current, d.confirmedValuesHash)) throw new AppError("VERSION_CONFLICT", "The customer changed their details; reload and review again")
      const [scan] = d.scanDocumentId ? await tx.select().from(documents).where(eq(documents.id, d.scanDocumentId)) : []
      const staff: MachineActor = { kind: "STAFF", userId: actor.userId, permissions: actor.permissions }
      const ev = evaluate(VERIFICATION_TRANSITIONS, COMMAND[body.decision], { status: d.verificationStatus, hasCleanScan: !!scan && scan.scanStatus === "CLEAN" && !scan.erasedAt, confirmationCurrent: true, reviewerIsSubject: t.ownerUserId === actor.userId }, staff)
      if (!ev.ok) throw new AppError(ev.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_TRANSITION", ev.reason)
      await tx.update(travellerDocuments).set({ verificationStatus: ev.to, verifiedAt: ev.to === "VERIFIED" ? new Date() : null }).where(eq(travellerDocuments.id, d.id))
      await tx.insert(verificationReviews).values({ travellerDocumentId: d.id, travellerId: t.id, decision: body.decision, reasonCode: body.reasonCode ?? null, reasonText: body.reasonText ?? null, reviewerUserId: actor.userId, valueHash: current, scanDocumentId: d.scanDocumentId })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "identity.verification_decided", entityType: "traveller_document", entityId: d.id, before: { status: ev.from }, after: { status: ev.to, reasonCode: body.reasonCode ?? null }, ip: actor.ip, requestId })
      await this.outbox.add(tx, { aggregateType: "traveller_document", aggregateId: d.id, eventType: "identity.verification_decided", payload: { customerUserId: t.ownerUserId, decision: body.decision, travellerName: `${t.givenNames} ${t.surname}`, message: body.reasonText ?? "" } })
      return { id: d.id, status: ev.to }
    })
  }
}
