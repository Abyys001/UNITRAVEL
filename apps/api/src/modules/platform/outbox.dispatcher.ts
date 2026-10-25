import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common"
import { sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { type Db, outboxEvents } from "@unitravel/db"

import { env } from "../../core/env"
import { DB, REDIS } from "../../core/infra.module"
import { type QueueName, Queues } from "../../core/queues"
import { STAFF_EVENT_AGGREGATES, STAFF_EVENTS_CHANNEL } from "./staff-events"

/** Which consumers react to which domain events (ch. 26.3). */
export const EVENT_ROUTES: Record<string, QueueName[]> = {
  "auth.otp_requested": ["notify.sms"],
  "user.registered": ["compliance.screen"],
  "identity.verified": ["compliance.screen"],
  "security.new_sign_in": ["notify.route"],
  "user.permissions_changed": ["notify.route"],
  "traveller.updated": ["compliance.screen"],
  "flight_request.submitted": ["compliance.screen", "notify.route", "timers.sla"],
  "flight_request.transitioned": ["notify.route", "timers.sla"],
  "flight_request.message": ["notify.route"],
  "quote.sent": ["notify.route", "timers.sla"],
  "quote.accepted": ["notify.route"],
  "invoice.issued": ["notify.route"],
  "invoice.cancelled": ["notify.route"],
  "invoice.expired": ["notify.route"],
  "reservation.recorded": ["notify.route", "timers.sla"],
  "ticket.recorded": ["notify.route", "timers.sla"],
  "payment.recorded": ["compliance.screen"],
  // Recorded for the audit trail and the staff stream; nothing consumes it yet. An empty list is deliberate and keeps it off events.misc.
  "payment.verified": [],
  "cargo_request.submitted": ["compliance.screen", "notify.route", "timers.sla"],
  "cargo_request.transitioned": ["notify.route", "timers.sla"],
  "cargo_request.message": ["notify.route"],
  "compliance.case_opened": ["notify.route"],
  "compliance.case_decided": ["notify.route"],
  "partner.updated": ["compliance.screen"],
  "provider.health_changed": ["notify.route"],
  "notification.route_degraded": ["notify.route"],
  "identity.verification_decided": ["notify.route"],
  "document.uploaded": ["documents.scan"],
  "document.published": ["notify.route"],
}

/** Events every process must react to immediately (config reload, provider switch-off) go out on pub/sub too. */
const BROADCAST = new Set(["config.published", "provider.health_changed", "provider.config_changed", "user.permissions_changed"])

@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("Outbox")
  private timer?: NodeJS.Timeout
  private running = false
  private readonly instance = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly queues: Queues) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), env().OUTBOX_POLL_MS)
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer)
  }

  /** One leader at a time (concurrency 1); FOR UPDATE SKIP LOCKED keeps it safe even if two overlap. */
  async tick(): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const leader = await this.redis.set("outbox:leader", this.instance, "PX", 5000, "NX")
      const isLeader = leader === "OK" || (await this.redis.get("outbox:leader")) === this.instance
      if (!isLeader) return 0
      await this.redis.pexpire("outbox:leader", 5000)
      return await this.dispatchBatch()
    } catch (err) {
      this.log.error({ err }, "outbox tick failed")
      return 0
    } finally {
      this.running = false
    }
  }

  private readonly unroutedLogged = new Set<string>()

  private logUnrouted(type: string) {
    if (this.unroutedLogged.has(type)) return
    this.unroutedLogged.add(type)
    this.log.warn({ type }, "outbox event has no consumer; marked dispatched (add it to EVENT_ROUTES if something should react)")
  }

  async dispatchBatch(limit = 100): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`select id, event_type, aggregate_type, aggregate_id, payload, dedupe_key, created_at from outbox_events where dispatched_at is null order by created_at limit ${limit} for update skip locked`)).rows as {
        id: string; event_type: string; aggregate_type: string; aggregate_id: string; payload: Record<string, unknown>; dedupe_key: string; created_at: Date
      }[]
      for (const r of rows) {
        const event = { id: r.id, type: r.event_type, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, payload: r.payload, occurredAt: new Date(r.created_at).toISOString() }
        try {
          const routes = EVENT_ROUTES[r.event_type] ?? []
          // No consumer: the row is still marked dispatched (below). Parking it on a queue nobody reads only piled up jobs.
          if (!EVENT_ROUTES[r.event_type] && !BROADCAST.has(r.event_type)) this.logUnrouted(r.event_type)
          for (const q of routes) {
            // jobId dedupes: a re-dispatched outbox row never creates a second job for the same consumer.
            await this.queues.get(q).add(r.event_type, event, { jobId: `${q}--${r.id}`, priority: r.event_type === "auth.otp_requested" ? 1 : undefined })
          }
          if (BROADCAST.has(r.event_type)) await this.redis.publish(r.event_type, JSON.stringify(event))
          // Identifiers only: the console stream re-reads counts and versions through the API (ch. 29.2).
          if (STAFF_EVENT_AGGREGATES.has(r.aggregate_type)) await this.redis.publish(STAFF_EVENTS_CHANNEL, JSON.stringify({ type: r.event_type, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id }))
          await tx.update(outboxEvents).set({ dispatchedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` }).where(sql`id = ${r.id}`)
        } catch (err) {
          await tx.update(outboxEvents).set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: String(err) }).where(sql`id = ${r.id}`)
        }
      }
      return rows.length
    })
  }
}

export interface DispatchedEvent<P = Record<string, unknown>> {
  id: string
  type: string
  aggregateType: string
  aggregateId: string
  payload: P
  occurredAt: string
}
