import { createHash } from "node:crypto"

import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm"

import type { ConsignmentBody, CustomerRateBody, CustomsReviewBody } from "@unitravel/contracts"
import { cargoConsignments, cargoCustomerRates, cargoCustomsReviews, cargoItems, cargoLanes, cargoPieces, cargoRequests, type Db, partners, quotes, trackingEvents, type Tx, users } from "@unitravel/db"
import { formatTrackingNumber } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { DocumentsService } from "../documents/documents.service"
import { renderPdf, type PdfSection } from "../documents/pdf"
import { ReferenceService } from "../reference/reference.service"

type Party = { name: string; company?: string; phone: string; email?: string; address: { line1: string; line2?: string; city: string; postcode?: string; country: string } }
type Consignment = typeof cargoConsignments.$inferSelect

/** Consignments are booked once the customer has accepted (or staff recorded acceptance); returns also after delivery. */
const BOOKABLE = ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "EXCEPTION"]
const RETURNABLE = [...BOOKABLE, "DELIVERED", "COMPLETED"]
const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`

/** ADR-0047: manual-courier consignments, customs review, customer rates and the shipping dashboard. */
@Injectable()
export class ShippingService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService, private readonly docs: DocumentsService, private readonly reference: ReferenceService) {}

  private async request(ref: string, tx: Db | Tx = this.db) {
    const [r] = await tx.select().from(cargoRequests).where(eq(cargoRequests.ref, ref))
    if (!r) throw notFound("Cargo request")
    return r
  }

  private async international(laneId: string, tx: Db | Tx = this.db) {
    const [l] = await tx.select().from(cargoLanes).where(eq(cargoLanes.id, laneId))
    return !!l && l.originCountry !== l.destinationCountry
  }

  private view(c: Consignment, partnerName: string | null) {
    return {
      id: c.id, shipmentNo: c.shipmentNo, direction: c.direction, partnerId: c.partnerId, courier: partnerName ?? "-", serviceLevel: c.serviceLevel, tracked: c.tracked, signedFor: c.signedFor,
      courierTrackingNumber: c.courierTrackingNumber, courierTrackingUrl: c.courierTrackingUrl, shipDate: c.shipDate, estimatedDelivery: c.estimatedDelivery,
      cost: c.costMinor != null && c.costCurrency ? { amountMinor: c.costMinor, currency: c.costCurrency } : null, labelDocumentId: c.labelDocumentId,
      status: c.status, cancelReason: c.cancelReason, note: c.note, dispatchedAt: c.dispatchedAt?.toISOString() ?? null, version: c.version, createdAt: c.createdAt.toISOString(),
    }
  }

  // ---------------- consignments (D2) ----------------

  async list(ref: string) {
    const r = await this.request(ref)
    const rows = await this.db.select({ c: cargoConsignments, p: partners.name }).from(cargoConsignments).leftJoin(partners, eq(partners.id, cargoConsignments.partnerId))
      .where(eq(cargoConsignments.cargoRequestId, r.id)).orderBy(asc(cargoConsignments.createdAt))
    const lanePartners = await this.db.select().from(partners).where(and(eq(partners.active, true), eq(partners.complianceStatus, "CLEARED")))
    return {
      consignments: rows.map(({ c, p }) => this.view(c, p)),
      // Rule 5: only active, compliance-cleared couriers; outbound ones must serve the lane and service.
      couriers: lanePartners.map((p) => ({ id: p.id, name: p.name, type: p.type, servesLane: p.laneIds.includes(r.laneId) && p.services.includes(r.service) })),
      international: await this.international(r.laneId),
      customs: await this.customsState(r.id),
    }
  }

  private async courierAllowed(tx: Tx, partnerId: string, r: typeof cargoRequests.$inferSelect, direction: "OUTBOUND" | "RETURN") {
    const [p] = await tx.select().from(partners).where(eq(partners.id, partnerId))
    if (!p || !p.active) throw new AppError("VALIDATION_FAILED", "Choose an active courier")
    if (p.complianceStatus !== "CLEARED") throw new AppError("VALIDATION_FAILED", `This courier's compliance status is ${p.complianceStatus}`)
    if (direction === "OUTBOUND" && !(p.laneIds.includes(r.laneId) && p.services.includes(r.service))) throw new AppError("VALIDATION_FAILED", "This courier does not serve this route and service")
    return p
  }

  async create(ref: string, body: ConsignmentBody, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.request(ref, tx)
      if (!(body.direction === "RETURN" ? RETURNABLE : BOOKABLE).includes(r.status)) throw new AppError("INVALID_TRANSITION", `A ${body.direction === "RETURN" ? "return" : "consignment"} cannot be booked while the request is ${r.status}`)
      await this.courierAllowed(tx, body.partnerId, r, body.direction)
      if ((body.costMinor != null) !== !!body.costCurrency) throw new AppError("VALIDATION_FAILED", "Give the courier cost with its currency")
      const [c] = await tx.insert(cargoConsignments).values({
        cargoRequestId: r.id, direction: body.direction, partnerId: body.partnerId, serviceLevel: body.serviceLevel, tracked: body.tracked, signedFor: body.signedFor,
        courierTrackingNumber: body.courierTrackingNumber ?? null, courierTrackingUrl: body.courierTrackingUrl ?? null, shipDate: body.shipDate ?? null, estimatedDelivery: body.estimatedDelivery ?? null,
        costMinor: body.costMinor ?? null, costCurrency: body.costCurrency ?? null, note: body.note ?? null, createdBy: actor.userId,
      }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_consignment.booked", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { ...c!, note: undefined } })
      return this.view(c!, null)
    })
  }

  private async lockOwn(tx: Tx, ref: string, id: string) {
    const r = await this.request(ref, tx)
    const [c] = await tx.select().from(cargoConsignments).where(and(eq(cargoConsignments.id, id), eq(cargoConsignments.cargoRequestId, r.id))).for("update")
    if (!c) throw notFound("Consignment")
    return { r, c }
  }

  async update(ref: string, id: string, body: ConsignmentBody, version: number | undefined, actor: Actor) {
    return this.uow.run(async (tx) => {
      const { r, c } = await this.lockOwn(tx, ref, id)
      if (version !== undefined && version !== c.version) throw new AppError("VERSION_CONFLICT", "Someone changed this consignment; reload it")
      if (c.status === "CANCELLED") throw new AppError("INVALID_TRANSITION", "The consignment is cancelled")
      if (body.partnerId !== c.partnerId) await this.courierAllowed(tx, body.partnerId, r, body.direction)
      const [after] = await tx.update(cargoConsignments).set({
        direction: body.direction, partnerId: body.partnerId, serviceLevel: body.serviceLevel, tracked: body.tracked, signedFor: body.signedFor,
        courierTrackingNumber: body.courierTrackingNumber ?? null, courierTrackingUrl: body.courierTrackingUrl ?? null, shipDate: body.shipDate ?? null, estimatedDelivery: body.estimatedDelivery ?? null,
        costMinor: body.costMinor ?? null, costCurrency: body.costCurrency ?? null, note: body.note ?? null, version: c.version + 1, updatedAt: new Date(),
      }).where(eq(cargoConsignments.id, c.id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_consignment.updated", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, before: c, after })
      return this.view(after!, null)
    })
  }

  /** D4: an international consignment leaves only with an approved customs review that still matches the items. */
  async dispatch(ref: string, id: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const { r, c } = await this.lockOwn(tx, ref, id)
      if (c.status !== "BOOKED") throw new AppError("INVALID_TRANSITION", `The consignment is ${c.status}`)
      if (c.direction === "OUTBOUND" && (await this.international(r.laneId, tx))) {
        const s = await this.customsState(r.id, tx)
        if (!s.approved) throw new AppError("VALIDATION_FAILED", s.stale ? "The declared items changed after the customs approval: review and approve again" : "Approve the customs review before dispatch")
      }
      const [after] = await tx.update(cargoConsignments).set({ status: "DISPATCHED", dispatchedAt: new Date(), shipDate: c.shipDate ?? new Date().toISOString().slice(0, 10), version: c.version + 1, updatedAt: new Date() }).where(eq(cargoConsignments.id, c.id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_consignment.dispatched", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { id: c.id, shipmentNo: c.shipmentNo } })
      return this.view(after!, null)
    })
  }

  async cancel(ref: string, id: string, reason: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const { r, c } = await this.lockOwn(tx, ref, id)
      if (c.status === "CANCELLED") throw new AppError("INVALID_TRANSITION", "Already cancelled")
      const [after] = await tx.update(cargoConsignments).set({ status: "CANCELLED", cancelReason: reason, version: c.version + 1, updatedAt: new Date() }).where(eq(cargoConsignments.id, c.id)).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_consignment.cancelled", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { id: c.id, shipmentNo: c.shipmentNo, reason } })
      return this.view(after!, null)
    })
  }

  async uploadLabel(ref: string, id: string, body: { filename: string; data: string }, actor: Actor) {
    const r = await this.request(ref)
    const raw = body.data.replace(/^data:[^,]*,/, "")
    const doc = await this.docs.storePdf({ ownerUserId: r.customerUserId, requestType: "CARGO", requestId: r.id, type: "COURIER_LABEL", filename: body.filename, body: Buffer.from(raw, "base64"), createdBy: actor.userId })
    return this.uow.run(async (tx) => {
      const { c } = await this.lockOwn(tx, ref, id)
      await tx.update(cargoConsignments).set({ labelDocumentId: doc.id, version: c.version + 1, updatedAt: new Date() }).where(eq(cargoConsignments.id, c.id))
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_consignment.label_uploaded", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { id: c.id, documentId: doc.id } })
      return { documentId: doc.id }
    })
  }

  /** D6: what the customer may see: dispatched consignments, courier and service, never the cost. */
  async customerCouriers(requestIds: string[]) {
    if (!requestIds.length) return new Map<string, { shipmentNo: string; direction: "OUTBOUND" | "RETURN"; courier: string; serviceLevel: string; trackingNumber: string | null; trackingUrl: string | null; shipDate: string | null; estimatedDelivery: string | null }[]>()
    const rows = await this.db.select({ c: cargoConsignments, p: partners.name }).from(cargoConsignments).leftJoin(partners, eq(partners.id, cargoConsignments.partnerId))
      .where(and(inArray(cargoConsignments.cargoRequestId, requestIds), eq(cargoConsignments.status, "DISPATCHED"))).orderBy(asc(cargoConsignments.dispatchedAt))
    const out = new Map<string, { shipmentNo: string; direction: "OUTBOUND" | "RETURN"; courier: string; serviceLevel: string; trackingNumber: string | null; trackingUrl: string | null; shipDate: string | null; estimatedDelivery: string | null }[]>()
    for (const { c, p } of rows) {
      const list = out.get(c.cargoRequestId) ?? []
      list.push({ shipmentNo: c.shipmentNo, direction: c.direction, courier: p ?? "Courier", serviceLevel: c.serviceLevel, trackingNumber: c.courierTrackingNumber, trackingUrl: c.courierTrackingUrl, shipDate: c.shipDate, estimatedDelivery: c.estimatedDelivery })
      out.set(c.cargoRequestId, list)
    }
    return out
  }

  // ---------------- customs review (D4) ----------------

  private async itemsHash(requestId: string, tx: Db | Tx = this.db) {
    const items = await tx.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, requestId)).orderBy(asc(cargoItems.id))
    return createHash("sha256").update(JSON.stringify(items.map((i) => [i.description, i.quantity, i.unitValueMinor, i.currency, i.hsCode, i.originCountry, i.purpose]))).digest("hex")
  }

  private async customsState(requestId: string, tx: Db | Tx = this.db) {
    const [rv] = await tx.select({ rv: cargoCustomsReviews, by: users.displayName }).from(cargoCustomsReviews).leftJoin(users, eq(users.id, cargoCustomsReviews.approvedBy)).where(eq(cargoCustomsReviews.cargoRequestId, requestId))
    if (!rv) return { review: null, approved: false, stale: false }
    const stale = !!rv.rv.approvedAt && rv.rv.itemsHash !== (await this.itemsHash(requestId, tx))
    return {
      review: { exportReason: rv.rv.exportReason, incoterm: rv.rv.incoterm, dutiesPayer: rv.rv.dutiesPayer, invoiceNumber: rv.rv.invoiceNumber, notes: rv.rv.notes, approvedAt: rv.rv.approvedAt?.toISOString() ?? null, approvedBy: rv.by },
      approved: !!rv.rv.approvedAt && !stale, stale,
    }
  }

  async saveCustoms(ref: string, body: CustomsReviewBody, actor: Actor) {
    return this.uow.run(async (tx) => {
      const r = await this.request(ref, tx)
      const items = await tx.select({ id: cargoItems.id }).from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
      if (body.approve && !items.length) throw new AppError("VALIDATION_FAILED", "There are no declared items to approve")
      const values = {
        exportReason: body.exportReason, incoterm: body.incoterm, dutiesPayer: body.dutiesPayer, invoiceNumber: body.invoiceNumber ?? null, notes: body.notes ?? null, updatedBy: actor.userId, updatedAt: new Date(),
        ...(body.approve ? { approvedBy: actor.userId, approvedAt: new Date(), itemsHash: await this.itemsHash(r.id, tx) } : { approvedBy: null, approvedAt: null, itemsHash: null }),
      }
      await tx.insert(cargoCustomsReviews).values({ cargoRequestId: r.id, ...values }).onConflictDoUpdate({ target: cargoCustomsReviews.cargoRequestId, set: values })
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: body.approve ? "cargo_request.customs_approved" : "cargo_request.customs_reviewed", entityType: "cargo_request", entityId: r.id, contextRef: r.ref, after: { ...values, updatedAt: undefined } })
      return this.customsState(r.id, tx)
    })
  }

  /** D4: commercial or pro-forma invoice from the declared items (booklet 14.9: the sender signs; ours is the template). */
  async invoicePdf(ref: string, kind: "commercial" | "proforma", actor: Actor) {
    const r = await this.request(ref)
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    if (!items.length) throw new AppError("VALIDATION_FAILED", "The request has no declared items")
    const pieces = await this.db.select().from(cargoPieces).where(eq(cargoPieces.cargoRequestId, r.id))
    const { review } = await this.customsState(r.id)
    const s = r.shipper as Party
    const c = r.consignee as Party
    const addr = (p: Party) => [p.address.line1, p.address.line2, [p.address.postcode, p.address.city].filter(Boolean).join(" "), this.reference.countryName(p.address.country, "en")].filter(Boolean).join(", ")
    const party = (p: Party): [string, string][] => [["Name", p.company ? `${p.name}, ${p.company}` : p.name], ["Address", addr(p)], ["Phone", p.phone], ...(p.email ? [["Email", p.email] as [string, string]] : [])]
    const currencies = [...new Set(items.map((i) => i.currency))]
    const total = items.reduce((n, i) => n + i.unitValueMinor * i.quantity, 0)
    const weight = Math.round(pieces.reduce((n, p) => n + (p.verifiedWeightKg ?? p.weightKg), 0) * 100) / 100
    const title = kind === "commercial" ? "Commercial invoice" : "Pro forma invoice"
    const sections: PdfSection[] = [
      { rows: [["Invoice no.", review?.invoiceNumber ?? r.ref], ["Date", new Date().toISOString().slice(0, 10)], ["Shipment", `${r.ref}${r.trackingNumber ? ` · ${formatTrackingNumber(r.trackingNumber)}` : ""}`], ["Reason for export", review?.exportReason?.replace(/_/g, " ").toLowerCase() ?? "-"], ["Incoterm", review?.incoterm ?? "DAP"], ["Duties and taxes paid by", review?.dutiesPayer === "SENDER" ? "Sender" : "Receiver"]] },
      { heading: "Exporter (sender)", rows: party(s) },
      { heading: "Consignee (receiver)", rows: party(c) },
      {
        heading: "Goods",
        table: {
          columns: [{ label: "Description", x: 0 }, { label: "HS code", x: 200 }, { label: "Origin", x: 265 }, { label: "Qty", x: 330, right: true }, { label: "Unit value", x: 410, right: true }, { label: "Total", x: 495, right: true }],
          rows: items.map((i) => [i.description.slice(0, 40), i.hsCode ?? "", i.originCountry, String(i.quantity), money(i.unitValueMinor, i.currency), money(i.unitValueMinor * i.quantity, i.currency)]),
        },
      },
      { rows: [["Total value", currencies.length === 1 ? money(total, currencies[0]!) : `${(total / 100).toFixed(2)} (${currencies.join("/")})`], ["Packages", String(pieces.length)], ["Total gross weight", `${weight} kg`]] },
      { heading: "Declaration", paragraphs: [kind === "commercial" ? "I declare that the information on this invoice is true and correct and that the contents of this shipment are as stated above." : "Pro forma invoice: no sale has taken place; values are for customs purposes only."], rows: [["Name, date and signature of exporter", "________________________________"]] },
    ]
    const pdf = await renderPdf(title, `${r.ref}`, sections, ["Prepared from the sender's declaration. The exporter is responsible for its accuracy (booklet 14.9)."], { kind: kind === "commercial" ? "INVOICE" : "PRO FORMA" })
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: `cargo_request.${kind}_invoice_generated`, entityType: "cargo_request", entityId: r.id, contextRef: r.ref }))
    return { pdf, filename: `${kind}-invoice-${r.ref}.pdf` }
  }

  // ---------------- customer rates (D3) ----------------

  async customerRates(customerUserId?: string) {
    const rows = await this.db.select({ c: cargoCustomerRates, name: users.displayName }).from(cargoCustomerRates).innerJoin(users, eq(users.id, cargoCustomerRates.customerUserId))
      .where(customerUserId ? eq(cargoCustomerRates.customerUserId, customerUserId) : undefined).orderBy(desc(cargoCustomerRates.updatedAt)).limit(200)
    return rows.map(({ c, name }) => ({ id: c.id, customerUserId: c.customerUserId, customerName: name, laneId: c.laneId, service: c.service, discountPct: c.discountPct, markupPct: c.markupPct, note: c.note, updatedAt: c.updatedAt.toISOString() }))
  }

  async saveCustomerRate(body: CustomerRateBody, actor: Actor) {
    return this.uow.run(async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, body.customerUserId))
      if (!u) throw notFound("Customer")
      const [row] = await tx.insert(cargoCustomerRates).values({ customerUserId: body.customerUserId, laneId: body.laneId ?? null, service: body.service ?? null, discountPct: body.discountPct, markupPct: body.markupPct ?? null, note: body.note ?? null, updatedBy: actor.userId }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_customer_rate.created", entityType: "user", entityId: body.customerUserId, after: row })
      return { id: row!.id }
    })
  }

  async deleteCustomerRate(id: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const [row] = await tx.delete(cargoCustomerRates).where(eq(cargoCustomerRates.id, id)).returning()
      if (!row) throw notFound("Customer rate")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_customer_rate.deleted", entityType: "user", entityId: row.customerUserId, before: row })
      return { ok: true }
    })
  }

  // ---------------- dashboard (D5) ----------------

  async dashboard(from?: string, to?: string) {
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date()
    const start = from ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 29 * 86_400_000)
    const now = new Date()
    const live = ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "EXCEPTION"] as const
    const reqs = await this.db.select({ id: cargoRequests.id, status: cargoRequests.status, exceptionReason: cargoRequests.exceptionReason, eta: cargoRequests.estimatedDeliveryAt, updatedAt: cargoRequests.updatedAt, createdAt: cargoRequests.createdAt })
      .from(cargoRequests).where(and(inArray(cargoRequests.status, [...live]), gte(cargoRequests.createdAt, start), lte(cargoRequests.createdAt, end)))
    const ids = reqs.map((r) => r.id)
    const cons = ids.length ? await this.db.select().from(cargoConsignments).where(and(inArray(cargoConsignments.cargoRequestId, ids), ne(cargoConsignments.status, "CANCELLED"))) : []
    const dispatched = new Set(cons.filter((c) => c.status === "DISPATCHED" && c.direction === "OUTBOUND").map((c) => c.cargoRequestId))
    const failed = ids.length ? await this.db.select({ id: trackingEvents.cargoRequestId }).from(trackingEvents).where(and(inArray(trackingEvents.cargoRequestId, ids), eq(trackingEvents.eventCode, "DELIVERY_FAILED"))) : []
    const customsReviews = ids.length ? await this.db.select().from(cargoCustomsReviews).where(and(inArray(cargoCustomsReviews.cargoRequestId, ids), isNotNull(cargoCustomsReviews.approvedAt))) : []
    const approved = new Set(customsReviews.map((x) => x.cargoRequestId))
    const delivered = (s: string) => s === "DELIVERED" || s === "COMPLETED"
    const counts = {
      total: reqs.length,
      awaitingDispatch: reqs.filter((r) => ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED"].includes(r.status) && !dispatched.has(r.id)).length,
      inTransit: reqs.filter((r) => ["IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY"].includes(r.status)).length,
      delivered: reqs.filter((r) => delivered(r.status)).length,
      delayed: reqs.filter((r) => r.eta && r.eta < now && !delivered(r.status)).length,
      customsIssues: reqs.filter((r) => (r.status === "AT_CUSTOMS" && now.getTime() - r.updatedAt.getTime() > 48 * 3_600_000) || (r.status === "EXCEPTION" && r.exceptionReason === "HELD")).length,
      customsAwaitingApproval: reqs.filter((r) => ["ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED"].includes(r.status) && !approved.has(r.id)).length,
      failedDeliveries: new Set(failed.map((f) => f.id)).size,
      returned: reqs.filter((r) => r.exceptionReason === "RETURNED").length + cons.filter((c) => c.direction === "RETURN").length,
      exceptions: reqs.filter((r) => r.status === "EXCEPTION").length,
    }
    // Revenue: accepted cargo quotes; cost: consignment costs, else the quote's partner cost (staff-only figures).
    const qs = ids.length ? await this.db.select({ requestId: quotes.requestId, lines: quotes.cargoLines, partnerCostMinor: quotes.partnerCostMinor, acceptedAt: quotes.acceptedAt }).from(quotes).where(and(eq(quotes.requestType, "CARGO"), inArray(quotes.requestId, ids), eq(quotes.status, "ACCEPTED"))) : []
    const byCur = new Map<string, { revenueMinor: number; costMinor: number }>()
    const add = (cur: string, k: "revenueMinor" | "costMinor", v: number) => { const x = byCur.get(cur) ?? { revenueMinor: 0, costMinor: 0 }; x[k] += v; byCur.set(cur, x) }
    const costed = new Set<string>()
    for (const c of cons) if (c.costMinor != null && c.costCurrency) { add(c.costCurrency, "costMinor", c.costMinor); costed.add(c.cargoRequestId) }
    for (const q of qs) {
      const total = (q.lines as { total?: { amountMinor: number; currency: string } } | null)?.total
      if (!total) continue
      add(total.currency, "revenueMinor", total.amountMinor)
      if (!costed.has(q.requestId) && q.partnerCostMinor != null) add(total.currency, "costMinor", Number(q.partnerCostMinor))
    }
    const money = [...byCur.entries()].map(([currency, v]) => ({ currency, revenueMinor: v.revenueMinor, costMinor: v.costMinor, profitMinor: v.revenueMinor - v.costMinor }))
    // Daily series: requests created and consignments dispatched.
    const days = new Map<string, { created: number; dispatched: number; delivered: number }>()
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) days.set(new Date(t).toISOString().slice(0, 10), { created: 0, dispatched: 0, delivered: 0 })
    for (const r of reqs) { const d = days.get(r.createdAt.toISOString().slice(0, 10)); if (d) d.created++ }
    for (const c of cons) if (c.dispatchedAt) { const d = days.get(c.dispatchedAt.toISOString().slice(0, 10)); if (d) d.dispatched++ }
    const deliveredEv = ids.length ? await this.db.select({ at: trackingEvents.occurredAt }).from(trackingEvents).where(and(inArray(trackingEvents.cargoRequestId, ids), eq(trackingEvents.eventCode, "DELIVERED"), gte(trackingEvents.occurredAt, start), lt(trackingEvents.occurredAt, end))) : []
    for (const e of deliveredEv) { const d = days.get(e.at.toISOString().slice(0, 10)); if (d) d.delivered++ }
    const byCourier = new Map<string, number>()
    if (cons.length) {
      const names = new Map((await this.db.select({ id: partners.id, name: partners.name }).from(partners)).map((p) => [p.id, p.name]))
      for (const c of cons) byCourier.set(names.get(c.partnerId) ?? "-", (byCourier.get(names.get(c.partnerId) ?? "-") ?? 0) + 1)
    }
    return {
      from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), counts, money,
      series: [...days.entries()].map(([date, v]) => ({ date, ...v })),
      couriers: [...byCourier.entries()].map(([name, n]) => ({ name, consignments: n })).sort((a, b) => b.consignments - a.consignments),
      openConsignments: (await this.db.select({ c: cargoConsignments, ref: cargoRequests.ref, p: partners.name }).from(cargoConsignments).innerJoin(cargoRequests, eq(cargoRequests.id, cargoConsignments.cargoRequestId)).leftJoin(partners, eq(partners.id, cargoConsignments.partnerId))
        .where(eq(cargoConsignments.status, "BOOKED")).orderBy(asc(sql`coalesce(${cargoConsignments.shipDate}, ${cargoConsignments.createdAt}::date)`)).limit(50))
        .map(({ c, ref, p }) => ({ ref, shipmentNo: c.shipmentNo, courier: p ?? "-", serviceLevel: c.serviceLevel, shipDate: c.shipDate, direction: c.direction })),
    }
  }
}
