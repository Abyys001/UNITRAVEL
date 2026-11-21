import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm"

import type { CalculateBody, RateCardBody } from "@unitravel/contracts"
import { cargoAgentAssignments, cargoAgents, cargoCustomerRates, cargoItems, cargoLanes, cargoPieces, cargoRateCards, cargoRequests, type Db, users } from "@unitravel/db"
import { cargoWeights, formatTrackingNumber } from "@unitravel/domain"

import { AppError, notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB, UnitOfWork } from "../../core/infra.module"
import { AuditService } from "../audit/audit.service"
import { renderPdf, type PdfSection } from "../documents/pdf"
import { ReferenceService } from "../reference/reference.service"

type Party = { name: string; company?: string; phone: string; email?: string; address: { line1: string; line2?: string; city: string; postcode?: string; country: string } }

/** CN22 covers low-value items (UPU: up to SDR 300, about £270); anything above, or another currency, gets a CN23. */
const CN22_LIMIT_GBP_MINOR = 27_000
const CN22_MAX_KG = 2
const CUSTOMS_CATEGORY: Record<string, string> = { GIFT: "Gift", DOCUMENTS: "Documents", SALE: "Sale of goods", SAMPLE: "Commercial sample", RETURN: "Returned goods", PERSONAL_EFFECTS: "Other: personal effects" }

const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`
const kg = (n: number) => `${Math.round(n * 100) / 100} kg`

/** ADR-0046: run sheets, rate cards, the postage calculator and customs declarations. */
@Injectable()
export class PostageService {
  constructor(@Inject(DB) private readonly db: Db, private readonly uow: UnitOfWork, private readonly audit: AuditService, private readonly reference: ReferenceService) {}

  private address(p: Party) {
    return [p.address.line1, p.address.line2, [p.address.postcode, p.address.city].filter(Boolean).join(" "), this.reference.countryName(p.address.country, "en")].filter(Boolean).join(", ")
  }

  // ---------------- run sheet (D3) ----------------

  /** London calendar day → [start, end) instants. */
  private day(date?: string) {
    const d = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())
    const probe = new Date(`${d}T12:00:00Z`)
    const offset = new Date(probe.toLocaleString("en-US", { timeZone: "Europe/London" })).getTime() - new Date(probe.toLocaleString("en-US", { timeZone: "UTC" })).getTime()
    const start = new Date(new Date(`${d}T00:00:00Z`).getTime() - offset)
    return { date: d, start, end: new Date(start.getTime() + 86_400_000) }
  }

  async manifestFor(agentId: string, date?: string) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.id, agentId))
    if (!a) throw notFound("Agent")
    const { date: d, start, end } = this.day(date)
    const rows = await this.db.select({ j: cargoAgentAssignments, r: cargoRequests }).from(cargoAgentAssignments).innerJoin(cargoRequests, eq(cargoRequests.id, cargoAgentAssignments.cargoRequestId))
      .where(and(eq(cargoAgentAssignments.agentId, a.id), inArray(cargoAgentAssignments.status, ["OFFERED", "ASSIGNED"]),
        or(and(gte(cargoAgentAssignments.scheduledFor, start), lt(cargoAgentAssignments.scheduledFor, end)), isNull(cargoAgentAssignments.scheduledFor), lt(cargoAgentAssignments.scheduledFor, start))))
      .orderBy(asc(cargoAgentAssignments.scheduledFor), asc(cargoAgentAssignments.assignedAt))
    const stops = []
    for (const { j, r } of rows) {
      const pieces = await this.db.select().from(cargoPieces).where(eq(cargoPieces.cargoRequestId, r.id))
      const s = r.shipper as Party
      const c = r.consignee as Party
      const accepted = j.status !== "OFFERED"
      // Collection: the shipper (or the drop-off point); delivery and handling: the consignee. Contacts only once accepted (ADR-0043 D4).
      const p = j.kind === "COLLECTION" ? (r.handoverMode === "PICKUP" ? s : null) : c
      stops.push({
        assignmentId: j.id, kind: j.kind, status: j.status, ref: r.ref, trackingNumber: r.trackingNumber,
        scheduledFor: j.scheduledFor?.toISOString() ?? null, overdue: !!j.scheduledFor && j.scheduledFor < start,
        name: p ? (accepted ? p.name : p.name.split(/\s+/)[0]!) : "Uni Travel drop-off point", company: p?.company ?? null,
        phone: p && accepted ? p.phone : null, address: p ? (accepted ? this.address(p) : `${p.address.city}, ${this.reference.countryName(p.address.country, "en")}`) : "Customer drops off at the partner point",
        mapQuery: p && accepted ? this.address(p) : null,
        pieces: pieces.length, weightKg: Math.round(pieces.reduce((n, x) => n + (x.verifiedWeightKg ?? x.weightKg), 0) * 100) / 100,
        handlingInstructions: r.handlingInstructions, attempts: j.attempts,
      })
    }
    return { agent: { id: a.id, agentCode: a.agentCode, displayName: a.displayName, vehicle: a.vehicle }, date: d, stops, totals: { stops: stops.length, pieces: stops.reduce((n, x) => n + x.pieces, 0), weightKg: Math.round(stops.reduce((n, x) => n + x.weightKg, 0) * 100) / 100 } }
  }

  async myManifest(actor: Actor, date?: string) {
    const [a] = await this.db.select().from(cargoAgents).where(eq(cargoAgents.userId, actor.userId))
    if (!a?.active) throw notFound("Agent profile")
    return this.manifestFor(a.id, date)
  }

  async manifestPdf(m: Awaited<ReturnType<PostageService["manifestFor"]>>) {
    const kind = { COLLECTION: "Collect", HANDLING: "Handle", DELIVERY: "Deliver" } as const
    const sections: PdfSection[] = [
      { rows: [["Agent", `${m.agent.displayName} (${m.agent.agentCode})`], ["Vehicle", m.agent.vehicle ?? "-"], ["Date", m.date], ["Stops", `${m.totals.stops} · ${m.totals.pieces} pieces · ${kg(m.totals.weightKg)}`]] },
      {
        heading: "Stops",
        table: {
          columns: [{ label: "#", x: 0 }, { label: "Job", x: 18 }, { label: "Shipment", x: 62 }, { label: "Name / address / phone", x: 160 }, { label: "Pcs", x: 395, right: true }, { label: "Weight", x: 440, right: true }, { label: "Done", x: 495 }],
          rows: m.stops.map((x, i) => [String(i + 1), kind[x.kind as keyof typeof kind] ?? x.kind, `${x.trackingNumber ? formatTrackingNumber(x.trackingNumber) : x.ref}${x.scheduledFor ? ` ${x.scheduledFor.slice(11, 16)}` : ""}${x.overdue ? " LATE" : ""}`, [x.name, x.address, x.phone].filter(Boolean).join(" · ").slice(0, 120), String(x.pieces), kg(x.weightKg), "[  ]"]),
        },
      },
      ...m.stops.filter((x) => x.handlingInstructions).map((x) => ({ heading: `Handling: ${x.trackingNumber ? formatTrackingNumber(x.trackingNumber) : x.ref}`, paragraphs: [x.handlingInstructions!] })),
      { heading: "Handover", rows: [["Loaded by (name, signature)", "______________________________"], ["Agent signature", "______________________________"], ["Time out / back", "________ / ________"]] },
    ]
    return renderPdf("Run sheet", `${m.agent.displayName} · ${m.date}`, sections, ["Uni Travel cargo · run sheet", "Contacts are confidential: use them only for this delivery."], { kind: "RUN SHEET" })
  }

  // ---------------- rate cards and calculator (D4) ----------------

  async lanesWithRates() {
    const lanes = await this.db.select().from(cargoLanes).orderBy(asc(cargoLanes.originCountry), asc(cargoLanes.destinationCountry))
    const cards = await this.db.select({ c: cargoRateCards, by: users.displayName }).from(cargoRateCards).leftJoin(users, eq(users.id, cargoRateCards.updatedBy))
    return lanes.map((l) => ({
      id: l.id, origin: l.originCountry, destination: l.destinationCountry, label: `${this.reference.countryName(l.originCountry, "en")} → ${this.reference.countryName(l.destinationCountry, "en")}`,
      enabled: l.enabled, services: l.services, volumetricDivisor: l.volumetricDivisor,
      rateCards: cards.filter((x) => x.c.laneId === l.id).map(({ c, by }) => ({ id: c.id, service: c.service, currency: c.currency, ratePerKgMinor: c.ratePerKgMinor, minimumChargeMinor: c.minimumChargeMinor, fuelSurchargePct: c.fuelSurchargePct, handlingFeeMinor: c.handlingFeeMinor, insurancePct: c.insurancePct, markupPct: c.markupPct, marginFixedMinor: c.marginFixedMinor, notes: c.notes, version: c.version, updatedAt: c.updatedAt.toISOString(), updatedBy: by ?? "-" })),
    }))
  }

  async saveRateCard(body: RateCardBody, actor: Actor) {
    return this.uow.run(async (tx) => {
      const [l] = await tx.select().from(cargoLanes).where(eq(cargoLanes.id, body.laneId))
      if (!l) throw notFound("Lane")
      if (!l.services.includes(body.service)) throw new AppError("VALIDATION_FAILED", "This lane does not offer that service")
      const [before] = await tx.select().from(cargoRateCards).where(and(eq(cargoRateCards.laneId, body.laneId), eq(cargoRateCards.service, body.service)))
      const values = { currency: body.currency, ratePerKgMinor: body.ratePerKgMinor, minimumChargeMinor: body.minimumChargeMinor, fuelSurchargePct: body.fuelSurchargePct, handlingFeeMinor: body.handlingFeeMinor, insurancePct: body.insurancePct, markupPct: body.markupPct, marginFixedMinor: body.marginFixedMinor, notes: body.notes ?? null, updatedBy: actor.userId }
      const [after] = before
        ? await tx.update(cargoRateCards).set({ ...values, version: before.version + 1, updatedAt: new Date() }).where(eq(cargoRateCards.id, before.id)).returning()
        : await tx.insert(cargoRateCards).values({ laneId: body.laneId, service: body.service, ...values }).returning()
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: before ? "cargo_rate_card.updated" : "cargo_rate_card.created", entityType: "cargo_rate_card", entityId: after!.id, before: before ?? undefined, after: after! })
      return { id: after!.id, version: after!.version }
    })
  }

  async deleteRateCard(id: string, actor: Actor) {
    return this.uow.run(async (tx) => {
      const [before] = await tx.delete(cargoRateCards).where(eq(cargoRateCards.id, id)).returning()
      if (!before) throw notFound("Rate card")
      await this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_rate_card.deleted", entityType: "cargo_rate_card", entityId: id, before })
      return { ok: true }
    })
  }

  async calculate(body: CalculateBody) {
    const [l] = await this.db.select().from(cargoLanes).where(eq(cargoLanes.id, body.laneId))
    if (!l || !l.enabled) throw new AppError("VALIDATION_FAILED", "This lane is not open")
    if (!l.services.includes(body.service)) throw new AppError("VALIDATION_FAILED", "This lane does not offer that service")
    const w = cargoWeights(body.pieces, l.volumetricDivisor)
    const [c] = await this.db.select().from(cargoRateCards).where(and(eq(cargoRateCards.laneId, l.id), eq(cargoRateCards.service, body.service)))
    const weights = { actualKg: w.actualKg, volumetricKg: w.volumetricKg, chargeableKg: w.chargeableKg, divisor: w.divisor }
    if (!c) return { weights, rateSet: false as const, estimate: null }
    // Booklet 14.6: freight = rate × chargeable weight (at least the minimum charge), then surcharges. Always an estimate.
    const freight = Math.max(Math.round(c.ratePerKgMinor * w.chargeableKg), c.minimumChargeMinor)
    const fuel = Math.round(freight * (c.fuelSurchargePct / 100))
    const insurance = body.declaredValueMinor && c.insurancePct ? Math.round(body.declaredValueMinor * (c.insurancePct / 100)) : 0
    const lines = [
      { key: "freight", label: `Freight: ${kg(w.chargeableKg)} × ${money(c.ratePerKgMinor, c.currency)}${freight === c.minimumChargeMinor && c.minimumChargeMinor > 0 ? " (minimum charge)" : ""}`, amountMinor: freight },
      ...(fuel ? [{ key: "fuel", label: `Fuel surcharge ${c.fuelSurchargePct}%`, amountMinor: fuel }] : []),
      ...(c.handlingFeeMinor ? [{ key: "handling", label: "Handling", amountMinor: c.handlingFeeMinor }] : []),
      ...(insurance ? [{ key: "insurance", label: `Insurance ${c.insurancePct}% of declared value`, amountMinor: insurance }] : []),
    ]
    const costMinor = lines.reduce((n, x) => n + x.amountMinor, 0)
    // ADR-0047 D3: customer price = cost × (1 + markup%) + fixed margin, then the customer's special rate (own markup, discount).
    const special = body.customerUserId ? await this.specialRate(body.customerUserId, l.id, body.service) : null
    const markupPct = special?.markupPct ?? c.markupPct
    const before = Math.round(costMinor * (1 + markupPct / 100)) + c.marginFixedMinor
    const discountMinor = special?.discountPct ? Math.round(before * (special.discountPct / 100)) : 0
    const priceMinor = Math.max(before - discountMinor, c.minimumChargeMinor)
    return {
      weights, rateSet: true as const,
      estimate: {
        currency: c.currency, lines, totalMinor: costMinor, note: "Estimate. Duties, taxes and customs brokerage are not included.",
        pricing: { costMinor, markupPct, marginFixedMinor: c.marginFixedMinor, discountPct: special?.discountPct ?? 0, discountMinor, priceMinor, profitMinor: priceMinor - costMinor, specialRate: special ? { id: special.id, note: special.note } : null },
      },
    }
  }

  private async specialRate(customerUserId: string, laneId: string, service: string) {
    const rows = await this.db.select().from(cargoCustomerRates).where(eq(cargoCustomerRates.customerUserId, customerUserId))
    const score = (x: typeof rows[number]) => (x.laneId === laneId ? 2 : x.laneId ? -10 : 0) + (x.service === service ? 1 : x.service ? -10 : 0)
    return rows.filter((x) => score(x) >= 0).sort((a, b) => score(b) - score(a))[0] ?? null
  }

  // ---------------- customs declaration (D5) ----------------

  async customsData(ref: string) {
    const [r] = await this.db.select().from(cargoRequests).where(eq(cargoRequests.ref, ref))
    if (!r) throw notFound("Cargo request")
    const items = await this.db.select().from(cargoItems).where(eq(cargoItems.cargoRequestId, r.id))
    const pieces = await this.db.select().from(cargoPieces).where(eq(cargoPieces.cargoRequestId, r.id))
    const currencies = [...new Set(items.map((i) => i.currency))]
    const totalMinor = items.reduce((n, i) => n + i.unitValueMinor * i.quantity, 0)
    const weightKg = Math.round(pieces.reduce((n, p) => n + (p.verifiedWeightKg ?? p.weightKg), 0) * 100) / 100
    const purposes = [...new Set(items.map((i) => i.purpose))]
    const form = currencies.length === 1 && currencies[0] === "GBP" && totalMinor <= CN22_LIMIT_GBP_MINOR && pieces.every((p) => (p.verifiedWeightKg ?? p.weightKg) <= CN22_MAX_KG) ? "CN22" : "CN23"
    const missingHs = items.filter((i) => !i.hsCode).map((i) => i.description)
    return { r, items, pieces, form, currency: currencies.length === 1 ? currencies[0]! : currencies.join("/"), totalMinor, weightKg, categories: purposes.map((p) => CUSTOMS_CATEGORY[p] ?? p), missingHs }
  }

  async customsCheck(ref: string) {
    const d = await this.customsData(ref)
    return { form: d.form, items: d.items.length, missingHsCodes: d.missingHs, total: { amountMinor: d.totalMinor, currency: d.currency }, weightKg: d.weightKg }
  }

  async customsPdf(ref: string, actor: Actor) {
    const d = await this.customsData(ref)
    if (!d.items.length) throw new AppError("VALIDATION_FAILED", "The request has no declared items")
    const s = d.r.shipper as Party
    const c = d.r.consignee as Party
    const party = (p: Party): [string, string][] => [["Name", p.company ? `${p.name}, ${p.company}` : p.name], ["Address", this.address(p)], ["Phone", p.phone], ...(p.email ? [["Email", p.email] as [string, string]] : [])]
    const sections: PdfSection[] = [
      { rows: [["Form", d.form === "CN22" ? "CN22 · Customs declaration" : "CN23 · Customs declaration"], ["Tracking number", d.r.trackingNumber ? formatTrackingNumber(d.r.trackingNumber) : "(not issued yet)"], ["Reference", d.r.ref], ["Category of item", d.categories.join(", ")]] },
      { heading: "From (sender)", rows: party(s) },
      { heading: "To (addressee)", rows: party(c) },
      {
        heading: "Contents",
        table: {
          columns: [{ label: "Detailed description", x: 0 }, { label: "Qty", x: 230, right: true }, { label: "HS tariff no.", x: 245 }, { label: "Origin", x: 320 }, { label: "Value", x: 450, right: true }],
          rows: d.items.map((i) => [i.description.slice(0, 48), String(i.quantity), i.hsCode ?? "", i.originCountry, money(i.unitValueMinor * i.quantity, i.currency)]),
        },
      },
      { rows: [["Total gross weight", kg(d.weightKg)], ["Number of pieces", String(d.pieces.length)], ["Total value", money(d.totalMinor, d.currency.includes("/") ? "" : d.currency).trim()], ["Postage / fees", "______________"]] },
      ...(d.form === "CN23" ? [{ heading: "CN23 details", rows: [["Licence no.", "______________"], ["Certificate no.", "______________"], ["Invoice no.", "______________"], ["Office of origin / date of posting", "______________"], ["Comments (e.g. goods subject to quarantine)", "______________"]] as [string, string][] }] : []),
      { heading: "Declaration", paragraphs: ["I certify that the particulars given in this customs declaration are correct and that this item does not contain any dangerous article or articles prohibited by legislation or by postal or customs regulations."], rows: [["Date and sender's signature", "________________________________"]] },
    ]
    const pdf = await renderPdf(d.form === "CN22" ? "Customs declaration CN22" : "Customs declaration CN23", `${d.r.ref}${d.r.trackingNumber ? ` · ${formatTrackingNumber(d.r.trackingNumber)}` : ""}`, sections, ["May be opened officially.", "Commercial invoices remain the sender's responsibility (booklet 14.9)."], { kind: d.form })
    await this.uow.run((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "cargo_request.customs_form_generated", entityType: "cargo_request", entityId: d.r.id, contextRef: d.r.ref, after: { form: d.form, missingHsCodes: d.missingHs.length } }))
    return { pdf, filename: `${d.form.toLowerCase()}-${d.r.ref}.pdf` }
  }
}
