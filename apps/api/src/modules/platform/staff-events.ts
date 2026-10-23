import { Injectable, type OnApplicationShutdown } from "@nestjs/common"
import type { Redis } from "ioredis"

import { newRedis } from "../../core/infra.module"

/** Pub/sub channel the outbox dispatcher publishes request-affecting events to, for the console stream (ch. 29.2). */
export const STAFF_EVENTS_CHANNEL = "staff:events"
export const STAFF_EVENT_AGGREGATES = new Set(["flight_request", "cargo_request", "compliance_case"])

export interface StaffSignal {
  type: string
  aggregateType: string
  aggregateId: string
}

/** One Redis subscription per API process, fanned out to every open console stream. */
@Injectable()
export class StaffEvents implements OnApplicationShutdown {
  private sub?: Redis
  private readonly listeners = new Set<(s: StaffSignal) => void>()

  listen(fn: (s: StaffSignal) => void): () => void {
    if (!this.sub) {
      this.sub = newRedis()
      void this.sub.subscribe(STAFF_EVENTS_CHANNEL)
      this.sub.on("message", (_c, msg) => {
        let s: StaffSignal
        try { s = JSON.parse(msg) as StaffSignal } catch { return }
        for (const l of this.listeners) l(s)
      })
    }
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  onApplicationShutdown() {
    this.sub?.disconnect()
  }
}
