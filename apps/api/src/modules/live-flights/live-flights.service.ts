import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common"
import type { Redis } from "ioredis"
import { z } from "zod"

import { type LiveFlightItem, type LiveFlightRegion, type LiveFlightsQuery, type LiveFlightsView } from "@unitravel/contracts"

import { env } from "../../core/env"
import { REDIS } from "../../core/infra.module"
import { PROCESS_ROLE, type ProcessRole } from "../../core/workers"

const SOURCE_URL = "https://api.adsb.lol/v2/lat"
const RADIUS_NM = 250
/** OBSERVED 1 Nov 2026: a sixth request about two seconds apart got HTTP 429. The source publishes no limit. */
const TICK_MS = 6_000
const DEFAULT_COOLDOWN_S = 120
/** Long enough for a full pass over AREAS, short enough that an aircraft from a failed area disappears rather than lingers. */
const AREA_TTL_S = 360
const CURSOR_KEY = "liveflights:cursor"
const LOCK_KEY = "liveflights:lock"
const COOLDOWN_KEY = "liveflights:cooldown"
const areaKey = (i: number) => `liveflights:area:${i}`

/** Circle centres that together cover the regions, because the source caps one query at 250 nm and has no area-wide call. */
export const AREAS: ReadonlyArray<readonly [lat: number, lon: number]> = [
  [24.5, 54.5], // UAE
  [39, 29], [39, 37], // Turkey
  [35.7, 49], [35.7, 57], [29.5, 52.6], [29.5, 60], // Iran
  [38, -6], [38, 3], [38, 12], [38, 21], // Europe, south to north
  [44, -2], [44, 8], [44, 18], [44, 28],
  [50, -6], [50, 5], [50, 15], [50, 25], [50, 35],
  [56, -3], [56, 10], [56, 22], [56, 33],
  [62, 8], [62, 20], [62, 30],
]

/** Rectangles, first match wins so the smaller regions are not swallowed by Europe. They include some neighbouring airspace. */
const REGION_BOXES: ReadonlyArray<readonly [LiveFlightRegion, latMin: number, latMax: number, lonMin: number, lonMax: number]> = [
  ["UAE", 22.5, 26.3, 51.5, 56.5],
  ["TURKEY", 35.8, 42.2, 26, 44.8],
  ["IRAN", 25, 39.8, 44, 63.5],
  ["EUROPE", 35, 72, -25, 45],
]

export function regionOf(lat: number, lon: number): LiveFlightRegion | null {
  for (const [region, latMin, latMax, lonMin, lonMax] of REGION_BOXES) if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) return region
  return null
}

// Untrusted upstream data. Only the fields used are read; anything malformed is dropped row by row.
const SourceAircraft = z.object({
  hex: z.string(), flight: z.string().optional(), t: z.string().optional(), category: z.string().optional(),
  lat: z.number().optional(), lon: z.number().optional(), alt_baro: z.union([z.number(), z.string()]).optional(),
  gs: z.number().optional(), seen_pos: z.number().optional(), seen: z.number().optional(), dbFlags: z.number().optional(),
})
const SourceResponse = z.object({ ac: z.array(z.unknown()) })

const AIRLINE_CALLSIGN = /^[A-Z]{3}[0-9][A-Z0-9]{0,3}$/
const NON_AIRLINE_CATEGORY = /^(A1|A7|[BCD])/
/** dbFlags bits: 1 military, 4 PIA (privacy address), 8 LADD (owner asked not to be displayed). */
const HIDDEN_FLAGS = 1 | 4 | 8

/**
 * Keeps airline flights in the air. A private aircraft's registration or callsign can identify a person (DPIA R20), so only
 * ICAO airline-format callsigns pass, and military and owner-restricted aircraft are never shown.
 */
export function toLiveItem(raw: unknown, nowMs: number): LiveFlightItem | null {
  const a = SourceAircraft.safeParse(raw)
  if (!a.success) return null
  const { hex, t, category, lat, lon, alt_baro: alt, gs, dbFlags } = a.data
  const callsign = a.data.flight?.trim() ?? ""
  if (!/^[0-9a-f]{6}$/.test(hex) || (category && NON_AIRLINE_CATEGORY.test(category)) || !AIRLINE_CALLSIGN.test(callsign)) return null
  if ((dbFlags ?? 0) & HIDDEN_FLAGS) return null
  if (lat === undefined || lon === undefined || typeof alt !== "number") return null
  const region = regionOf(lat, lon)
  if (!region) return null
  const ageS = a.data.seen_pos ?? a.data.seen ?? 0
  return {
    label: "LIVE_POSITION", hex, callsign, aircraftType: t?.slice(0, 8) || null, region, altitudeFt: Math.round(alt),
    groundSpeedKt: gs === undefined ? null : Math.max(0, Math.round(gs)), seenAt: new Date(nowMs - ageS * 1000).toISOString(),
  }
}

interface AreaSnapshot { fetchedAt: string; items: LiveFlightItem[] }

/** Overlapping areas report the same aircraft: the newest position wins. */
export function buildView(snapshots: AreaSnapshot[], q: LiveFlightsQuery): LiveFlightsView {
  const byHex = new Map<string, LiveFlightItem>()
  for (const s of snapshots) for (const i of s.items) {
    const held = byHex.get(i.hex)
    if (!held || i.seenAt > held.seenAt) byHex.set(i.hex, i)
  }
  const all = [...byHex.values()]
  const regions = { EUROPE: 0, TURKEY: 0, UAE: 0, IRAN: 0 }
  for (const i of all) regions[i.region]++
  const matches = all.filter((i) => (!q.region || i.region === q.region) && (!q.q || i.callsign.startsWith(q.q))).sort((a, b) => a.callsign.localeCompare(b.callsign))
  return {
    items: matches.slice(0, q.limit), total: matches.length, regions,
    updatedAt: snapshots.map((s) => s.fetchedAt).sort().pop() ?? null,
    notice: snapshots.length ? null : "NO_DATA",
  }
}

/**
 * Live positions from adsb.lol (ADR-0027). One worker polls one area per tick and holds the result briefly in Valkey, so
 * customer traffic never reaches the source and no position history is stored.
 */
@Injectable()
export class LiveFlightsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("LiveFlights")
  private timer?: NodeJS.Timeout

  constructor(@Inject(REDIS) private readonly redis: Redis, @Inject(PROCESS_ROLE) private readonly role: ProcessRole) {}

  onApplicationBootstrap() {
    if (this.role !== "worker" || env().LIVE_FLIGHTS_SOURCE === "off") return
    this.timer = setInterval(() => void this.tick().catch((err: Error) => this.log.warn({ err: err.message }, "poll failed")), TICK_MS)
    this.timer.unref()
  }

  onApplicationShutdown() {
    clearInterval(this.timer)
  }

  async tick(now = Date.now()): Promise<void> {
    if (await this.redis.exists(COOLDOWN_KEY)) return
    // The lock keeps the request rate the same however many workers run.
    if ((await this.redis.set(LOCK_KEY, "1", "PX", TICK_MS - 500, "NX")) !== "OK") return
    const i = (await this.redis.incr(CURSOR_KEY)) % AREAS.length
    const [lat, lon] = AREAS[i]!
    const res = await fetch(`${SOURCE_URL}/${lat}/lon/${lon}/dist/${RADIUS_NM}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) })
    if (res.status === 429) {
      const seconds = Number(res.headers.get("retry-after")) || DEFAULT_COOLDOWN_S
      await this.redis.set(COOLDOWN_KEY, "1", "EX", seconds)
      this.log.warn({ seconds }, "source rate limit, pausing")
      return
    }
    if (!res.ok) throw new Error(`source answered ${res.status}`)
    const body = SourceResponse.parse(await res.json())
    const items = body.ac.flatMap((a) => toLiveItem(a, now) ?? [])
    const snapshot: AreaSnapshot = { fetchedAt: new Date(now).toISOString(), items }
    await this.redis.set(areaKey(i), JSON.stringify(snapshot), "EX", AREA_TTL_S)
  }

  async list(q: LiveFlightsQuery): Promise<LiveFlightsView> {
    if (env().LIVE_FLIGHTS_SOURCE === "off") return { items: [], total: 0, regions: { EUROPE: 0, TURKEY: 0, UAE: 0, IRAN: 0 }, updatedAt: null, notice: "OFF" }
    const held = await this.redis.mget(AREAS.map((_, i) => areaKey(i)))
    return buildView(held.flatMap((s) => (s ? [JSON.parse(s) as AreaSnapshot] : [])), q)
  }
}
