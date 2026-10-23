import { Injectable } from "@nestjs/common"

import { outboxEvents, type DbOrTx } from "@unitravel/db"

export interface DomainEvent {
  aggregateType: string
  aggregateId: string
  eventType: string
  /** Identifiers and minimum context only, never full personal data (ch. 26.3). */
  payload: Record<string, unknown>
  dedupeKey?: string
}

/** Writes events in the caller's transaction; the worker dispatches them (ch. 26.1). */
@Injectable()
export class OutboxService {
  async add(tx: DbOrTx, ...events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return
    await tx.insert(outboxEvents).values(events.map((e) => ({
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload,
      dedupeKey: e.dedupeKey ?? `${e.eventType}:${e.aggregateId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    })))
  }
}
