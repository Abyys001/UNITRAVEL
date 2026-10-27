import { Inject, Injectable } from "@nestjs/common"
import type { Redis } from "ioredis"

import { DEFAULT_WORKFLOW, CARGO_SMS_STATUSES } from "@unitravel/contracts"

import { REDIS } from "../../core/infra.module"
import { AccessService } from "../access/access.service"
import { ConfigService } from "../config/config.service"
import { isBusinessTime } from "../platform/business-hours"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { NotificationsService } from "./notifications.service"

interface RequestPayload {
  requestId: string; ref: string; customerUserId: string; assigneeUserId?: string | null; from?: string; to?: string; command?: string;
  actorUserId?: string | null; routeLabel?: string; message?: string; validUntil?: string; urgent?: boolean; deadline?: string; ticketNumbers?: string[];
  productType?: "FLIGHT" | "CARGO"; service_en?: string; service_fa?: string; documentNumber?: string; statusLabels?: { en: string; fa: string }; direction?: string; locale?: "en" | "fa"
}

/** Maps domain events onto the event catalogue and its audiences (Table 17.1). */
@Injectable()
export class NotificationRouter {
  constructor(
    private readonly n: NotificationsService,
    private readonly access: AccessService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private requestPath(ref: string) {
    return ref.startsWith("UT-C") ? `/cargo/${ref}` : ref.startsWith("UT-S") ? `/services/${ref}` : `/requests/${ref}`
  }

  /** New-request alerts go to on-duty admins only; outside business hours an hourly digest instead, unless urgent. */
  private async alertAdmins(e: DispatchedEvent, p: RequestPayload, eventType: "request.submitted" | "cargo.submitted") {
    const perm = p.productType === "CARGO" ? "cargo_request.read.any" : "flight_request.read.any"
    const onDuty = await this.access.usersWithPermission(perm, { onDutyOnly: true })
    const hours = this.config.get("WORKFLOW").businessHours ?? DEFAULT_WORKFLOW.businessHours
    if (!isBusinessTime(hours) && !p.urgent) {
      await this.redis.sadd("digest:new-requests", p.ref)
      await this.n.notify({ eventType, eventId: e.id, audience: "ON_DUTY_ADMINS", userIds: onDuty, vars: { ref: p.ref, route: p.routeLabel }, linkPath: `/requests/${p.ref}`, data: { ref: p.ref, digest: true } })
      return
    }
    await this.n.notify({ eventType, eventId: e.id, audience: "ON_DUTY_ADMINS", userIds: onDuty, vars: { ref: p.ref, route: p.routeLabel }, linkPath: `/requests/${p.ref}`, data: { ref: p.ref } })
  }

  async handle(e: DispatchedEvent): Promise<void> {
    if (e.type === "identity.verification_decided") {
      const v = e.payload as unknown as { customerUserId: string; decision: "VERIFIED" | "REJECTED" | "CORRECTION_REQUIRED"; travellerName: string; message: string }
      const eventType = v.decision === "VERIFIED" ? "identity.verification_verified" : v.decision === "REJECTED" ? "identity.verification_rejected" : "identity.verification_correction"
      return this.n.notify({ eventId: e.id, eventType, audience: "CUSTOMER", userIds: [v.customerUserId], vars: { name: v.travellerName, message: v.message }, linkPath: "/account/details", data: { decision: v.decision } })
    }
    // Payment documents (ADR-0013 A7): same delivery as invoices, no amounts in the message.
    if (e.type === "invoice.issued" || e.type === "invoice.cancelled" || e.type === "invoice.expired" || e.type === "invoice.paid" || e.type === "payment.requested" || e.type === "payment.failed" || e.type === "payment.refunded") {
      const v = e.payload as unknown as { number: string; ref: string; customerUserId: string; expiresAt?: string }
      return this.n.notify({
        eventId: e.id, eventType: e.type, audience: "CUSTOMER", userIds: [v.customerUserId], documentDelivery: true, requestKey: v.ref,
        vars: { ref: v.ref, number: v.number, expires_at: v.expiresAt }, linkPath: `/billing/${v.number}`, data: { ref: v.ref, number: v.number },
      })
    }
    const p = e.payload as unknown as RequestPayload
    const base = { eventId: e.id, requestKey: p.ref, data: { ref: p.ref } }
    switch (e.type) {
      case "flight_request.submitted":
        await this.n.notify({ ...base, eventType: "request.submitted", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, route: p.routeLabel }, linkPath: this.requestPath(p.ref) })
        return this.alertAdmins(e, p, "request.submitted")
      case "cargo_request.submitted":
        await this.n.notify({ ...base, eventType: "cargo.submitted", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, route: p.routeLabel }, linkPath: this.requestPath(p.ref) })
        return this.alertAdmins(e, { ...p, productType: "CARGO" }, "cargo.submitted")
      case "service_request.submitted": {
        const vars = { ref: p.ref, route: p.routeLabel, service_en: p.service_en, service_fa: p.service_fa }
        await this.n.notify({ ...base, eventType: "service_request.submitted", audience: "CUSTOMER", userIds: [p.customerUserId], vars, linkPath: this.requestPath(p.ref) })
        const onDuty = await this.access.usersWithPermission("service_request.read.any", { onDutyOnly: true })
        return this.n.notify({ ...base, eventType: "service_request.submitted", audience: "ON_DUTY_ADMINS", userIds: onDuty, vars, linkPath: this.requestPath(p.ref) })
      }
      case "service_request.transitioned":
        return this.serviceTransition(e, p)
      case "service_request.quote_sent":
        // Same numbered quotation as flights and cargo (ADR-0006 C1).
        return this.n.notify({ ...base, eventType: "quotation.sent", audience: "CUSTOMER", userIds: [p.customerUserId], documentDelivery: true, vars: { ref: p.ref, number: p.documentNumber ?? p.ref, expires_at: p.validUntil }, linkPath: this.requestPath(p.ref), data: { ref: p.ref, number: p.documentNumber } })
      case "flight_request.transitioned":
        return this.flightTransition(e, p)
      case "cargo_request.transitioned": {
        if (p.to === "COMPLIANCE_HOLD" || p.to === "SUBMITTED") return
        const label = p.statusLabels ?? { en: p.to ?? "", fa: p.to ?? "" }
        const smsWorthy = (CARGO_SMS_STATUSES as readonly string[]).includes(p.to ?? "")
        if (p.to === "AWAITING_CUSTOMER") return this.n.notify({ ...base, eventType: "request.info_requested", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, message_preview: preview(p.message) }, linkPath: this.requestPath(p.ref) })
        if (p.to === "DECLINED") return this.n.notify({ ...base, eventType: "request.declined", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, message_preview: preview(p.message) }, linkPath: this.requestPath(p.ref) })
        if (p.command === "claim" || p.command === "assign") {
          if (p.assigneeUserId && p.assigneeUserId !== p.actorUserId) await this.n.notify({ ...base, eventType: "request.assigned", audience: "ASSIGNEE", userIds: [p.assigneeUserId], vars: { ref: p.ref, route: p.routeLabel } })
          return
        }
        // cargo.status_changed: inbox + push; SMS only for handover, customs, delivered and exceptions (Table 17.1).
        return this.n.notify({
          ...base, eventType: smsWorthy ? "cargo.status_changed" : "request.status_changed", audience: "CUSTOMER", userIds: [p.customerUserId],
          vars: { ref: p.ref, status_label: label.en, status_label_fa: label.fa }, linkPath: this.requestPath(p.ref),
        })
      }
      case "flight_request.message":
      case "cargo_request.message":
      case "service_request.message":
        if (p.direction === "FROM_CUSTOMER") {
          if (p.assigneeUserId) return this.n.notify({ ...base, eventType: "request.message_from_customer", audience: "ASSIGNEE", userIds: [p.assigneeUserId], vars: { ref: p.ref, message_preview: preview(p.message) }, linkPath: p.ref.startsWith("UT-S") ? this.requestPath(p.ref) : `/requests/${p.ref}` })
          return
        }
        return this.n.notify({ ...base, eventType: "request.message_from_staff", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, message_preview: preview(p.message) }, linkPath: this.requestPath(p.ref) })
      case "quote.sent":
        // The sent quote is the quotation (ADR-0006 C1): numbered, delivered by email with a sign-in-protected link, SMS when no email is verified.
        return this.n.notify({ ...base, eventType: "quotation.sent", audience: "CUSTOMER", userIds: [p.customerUserId], documentDelivery: true, vars: { ref: p.ref, number: p.documentNumber ?? p.ref, expires_at: p.validUntil }, linkPath: this.requestPath(p.ref), data: { ref: p.ref, number: p.documentNumber } })
      case "flight_request.amended":
        return this.n.notify({ ...base, eventType: "request.amended", audience: "CUSTOMER", userIds: [p.customerUserId], documentDelivery: true, vars: { ref: p.ref, route: p.routeLabel }, linkPath: this.requestPath(p.ref) })
      case "quote.accepted":
        await this.n.notify({ ...base, eventType: "quote.accepted", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref } })
        if (p.assigneeUserId) await this.n.notify({ ...base, eventType: "quote.accepted", audience: "ASSIGNEE", userIds: [p.assigneeUserId], vars: { ref: p.ref } })
        return
      case "reservation.recorded":
        return this.n.notify({ ...base, eventType: "reservation.recorded", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, deadline_at: p.deadline }, linkPath: this.requestPath(p.ref) })
      case "ticket.recorded":
        return this.n.notify({ ...base, eventType: "ticket.issued", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, ticket_numbers: (p.ticketNumbers ?? []).join(", ") }, linkPath: this.requestPath(p.ref) })
      case "compliance.case_opened": {
        const officers = await this.access.usersWithPermission("compliance.case.decide")
        return this.n.notify({ ...base, eventType: "compliance.hold_created", audience: "COMPLIANCE", userIds: officers, vars: { ref: p.ref, trigger: String((e.payload as { trigger?: string }).trigger ?? "") }, linkPath: `/compliance` })
      }
      case "compliance.case_decided": {
        const admins = await this.access.usersWithPermission(p.ref.startsWith("UT-C") ? "cargo_request.read.any" : p.ref.startsWith("UT-S") ? "service_request.read.any" : "flight_request.read.any", { onDutyOnly: true })
        return this.n.notify({ ...base, eventType: "compliance.case_decided", audience: "ON_DUTY_ADMINS", userIds: admins, vars: { ref: p.ref, decision: String((e.payload as { decision?: string }).decision ?? "") }, linkPath: `/requests/${p.ref}` })
      }
      case "security.new_sign_in": {
        const sp = e.payload as { userId: string; client: string }
        return this.n.notify({ eventType: "security.new_sign_in", eventId: e.id, audience: "CUSTOMER", userIds: [sp.userId], vars: { client: sp.client.toLowerCase(), when_at: e.occurredAt } })
      }
      case "user.permissions_changed": {
        const sp = e.payload as { userId: string; roles: string[]; actorUserId: string; privileged: boolean }
        // A silent push triggers the same refresh immediately where push is available (ch. 10.5 step 4).
        await this.n.notify({ eventType: "security.role_changed", eventId: e.id, audience: "CUSTOMER", userIds: [sp.userId], vars: { roles: sp.roles.join(", "), actor: "Uni Travel" }, silentPush: true, data: { refreshPermissions: true } })
        if (sp.privileged) {
          const owners = await this.access.usersWithRole("owner")
          await this.n.notify({ eventType: "security.role_changed", eventId: e.id, audience: "OWNERS", userIds: owners, vars: { roles: sp.roles.join(", "), actor: sp.actorUserId } })
        }
        return
      }
      case "provider.health_changed": {
        const devs = await this.access.usersWithPermission("diagnostics.read")
        const hp = e.payload as { provider: string; circuit: string; detail?: string }
        return this.n.notify({ eventType: "provider.degraded", eventId: e.id, audience: "DEVELOPERS", userIds: devs, vars: { provider: hp.provider, detail: hp.detail ?? `Circuit ${hp.circuit}` } })
      }
      case "notification.route_degraded": {
        const devs = await this.access.usersWithPermission("diagnostics.read")
        const rp = e.payload as { route: string; rate: number }
        return this.n.notify({ eventType: "notification.route_degraded", eventId: e.id, audience: "DEVELOPERS", userIds: devs, vars: { route: rp.route, rate: rp.rate } })
      }
      case "document.published":
        return this.n.notify({ ...base, eventType: "request.status_changed", audience: "CUSTOMER", userIds: [p.customerUserId], vars: { ref: p.ref, status_label: "New document", status_label_fa: "سند جدید" }, linkPath: this.requestPath(p.ref) })
      default:
        return
    }
  }

  /** Service request wording (ADR-0015): customer-facing notices for quoted, confirmed and closed; the machine's hold states stay internal. */
  private async serviceTransition(e: DispatchedEvent, p: RequestPayload) {
    if (p.to === "COMPLIANCE_HOLD" || p.to === "SUBMITTED") return
    const base = { eventId: e.id, requestKey: p.ref, data: { ref: p.ref }, linkPath: this.requestPath(p.ref) }
    const vars = { ref: p.ref, service_en: p.service_en, service_fa: p.service_fa }
    const customer = { audience: "CUSTOMER" as const, userIds: [p.customerUserId] }
    if (p.command === "claim" || p.command === "assign") {
      if (p.assigneeUserId && p.assigneeUserId !== p.actorUserId) await this.n.notify({ ...base, eventType: "request.assigned", audience: "ASSIGNEE", userIds: [p.assigneeUserId], vars: { ref: p.ref, route: p.service_en } })
      return
    }
    switch (p.to) {
      case "QUOTED": return this.n.notify({ ...base, ...customer, eventType: "service_request.quoted", vars })
      case "CONFIRMED": return this.n.notify({ ...base, ...customer, eventType: "service_request.confirmed", vars })
      case "CANCELLED": case "CLOSED_NO_RESPONSE": return this.n.notify({ ...base, ...customer, eventType: "service_request.cancelled", vars })
      case "DECLINED": return this.n.notify({ ...base, ...customer, eventType: "request.declined", vars: { ref: p.ref, message_preview: preview(p.message) } })
      default: return this.n.notify({ ...base, ...customer, eventType: "request.status_changed", vars: { ref: p.ref, status_label: p.statusLabels?.en ?? "", status_label_fa: p.statusLabels?.fa } })
    }
  }

  private async flightTransition(e: DispatchedEvent, p: RequestPayload) {
    const base = { eventId: e.id, requestKey: p.ref, data: { ref: p.ref }, linkPath: this.requestPath(p.ref) }
    const customer = [p.customerUserId]
    if (p.command === "claim" || p.command === "assign") {
      if (p.assigneeUserId && p.assigneeUserId !== p.actorUserId) await this.n.notify({ ...base, eventType: "request.assigned", audience: "ASSIGNEE", userIds: [p.assigneeUserId], vars: { ref: p.ref, route: p.routeLabel }, linkPath: `/requests/${p.ref}` })
      return this.n.notify({ ...base, eventType: "request.status_changed", audience: "CUSTOMER", userIds: customer, vars: { ref: p.ref, status_label: p.statusLabels?.en ?? "", status_label_fa: p.statusLabels?.fa } })
    }
    switch (p.to) {
      case "AWAITING_CUSTOMER":
        return this.n.notify({ ...base, eventType: "request.info_requested", audience: "CUSTOMER", userIds: customer, vars: { ref: p.ref, message_preview: preview(p.message) } })
      case "DECLINED":
        return this.n.notify({ ...base, eventType: "request.declined", audience: "CUSTOMER", userIds: customer, vars: { ref: p.ref, message_preview: preview(p.message) } })
      case "CANCELLED":
        if (p.command === "cancel_by_customer" && p.assigneeUserId) return this.n.notify({ ...base, eventType: "request.cancelled", audience: "ASSIGNEE", userIds: [p.assigneeUserId], vars: { ref: p.ref }, linkPath: `/requests/${p.ref}` })
        return this.n.notify({ ...base, eventType: "request.status_changed", audience: "CUSTOMER", userIds: customer, vars: { ref: p.ref, status_label: p.statusLabels?.en ?? "Cancelled", status_label_fa: p.statusLabels?.fa ?? "لغو شد" } })
      case "EXPIRED":
        if (p.from === "QUOTED") return this.n.notify({ ...base, eventType: "quote.expired", audience: "CUSTOMER", userIds: customer, vars: { ref: p.ref } })
        return
      case "QUOTED": case "ACCEPTED": case "RESERVED": case "TICKETED": case "COMPLIANCE_HOLD": case "SUBMITTED":
        return // covered by quote.sent / quote.accepted / reservation.recorded / ticket.recorded / compliance events
      case "NEW":
        if (p.from === "COMPLIANCE_HOLD") return // compliance.case_decided notifies admins
        return
      default:
        return this.n.notify({ ...base, eventType: "request.status_changed", audience: "CUSTOMER", userIds: customer, vars: { ref: p.ref, status_label: p.statusLabels?.en ?? p.to, status_label_fa: p.statusLabels?.fa ?? p.to } })
    }
  }
}

function preview(s?: string) {
  if (!s) return ""
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}
