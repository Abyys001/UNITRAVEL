import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import { and, count, desc, eq, gte, ilike, isNull, lt, lte, notExists, or, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import {
  ACTIVITY_RETENTION_DAYS, type ActivityBody, type ActivityScreen, type CustomerActivityView, type CustomerListItem, type CustomerListPage, type CustomerListQuery, ONLINE_WINDOW_MINUTES,
} from "@unitravel/contracts"
import {
  cargoRequests, customerActivity, type Db, flightRequests, roles, serviceRequests, sessions, userIdentities, userRoles, users,
} from "@unitravel/db"

import { notFound } from "../../core/errors"
import type { Actor } from "../../core/http/decorators"
import { ipPrefix } from "../../core/http/rate-limit"
import { DB, REDIS } from "../../core/infra.module"
import { WorkerRegistry } from "../../core/workers"
import { Queues } from "../../core/queues"
import { AuditService, maskValue } from "../audit/audit.service"

const CLIENT = { web: "WEB", mobile: "MOBILE", console: "CONSOLE" } as const
const iso = (d: Date | null) => d?.toISOString() ?? null
/** One screen event per customer per 2 seconds is kept: a client re-rendering must not become a click stream. */
const SCREEN_THROTTLE_SECONDS = 2

/** The opt-outs a client can express: a browser signal or the customer's own setting. Sign-in and sign-out rows are security records and ignore them. */
export function trackingDeclined(headers: { dnt?: string; gpc?: string }, prefs: Record<string, boolean> | null): boolean {
  return headers.dnt === "1" || headers.gpc === "1" || prefs?.activity_tracking === false
}

/** Customer activity (ADR-0018): screen names only, 90-day retention, masked list for staff. */
@Injectable()
export class ActivityService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly workers: WorkerRegistry,
    private readonly queues: Queues,
  ) {}

  async onModuleInit() {
    this.workers.registerJob("maintenance", "activity.prune", () => this.prune())
    await this.queues.get("maintenance").upsertJobScheduler("activity-prune-daily", { every: 24 * 3600_000 }, { name: "activity.prune" }).catch(() => undefined)
  }

  async prune(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * 86400_000)
    const rows = await this.db.delete(customerActivity).where(lt(customerActivity.occurredAt, cutoff)).returning({ id: customerActivity.id })
    return { deleted: rows.length }
  }

  /** Returns true when a row was stored. Staff console sessions are never tracked. */
  async recordScreen(actor: Actor, body: ActivityBody, headers: { dnt?: string; gpc?: string }): Promise<boolean> {
    if (actor.audience === "console") return false
    const [u] = await this.db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.userId))
    if (trackingDeclined(headers, u?.prefs ?? null)) return false
    if ((await this.redis.set(`act:${actor.userId}`, "1", "EX", SCREEN_THROTTLE_SECONDS, "NX")) !== "OK") return false
    await this.db.insert(customerActivity).values({ userId: actor.userId, sessionId: actor.sessionId, kind: "SCREEN_VIEW", screen: body.screen, ref: body.ref ?? null, client: CLIENT[actor.audience], network: actor.ip ? ipPrefix(actor.ip) : null })
    return true
  }

  // ---------------- staff views ----------------

  async customers(q: CustomerListQuery): Promise<CustomerListPage> {
    const identityMatch = (extra: ReturnType<typeof sql>) => sql`exists (select 1 from user_identities ui where ui.user_id = ${users.id} and ui.revoked_at is null ${extra})`
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, "\\$&")}%` : null
    const conds = [
      // Staff are not customers: anyone holding a role other than "customer" is left out of this list.
      notExists(this.db.select({ x: sql`1` }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(userRoles.userId, users.id), sql`${roles.key} <> 'customer'`))),
      q.status ? eq(users.status, q.status) : undefined,
      q.seenFrom ? gte(users.lastActiveAt, new Date(q.seenFrom)) : undefined,
      q.seenTo ? lte(users.lastActiveAt, new Date(q.seenTo)) : undefined,
      q.verified === undefined ? undefined : q.verified ? identityMatch(sql`and ui.verified_at is not null`) : sql`not ${identityMatch(sql`and ui.verified_at is not null`)}`,
      like ? or(ilike(users.displayName, like), identityMatch(sql`and ui.value_normalised ilike ${like}`)) : undefined,
      q.cursor ? lt(users.id, q.cursor) : undefined,
    ].filter(Boolean)
    const rows = await this.db.select().from(users).where(and(...conds)).orderBy(desc(users.id)).limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    const items = await Promise.all(page.map((u) => this.listItem(u)))
    return { items, nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null }
  }

  private async listItem(u: typeof users.$inferSelect): Promise<CustomerListItem> {
    const [ids, [screen], [signIns], flights, cargo, services] = await Promise.all([
      this.db.select().from(userIdentities).where(and(eq(userIdentities.userId, u.id), isNull(userIdentities.revokedAt))),
      this.db.select({ screen: customerActivity.screen }).from(customerActivity).where(and(eq(customerActivity.userId, u.id), eq(customerActivity.kind, "SCREEN_VIEW"))).orderBy(desc(customerActivity.occurredAt)).limit(1),
      this.db.select({ n: count() }).from(sessions).where(eq(sessions.userId, u.id)),
      this.db.select({ n: count() }).from(flightRequests).where(and(eq(flightRequests.customerUserId, u.id), isNull(flightRequests.closedAt))),
      this.db.select({ n: count() }).from(cargoRequests).where(and(eq(cargoRequests.customerUserId, u.id), isNull(cargoRequests.closedAt))),
      this.db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.customerUserId, u.id), isNull(serviceRequests.closedAt))),
    ])
    const email = ids.find((i) => i.type === "EMAIL")
    const phone = ids.find((i) => i.type === "PHONE" && i.isPrimary) ?? ids.find((i) => i.type === "PHONE")
    return {
      id: u.id, displayName: u.displayName, email: email ? String(maskValue("email", email.valueNormalised)) : null, phone: phone ? String(maskValue("phone", phone.valueNormalised)) : null,
      verified: ids.some((i) => !!i.verifiedAt), status: u.status, createdAt: u.createdAt.toISOString(), lastActiveAt: iso(u.lastActiveAt),
      online: !!u.lastActiveAt && Date.now() - u.lastActiveAt.getTime() < ONLINE_WINDOW_MINUTES * 60_000,
      lastScreen: (screen?.screen as ActivityScreen | undefined) ?? null, openRequests: (flights[0]?.n ?? 0) + (cargo[0]?.n ?? 0) + (services[0]?.n ?? 0), signInCount: signIns?.n ?? 0,
    }
  }

  async activityOf(customerId: string, q: { limit: number; cursor?: string }, actor: Actor, requestId?: string): Promise<CustomerActivityView> {
    const [u] = await this.db.select().from(users).where(eq(users.id, customerId))
    if (!u) throw notFound("Customer")
    const [isStaffRole] = await this.db.select({ x: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(userRoles.userId, customerId), sql`${roles.key} <> 'customer'`)).limit(1)
    if (isStaffRole) throw notFound("Customer")
    const rows = await this.db.select().from(customerActivity).where(and(eq(customerActivity.userId, customerId), q.cursor ? lt(customerActivity.id, q.cursor) : undefined)).orderBy(desc(customerActivity.id)).limit(q.limit + 1)
    const all = await this.db.select().from(sessions).where(eq(sessions.userId, customerId)).orderBy(desc(sessions.createdAt))
    const live = (s: typeof sessions.$inferSelect) => !s.revokedAt && s.absoluteExpiresAt > new Date()
    // Viewing someone's activity is itself recorded (ADR-0018).
    await this.db.transaction((tx) => this.audit.record(tx, { actorUserId: actor.userId, actorKind: "STAFF", action: "customer.activity_viewed", entityType: "user", entityId: customerId, ip: actor.ip, requestId }))
    return {
      customerId, retentionDays: ACTIVITY_RETENTION_DAYS, trackingEnabled: u.notificationPrefs.activity_tracking !== false,
      sessions: {
        active: all.filter(live).length, total: all.length,
        recent: all.slice(0, 10).map((s) => ({ id: s.id, client: s.client, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), active: live(s), revokedReason: s.revokedReason })),
      },
      activity: {
        items: rows.slice(0, q.limit).map((a) => ({ id: a.id, kind: a.kind, screen: (a.screen as ActivityScreen | null) ?? null, ref: a.ref, client: a.client, network: a.network, occurredAt: a.occurredAt.toISOString() })),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      },
    }
  }
}
