import { Inject, Injectable } from "@nestjs/common"
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm"

import {
  type CustomerTicketSummary, type PendingAction, type PortalItem, type PortalOverview, type PurchaseItem, type TrackDetail, type TrackDocument, type TrackEvent, type TrackSearchResult, type UnreadCounts,
} from "@unitravel/contracts"
import { cargoRequests, type Db, flightRequests, notifications, partnerBookings, requestStatusHistory, serviceRequests, ticketDocuments, travellerDocuments, travellers, userIdentities, users, customerProfiles } from "@unitravel/db"
import { normaliseReference } from "@unitravel/domain"

import { notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { DB } from "../../core/infra.module"
import { CarrierTrackingService } from "../cargo-tracking/carrier-tracking.service"
import { CargoService } from "../cargo/cargo.service"
import { ConfigService } from "../config/config.service"
import { InvoicesService } from "../invoices/invoices.service"
import { LoyaltyService } from "../loyalty/loyalty.service"
import { NotificationsService } from "../notifications/notifications.service"
import { RequestsService } from "../requests/requests.service"
import { SERVICE_STATUS_LABELS, serviceTitle } from "../services/service-labels"
import { ServicesService } from "../services/services.service"
import { SupportService } from "../support/support.service"
import {
  actionLabel, buildSteps, CARGO_STEP_AT, CARGO_STEP_STATUSES, FLIGHT_STEP_AT, FLIGHT_STEP_KEYS, flightStepLabel, INVOICE_LABELS, NEXT_STEP, SERVICE_STEP_AT, SERVICE_STEP_STATUSES,
} from "./portal-copy"

type Locale = "en" | "fa"
type Kind = PortalItem["kind"]

const CLOSED: Record<Kind, readonly string[]> = {
  FLIGHT: ["COMPLETED", "DECLINED", "CANCELLED", "EXPIRED"],
  CARGO: ["COMPLETED", "DECLINED", "CANCELLED", "EXPIRED"],
  SERVICE: ["COMPLETED", "CANCELLED", "CLOSED_NO_RESPONSE", "DECLINED"],
  INVOICE: ["PAID", "CANCELLED", "REFUNDED"],
}
const DETAIL_HREF = (kind: Kind, ref: string) => (kind === "FLIGHT" ? `/requests/${ref}` : kind === "CARGO" ? `/cargo/${ref}` : kind === "SERVICE" ? `/services/${ref}` : `/billing/${ref}`)
const pair = (p: { en: string; fa: string }, l: Locale) => p[l]
const dedupeRuns = <T extends { label: string }>(xs: T[]) => xs.filter((x, i) => i === 0 || xs[i - 1]!.label !== x.label)

/** ADR-0040: the customer portal's composed views. Everything is read through the customer's own id; a foreign reference is 404. */
@Injectable()
export class PortalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly requests: RequestsService,
    private readonly cargo: CargoService,
    private readonly services: ServicesService,
    private readonly invoices: InvoicesService,
    private readonly loyalty: LoyaltyService,
    private readonly support: SupportService,
    private readonly inbox: NotificationsService,
    private readonly carrier: CarrierTrackingService,
  ) {}

  // ---------------- steps ----------------

  private async cargoLabels(l: Locale) {
    return CARGO_STEP_STATUSES.map((s) => this.cargo.label(s, l))
  }

  private async item(kind: Kind, ref: string, title: string, status: string, statusLabel: string, updatedAt: string, l: Locale): Promise<PortalItem> {
    const active = !CLOSED[kind].includes(status)
    const next = pair(NEXT_STEP[kind][status] ?? { en: "", fa: "" }, l) || null
    let steps: PortalItem["steps"] = []
    if (active) {
      if (kind === "FLIGHT") steps = buildSteps(FLIGHT_STEP_KEYS.map((k) => flightStepLabel(k, l)), FLIGHT_STEP_AT[status])
      else if (kind === "CARGO") steps = buildSteps(await this.cargoLabels(l), CARGO_STEP_AT[status])
      else if (kind === "SERVICE") steps = buildSteps(SERVICE_STEP_STATUSES.map((s) => SERVICE_STATUS_LABELS[s][l]), SERVICE_STEP_AT[status])
      else steps = buildSteps([INVOICE_LABELS.ISSUED![l], INVOICE_LABELS.PAID![l]], 0)
    }
    return { kind, ref, title, status, statusLabel, active, steps, nextStep: active ? next : null, updatedAt }
  }

  // ---------------- overview ----------------

  async unread(userId: string): Promise<UnreadCounts> {
    const [[inbox], tickets] = await Promise.all([
      this.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
      this.support.customerList(userId),
    ])
    return { inbox: inbox?.n ?? 0, support: tickets.filter((t) => t.unread).length }
  }

  private async profile(userId: string) {
    const [[u], ids, [profile], [doc]] = await Promise.all([
      this.db.select().from(users).where(eq(users.id, userId)),
      this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), isNull(userIdentities.revokedAt))),
      this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)),
      this.db.select({ id: travellerDocuments.id }).from(travellerDocuments).innerJoin(travellers, eq(travellers.id, travellerDocuments.travellerId)).where(and(eq(travellers.ownerUserId, userId), isNull(travellers.deletedAt))).limit(1),
    ])
    if (!u) throw notFound("Account")
    const pick = (type: "EMAIL" | "PHONE") => ids.filter((i) => i.type === type).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0]
    const email = pick("EMAIL"), phone = pick("PHONE")
    const missing = [
      ...(profile?.givenNamesLatin && profile.surnameLatin ? [] : ["NAME"]),
      ...(email?.verifiedAt ? [] : ["EMAIL"]),
      ...(phone?.verifiedAt ? [] : ["PHONE"]),
      ...(doc ? [] : ["PASSPORT"]),
    ]
    return { name: u.displayName || null, email: email?.valueNormalised ?? null, phone: phone?.valueNormalised ?? null, memberSince: u.createdAt.toISOString(), missing }
  }

  async overview(actor: Actor, l: Locale): Promise<PortalOverview> {
    const userId = actor.userId
    const [flights, cargo, services, billing, purchasable, tickets, profile, clubView, inboxPage, unread, ticketDocs] = await Promise.all([
      this.requests.customerList(userId, l), this.cargo.customerList(userId, l), this.services.customerList(userId, l), this.invoices.billing(userId), this.invoices.purchasable(userId, l),
      this.support.customerList(userId), this.profile(userId), this.loyalty.customerView(userId), this.inbox.inbox(userId, { limit: 5, locale: l }), this.unread(userId),
      this.db.select({ id: ticketDocuments.id, ref: flightRequests.ref, at: ticketDocuments.issuedAt }).from(ticketDocuments).innerJoin(flightRequests, eq(flightRequests.id, ticketDocuments.requestId)).where(and(eq(flightRequests.customerUserId, userId), eq(ticketDocuments.status, "ISSUED"))),
    ])
    const items = await Promise.all([
      ...flights.map((f) => this.item("FLIGHT", f.ref, f.routeLabel, f.status, f.statusLabel, f.updatedAt, l)),
      ...cargo.map((c) => this.item("CARGO", c.ref, c.routeLabel, c.status, c.statusLabel, c.updatedAt, l)),
      ...services.map((s) => this.item("SERVICE", s.ref, s.title, s.status, SERVICE_STATUS_LABELS[s.status][l], s.updatedAt, l)),
    ])
    const byNewest = (a: PortalItem, b: PortalItem) => b.updatedAt.localeCompare(a.updatedAt)
    const active = items.filter((i) => i.active).sort(byNewest)
    const closed = items.filter((i) => !i.active).sort(byNewest)

    const pending: PendingAction[] = []
    // Actions come from the same views the request pages use; only the few requests that can have one are opened.
    for (const f of flights.filter((x) => ["QUOTED", "ACCEPTED", "AWAITING_CUSTOMER"].includes(x.status))) {
      const d = await this.requests.customerDetail(f.ref, actor, l)
      const dueAt = (d.quotes ?? []).find((q: { status: string; validUntil: string | null }) => q.status === "SENT")?.validUntil ?? null
      for (const a of d.actions as string[]) if (a === "ACCEPT_QUOTE" || a === "RESPOND" || a === "PROVIDE_PASSPORT") pending.push({ kind: a, ref: f.ref, label: actionLabel(a, l), dueAt: a === "ACCEPT_QUOTE" ? dueAt : null })
    }
    for (const c of cargo.filter((x) => ["QUOTED", "EXCEPTION", "AWAITING_CUSTOMER"].includes(x.status))) {
      if (c.status === "AWAITING_CUSTOMER") { pending.push({ kind: "RESPOND", ref: c.ref, label: actionLabel("RESPOND", l), dueAt: null }); continue }
      const d = await this.cargo.customerDetail(c.ref, actor, l)
      if ((d.actions as string[]).includes("ACCEPT_QUOTE")) pending.push({ kind: "ACCEPT_QUOTE", ref: c.ref, label: actionLabel("ACCEPT_QUOTE", l), dueAt: d.quotes.find((q) => q.status === "SENT")?.validUntil ?? null })
    }
    for (const p of purchasable) pending.push({ kind: p.action === "PAY" ? "PAY_INVOICE" : "ACCEPT_QUOTE", ref: p.requestRef, label: actionLabel(p.action === "PAY" ? "PAY_INVOICE" : "ACCEPT_QUOTE", l), dueAt: p.dueAt })
    for (const t of tickets.filter((x) => x.unread)) pending.push({ kind: "SUPPORT_REPLY", ref: t.ref, label: actionLabel("SUPPORT_REPLY", l), dueAt: null })
    if (profile.missing.some((m) => m !== "PASSPORT")) pending.push({ kind: "COMPLETE_PROFILE", ref: null, label: actionLabel("COMPLETE_PROFILE", l), dueAt: null })

    const purchases = await this.purchases(userId, billing, ticketDocs, flights, l)
    const open = tickets.filter((t) => t.status === "OPEN" || t.status === "PENDING_CUSTOMER")
    return {
      profile,
      counts: { active: active.length, previous: closed.length, pendingActions: pending.length, unreadInbox: unread.inbox, unreadSupport: unread.support, openSupport: open.length },
      active, previous: closed.slice(0, 5), pendingActions: pending, purchases,
      notifications: inboxPage.items as PortalOverview["notifications"],
      support: open.slice(0, 5) as CustomerTicketSummary[],
      club: { enabled: clubView.enabled, member: clubView.member ? { tierNameEn: clubView.member.tier.nameEn, tierNameFa: clubView.member.tier.nameFa, status: clubView.member.status } : null, creditBalance: clubView.creditBalance, points: clubView.points?.balance ?? null },
      // ADR-0040 D7: no active state exists yet, so the card is always "coming soon" whatever the menu flag says.
      travelCard: { status: "COMING_SOON" },
    }
  }

  private async purchases(userId: string, billing: Awaited<ReturnType<InvoicesService["billing"]>>, ticketDocs: { id: string; ref: string; at: Date | null }[], flights: { ref: string; routeLabel: string }[], l: Locale): Promise<PurchaseItem[]> {
    const titles = { INVOICE_PAID: l === "fa" ? "فاکتور پرداخت‌شده" : "Paid invoice", TICKET_ISSUED: l === "fa" ? "بلیت صادر شد" : "Ticket issued", SERVICE_CONFIRMED: l === "fa" ? "خدمت تأیید شد" : "Service confirmed", CARGO_BOOKED: l === "fa" ? "محموله رزرو شد" : "Shipment booked" }
    const out: PurchaseItem[] = billing.invoices.filter((i) => i.status === "PAID" && i.paidAt).map((i) => ({ kind: "INVOICE_PAID" as const, ref: i.number, title: `${titles.INVOICE_PAID} · ${i.requestRef}`, amount: i.total, at: i.paidAt! }))
    for (const t of ticketDocs) if (t.at) out.push({ kind: "TICKET_ISSUED", ref: t.ref, title: `${titles.TICKET_ISSUED} · ${flights.find((f) => f.ref === t.ref)?.routeLabel ?? t.ref}`, amount: null, at: t.at.toISOString() })
    // When the request reached the state, not when it last changed.
    const reached = await this.db.select({ type: requestStatusHistory.requestType, id: requestStatusHistory.requestId, at: sql<Date>`max(${requestStatusHistory.createdAt})` }).from(requestStatusHistory)
      .where(sql`(${requestStatusHistory.requestType} = 'SERVICE' and ${requestStatusHistory.toStatus} = 'CONFIRMED' and ${requestStatusHistory.requestId} in (select id from service_requests where customer_user_id = ${userId}))
        or (${requestStatusHistory.requestType} = 'CARGO' and ${requestStatusHistory.toStatus} = 'BOOKED' and ${requestStatusHistory.requestId} in (select id from cargo_requests where customer_user_id = ${userId}))`)
      .groupBy(requestStatusHistory.requestType, requestStatusHistory.requestId)
    const svc = reached.filter((r) => r.type === "SERVICE"), crg = reached.filter((r) => r.type === "CARGO")
    if (svc.length) for (const s of await this.db.select({ id: serviceRequests.id, ref: serviceRequests.ref, type: serviceRequests.type }).from(serviceRequests).where(inArray(serviceRequests.id, svc.map((x) => x.id)))) out.push({ kind: "SERVICE_CONFIRMED", ref: s.ref, title: `${titles.SERVICE_CONFIRMED} · ${serviceTitle(s.type, l)}`, amount: null, at: new Date(svc.find((x) => x.id === s.id)!.at).toISOString() })
    if (crg.length) for (const c of await this.db.select({ id: cargoRequests.id, ref: cargoRequests.ref }).from(cargoRequests).where(inArray(cargoRequests.id, crg.map((x) => x.id)))) out.push({ kind: "CARGO_BOOKED", ref: c.ref, title: `${titles.CARGO_BOOKED} · ${c.ref}`, amount: null, at: new Date(crg.find((x) => x.id === c.id)!.at).toISOString() })
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
  }

  // ---------------- search ----------------

  /** A reference, an invoice number or (cargo) an AWB, resolved only among the customer's own records. */
  async search(userId: string, q: string): Promise<TrackSearchResult> {
    const ref = normaliseReference(q)
    if (ref) return { ref: (await this.kindOf(ref, userId).catch(() => null)) ? ref : null }
    const digits = q.replace(/[\s-]/g, "")
    if (/^\d{11}$/.test(digits)) {
      const awb = `${digits.slice(0, 3)}-${digits.slice(3)}`
      const [row] = await this.db.select({ ref: cargoRequests.ref }).from(partnerBookings).innerJoin(cargoRequests, eq(cargoRequests.id, partnerBookings.cargoRequestId)).where(and(eq(partnerBookings.awbNumber, awb), eq(cargoRequests.customerUserId, userId))).limit(1)
      return { ref: row?.ref ?? null }
    }
    return { ref: (await this.kindOf(q.trim().toUpperCase(), userId).catch(() => null)) ? q.trim().toUpperCase() : null }
  }

  private async kindOf(ref: string, userId: string): Promise<Kind> {
    if (ref.startsWith("UT-F-")) { await this.requests.ownedByRef(ref, userId); return "FLIGHT" }
    if (ref.startsWith("UT-C-")) { await this.cargo.owned(ref, userId); return "CARGO" }
    if (ref.startsWith("UT-S-")) {
      const [r] = await this.db.select({ id: serviceRequests.id }).from(serviceRequests).where(and(eq(serviceRequests.ref, ref), eq(serviceRequests.customerUserId, userId)))
      if (!r) throw notFound("Request")
      return "SERVICE"
    }
    await this.invoices.customerInvoice(ref, userId)
    return "INVOICE"
  }

  // ---------------- track one purchase ----------------

  async track(refIn: string, actor: Actor, l: Locale): Promise<TrackDetail> {
    const ref = normaliseReference(refIn) ?? refIn.trim().toUpperCase()
    const kind = await this.kindOf(ref, actor.userId)
    const billing = await this.invoices.billing(actor.userId)
    const docs = (requestRef: string): TrackDocument[] => [
      ...billing.quotations.filter((q) => q.requestRef === requestRef && q.documentId).map((q) => ({ kind: "QUOTATION" as const, label: `${l === "fa" ? "پیشنهاد قیمت" : "Quotation"} ${q.number}`, href: `/v1/documents/${q.documentId}/download` })),
      ...billing.invoices.filter((i) => i.requestRef === requestRef && i.status !== "CANCELLED").map((i) => ({ kind: "INVOICE" as const, label: `${l === "fa" ? "فاکتور" : "Invoice"} ${i.number}`, href: `/billing/${i.number}` })),
    ]
    const history = async (type: "FLIGHT" | "SERVICE", id: string, label: (s: string) => string): Promise<TrackEvent[]> => {
      const rows = await this.db.select().from(requestStatusHistory).where(and(eq(requestStatusHistory.requestType, type), eq(requestStatusHistory.requestId, id))).orderBy(requestStatusHistory.createdAt)
      return dedupeRuns(rows.map((h) => ({ id: h.id, at: h.createdAt.toISOString(), label: label(h.toStatus), location: null, description: null, source: "UNITRAVEL" as const, corrected: false }))).reverse()
    }
    const base = { ref, detailHref: DETAIL_HREF(kind, ref), kind, shipment: null }

    if (kind === "FLIGHT") {
      const r = await this.requests.ownedByRef(ref, actor.userId)
      const label = (s: string) => this.requests.statusLabel(s as never, r.paymentStatus, l)
      const it = await this.item("FLIGHT", ref, this.requests.routeLabel(r.query, l), r.status, label(r.status), r.updatedAt.toISOString(), l)
      const issued = await this.db.select({ id: ticketDocuments.id, kind: ticketDocuments.kind, branded: ticketDocuments.brandedDocumentId }).from(ticketDocuments).where(and(eq(ticketDocuments.requestId, r.id), eq(ticketDocuments.status, "ISSUED")))
      const tickets: TrackDocument[] = issued.map((t) => ({ kind: t.kind === "BOARDING_PASS" ? "BOARDING_PASS" : "E_TICKET", label: t.kind === "BOARDING_PASS" ? (l === "fa" ? "کارت پرواز" : "Boarding pass") : (l === "fa" ? "بلیت الکترونیک" : "E-ticket"), href: `/v1/ticket-documents/${t.id}/files/${t.branded ? "branded" : "original"}?disposition=inline` }))
      return { ...base, ...pickItem(it), events: await history("FLIGHT", r.id, label), documents: [...docs(ref), ...tickets] }
    }
    if (kind === "SERVICE") {
      const [r] = await this.db.select().from(serviceRequests).where(eq(serviceRequests.ref, ref))
      const st = r!.status === "COMPLIANCE_HOLD" ? "SUBMITTED" : r!.status
      const label = (s: string) => SERVICE_STATUS_LABELS[(s === "COMPLIANCE_HOLD" ? "SUBMITTED" : s) as keyof typeof SERVICE_STATUS_LABELS][l]
      const it = await this.item("SERVICE", ref, serviceTitle(r!.type, l), st, label(st), r!.updatedAt.toISOString(), l)
      return { ...base, ...pickItem(it), events: await history("SERVICE", r!.id, label), documents: docs(ref) }
    }
    if (kind === "CARGO") {
      const f = await this.cargo.portalFacts(ref, actor.userId, l)
      const it = await this.item("CARGO", ref, f.laneLabel, f.r.status, f.statusLabel, f.r.updatedAt.toISOString(), l)
      const carrier = await this.carrier.state(f.r.id, f.awbNumber)
      const events: TrackEvent[] = [
        ...dedupeRuns(f.history.map((h) => ({ id: h.id, at: h.at, label: h.label, location: null, description: null, source: "UNITRAVEL" as const, corrected: false }))),
        ...f.tracking.map((e) => (e.carrier && e.eventCode === "NOTE"
          // An airline checkpoint we could not map: the provider's own words, nothing added.
          ? { id: e.id, at: e.occurredAt, label: e.description ?? e.label, location: e.location === "—" ? null : e.location, description: null, source: "CARRIER" as const, corrected: false }
          : { id: e.id, at: e.occurredAt, label: e.label, location: e.location === "—" ? null : e.location, description: e.description ?? null, source: e.carrier ? "CARRIER" as const : "UNITRAVEL" as const, corrected: e.corrected })),
      ].sort((a, b) => b.at.localeCompare(a.at))
      const cargoDocs: TrackDocument[] = f.documents.filter((d) => d.type !== "QUOTE_PDF" && d.type !== "INVOICE").map((d) => ({ kind: "CARGO_DOCUMENT" as const, label: d.filename, href: `/v1/documents/${d.id}/download` }))
      return {
        ...base, ...pickItem(it), events, documents: [...docs(ref), ...cargoDocs],
        shipment: {
          awbNumber: f.awbNumber, origin: f.origin, destination: f.destination, service: f.r.service, pieces: f.pieces, chargeableWeightKg: f.chargeableWeightKg, estimatedDeliveryAt: f.r.estimatedDeliveryAt?.toISOString() ?? null,
          carrier: { state: carrier.state, provider: carrier.state === "NOT_CONFIGURED" ? null : "TRACKINGMORE", airline: carrier.airline, lastSyncedAt: carrier.lastSyncedAt },
        },
      }
    }
    const inv = await this.invoices.customerInvoice(ref, actor.userId)
    const it = await this.item("INVOICE", ref, inv.requestRef, inv.status, INVOICE_LABELS[inv.status]![l], [inv.issuedAt, inv.paidAt, inv.cancelledAt].filter(Boolean).sort().pop()!, l)
    const at = (s: string | null, status: string) => (s ? [{ id: `${ref}:${status}`, at: s, label: INVOICE_LABELS[status]![l], location: null, description: null, source: "UNITRAVEL" as const, corrected: false }] : [])
    return { ...base, ...pickItem(it), events: [...at(inv.paidAt, "PAID"), ...at(inv.cancelledAt, "CANCELLED"), ...at(inv.issuedAt, "ISSUED")], documents: inv.documentId ? [{ kind: "INVOICE", label: `${l === "fa" ? "فاکتور" : "Invoice"} ${inv.number}`, href: `/billing/${inv.number}` }] : [] }
  }
}

const pickItem = (i: PortalItem) => ({ title: i.title, status: i.status, statusLabel: i.statusLabel, active: i.active, steps: i.steps, nextStep: i.nextStep })
