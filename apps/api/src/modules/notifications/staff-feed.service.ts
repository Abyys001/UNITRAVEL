import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, like, lt, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  type MarkStaffNotificationsBody, type Permission, STAFF_FEED_EVENTS, type StaffFeedEvent, type StaffNotification, type StaffNotificationCategory,
  type StaffNotificationPage, type StaffNotificationQuery, type StaffNotificationSummary,
} from "@unitravel/contracts"
import { type Db, notifications } from "@unitravel/db"

import { DB, REDIS } from "../../core/infra.module"
import { AccessService } from "../access/access.service"
import type { DispatchedEvent } from "../platform/outbox.dispatcher"
import { STAFF_EVENTS_CHANNEL, type StaffSignal } from "../platform/staff-events"
import { NotificationsService } from "./notifications.service"

/** What one domain event becomes in the staff feed; null when it is not staff news (a staff reply, a staff-recorded acceptance). */
export interface FeedItem {
  event: StaffFeedEvent
  /** Any one of these permissions makes a staff member a recipient. */
  permissions: Permission[]
  vars: Record<string, string | number | undefined>
  ref: string | null
  consolePath: string
}

type P = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const fromCustomer = (p: P) => p.direction === "FROM_CUSTOMER"

/**
 * ADR-0039 D1: maps outbox events to the staff feed. Pure, so the mapping is unit-tested without a database.
 * Only customer-side activity is news for staff; what staff did themselves is already on the request timeline.
 */
export function feedItemFor(e: Pick<DispatchedEvent, "type" | "payload">): FeedItem | null {
  const p = e.payload as P
  const ref = str(p.ref) ?? null
  switch (e.type) {
    case "flight_request.submitted":
      return { event: "staff.request_submitted", permissions: ["flight_request.read.any"], vars: { ref: ref ?? "", route: str(p.routeLabel) }, ref, consolePath: `/requests/${ref}` }
    case "cargo_request.submitted":
      return { event: "staff.cargo_submitted", permissions: ["cargo_request.read.any"], vars: { ref: ref ?? "", route: str(p.routeLabel) }, ref, consolePath: `/cargo/${ref}` }
    case "flight_request.message":
      return fromCustomer(p) ? { event: "staff.customer_message", permissions: ["flight_request.read.any"], vars: { ref: ref ?? "" }, ref, consolePath: `/requests/${ref}` } : null
    case "cargo_request.message":
      return fromCustomer(p) ? { event: "staff.customer_message", permissions: ["cargo_request.read.any"], vars: { ref: ref ?? "" }, ref, consolePath: `/cargo/${ref}` } : null
    case "quote.accepted":
      return p.via === "APP" ? { event: "staff.quote_accepted", permissions: ["flight_request.read.any"], vars: { ref: ref ?? "" }, ref, consolePath: `/requests/${ref}` } : null
    case "service_request.submitted":
      return { event: "staff.service_submitted", permissions: ["service_request.read.any"], vars: { ref: ref ?? "", service: str(p.service_en), service_en: str(p.service_en), service_fa: str(p.service_fa) }, ref, consolePath: `/services/${ref}` }
    case "service_request.message":
      return fromCustomer(p) ? { event: "staff.service_message", permissions: ["service_request.read.any"], vars: { ref: ref ?? "" }, ref, consolePath: `/services/${ref}` } : null
    case "support.ticket_created":
      return { event: "staff.support_ticket", permissions: ["support.read"], vars: { ref: ref ?? "", topic: str(p.topic)?.toLowerCase().replace(/_/g, " ") }, ref, consolePath: `/support/${ref}` }
    case "support.customer_replied":
      return { event: "staff.support_reply", permissions: ["support.read"], vars: { ref: ref ?? "" }, ref, consolePath: `/support/${ref}` }
    case "invoice.paid": {
      const number = str(p.number) ?? null
      return { event: "staff.invoice_paid", permissions: ["commercial_document.issue", "invoice.direct"], vars: { number: number ?? "" }, ref: number, consolePath: `/invoices/${str(p.invoiceId) ?? ""}` }
    }
    case "identity.submitted":
      // The document id stands in for a reference so opening the check reads the notification.
      return { event: "staff.identity_submitted", permissions: ["identity.verify"], vars: { name: str(p.travellerName) ?? "" }, ref: str(p.documentId) ?? null, consolePath: `/verifications/${str(p.documentId) ?? ""}` }
    default:
      return null
  }
}

const FEED = Object.keys(STAFF_FEED_EVENTS) as StaffFeedEvent[]
const categoryOf = (eventType: string): StaffNotificationCategory => STAFF_FEED_EVENTS[eventType as StaffFeedEvent] ?? "REQUEST"
const eventsOf = (c: StaffNotificationCategory) => FEED.filter((e) => STAFF_FEED_EVENTS[e] === c)

@Injectable()
export class StaffFeedService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly n: NotificationsService,
    private readonly access: AccessService,
  ) {}

  /** Outbox consumer (queue notify.staff). Idempotent: the inbox dedupe key is per event, user and type. */
  async handle(e: DispatchedEvent): Promise<void> {
    const item = feedItemFor(e)
    if (!item) return
    const userIds = [...new Set((await Promise.all(item.permissions.map((p) => this.access.usersWithPermission(p)))).flat())]
    if (!userIds.length) return
    await this.n.notify({
      eventType: item.event, eventId: e.id, audience: "STAFF", userIds, vars: item.vars,
      data: { category: STAFF_FEED_EVENTS[item.event], ref: item.ref, consolePath: item.consolePath },
    })
    // The console stream tells exactly these people to refresh their badges (requests.controllers.ts `events`).
    const signal: StaffSignal = { type: "staff.notification", aggregateType: "staff_notification", aggregateId: e.id, userIds }
    await this.redis.publish(STAFF_EVENTS_CHANNEL, JSON.stringify(signal))
  }

  private mine(userId: string) {
    return and(eq(notifications.userId, userId), like(notifications.eventType, "staff.%"), inArray(notifications.eventType, FEED))
  }

  async list(userId: string, q: StaffNotificationQuery): Promise<StaffNotificationPage> {
    const rows = await this.db.select().from(notifications).where(and(
      this.mine(userId),
      q.category ? inArray(notifications.eventType, eventsOf(q.category)) : undefined,
      q.unread === "1" ? isNull(notifications.readAt) : undefined,
      q.before ? lt(notifications.createdAt, new Date(q.before)) : undefined,
    )).orderBy(desc(notifications.createdAt)).limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    return {
      items: page.map((r): StaffNotification => {
        const d = r.data as { ref?: string | null; consolePath?: string | null }
        return { id: r.id, eventType: r.eventType, category: categoryOf(r.eventType), title: r.title, body: r.body, ref: d.ref ?? null, linkPath: d.consolePath ?? null, readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }
      }),
      nextBefore: rows.length > q.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
    }
  }

  async summary(userId: string): Promise<StaffNotificationSummary> {
    const rows = await this.db.select({ eventType: notifications.eventType, n: sql<number>`count(*)::int` }).from(notifications)
      .where(and(this.mine(userId), isNull(notifications.readAt))).groupBy(notifications.eventType)
    const unread: StaffNotificationSummary["unread"] = { total: 0, REQUEST: 0, SERVICE: 0, SUPPORT: 0, PAYMENT: 0, IDENTITY: 0 }
    for (const r of rows) { unread[categoryOf(r.eventType)] += r.n; unread.total += r.n }
    return { unread }
  }

  /** Marks the caller's own rows only; returns how many changed so the console can skip a refetch. */
  async markRead(userId: string, b: MarkStaffNotificationsBody): Promise<{ updated: number }> {
    const which = b.ids ? inArray(notifications.id, b.ids)
      : b.category ? inArray(notifications.eventType, eventsOf(b.category))
        : b.ref ? sql`${notifications.data}->>'ref' = ${b.ref}`
          : undefined
    const done = await this.db.update(notifications).set({ readAt: new Date() }).where(and(this.mine(userId), isNull(notifications.readAt), which)).returning({ id: notifications.id })
    return { updated: done.length }
  }
}
