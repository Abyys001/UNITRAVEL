import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { and, desc, eq, gte, inArray } from "drizzle-orm"

import { contactAttempts, customerProfiles, type Db, flightRequests, offerSnapshots, quoteOptions, quotes, requestStatusHistory, requestTravellers, reservations, users } from "@unitravel/db"
import type { MachineActor } from "@unitravel/domain"

import { DB, UnitOfWork } from "../../core/infra.module"
import { AccessService } from "../access/access.service"
import { ComplianceService } from "../compliance/compliance.service"
import { ConfigService } from "../config/config.service"
import { CustomersService } from "../customers/customers.service"
import { NotificationsService } from "../notifications/notifications.service"
import { addBusinessMinutes } from "../platform/business-hours"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { TimersService } from "../platform/timers.service"
import { neutralDeclineForUser } from "../compliance/customer-messages"
import { ReferenceService } from "../reference/reference.service"
import { RequestsService, SYSTEM } from "./requests.service"

const ALL_TIMERS = ["fr.unassigned", "fr.unassigned_escalate", "fr.first_contact", "fr.awaiting_1", "fr.awaiting_2", "fr.quote_reminder", "fr.quote_expiry", "fr.deadline_24", "fr.deadline_4", "fr.deadline_2", "fr.deadline", "fr.complete"]

/** Automatic screening on submission (ch. 27.1) and SLA timers (ch. 13.5) for flight requests. */
@Injectable()
export class FlightLifecycle implements OnModuleInit {
  private readonly log = new Logger("FlightLifecycle")

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly requests: RequestsService,
    private readonly compliance: ComplianceService,
    private readonly customers: CustomersService,
    private readonly config: ConfigService,
    private readonly timers: TimersService,
    private readonly notifications: NotificationsService,
    private readonly access: AccessService,
    private readonly reference: ReferenceService,
  ) {}

  onModuleInit() {
    this.compliance.onScreenRequest("flight_request.submitted", (id) => this.screen(id))
    this.compliance.onOutcome("FLIGHT", async (tx, requestId, o) => {
      const [r] = await tx.select().from(flightRequests).where(eq(flightRequests.id, requestId)).for("update")
      if (!r) return
      const officer: MachineActor = { kind: "STAFF", userId: o.actorUserId, permissions: new Set(["compliance.case.decide"]) }
      if (o.decision === "RELEASE" && r.status === "COMPLIANCE_HOLD") await this.requests.transition(tx, r, "release_hold", officer, { facts: { decisionReason: o.reason }, reasonText: o.reason })
      if (o.decision === "DECLINE") {
        const msg = o.customerMessage || await neutralDeclineForUser(tx, r.customerUserId)
        await this.requests.transition(tx, r, "decline", officer, { facts: { reasonCode: o.reasonCode ?? "COMPLIANCE", message: msg }, reasonCode: o.reasonCode ?? "COMPLIANCE", reasonText: o.reason, message: msg })
        await this.requests.addMessage(tx, r, o.actorUserId, "TO_CUSTOMER", msg, [], false)
      }
    })
    this.timers.onEvent("flight_request.transitioned", (e) => this.onTransition(e))
    this.timers.onEvent("quote.sent", (e) => this.onQuoteSent(e))
    this.timers.onEvent("reservation.recorded", (e) => this.onReservation(e))
    this.timers.onEvent("ticket.recorded", (e) => this.onTicketed(e))
    this.timers.onEvent("flight_request.submitted", async () => undefined)
    for (const k of ALL_TIMERS) this.timers.onTimer(k, (d) => this.fire(k, d as { requestId: string }))
    this.timers.onReconcile(() => this.reconcileTimers())
  }

  /** Screens parties, carriers and route; any hit holds the request for a compliance officer. */
  async screen(requestId: string) {
    const [r] = await this.db.select().from(flightRequests).where(eq(flightRequests.id, requestId))
    if (!r || r.status !== "SUBMITTED") return
    const [u] = await this.db.select().from(users).where(eq(users.id, r.customerUserId))
    const [p] = await this.db.select().from(customerProfiles).where(eq(customerProfiles.userId, r.customerUserId))
    const rt = await this.db.select().from(requestTravellers).where(eq(requestTravellers.requestId, r.id))
    const trav = await this.customers.byIds(rt.map((t) => t.travellerId))
    return this.uow.run(async (tx) => {
      const results = []
      const customerName = p?.givenNamesLatin && p.surnameLatin ? `${p.givenNamesLatin} ${p.surnameLatin}` : u?.displayName ?? ""
      if (customerName && customerName !== "Customer") results.push({ who: `Customer ${customerName}`, ...(await this.compliance.screen(tx, { subjectType: "CUSTOMER", subjectRef: r.customerUserId, name: customerName, nameFa: p?.nameFa, contextRef: r.ref })) })
      for (const t of trav) results.push({ who: `Traveller ${t.givenNames} ${t.surname}`, ...(await this.compliance.screen(tx, { subjectType: "TRAVELLER", subjectRef: t.id, name: `${t.givenNames} ${t.surname}`, nameFa: t.nameFa, dateOfBirth: t.dateOfBirth, nationality: t.nationality, contextRef: r.ref })) })
      const evidence: { kind: string; label: string; detail: string; score?: number }[] = []
      const screeningIds: string[] = []
      for (const res of results) if (res.result !== "CLEAR") {
        screeningIds.push(res.screeningId)
        for (const h of res.hits) evidence.push({ kind: "PARTY_MATCH", label: `${res.who} ↔ ${h.matchedName}`, detail: `${h.listId} ${h.externalId} · ${h.programmes.join(", ")} · ${h.reasons.join("; ")}`, score: h.score })
      }
      const policy = await this.compliance.carrierPolicy()
      let requiresFourEyes = false
      if (r.offerSnapshotId) {
        const [s] = await tx.select().from(offerSnapshots).where(eq(offerSnapshots.id, r.offerSnapshotId))
        const segs = s!.itinerary.components.flatMap((c) => c.slices.flatMap((x) => x.segments))
        for (const g of segs) for (const c of [g.marketing.carrier, g.operating.carrier]) {
          if (policy.blockedCarriers.has(c)) { evidence.push({ kind: "BLOCKED_CARRIER", label: `Carrier ${c} in snapshot`, detail: "Blocked by carrier policy (D-01)" }); requiresFourEyes = true }
          else if (policy.reviewCarriers.has(c)) evidence.push({ kind: "REVIEW_CARRIER", label: `Carrier ${c} in snapshot`, detail: "Carrier flagged for review" })
        }
        const countries = [...new Set(segs.flatMap((g) => [this.reference.airport(g.origin.iata)?.country, this.reference.airport(g.destination.iata)?.country]).filter(Boolean) as string[])]
        for (const k of await this.compliance.routeReview(countries)) evidence.push({ kind: "ROUTE_POLICY", label: `Route touches ${k}`, detail: "Country route policy requires review" })
      }
      if (evidence.length) {
        await this.compliance.openCase(tx, { requestType: "FLIGHT", requestId: r.id, requestRef: r.ref, trigger: screeningIds.length ? "SCREENING" : "POLICY", summary: `${evidence.length} item(s) need a compliance decision`, evidence, screeningIds, requiresFourEyes })
        await this.requests.transition(tx, r, "screen_flag", SYSTEM)
      } else {
        await this.requests.transition(tx, r, "screen_pass", SYSTEM)
      }
    })
  }

  // ---------------- timers ----------------

  private async onTransition(e: DispatchedEvent) {
    const p = e.payload as { requestId: string; from: string; to: string; command: string }
    const [r] = await this.db.select().from(flightRequests).where(eq(flightRequests.id, p.requestId))
    if (!r) return
    const wf = this.config.get("WORKFLOW")
    const key = `fr:${r.id}`
    const now = new Date()
    if (["COMPLETED", "DECLINED", "CANCELLED"].includes(p.to)) return this.timers.cancelAll(key, ALL_TIMERS)
    if (p.to === "NEW") {
      await this.timers.schedule("fr.unassigned", key, addBusinessMinutes(wf.businessHours, now, wf.sla.unassignedMinutes), { requestId: r.id })
      await this.timers.schedule("fr.unassigned_escalate", key, addBusinessMinutes(wf.businessHours, r.submittedAt, wf.sla.unassignedEscalateMinutes), { requestId: r.id })
    }
    if (p.command === "claim" || p.command === "assign") {
      await this.timers.cancelAll(key, ["fr.unassigned", "fr.unassigned_escalate"])
      await this.timers.schedule("fr.first_contact", key, addBusinessMinutes(wf.businessHours, now, wf.sla.firstContactMinutes), { requestId: r.id })
    }
    if (p.to === "AWAITING_CUSTOMER") {
      const [h1, h2] = wf.sla.awaitingCustomerReminderHours
      if (h1) await this.timers.schedule("fr.awaiting_1", key, new Date(now.getTime() + h1 * 3600_000), { requestId: r.id })
      if (h2) await this.timers.schedule("fr.awaiting_2", key, new Date(now.getTime() + h2 * 3600_000), { requestId: r.id })
    }
    if (p.from === "AWAITING_CUSTOMER") await this.timers.cancelAll(key, ["fr.awaiting_1", "fr.awaiting_2"])
    if (p.from === "QUOTED" && p.to !== "QUOTED") await this.timers.cancelAll(key, ["fr.quote_reminder", "fr.quote_expiry"])
    if (p.from === "RESERVED") await this.timers.cancelAll(key, ["fr.deadline_24", "fr.deadline_4", "fr.deadline_2", "fr.deadline"])
  }

  private async onQuoteSent(e: DispatchedEvent) {
    const p = e.payload as { requestId: string; validUntil?: string }
    if (!p.validUntil) return
    const until = new Date(p.validUntil)
    const key = `fr:${p.requestId}`
    const before = this.config.get("WORKFLOW").sla.quoteReminderBeforeHours * 3600_000
    // Reminder at T-6 h; expire at T-0 (ch. 13.5).
    if (until.getTime() - before > Date.now()) await this.timers.schedule("fr.quote_reminder", key, new Date(until.getTime() - before), { requestId: p.requestId, validUntil: p.validUntil })
    await this.timers.schedule("fr.quote_expiry", key, until, { requestId: p.requestId, validUntil: p.validUntil })
  }

  private async onReservation(e: DispatchedEvent) {
    const p = e.payload as { requestId: string; deadline: string }
    const d = new Date(p.deadline).getTime()
    const key = `fr:${p.requestId}`
    const wf = this.config.get("WORKFLOW").sla
    const [a, b] = wf.ticketingDeadlineAlertHours
    if (a) await this.timers.schedule("fr.deadline_24", key, new Date(d - a * 3600_000), { requestId: p.requestId })
    if (b) await this.timers.schedule("fr.deadline_4", key, new Date(d - b * 3600_000), { requestId: p.requestId })
    await this.timers.schedule("fr.deadline_2", key, new Date(d - wf.ticketingDeadlineOwnerHours * 3600_000), { requestId: p.requestId })
    await this.timers.schedule("fr.deadline", key, new Date(d), { requestId: p.requestId })
  }

  private async onTicketed(e: DispatchedEvent) {
    const p = e.payload as { requestId: string; lastDeparture?: string }
    if (!p.lastDeparture) return
    await this.timers.schedule("fr.complete", `fr:${p.requestId}`, new Date(new Date(p.lastDeparture).getTime() + 24 * 3600_000), { requestId: p.requestId })
  }

  /**
   * Rebuilds the timers each open request should have from the database (same due times as the event handlers
   * above). Only missing jobs are added; overdue ones fire at once and re-check the state like any other timer.
   */
  async reconcileTimers(): Promise<number> {
    const open = await this.db.select().from(flightRequests).where(inArray(flightRequests.status, ["NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "RESERVED", "TICKETED"]))
    const wf = this.config.get("WORKFLOW")
    let added = 0
    for (const r of open) {
      const key = `fr:${r.id}`
      const data = { requestId: r.id }
      const ensure = async (kind: string, at: Date, d: Record<string, unknown> = data) => { if (await this.timers.ensure(kind, key, at, d)) added++ }
      const [entered] = await this.db.select({ at: requestStatusHistory.createdAt }).from(requestStatusHistory)
        .where(and(eq(requestStatusHistory.requestType, "FLIGHT"), eq(requestStatusHistory.requestId, r.id), eq(requestStatusHistory.toStatus, r.status))).orderBy(desc(requestStatusHistory.createdAt)).limit(1)
      const since = entered?.at ?? r.updatedAt
      switch (r.status) {
        case "NEW":
          await ensure("fr.unassigned", addBusinessMinutes(wf.businessHours, since, wf.sla.unassignedMinutes))
          await ensure("fr.unassigned_escalate", addBusinessMinutes(wf.businessHours, r.submittedAt, wf.sla.unassignedEscalateMinutes))
          break
        case "IN_REVIEW":
          if (r.assigneeUserId && !r.firstContactAt) await ensure("fr.first_contact", addBusinessMinutes(wf.businessHours, r.assignedAt ?? since, wf.sla.firstContactMinutes))
          break
        case "AWAITING_CUSTOMER": {
          const [h1, h2] = wf.sla.awaitingCustomerReminderHours
          if (h1) await ensure("fr.awaiting_1", new Date(since.getTime() + h1 * 3600_000))
          if (h2) await ensure("fr.awaiting_2", new Date(since.getTime() + h2 * 3600_000))
          break
        }
        case "QUOTED": {
          const [q] = await this.db.select().from(quotes).where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
          if (!q?.validUntil) break
          const d = { requestId: r.id, validUntil: q.validUntil.toISOString() }
          const remindAt = q.validUntil.getTime() - wf.sla.quoteReminderBeforeHours * 3600_000
          if (remindAt > Date.now()) await ensure("fr.quote_reminder", new Date(remindAt), d)
          await ensure("fr.quote_expiry", q.validUntil, d)
          break
        }
        case "RESERVED": {
          const [res] = await this.db.select().from(reservations).where(eq(reservations.requestId, r.id)).orderBy(desc(reservations.createdAt)).limit(1)
          if (!res) break
          const d = res.ticketingDeadline.getTime()
          const [a, b] = wf.sla.ticketingDeadlineAlertHours
          if (a) await ensure("fr.deadline_24", new Date(d - a * 3600_000))
          if (b) await ensure("fr.deadline_4", new Date(d - b * 3600_000))
          await ensure("fr.deadline_2", new Date(d - wf.sla.ticketingDeadlineOwnerHours * 3600_000))
          await ensure("fr.deadline", new Date(d))
          break
        }
        case "TICKETED": {
          const [row] = await this.db.select({ itinerary: quoteOptions.itinerary }).from(quotes).innerJoin(quoteOptions, eq(quoteOptions.id, quotes.acceptedOptionId))
            .where(and(eq(quotes.requestType, "FLIGHT"), eq(quotes.requestId, r.id), eq(quotes.status, "ACCEPTED"))).limit(1)
          const last = ((row?.itinerary as { slices?: { segments: { departure: { utc: string } }[] }[] } | undefined)?.slices ?? []).flatMap((x) => x.segments).at(-1)
          if (last) await ensure("fr.complete", new Date(new Date(last.departure.utc).getTime() + 24 * 3600_000))
          break
        }
      }
    }
    return added
  }

  /** Each timer re-checks the current state when it fires and does nothing if its condition no longer holds. */
  private async fire(kind: string, d: { requestId: string }) {
    const [r] = await this.db.select().from(flightRequests).where(eq(flightRequests.id, d.requestId))
    if (!r) return "gone"
    const ev = `${kind}:${r.id}:${r.version}`
    const vars = { ref: r.ref, minutes: this.config.get("WORKFLOW").sla.unassignedMinutes }
    switch (kind) {
      case "fr.unassigned": {
        if (r.status !== "NEW") return "skip"
        return this.notifications.notify({ eventType: "sla.unassigned", eventId: ev, audience: "ON_DUTY_ADMINS", userIds: await this.access.usersWithPermission("flight_request.assign", { onDutyOnly: true }), vars, linkPath: `/requests/${r.ref}` })
      }
      case "fr.unassigned_escalate": {
        if (r.status !== "NEW") return "skip"
        return this.notifications.notify({ eventType: "sla.unassigned", eventId: ev, audience: "OWNERS", userIds: await this.access.usersWithRole("owner"), vars: { ...vars, minutes: this.config.get("WORKFLOW").sla.unassignedEscalateMinutes }, linkPath: `/requests/${r.ref}` })
      }
      case "fr.first_contact": {
        if (r.status !== "IN_REVIEW" || !r.assigneeUserId) return "skip"
        const contacted = await this.db.select().from(contactAttempts).where(and(eq(contactAttempts.requestId, r.id), gte(contactAttempts.createdAt, r.assignedAt ?? r.submittedAt)))
        if (contacted.length) return "contacted"
        return this.notifications.notify({ eventType: "sla.first_contact_due", eventId: ev, audience: "ASSIGNEE", userIds: [r.assigneeUserId], vars: { ref: r.ref }, linkPath: `/requests/${r.ref}` })
      }
      case "fr.awaiting_1":
        if (r.status !== "AWAITING_CUSTOMER") return "skip"
        return this.notifications.notify({ eventType: "sla.awaiting_customer_reminder", eventId: ev, audience: "CUSTOMER", userIds: [r.customerUserId], vars: { ref: r.ref }, linkPath: `/requests/${r.ref}`, requestKey: r.ref })
      case "fr.awaiting_2":
        // After 72 h the admin decides whether to close (ch. 13.5).
        if (r.status !== "AWAITING_CUSTOMER") return "skip"
        await this.notifications.notify({ eventType: "sla.awaiting_customer_reminder", eventId: ev, audience: "CUSTOMER", userIds: [r.customerUserId], vars: { ref: r.ref }, linkPath: `/requests/${r.ref}`, requestKey: r.ref })
        if (r.assigneeUserId) await this.notifications.notify({ eventType: "sla.first_contact_due", eventId: `${ev}:assignee`, audience: "ASSIGNEE", userIds: [r.assigneeUserId], vars: { ref: r.ref }, linkPath: `/requests/${r.ref}` })
        return "reminded"
      case "fr.quote_reminder": {
        if (r.status !== "QUOTED") return "skip"
        const q = await this.db.select().from(quotes).where(and(eq(quotes.requestId, r.id), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
        if (!q[0]?.validUntil) return "skip"
        await this.notifications.notify({ eventType: "quote.expiring", eventId: ev, audience: "CUSTOMER", userIds: [r.customerUserId], vars: { ref: r.ref, expires_at: q[0].validUntil.toISOString() }, linkPath: `/requests/${r.ref}` })
        if (r.assigneeUserId) await this.notifications.notify({ eventType: "quote.expiring", eventId: ev, audience: "ASSIGNEE", userIds: [r.assigneeUserId], vars: { ref: r.ref, expires_at: q[0].validUntil.toISOString() } })
        return "reminded"
      }
      case "fr.quote_expiry":
        return this.uow.run(async (tx) => {
          const [cur] = await tx.select().from(flightRequests).where(eq(flightRequests.id, r.id)).for("update")
          if (cur?.status !== "QUOTED") return "skip"
          const [q] = await tx.select().from(quotes).where(and(eq(quotes.requestId, r.id), eq(quotes.status, "SENT"))).orderBy(desc(quotes.version)).limit(1)
          if (!q || !q.validUntil || q.validUntil > new Date()) return "skip"
          await this.requests.transition(tx, cur, "expire_quote", SYSTEM, { facts: { quoteId: q.id } })
          await tx.update(quotes).set({ status: "EXPIRED" }).where(eq(quotes.id, q.id))
          return "expired"
        })
      case "fr.deadline_24": case "fr.deadline_4": case "fr.deadline_2": {
        if (r.status !== "RESERVED") return "skip"
        const [res] = await this.db.select().from(reservations).where(eq(reservations.requestId, r.id)).orderBy(desc(reservations.createdAt)).limit(1)
        const vars2 = { ref: r.ref, deadline_at: res?.ticketingDeadline.toISOString() }
        if (kind === "fr.deadline_2") return this.notifications.notify({ eventType: "reservation.deadline_approaching", eventId: ev, audience: "OWNERS", userIds: await this.access.usersWithRole("owner"), vars: vars2, linkPath: `/requests/${r.ref}` })
        if (!r.assigneeUserId) return "no-assignee"
        return this.notifications.notify({ eventType: "reservation.deadline_approaching", eventId: ev, audience: "ASSIGNEE", userIds: [r.assigneeUserId], vars: vars2, linkPath: `/requests/${r.ref}` })
      }
      case "fr.deadline":
        return this.uow.run(async (tx) => {
          const [cur] = await tx.select().from(flightRequests).where(eq(flightRequests.id, r.id)).for("update")
          if (cur?.status !== "RESERVED") return "skip"
          const [res] = await tx.select().from(reservations).where(eq(reservations.requestId, r.id)).orderBy(desc(reservations.createdAt)).limit(1)
          if (res?.status === "LAPSED") { await this.requests.transition(tx, cur, "expire_reservation", SYSTEM); return "expired" }
          return "deadline-passed-not-lapsed"
        })
      case "fr.complete":
        return this.uow.run(async (tx) => {
          const [cur] = await tx.select().from(flightRequests).where(eq(flightRequests.id, r.id)).for("update")
          if (cur?.status !== "TICKETED") return "skip"
          await this.requests.transition(tx, cur, "complete", SYSTEM)
          return "completed"
        })
      default:
        return "unknown"
    }
  }
}
