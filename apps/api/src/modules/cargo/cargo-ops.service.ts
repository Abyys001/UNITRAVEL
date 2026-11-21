import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm"
import type { z } from "zod"

import {
  AGENT_EVENT_LABELS, CARGO_MILESTONE_LABELS, LEGACY_EVENT_CODES, RECIPIENT_MILESTONES, type CargoDetailsPatch, type CargoMilestone, type CargoOpsQuery, type CargoStatus, IMPORTANT_MILESTONES, PublicCargoTracking, SILENT_MILESTONES,
  TRACKING_EVENT_LABELS, type TrackingEventCode,
} from "@unitravel/contracts"
import {
  cargoDeliveryProofs, cargoAgentAssignments, cargoAgents, cargoItems, cargoLabels, cargoLanes, cargoNotifications, cargoPieces, cargoRequests, type Db, notificationDeliveries,
  notifications, requestStatusHistory, trackingEvents, users,
} from "@unitravel/db"
import { cargoWeights, effectiveTimeline, parseTrackingNumber, PROGRESS_STEPS, progressStep, type TrackingRecord } from "@unitravel/domain"

import { constantTimeEqual, hmacSign } from "../../core/crypto"
import { env } from "../../core/env"
import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { DocumentsService } from "../documents/documents.service"
import { EmailSender } from "../notifications/channels"
import { NotificationRouter } from "../notifications/notification-router"
import { NotificationsService } from "../notifications/notifications.service"
import { eventUuid } from "../notifications/format"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { OutboxService } from "../platform/outbox.service"
import { ReferenceService } from "../reference/reference.service"
import { CargoService } from "./cargo.service"
import { type LabelFormat, renderCargoLabels } from "./label-pdf"

type Cargo = typeof cargoRequests.$inferSelect
type Party = { name: string; company?: string; phone: string; email?: string; address: { line1: string; line2?: string; city: string; postcode?: string; country: string } }

const TERMINAL: CargoStatus[] = ["COMPLETED", "DECLINED", "CANCELLED"]
/** Admin buckets (ADR-0042; brief section 8). */
export const OPS_TABS: Record<string, CargoStatus[] | null> = {
  all: null,
  pending: ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED"],
  confirmed: ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER"],
  in_transit: ["RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY"],
  delivered: ["DELIVERED", "COMPLETED"],
  cancelled: ["CANCELLED", "DECLINED", "EXPIRED"],
}
const ACTIVE: CargoStatus[] = ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "EXCEPTION"]

/** "Agent AG-00012" unless the agent has a company-approved public name (ADR-0043 D4). */
export const publicAgentName = (a: { publicName: string | null; agentCode: string }) => a.publicName?.trim() || `Agent ${a.agentCode}`

/** QR signature: proves a label came from us; it does not gate the public view (ADR-0042 D5). */
export const labelSignature = (trackingNumber: string) => hmacSign(trackingNumber, "cargo-label").slice(0, 16)

@Injectable()
export class CargoOpsService implements OnModuleInit {
  private readonly log = new Logger("CargoOps")

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly docs: DocumentsService,
    private readonly cargo: CargoService,
    private readonly router: NotificationRouter,
    private readonly n: NotificationsService,
    private readonly reference: ReferenceService,
    private readonly email: EmailSender,
  ) {}

  onModuleInit() {
    this.router.onCargoMilestone((e) => this.onMilestoneEvent(e))
  }

  // ---------------- shared ----------------

  async records(requestId: string): Promise<TrackingRecord[]> {
    const rows = await this.db.select().from(trackingEvents).where(eq(trackingEvents.cargoRequestId, requestId)).orderBy(asc(trackingEvents.occurredAt), asc(trackingEvents.createdAt))
    return rows.map((t) => ({ id: t.id, eventCode: LEGACY_EVENT_CODES[t.eventCode] ?? t.eventCode, location: t.location, occurredAt: t.occurredAt.toISOString(), description: t.description, correctsEventId: t.correctsEventId, createdAt: t.createdAt.toISOString() }))
  }

  /** Event id → the recording agent's public name (ADR-0043 D4); never the account name, phone or email. */
  async agentNames(requestId: string): Promise<Map<string, string>> {
    const rows = await this.db.select({ id: trackingEvents.id, code: cargoAgents.agentCode, publicName: cargoAgents.publicName }).from(trackingEvents)
      .innerJoin(cargoAgents, eq(cargoAgents.id, trackingEvents.agentId)).where(eq(trackingEvents.cargoRequestId, requestId))
    return new Map(rows.map((r) => [r.id, publicAgentName({ agentCode: r.code, publicName: r.publicName })]))
  }

  /** "Cargo collected by agent" when an agent recorded it, the plain label otherwise. */
  eventLabel(code: TrackingEventCode, byAgent: boolean, locale: "en" | "fa") {
    return ((byAgent ? AGENT_EVENT_LABELS[code] : undefined) ?? TRACKING_EVENT_LABELS[code])[locale]
  }

  async milestone(r: Cargo): Promise<CargoMilestone> {
    return this.cargo.milestoneOf(r, await this.records(r.id))
  }

  trackingUrl(trackingNumber: string, locale: "en" | "fa", signed = false) {
    return `${env().PUBLIC_WEB_URL}/${locale}/tracking/${trackingNumber}${signed ? `?s=${labelSignature(trackingNumber)}` : ""}`
  }

  // ---------------- milestone notices (ADR-0042 D10) ----------------

  /**
   * Computes the milestone after any change and sends one notice per (request, key). The unique index on
   * cargo_notifications makes a replayed or concurrent event a no-op, so a status is never emailed twice.
   */
  async onMilestoneEvent(e: DispatchedEvent) {
    const p = e.payload as { requestId: string; key?: string }
    const [r] = await this.db.select().from(cargoRequests).where(eq(cargoRequests.id, p.requestId))
    if (!r) return
    // The milestone as of the event, not as of now: a request booked a second after it was confirmed still gets its
    // "confirmed" notice. Rows written in the event's transaction share its timestamp, later ones are newer.
    const asOf = new Date(e.occurredAt).getTime()
    const records = (await this.records(r.id)).filter((t) => new Date(t.createdAt).getTime() <= asOf)
    const [hist] = await this.db.select({ to: requestStatusHistory.toStatus }).from(requestStatusHistory)
      .where(and(eq(requestStatusHistory.requestType, "CARGO"), eq(requestStatusHistory.requestId, r.id), lte(requestStatusHistory.createdAt, new Date(asOf + 1))))
      .orderBy(desc(requestStatusHistory.createdAt), desc(requestStatusHistory.id)).limit(1)
    const milestone = this.cargo.milestoneOf({ status: (hist?.to as CargoStatus | undefined) ?? r.status, exceptionReason: r.exceptionReason }, records)
    let key: string = milestone
    let label = CARGO_MILESTONE_LABELS[milestone]
    if (p.key === "TRACKING_NUMBER") {
      if (!r.trackingNumber) return
      key = "TRACKING_NUMBER"
      label = { en: "Tracking number issued", fa: "کد رهگیری صادر شد" }
    } else if (p.key === "AGENT_ASSIGNED:DELIVERY" || p.key === "AGENT_ASSIGNED:COLLECTION") {
      // Every assignment is announced once by its own key (a reassignment or a second agent is not announced again).
      key = p.key
      label = p.key.endsWith("DELIVERY") ? { en: "Assigned to delivery agent", fa: "به مأمور تحویل سپرده شد" } : { en: "Collection agent assigned", fa: "مأمور جمع‌آوری تعیین شد" }
    } else if (p.key?.startsWith("AGENT_ASSIGNED:")) {
      return
    } else {
      if (SILENT_MILESTONES.includes(milestone) || milestone === "AGENT_ASSIGNED") return
      // A held submission is not announced again when it is released; the receipt already went out.
      if (milestone === "DELIVERY_FAILED" || milestone === "COLLECTION_FAILED") {
        const timeline = effectiveTimeline(records)
        const last = [...timeline].reverse().find((t) => t.eventCode === (milestone === "DELIVERY_FAILED" ? "DELIVERY_FAILED" : "COLLECTION_FAILED"))
        key = `${milestone}:${last?.id ?? "x"}`
      }
    }
    const important = IMPORTANT_MILESTONES.includes(milestone) && key === milestone || key.startsWith("DELIVERY_FAILED:")
    const eventType = important ? "cargo.milestone_important" : "cargo.milestone"
    const [row] = await this.db.insert(cargoNotifications).values({ cargoRequestId: r.id, key, milestone, eventType, outboxEventId: String(e.id).slice(0, 64) }).onConflictDoNothing().returning()
    if (!row) return
    if (RECIPIENT_MILESTONES.includes(milestone) && key !== "TRACKING_NUMBER" && !key.startsWith("AGENT_ASSIGNED")) await this.notifyRecipient(r, key, milestone, String(e.id))
    const [u] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, r.customerUserId))
    const shipper = r.shipper as Party
    const name = u?.name && u.name !== "Customer" ? u.name : shipper.name
    await this.n.notify({
      eventId: `cargo-notice:${row.id}`, eventType, audience: "CUSTOMER", userIds: [r.customerUserId], requestKey: r.ref, smsWhenNoEmail: true,
      data: { ref: r.ref, milestone, trackingNumber: r.trackingNumber },
      vars: {
        name, ref: r.ref, tracking_number: r.trackingNumber ?? "—", status_label: label.en, status_label_fa: label.fa, when_at: new Date().toISOString(),
        tracking_link: r.trackingNumber ? this.trackingUrl(r.trackingNumber, "en") : `${env().PUBLIC_WEB_URL}/en/cargo/${r.ref}`,
        tracking_link_fa: r.trackingNumber ? this.trackingUrl(r.trackingNumber, "fa") : `${env().PUBLIC_WEB_URL}/fa/cargo/${r.ref}`,
      },
      linkPath: `/cargo/${r.ref}`,
    })
  }

  /**
   * D10a: the recipient is not an account, so the email goes out directly: bilingual, status and tracking link only.
   * The row is the dedupe; a failed send removes it and rethrows so the job retries.
   */
  private async notifyRecipient(r: Cargo, key: string, milestone: CargoMilestone, outboxId: string) {
    const to = (r.consignee as Party).email?.trim().toLowerCase()
    if (!to || !r.trackingNumber) return
    const [cust] = await this.db.execute<{ v: string }>(sql`select value_normalised as v from user_identities where user_id = ${r.customerUserId} and type = 'EMAIL' and verified_at is not null and revoked_at is null limit 1`).then((x) => x.rows)
    if (cust?.v === to) return
    const [row] = await this.db.insert(cargoNotifications).values({ cargoRequestId: r.id, key: `RECIPIENT:${key}`, milestone, eventType: "cargo.recipient_email", outboxEventId: outboxId.slice(0, 64), audience: "RECIPIENT", recipientEmail: to }).onConflictDoNothing().returning()
    if (!row) return
    const label = CARGO_MILESTONE_LABELS[milestone]
    const tn = r.trackingNumber
    const body = [
      `A shipment is on its way to you. Status: ${label.en}.`, `Tracking number: ${tn}`, `Follow it here: ${this.trackingUrl(tn, "en")}`, "",
      `بسته‌ای برای شما در راه است. وضعیت: ${label.fa}`, `کد رهگیری: ${tn}`, `پیگیری: ${this.trackingUrl(tn, "fa")}`, "", "Uni Travel cargo · بار یونی‌تراول",
    ].join("\n")
    try {
      const sent = await this.email.send(to, `${label.en} · ${tn} · ${label.fa}`, body, "en")
      await this.db.update(cargoNotifications).set({ deliveryStatus: "SENT", deliveryError: null }).where(eq(cargoNotifications.id, row.id))
      this.log.log({ ref: r.ref, milestone, provider: sent.provider }, "recipient notice sent")
    } catch (err) {
      await this.db.delete(cargoNotifications).where(eq(cargoNotifications.id, row.id))
      throw err
    }
  }

  // ---------------- public tracking (ADR-0042 D4, D5) ----------------

  async publicTracking(input: string, sig: string | undefined, locale: "en" | "fa"): Promise<PublicCargoTracking> {
    const number = parseTrackingNumber(input)
    // Same answer for a wrong check digit and an unknown number.
    if (!number) throw notFound("Shipment")
    const [row] = await this.db.select({ r: cargoRequests, l: cargoLanes }).from(cargoRequests).innerJoin(cargoLanes, eq(cargoLanes.id, cargoRequests.laneId)).where(eq(cargoRequests.trackingNumber, number))
    if (!row) throw notFound("Shipment")
    const { r, l } = row
    const records = await this.records(r.id)
    const timeline = effectiveTimeline(records)
    const milestone = this.cargo.milestoneOf(r, records)
    const names = await this.agentNames(r.id)
    const shipper = r.shipper as Party
    const consignee = r.consignee as Party
    const country = (c: string) => this.reference.countryName(c, locale)
    const delivered = ["DELIVERED", "COMPLETED"].includes(r.status)
    let receivedBy: string | null = null
    let deliveredAt: string | null = null
    if (delivered) {
      const [proof] = await this.db.select().from(cargoDeliveryProofs).where(and(eq(cargoDeliveryProofs.cargoRequestId, r.id), eq(cargoDeliveryProofs.kind, "DELIVERY"))).orderBy(desc(cargoDeliveryProofs.capturedAt)).limit(1)
      receivedBy = proof?.receiverName ? initials(proof.receiverName) : null
      deliveredAt = [...timeline].reverse().find((t) => t.eventCode === "DELIVERED")?.occurredAt ?? proof?.capturedAt.toISOString() ?? r.updatedAt.toISOString()
    }
    const step = progressStep(milestone)
    const last = timeline.at(-1)
    return PublicCargoTracking.parse({
      trackingNumber: number, service: r.service, milestone, milestoneLabel: CARGO_MILESTONE_LABELS[milestone][locale],
      origin: { city: shipper.address?.city ?? null, country: country(l.originCountry) },
      destination: { city: consignee.address?.city ?? null, country: country(l.destinationCountry) },
      timeline: timeline.filter((t) => t.eventCode !== "NOTE" || names.has(t.id)).map((t) => ({ eventCode: t.eventCode, label: this.eventLabel(t.eventCode, names.has(t.id), locale), location: t.location, occurredAt: t.occurredAt, agent: names.get(t.id) ?? null })).reverse(),
      lastUpdatedAt: last && last.occurredAt > r.updatedAt.toISOString() ? last.occurredAt : r.updatedAt.toISOString(),
      estimatedDeliveryAt: delivered ? null : r.estimatedDeliveryAt?.toISOString() ?? null,
      delivered: delivered && deliveredAt ? { at: deliveredAt, receivedBy } : null,
      labelVerified: sig ? constantTimeEqual(sig, labelSignature(number)) : null,
      agentUrl: sig && constantTimeEqual(sig, labelSignature(number)) && !delivered ? `${env().PUBLIC_CONSOLE_ADMIN_URL}/agent/scan?tn=${number}` : null,
      progress: PROGRESS_STEPS.map((m, i) => ({ milestone: m, label: CARGO_MILESTONE_LABELS[m][locale], reached: step >= i, current: step === i })),
    })
  }

  // ---------------- tracking number, labels ----------------

  async issueTrackingNumber(ref: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.cargo.byRef(ref, tx, true)
      if (!ACTIVE.includes(r.status) && !["DELIVERED", "COMPLETED"].includes(r.status)) throw new AppError("INVALID_TRANSITION", "A tracking number is issued once the request is confirmed")
      return { trackingNumber: await this.cargo.issueTrackingNumber(tx, r, actor.userId) }
    })
  }

  async generateLabel(ref: string, format: LabelFormat, actor: Actor) {
    const r = await this.cargo.byRef(ref)
    if (!r.trackingNumber) throw new AppError("INVALID_TRANSITION", "Issue the tracking number first")
    if (TERMINAL.includes(r.status) && r.status !== "COMPLETED") throw new AppError("INVALID_TRANSITION", "The request is closed")
    const pieces = await this.db.select().from(cargoPieces).where(eq(cargoPieces.cargoRequestId, r.id)).orderBy(asc(cargoPieces.createdAt))
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    const [lane] = await this.db.select().from(cargoLanes).where(eq(cargoLanes.id, r.laneId))
    const shipper = r.shipper as Party
    const consignee = r.consignee as Party
    const addr = (p: Party) => [p.address.line1, p.address.line2, [p.address.postcode, p.address.city].filter(Boolean).join(" "), this.reference.countryName(p.address.country, "en")].filter(Boolean) as string[]
    const weights = cargoWeights(pieces, lane!.volumetricDivisor)
    const description = items.map((i) => `${i.quantity} x ${i.description}`).join(", ")
    const pdf = await renderCargoLabels({
      trackingNumber: r.trackingNumber, ref: r.ref, qrUrl: this.trackingUrl(r.trackingNumber, "en", true), service: r.service,
      sender: { name: shipper.name, company: shipper.company, phone: shipper.phone, lines: addr(shipper) },
      recipient: { name: consignee.name, company: consignee.company, phone: consignee.phone, lines: addr(consignee) },
      collection: r.handoverMode === "PICKUP" ? addr(shipper) : ["Drop-off at Uni Travel", "partner point"],
      description, handlingInstructions: r.handlingInstructions, readyDate: r.readyDate,
      pieces: pieces.map((p) => ({ lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm, weightKg: p.verifiedWeightKg ?? p.weightKg })), totalWeightKg: weights.actualKg, printedAt: new Date(),
    }, format)
    return this.uow.run(async (tx) => {
      const doc = await this.docs.storeGenerated(tx, { ownerUserId: r.customerUserId, requestType: "CARGO", requestId: r.id, type: "CARGO_LABEL", filename: `label-${r.trackingNumber}-${format}.pdf`, body: pdf, createdBy: actor.userId, visibility: "INTERNAL" })
      const voided = await tx.update(cargoLabels).set({ voidedAt: new Date() }).where(and(eq(cargoLabels.cargoRequestId, r.id), isNull(cargoLabels.voidedAt))).returning({ id: cargoLabels.id })
      const [label] = await tx.insert(cargoLabels).values({ cargoRequestId: r.id, documentId: doc.id, format, pieces: pieces.length, trackingNumber: r.trackingNumber!, createdBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.label_generated", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { labelId: label!.id, format, pieces: pieces.length, voided: voided.map((v) => v.id) } })
      return { id: label!.id, documentId: doc.id, format, pieces: pieces.length, url: (await this.docs.downloadUrl(doc)).url }
    })
  }

  // ---------------- edits, proofs ----------------

  async patchDetails(ref: string, body: z.infer<typeof CargoDetailsPatch>, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.cargo.byRef(ref, tx, true)
      if (TERMINAL.includes(r.status) || r.status === "DELIVERED") throw new AppError("INVALID_TRANSITION", "The request is closed")
      const merge = (orig: Party, patch?: { address?: Partial<Party["address"]>; phone?: string; email?: string }) => {
        if (!patch) return orig
        const next: Party = { ...orig, address: { ...orig.address, ...(patch.address ?? {}) } }
        if (patch.phone) next.phone = patch.phone
        if (patch.email !== undefined) { if (patch.email) next.email = patch.email; else delete next.email }
        return next
      }
      const shipper = merge(r.shipper as Party, body.shipper)
      const consignee = merge(r.consignee as Party, body.consignee)
      const readyDate = body.readyDate ?? r.readyDate
      const preferred = body.preferredDeliveryDate === undefined ? r.preferredDeliveryDate : body.preferredDeliveryDate
      if (preferred && preferred < readyDate) throw new AppError("VALIDATION_FAILED", "The preferred delivery date cannot be before the collection date", [{ path: "preferredDeliveryDate", code: "BEFORE_READY" }])
      const patch = { shipper, consignee, readyDate, preferredDeliveryDate: preferred, handlingInstructions: body.handlingInstructions === undefined ? r.handlingInstructions : body.handlingInstructions || null, version: r.version + 1 }
      await tx.update(cargoRequests).set(patch).where(eq(cargoRequests.id, r.id))
      await this.audit.record(tx, {
        actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.details_edited", entityType: "cargo_request", entityId: r.id, contextRef: r.ref,
        before: { shipper: r.shipper, consignee: r.consignee, readyDate: r.readyDate, preferredDeliveryDate: r.preferredDeliveryDate, handlingInstructions: r.handlingInstructions },
        after: { shipper, consignee, readyDate, preferredDeliveryDate: preferred, handlingInstructions: patch.handlingInstructions, reason: body.reason },
      })
      return { ok: true }
    })
  }

  /** Staff-recorded proof (e.g. a partner's POD photo). Files must belong to this request. */
  async addProof(ref: string, body: { kind: "COLLECTION" | "DELIVERY"; receiverName?: string; location: string; note?: string; signatureDocumentId?: string; photoDocumentIds: string[] }, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.cargo.byRef(ref, tx, true)
      await this.assertFiles(r.id, [body.signatureDocumentId, ...body.photoDocumentIds].filter(Boolean) as string[])
      const [p] = await tx.insert(cargoDeliveryProofs).values({ cargoRequestId: r.id, kind: body.kind, receiverName: body.receiverName ?? null, signatureDocumentId: body.signatureDocumentId ?? null, photoDocumentIds: body.photoDocumentIds, location: body.location, note: body.note ?? null, capturedBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.proof_added", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { proofId: p!.id, kind: body.kind, files: body.photoDocumentIds.length + (body.signatureDocumentId ? 1 : 0) } })
      return p
    })
  }

  async assertFiles(requestId: string, ids: string[]) {
    for (const id of ids) {
      const d = await this.docs.get(id)
      if (!d || d.requestType !== "CARGO" || d.requestId !== requestId) throw new AppError("VALIDATION_FAILED", "Attachment does not belong to this shipment", [{ path: "documentId", code: "NOT_FOUND" }])
    }
  }

  async staffImage(ref: string, body: { filename: string; data: string; purpose: "PHOTO" | "SIGNATURE" }, actor: Actor) {
    const r = await this.cargo.byRef(ref)
    const doc = await this.docs.storeImage({ ownerUserId: r.customerUserId, requestType: "CARGO", requestId: r.id, type: body.purpose === "SIGNATURE" ? "CARGO_SIGNATURE" : "CARGO_PHOTO", filename: body.filename, body: decodeImage(body.data), createdBy: actor.userId })
    return { documentId: doc.id, scanStatus: doc.scanStatus }
  }

  // ---------------- staff views ----------------

  /** Everything the operations panel adds to the request page: tracking number, milestone, jobs, labels, proof, notices. */
  async operations(ref: string) {
    const r = await this.cargo.byRef(ref)
    const milestone = await this.milestone(r)
    const jobs = await this.db.select({ a: cargoAgentAssignments, d: cargoAgents }).from(cargoAgentAssignments).innerJoin(cargoAgents, eq(cargoAgents.id, cargoAgentAssignments.agentId)).where(eq(cargoAgentAssignments.cargoRequestId, r.id)).orderBy(desc(cargoAgentAssignments.assignedAt))
    const labels = await this.db.select({ l: cargoLabels, by: users.displayName }).from(cargoLabels).leftJoin(users, eq(users.id, cargoLabels.createdBy)).where(eq(cargoLabels.cargoRequestId, r.id)).orderBy(desc(cargoLabels.createdAt))
    const proofs = await this.db.select({ p: cargoDeliveryProofs, by: users.displayName }).from(cargoDeliveryProofs).leftJoin(users, eq(users.id, cargoDeliveryProofs.capturedBy)).where(eq(cargoDeliveryProofs.cargoRequestId, r.id)).orderBy(desc(cargoDeliveryProofs.capturedAt))
    return {
      ref: r.ref, trackingNumber: r.trackingNumber, trackingUrl: r.trackingNumber ? this.trackingUrl(r.trackingNumber, "en") : null, labelUrl: r.trackingNumber ? this.trackingUrl(r.trackingNumber, "en", true) : null, trackingNumberIssuedAt: r.trackingNumberIssuedAt?.toISOString() ?? null,
      milestone, milestoneLabel: CARGO_MILESTONE_LABELS[milestone].en, preferredDeliveryDate: r.preferredDeliveryDate, handlingInstructions: r.handlingInstructions, handoverMode: r.handoverMode,
      shipper: r.shipper, consignee: r.consignee, readyDate: r.readyDate,
      assignments: jobs.map(({ a, d }) => ({ id: a.id, kind: a.kind, status: a.status, agentId: d.id, agentCode: d.agentCode, agentName: d.displayName, agentPublicName: publicAgentName(d), acceptedAt: a.acceptedAt?.toISOString() ?? null, declineReason: a.declineReason, scheduledFor: a.scheduledFor?.toISOString() ?? null, attempts: a.attempts, note: a.note, assignedAt: a.assignedAt.toISOString(), completedAt: a.completedAt?.toISOString() ?? null, cancelReason: a.cancelReason })),
      labels: labels.map(({ l, by }) => ({ id: l.id, documentId: l.documentId, format: l.format, pieces: l.pieces, createdAt: l.createdAt.toISOString(), createdBy: by ?? "—", voidedAt: l.voidedAt?.toISOString() ?? null })),
      proofs: proofs.map(({ p, by }) => ({ id: p.id, kind: p.kind, receiverName: p.receiverName, location: p.location, capturedAt: p.capturedAt.toISOString(), capturedBy: by ?? "—", note: p.note, signatureDocumentId: p.signatureDocumentId, photoDocumentIds: p.photoDocumentIds })),
      notifications: (await this.notificationHistory({ requestId: r.id, page: 1, pageSize: 50 })).items,
      failedAttempts: jobs.filter(({ a }) => a.kind === "DELIVERY").reduce((n, { a }) => n + a.attempts, 0),
    }
  }

  async list(q: z.infer<typeof CargoOpsQuery>) {
    const conds: SQL[] = [...this.tabCondition(q.tab)]
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, "")}%`
      const tn = parseTrackingNumber(q.q)
      conds.push(or(
        ilike(cargoRequests.ref, like), ilike(cargoRequests.trackingNumber, like), ...(tn ? [eq(cargoRequests.trackingNumber, tn)] : []),
        sql`${cargoRequests.shipper}->>'name' ILIKE ${like}`, sql`${cargoRequests.consignee}->>'name' ILIKE ${like}`,
        sql`${cargoRequests.consignee}->'address'->>'postcode' ILIKE ${like}`, sql`${cargoRequests.shipper}->'address'->>'postcode' ILIKE ${like}`,
        sql`${cargoRequests.consignee}->'address'->>'city' ILIKE ${like}`,
      )!)
    }
    const where = conds.length ? and(...conds) : undefined
    const order = { submitted_desc: [desc(cargoRequests.submittedAt)], submitted_asc: [asc(cargoRequests.submittedAt)], updated_desc: [desc(cargoRequests.updatedAt)], ready_asc: [asc(cargoRequests.readyDate), desc(cargoRequests.submittedAt)] }[q.sort]
    const [{ total } = { total: 0 }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(cargoRequests).where(where)
    const rows = await this.db.select({ r: cargoRequests, l: cargoLanes }).from(cargoRequests).innerJoin(cargoLanes, eq(cargoLanes.id, cargoRequests.laneId)).where(where).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize)
    const ids = rows.map(({ r }) => r.id)
    const events = ids.length ? await this.db.select().from(trackingEvents).where(inArray(trackingEvents.cargoRequestId, ids)) : []
    const jobs = ids.length ? await this.db.select({ a: cargoAgentAssignments, name: cargoAgents.displayName, code: cargoAgents.agentCode }).from(cargoAgentAssignments).innerJoin(cargoAgents, eq(cargoAgents.id, cargoAgentAssignments.agentId)).where(and(inArray(cargoAgentAssignments.cargoRequestId, ids), inArray(cargoAgentAssignments.status, ["ASSIGNED", "COMPLETED", "FAILED"]))) : []
    const pieces = ids.length ? await this.db.select().from(cargoPieces).where(inArray(cargoPieces.cargoRequestId, ids)) : []
    const items = rows.map(({ r, l }) => {
      const recs = events.filter((e) => e.cargoRequestId === r.id).map((t) => ({ id: t.id, eventCode: t.eventCode, location: t.location, occurredAt: t.occurredAt.toISOString(), description: t.description, correctsEventId: t.correctsEventId, createdAt: t.createdAt.toISOString() }))
      const milestone = this.cargo.milestoneOf(r, recs)
      const ps = pieces.filter((p) => p.cargoRequestId === r.id)
      const myJobs = jobs.filter((j) => j.a.cargoRequestId === r.id)
      return {
        ref: r.ref, trackingNumber: r.trackingNumber, status: r.status, milestone, milestoneLabel: CARGO_MILESTONE_LABELS[milestone].en, service: r.service, lane: this.cargo.laneLabel(l),
        shipperName: (r.shipper as Party).name, consigneeName: (r.consignee as Party).name, destinationCity: (r.consignee as Party).address?.city ?? "", readyDate: r.readyDate,
        submittedAt: r.submittedAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        agents: myJobs.filter((j) => j.a.status === "ASSIGNED" || j.a.status === "OFFERED").map((j) => ({ kind: j.a.kind, name: j.name, agentCode: j.code, offered: j.a.status === "OFFERED" })),
        failedAttempts: myJobs.filter((j) => j.a.kind === "DELIVERY").reduce((n, j) => n + j.a.attempts, 0),
        pieces: ps.length, weightKg: Math.round(ps.reduce((n, p) => n + (p.verifiedWeightKg ?? p.weightKg), 0) * 100) / 100,
      }
    })
    return { items, total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) }
  }

  private tabCondition(tab: string): SQL[] {
    if (tab === "assigned") return [sql`exists (select 1 from cargo_agent_assignments a where a.cargo_request_id = ${cargoRequests.id} and a.status in ('OFFERED', 'ASSIGNED'))`]
    // Failed: a failed delivery or collection attempt on a shipment that is still open, or an exception.
    if (tab === "failed") return [or(eq(cargoRequests.status, "EXCEPTION"), and(inArray(cargoRequests.status, ["BOOKED", "AWAITING_HANDOVER", "OUT_FOR_DELIVERY"]), sql`exists (select 1 from cargo_agent_assignments a where a.cargo_request_id = ${cargoRequests.id} and (a.status = 'FAILED' or a.attempts > 0))`))!]
    const statuses = OPS_TABS[tab]
    return statuses ? [inArray(cargoRequests.status, statuses)] : []
  }

  async stats() {
    const byStatus = await this.db.select({ s: cargoRequests.status, n: sql<number>`count(*)::int` }).from(cargoRequests).groupBy(cargoRequests.status)
    const count = (ss: CargoStatus[]) => byStatus.filter((x) => ss.includes(x.s)).reduce((n, x) => n + x.n, 0)
    const tabs: Record<string, number> = {}
    for (const t of Object.keys(OPS_TABS).concat(["assigned", "failed"])) {
      const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(cargoRequests).where(and(...this.tabCondition(t)))
      tabs[t] = n
    }
    return {
      total: byStatus.reduce((n, x) => n + x.n, 0), pending: count(OPS_TABS.pending!), pendingCollections: count(["ACCEPTED", "BOOKED", "AWAITING_HANDOVER"]),
      active: count(["RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "EXCEPTION"]), delivered: count(OPS_TABS.delivered!), failed: tabs.failed ?? 0, cancelled: count(OPS_TABS.cancelled!), tabs,
    }
  }

  /** The milestone notice log with each notice's email and SMS delivery state (brief section 8). */
  async notificationHistory(q: { requestId?: string; q?: string; page: number; pageSize: number }) {
    const conds: SQL[] = []
    if (q.requestId) conds.push(eq(cargoNotifications.cargoRequestId, q.requestId))
    if (q.q) conds.push(or(ilike(cargoRequests.ref, `%${q.q}%`), ilike(cargoRequests.trackingNumber, `%${q.q}%`))!)
    const where = conds.length ? and(...conds) : undefined
    const [{ total } = { total: 0 }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(cargoNotifications).innerJoin(cargoRequests, eq(cargoRequests.id, cargoNotifications.cargoRequestId)).where(where)
    const rows = await this.db.select({ c: cargoNotifications, r: cargoRequests, name: users.displayName }).from(cargoNotifications).innerJoin(cargoRequests, eq(cargoRequests.id, cargoNotifications.cargoRequestId)).leftJoin(users, eq(users.id, cargoRequests.customerUserId))
      .where(where).orderBy(desc(cargoNotifications.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)
    const evIds = rows.map(({ c }) => eventUuid(`cargo-notice:${c.id}`))
    const ns = evIds.length ? await this.db.select({ id: notifications.id, eventId: notifications.eventId }).from(notifications).where(inArray(notifications.eventId, evIds)) : []
    const ds = ns.length ? await this.db.select().from(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, ns.map((x) => x.id))) : []
    const items = rows.map(({ c, r, name }) => {
      const nid = ns.find((x) => x.eventId === eventUuid(`cargo-notice:${c.id}`))?.id
      const email = ds.find((d) => d.notificationId === nid && d.channel === "EMAIL")
      const sms = ds.find((d) => d.notificationId === nid && d.channel === "SMS")
      const ex = c.audience === "RECIPIENT"
        ? { status: c.deliveryStatus ?? "QUEUED", destination: c.recipientEmail, sentAt: c.deliveryStatus === "SENT" ? c.createdAt : null, error: c.deliveryError }
        : email
      return {
        id: c.id, ref: r.ref, trackingNumber: r.trackingNumber, key: c.key, audience: c.audience, milestone: c.milestone, eventType: c.eventType, createdAt: c.createdAt.toISOString(), customerName: name ?? "—",
        inbox: c.audience === "CUSTOMER" && !!nid,
        email: ex ? { status: ex.status, destination: maskEmail(ex.destination ?? null), sentAt: ex.sentAt?.toISOString() ?? null, error: ex.error ?? null } : null,
        sms: sms?.status ?? null,
      }
    })
    return { items, total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) }
  }
}

/** Public view shows "J. S." for "John Smith" (ADR-0042 D4). */
export function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((w) => `${w[0]!.toUpperCase()}.`).join(" ")
}

const maskEmail = (e: string | null) => (e?.includes("•") ? e : e ? e.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"•".repeat(Math.min(6, b.length))}${c}`) : null)

/** `data:image/...;base64,` or bare base64; capped well under the 1 MB JSON limit. */
export function decodeImage(data: string): Buffer {
  const b64 = data.replace(/^data:image\/(png|jpeg);base64,/, "")
  if (b64.length > 950_000 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new AppError("VALIDATION_FAILED", "The image is too large or not base64 (resize to under 700 KB)", [{ path: "data", code: "INVALID" }])
  return Buffer.from(b64, "base64")
}

export type { TrackingEventCode }
