import { createHash } from "node:crypto"

import type { CargoTrackingPort, IncomingTrackingEvent, TrackingShipmentRef } from "@unitravel/domain"

/**
 * TrackingMore air waybill tracking (ADR-0040 D5).
 *
 * Evidence: DOCUMENTED in the vendor's official SDKs (github.com/TrackingMore-API, Node.js, PHP, Python, Go, Java), because the
 * web docs answer automated clients with 403: base `https://api.trackingmore.com/v4`, header `Tracking-Api-Key`, `POST /awb` with
 * `{ awb_number: "235-69030430" }`, envelope `{ meta: { code, type, message }, data }`, error meta codes 4160 (bad AWB), 4161 (airline
 * not supported yet), 4190 (plan quota), HTTP 401/403/429. The `data` shape is the SDK's AirWaybill model (`track_info[]`, `airline_info`).
 * UNKNOWN (docs unreadable): the webhook signature scheme, whether checkpoint dates carry a zone, and the full checkpoint_status
 * vocabulary. So there is no webhook receiver (the poll job does the work), dates are read as UTC and dropped when unparseable, and
 * only the status `delivered` is mapped to one of our codes; everything else is kept as the provider's own words (code NOTE).
 */
export const TRACKINGMORE_BASE = "https://api.trackingmore.com/v4"
const CALL_TIMEOUT_MS = 20_000

export type TrackingMoreFailure = "AUTH" | "INVALID_AWB" | "AIRLINE_UNSUPPORTED" | "QUOTA" | "RATE_LIMITED" | "UNAVAILABLE"

/** Messages never contain the key or the URL: they are rebuilt from the status or meta code alone. */
export class TrackingMoreError extends Error {
  constructor(readonly failure: TrackingMoreFailure, message: string) {
    super(message)
    this.name = "TrackingMoreError"
  }
}

export interface AwbLookup { airline: string | null; events: IncomingTrackingEvent[] }

interface AwbTrackInfo { plan_date?: string | null; actual_date?: string | null; event?: string | null; station?: string | null; flight_number?: string | null; status?: string | null; checkpoint_status?: string | null }
interface AwbEnvelope { meta?: { code?: number; type?: string }; data?: { airline_info?: { name?: string | null } | null; track_info?: AwbTrackInfo[] | null } | null }

/** Only a status whose meaning is unambiguous is mapped; the rest stays the provider's text. */
const MAPPED_STATUS: Record<string, string> = { delivered: "DELIVERED" }

function parseWhen(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Pure: the envelope's `data` onto our incoming events. A checkpoint without a usable date is dropped, never given one. */
export function awbEvents(awb: string, data: NonNullable<AwbEnvelope["data"]>): IncomingTrackingEvent[] {
  const out: IncomingTrackingEvent[] = []
  for (const t of data.track_info ?? []) {
    const occurredAt = parseWhen(t.actual_date) ?? parseWhen(t.plan_date)
    if (!occurredAt) continue
    const words = [t.event, t.status].map((x) => x?.trim()).filter((x): x is string => !!x)
    if (t.flight_number?.trim()) words.push(t.flight_number.trim())
    const id = createHash("sha256").update([awb, occurredAt, t.event, t.station, t.flight_number, t.status, t.checkpoint_status].map((x) => x ?? "").join("|")).digest("hex").slice(0, 40)
    out.push({
      externalEventId: `tm:${id}`,
      eventCode: MAPPED_STATUS[(t.checkpoint_status ?? "").toLowerCase()] ?? "NOTE",
      location: t.station?.trim() || "—",
      occurredAt,
      description: words.join(" · ") || undefined,
    })
  }
  return out
}

export function parseAwbResponse(awb: string, httpStatus: number, body: unknown): AwbLookup {
  const env = (body ?? {}) as AwbEnvelope
  const code = env.meta?.code ?? httpStatus
  if (code === 401 || code === 403) throw new TrackingMoreError("AUTH", `TrackingMore ${code}`)
  if (code === 4160) throw new TrackingMoreError("INVALID_AWB", "TrackingMore 4160: AWB number rejected")
  if (code === 4161) throw new TrackingMoreError("AIRLINE_UNSUPPORTED", "TrackingMore 4161: airline not supported")
  if (code === 4190) throw new TrackingMoreError("QUOTA", "TrackingMore 4190: plan quota reached")
  if (code === 429) throw new TrackingMoreError("RATE_LIMITED", "TrackingMore 429")
  if (code !== 200 || !env.data) throw new TrackingMoreError("UNAVAILABLE", `TrackingMore answered ${code}`)
  return { airline: env.data.airline_info?.name?.trim() || null, events: awbEvents(awb, env.data) }
}

/** `CargoTrackingPort` over `POST /awb`. The API key is held only here and sent only as the vendor's header. */
export class TrackingMoreAdapter implements CargoTrackingPort {
  readonly source = "PARTNER_API" as const
  /** Airline name of the last successful lookup. */
  airline: string | null = null

  constructor(private readonly apiKey: string, private readonly base = TRACKINGMORE_BASE) {}

  async lookup(awb: string): Promise<AwbLookup> {
    let res: Response
    try {
      res = await fetch(`${this.base}/awb`, {
        method: "POST", signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        headers: { "content-type": "application/json", accept: "application/json", "Tracking-Api-Key": this.apiKey },
        body: JSON.stringify({ awb_number: awb }),
      })
    } catch (err) {
      // fetch errors can carry the URL in their cause; only the error name is kept.
      throw new TrackingMoreError("UNAVAILABLE", `TrackingMore unreachable: ${(err as Error).name}`)
    }
    let body: unknown = null
    try { body = JSON.parse(await res.text()) } catch { if (res.ok) throw new TrackingMoreError("UNAVAILABLE", "TrackingMore answered with invalid JSON") }
    const found = parseAwbResponse(awb, res.status, body)
    this.airline = found.airline
    return found
  }

  async fetchEvents(shipment: TrackingShipmentRef): Promise<IncomingTrackingEvent[]> {
    return shipment.awbNumber ? (await this.lookup(shipment.awbNumber)).events : []
  }
}
