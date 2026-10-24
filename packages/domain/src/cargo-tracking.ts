import type { TrackingEventCode } from "@unitravel/contracts"

/** Code a correction uses to withdraw an event without replacing it. */
export const RETRACTED = "RETRACTED"

export type TrackingSource = "STAFF" | "PARTNER_API"

/** One stored row of `tracking_events`. Rows are append-only; a correction is a row that points at the one it replaces. */
export interface TrackingRecord {
  id: string
  eventCode: string
  location: string
  occurredAt: string
  description?: string | null
  correctsEventId?: string | null
  createdAt: string
}

export interface EffectiveTrackingEvent {
  /** Id of the original event, stable across corrections. */
  id: string
  eventCode: TrackingEventCode
  location: string
  occurredAt: string
  description?: string
  corrected: boolean
}

/** An event as a source reports it, before storage. Partner sources carry their own id for deduplication. */
export interface IncomingTrackingEvent {
  externalEventId: string | null
  eventCode: string
  location: string
  occurredAt: string
  description?: string
}

export interface TrackingShipmentRef { ref: string; awbNumber: string | null }

/**
 * Port for whatever supplies tracking events (ch. 14.5, 14.8): staff entry today, a partner API later. Framework-free
 * like the supplier ports; the API owns storage, deduplication and audit.
 */
export interface CargoTrackingPort {
  readonly source: TrackingSource
  fetchEvents(shipment: TrackingShipmentRef): Promise<IncomingTrackingEvent[]>
}

/** Staff entry: the events were typed by a person, so fetching just hands them over. No external id. */
export class ManualTrackingAdapter implements CargoTrackingPort {
  readonly source = "STAFF" as const
  constructor(private readonly entered: Omit<IncomingTrackingEvent, "externalEventId">[]) {}
  async fetchEvents(): Promise<IncomingTrackingEvent[]> {
    return this.entered.map((e) => ({ ...e, externalEventId: null }))
  }
}

/** Keeps the first occurrence of each external id; events with no id are always kept (staff entry). */
export function dedupeIncoming(events: IncomingTrackingEvent[], alreadyStored: ReadonlySet<string> = new Set()): IncomingTrackingEvent[] {
  const seen = new Set(alreadyStored)
  return events.filter((e) => {
    if (e.externalEventId === null) return true
    if (seen.has(e.externalEventId)) return false
    seen.add(e.externalEventId)
    return true
  })
}

/**
 * The timeline a customer sees: every original event with its latest correction applied. Pure and order-independent
 * of the input; never mutates the records. A correction of a correction resolves to the original event; a correction
 * whose target is unknown is ignored; the latest correction (by createdAt, then input order) wins.
 */
export function effectiveTimeline(records: readonly TrackingRecord[]): EffectiveTrackingEvent[] {
  const byId = new Map(records.map((r) => [r.id, r]))
  const rootOf = (r: TrackingRecord): TrackingRecord | undefined => {
    let cur = r
    for (let hops = 0; cur.correctsEventId && hops <= records.length; hops++) {
      const next = byId.get(cur.correctsEventId)
      if (!next) return undefined
      cur = next
    }
    return cur.correctsEventId ? undefined : cur
  }
  const winner = new Map<string, TrackingRecord>()
  records.forEach((r) => {
    if (!r.correctsEventId) return
    const root = rootOf(r)
    if (!root) return
    const prev = winner.get(root.id)
    if (!prev || r.createdAt >= prev.createdAt) winner.set(root.id, r)
  })
  const out: (EffectiveTrackingEvent & { createdAt: string })[] = []
  for (const r of records) {
    if (r.correctsEventId) continue
    const w = winner.get(r.id)
    const src = w ?? r
    if (src.eventCode === RETRACTED) continue
    out.push({ id: r.id, eventCode: src.eventCode as TrackingEventCode, location: src.location, occurredAt: src.occurredAt, description: src.description ?? undefined, corrected: !!w, createdAt: r.createdAt })
  }
  return out
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(({ createdAt: _c, ...e }) => e)
}

/** Ids of the rows that are the effective version of an event (the original when uncorrected, else the winning correction). */
export function effectiveRecordIds(records: readonly TrackingRecord[]): Set<string> {
  const byId = new Map(records.map((r) => [r.id, r]))
  const ids = new Set<string>()
  const winner = new Map<string, TrackingRecord>()
  for (const r of records) {
    if (!r.correctsEventId) continue
    let cur: TrackingRecord | undefined = r
    for (let hops = 0; cur?.correctsEventId && hops <= records.length; hops++) cur = byId.get(cur.correctsEventId)
    if (!cur || cur.correctsEventId) continue
    const prev = winner.get(cur.id)
    if (!prev || r.createdAt >= prev.createdAt) winner.set(cur.id, r)
  }
  for (const r of records) {
    if (r.correctsEventId) continue
    const src = winner.get(r.id) ?? r
    if (src.eventCode !== RETRACTED) ids.add(src.id)
  }
  return ids
}

export const lastEvent = (timeline: readonly EffectiveTrackingEvent[]) => timeline.at(-1) ?? null
