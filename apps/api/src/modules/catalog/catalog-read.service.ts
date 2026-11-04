import { createHash, randomBytes } from "node:crypto"

import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import type { Redis } from "ioredis"

import { type CatalogDateGroup, type CatalogRoutesResponse, type CatalogSearchQuery, type CatalogSearchResponse, type CatalogSettings, type CatalogState, DEFAULT_CATALOG_SETTINGS, type PublicItinerary, PublicItineraryDetail } from "@unitravel/contracts"
import { catalogPublicSnapshots, catalogSlots, type Db, flightResults, flightWatchlistRoutes } from "@unitravel/db"
import { daysOut, tierFor } from "@unitravel/engine"

import { AppError } from "../../core/errors"
import { DB, REDIS } from "../../core/infra.module"
import { ReferenceService } from "../reference/reference.service"
import { etagOf } from "./catalog-model"
import { CatalogSettingsService } from "./catalog-settings.service"
import { datesKey, latestKey, SNAPSHOT_TTL_S, type SnapshotBlob, slotIndexKey, snapshotKey } from "./catalog-write.service"

type RouteRow = typeof flightWatchlistRoutes.$inferSelect

const HOUR = 3_600_000
const DAY = 86_400_000
const ROUTES_CACHE_MS = 60_000
const NEARBY_LIMIT = 8
const DEMAND_VIEW = 1
export const DEMAND_REQUEST = 5

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const shift = (date: string, n: number) => isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY))

export interface SearchOutcome {
  body: CatalogSearchResponse
  etag: string
  /** False for UNAVAILABLE: a failure must not be cached by a CDN. */
  cacheable: boolean
}

/** Adds to the demand counters (spec §4.4). Redis only; the hourly fold moves them into the slots. Never throws: demand is a hint, not a requirement. */
export async function bumpDemand(redis: Pick<Redis, "incrby" | "expire">, origin: string, destination: string, date: string, by: number) {
  try {
    const key = `demand:${origin}:${destination}:${date}`
    await redis.incrby(key, by)
    await redis.expire(key, 3 * DAY / 1000)
  } catch { /* a lost hint */ }
}

/**
 * ADR-0034 C1: the customer read path. It reads Redis, then the snapshot table, and nothing else: no provider, no result row, no price.
 * This class has no dependency that could start a provider call.
 */
@Injectable()
export class CatalogReadService {
  private readonly log = new Logger("CatalogRead")
  private routesCache?: { at: number; rows: RouteRow[] }
  private salt?: { day: string; value: string }

  constructor(@Inject(DB) private readonly db: Db, @Inject(REDIS) private readonly redis: Redis, private readonly cfg: CatalogSettingsService, private readonly reference: ReferenceService) {}

  // ---------------- routes ----------------

  private async routes(): Promise<RouteRow[]> {
    if (this.routesCache && Date.now() - this.routesCache.at < ROUTES_CACHE_MS) return this.routesCache.rows
    try {
      const rows = await this.db.select().from(flightWatchlistRoutes).where(eq(flightWatchlistRoutes.enabled, true))
      this.routesCache = { at: Date.now(), rows }
      return rows
    } catch (err) {
      // A stale route list still lets Redis answer when Postgres is down.
      if (this.routesCache) return this.routesCache.rows
      throw err
    }
  }

  private async settings(): Promise<CatalogSettings> {
    try { return await this.cfg.get() } catch { return DEFAULT_CATALOG_SETTINGS }
  }

  private airportsOf(code: string): Set<string> {
    return new Set([code, ...this.reference.lookup().cityAirports(code)])
  }

  /** Spec §6.1: "THR" and "LON" are city codes; every airport of the city counts. */
  private matchRoutes(routes: RouteRow[], from: string, to: string): RouteRow[] {
    const o = this.airportsOf(from)
    const d = this.airportsOf(to)
    return routes.filter((r) => o.has(r.origin) && d.has(r.destination))
  }

  // ---------------- snapshots ----------------

  /** Redis first, then Postgres, then Redis again. Returns null for "no such slot or no snapshot yet". Throws only when both stores fail. */
  private async blobs(pairs: { routeId: string; date: string }[]): Promise<Map<string, SnapshotBlob | null>> {
    const out = new Map<string, SnapshotBlob | null>()
    const key = (p: { routeId: string; date: string }) => `${p.routeId}:${p.date}`
    let missing = pairs
    let redisOk = true
    try {
      const ids = pairs.length ? await this.redis.mget(...pairs.map((p) => slotIndexKey(p.routeId, p.date))) : []
      const withId = pairs.flatMap((p, i) => (ids[i] ? [{ p, slotId: ids[i]! }] : []))
      const latest = withId.length ? await this.redis.mget(...withId.map((x) => latestKey(x.slotId))) : []
      const live = withId.flatMap((x, i) => (latest[i] ? [{ ...x, version: latest[i]! }] : []))
      const raw = live.length ? await this.redis.mget(...live.map((x) => snapshotKey(x.slotId, Number(x.version)))) : []
      live.forEach((x, i) => { if (raw[i]) out.set(key(x.p), JSON.parse(raw[i]!) as SnapshotBlob) })
      missing = pairs.filter((p) => !out.has(key(p)))
    } catch (err) {
      redisOk = false
      this.log.warn({ err: (err as Error).message }, "Redis unavailable; reading snapshots from Postgres")
    }
    if (!missing.length) return out
    try {
      const rows = await this.db.select({ slot: catalogSlots, snap: catalogPublicSnapshots }).from(catalogSlots)
        .leftJoin(catalogPublicSnapshots, eq(catalogPublicSnapshots.slotId, catalogSlots.id))
        .where(and(inArray(catalogSlots.routeId, [...new Set(missing.map((p) => p.routeId))]), inArray(catalogSlots.departureDate, [...new Set(missing.map((p) => p.date))])))
      const found = new Map(rows.map((r) => [`${r.slot.routeId}:${r.slot.departureDate}`, r]))
      for (const p of missing) {
        const r = found.get(key(p))
        if (!r?.snap) { out.set(key(p), null); continue }
        const blob: SnapshotBlob = { slotId: r.slot.id, version: r.snap.version, fetchedAt: r.snap.fetchedAt?.toISOString() ?? null, status: r.slot.status, payload: r.snap.payload }
        out.set(key(p), blob)
        if (redisOk) void this.cacheBlob(p, blob)
      }
      return out
    } catch (err) {
      // Postgres failed: whatever Redis answered is still good; the rest is unknown.
      if (!redisOk) throw err
      this.log.warn({ err: (err as Error).message }, "Postgres unavailable; serving what Redis holds")
      return out
    }
  }

  private async cacheBlob(p: { routeId: string; date: string }, blob: SnapshotBlob) {
    try {
      await this.redis.multi()
        .set(snapshotKey(blob.slotId, blob.version), JSON.stringify(blob), "EX", SNAPSHOT_TTL_S)
        .set(latestKey(blob.slotId), String(blob.version), "EX", SNAPSHOT_TTL_S)
        .set(slotIndexKey(p.routeId, p.date), blob.slotId, "EX", SNAPSHOT_TTL_S)
        .exec()
    } catch { /* the next request tries again */ }
  }

  /** Dates of a route that currently show flights (for the empty state's "nearby dates"). Cached 5 minutes. */
  private async datesWithResults(routeId: string, hideAfterDays: number): Promise<string[]> {
    try {
      const hit = await this.redis.get(datesKey(routeId))
      if (hit) return JSON.parse(hit) as string[]
    } catch { /* fall through to Postgres */ }
    const rows = await this.db.select({ date: catalogSlots.departureDate }).from(catalogSlots)
      .innerJoin(catalogPublicSnapshots, eq(catalogPublicSnapshots.slotId, catalogSlots.id))
      .where(and(eq(catalogSlots.routeId, routeId), gte(catalogSlots.departureDate, isoDate(new Date())), sql`jsonb_array_length(${catalogPublicSnapshots.payload}) > 0`, sql`${catalogPublicSnapshots.fetchedAt} > now() - make_interval(days => ${hideAfterDays})`))
    const dates = rows.map((r) => r.date).sort()
    try { await this.redis.set(datesKey(routeId), JSON.stringify(dates), "EX", 300) } catch { /* optional */ }
    return dates
  }

  // ---------------- search ----------------

  async search(q: CatalogSearchQuery, viewer: { ip: string; ua: string }, now = new Date()): Promise<SearchOutcome> {
    const partyNote = q.cabin !== "economy" || q.adults !== 1
    const base = { origin: q.from, destination: q.to, date: q.date, partyNote }
    let routes: RouteRow[]
    let s: CatalogSettings
    try {
      s = await this.settings()
      routes = this.matchRoutes(await this.routes(), q.from, q.to)
    } catch {
      return { body: { ...base, tracked: false, state: "UNAVAILABLE", fetchedAt: null, results: [], dates: [], nearbyDates: [] }, etag: etagOf(["UNAVAILABLE", q.from, q.to, q.date]), cacheable: false }
    }
    if (!routes.length) {
      await this.countView(viewer, null, q, now)
      return { body: { ...base, tracked: false, state: "NOT_TRACKED", fetchedAt: null, results: [], dates: [], nearbyDates: [] }, etag: etagOf(["NOT_TRACKED", q.from, q.to, q.date]), cacheable: true }
    }
    const today = isoDate(now)
    const window = Array.from({ length: 2 * q.flex + 1 }, (_, i) => shift(q.date, i - q.flex)).filter((d) => d >= today)
    if (!window.includes(q.date)) window.push(q.date)
    let blobs: Map<string, SnapshotBlob | null>
    try {
      blobs = await this.blobs(routes.flatMap((r) => window.map((date) => ({ routeId: r.id, date }))))
    } catch {
      return { body: { ...base, tracked: true, state: "UNAVAILABLE", fetchedAt: null, results: [], dates: [], nearbyDates: [] }, etag: etagOf(["UNAVAILABLE", q.from, q.to, q.date]), cacheable: false }
    }
    const used: string[] = []
    const groups: CatalogDateGroup[] = window.sort().map((date) => {
      const tierH = tierFor(daysOut(date, now), s.tiers).intervalHours
      const usable = routes.flatMap((r) => {
        const b = blobs.get(`${r.id}:${date}`)
        if (!b) return []
        used.push(`${b.slotId}@${b.version}`)
        const age = b.fetchedAt ? now.getTime() - Date.parse(b.fetchedAt) : Infinity
        return b.payload.length && age <= s.hideAfterDays * DAY ? [{ b, age }] : []
      })
      if (!usable.length) return { date, state: "EMPTY" as CatalogState, fetchedAt: null, results: [] }
      const oldest = usable.reduce((a, x) => (x.age > a.age ? x : a))
      const state: CatalogState = usable.some((x) => x.age > 3 * tierH * HOUR) ? "STALE" : "RESULTS"
      return { date, state, fetchedAt: oldest.b.fetchedAt, results: usable.flatMap((x) => x.b.payload).sort((a, b) => a.departLocal.localeCompare(b.departLocal) || a.id.localeCompare(b.id)) }
    })
    const main = groups.find((g) => g.date === q.date)!
    let nearbyDates: string[] = []
    if (main.state === "EMPTY") {
      try {
        const all = new Set((await Promise.all(routes.map((r) => this.datesWithResults(r.id, s.hideAfterDays)))).flat())
        all.delete(q.date)
        nearbyDates = [...all].sort((a, b) => Math.abs(Date.parse(a) - Date.parse(q.date)) - Math.abs(Date.parse(b) - Date.parse(q.date)) || a.localeCompare(b)).slice(0, NEARBY_LIMIT).sort()
      } catch { /* the empty state still renders without suggestions */ }
    }
    await this.countView(viewer, routes, q, now)
    const body: CatalogSearchResponse = { ...base, tracked: true, state: main.state, fetchedAt: main.fetchedAt, results: main.results, dates: groups, nearbyDates, partyNote }
    return { body, etag: etagOf([...used.sort(), main.state, q.from, q.to, q.date, String(q.flex), String(partyNote), nearbyDates.join(",")]), cacheable: true }
  }

  /** +1 per view, once per visitor per hour. Only a hash of (ip, user agent, daily salt) is kept, in Redis for an hour; nothing is stored in Postgres. */
  private async countView(viewer: { ip: string; ua: string }, routes: RouteRow[] | null, q: CatalogSearchQuery, now: Date) {
    try {
      const who = createHash("sha256").update(`${viewer.ip}|${viewer.ua}|${await this.dailySalt(now)}`).digest("hex").slice(0, 32)
      const targets = routes ? routes.map((r) => [r.origin, r.destination] as const) : [[q.from, q.to] as const]
      for (const [o, d] of targets) {
        const first = await this.redis.set(`demand:seen:${who}:${o}:${d}:${q.date}`, "1", "EX", 3600, "NX")
        if (first === "OK") await bumpDemand(this.redis, o, d, q.date, DEMAND_VIEW)
      }
    } catch { /* demand is a hint */ }
  }

  private async dailySalt(now: Date): Promise<string> {
    const day = isoDate(now)
    if (this.salt?.day === day) return this.salt.value
    const fresh = randomBytes(16).toString("hex")
    await this.redis.set(`demand:salt:${day}`, fresh, "EX", 2 * 86400, "NX")
    const value = (await this.redis.get(`demand:salt:${day}`)) ?? fresh
    this.salt = { day, value }
    return value
  }

  // ---------------- detail and routes ----------------

  /** One result's customer view. Selects named columns only: the provider offer and the pricing table are never read here. */
  async detail(id: string, now = new Date()): Promise<PublicItineraryDetail> {
    const [r] = await this.db.select({ id: flightResults.id, detail: flightResults.detail, isCurrent: flightResults.isCurrent, lastSeenAt: flightResults.lastSeenAt }).from(flightResults).where(eq(flightResults.id, id))
    const s = await this.settings()
    if (!r || (!r.isCurrent && now.getTime() - r.lastSeenAt.getTime() > s.hideAfterDays * DAY)) throw new AppError("NOT_FOUND", "Flight not found")
    return PublicItineraryDetail.strict().parse({ id: r.id, ...r.detail, isCurrent: r.isCurrent, lastSeenAt: r.lastSeenAt.toISOString() })
  }

  /** The next departures with flights on a route pair (popular-route cards): up to `limit` itineraries from the nearest dates. Snapshot reads only. */
  async upcoming(from: string, to: string, limit: number, now = new Date()): Promise<PublicItinerary[]> {
    try {
      const s = await this.settings()
      const routes = this.matchRoutes(await this.routes(), from, to)
      if (!routes.length) return []
      const today = isoDate(now)
      const dates = [...new Set((await Promise.all(routes.map((r) => this.datesWithResults(r.id, s.hideAfterDays)))).flat())].filter((d) => d >= today).sort().slice(0, limit)
      const blobs = await this.blobs(routes.flatMap((r) => dates.map((date) => ({ routeId: r.id, date }))))
      return dates.flatMap((d) => routes.flatMap((r) => blobs.get(`${r.id}:${d}`)?.payload ?? [])).slice(0, limit)
    } catch {
      return []
    }
  }

  async trackedRoutes(now = new Date()): Promise<CatalogRoutesResponse> {
    const rows = await this.routes()
    return { routes: rows.map((r) => ({ origin: r.origin, destination: r.destination, selfTransfer: r.kind === "COMBINED", firstDate: isoDate(now), lastDate: isoDate(new Date(now.getTime() + r.horizonDays * DAY)) })) }
  }
}
