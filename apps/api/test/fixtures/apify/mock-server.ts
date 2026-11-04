import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { DIRECT, LIMITS_RESPONSE, TOKEN_INVALID } from "./google-flights"

/**
 * Local stand-in for the Apify API v2 endpoints the client calls, for the ADR-0029 A9 sandbox override
 * (`APIFY_BASE_URL`, honoured with APP_ENV=local only). Every run SUCCEEDS at once and its dataset holds one
 * SYNTHETIC direct row per requested route and date, shaped like the `DIRECT` fixture. Nothing here reaches Apify.
 */
export interface ApifyMock { url: string; calls: { method: string; path: string }[]; close: () => Promise<void> }

interface Route { origin: string; destination: string; departureDate: string }

const rowFor = (r: Route, i: number) => {
  const no = `TK${1900 + i}`
  const departAt = `${r.departureDate}T08:40`
  const arriveAt = `${r.departureDate}T10:55`
  return {
    ...DIRECT, origin: r.origin, destination: r.destination, departAirport: r.origin, departureDate: r.departureDate, departAt, arriveAt, flightNumbers: [no],
    legs: [{ ...DIRECT.legs[0]!, flightNumber: no, from: r.origin, to: r.destination, departAt, arriveAt }],
    bookingToken: `SYNTHETIC-TOKEN-${i}`, googleFlightsUrl: `https://www.google.com/travel/flights?synthetic=${i}`,
  }
}

export async function startApifyMock(port: number, token: string): Promise<ApifyMock> {
  const datasets = new Map<string, unknown[]>()
  const calls: ApifyMock["calls"] = []
  let seq = 0
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock")
    const path = url.pathname.replace(/^\/v2/, "")
    calls.push({ method: req.method ?? "GET", path })
    let body = ""
    req.on("data", (c: Buffer) => { body += c.toString() })
    req.on("end", () => {
      const send = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)) }
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, TOKEN_INVALID)
      if (req.method === "GET" && path === "/users/me/limits") return send(200, LIMITS_RESPONSE)
      if (req.method === "POST" && /^\/acts\/[^/]+\/runs$/.test(path)) {
        const input = JSON.parse(body || "{}") as { routes?: Route[] }
        const id = `runMOCK${++seq}`
        datasets.set(`ds${id}`, (input.routes ?? []).map(rowFor))
        return send(201, { data: { id, defaultDatasetId: `ds${id}`, status: "SUCCEEDED" } })
      }
      const run = /^\/actor-runs\/([^/]+)$/.exec(path)
      if (req.method === "GET" && run) return send(200, { data: { id: run[1], defaultDatasetId: `ds${run[1]}`, status: "SUCCEEDED" } })
      const ds = /^\/datasets\/([^/]+)\/items$/.exec(path)
      if (req.method === "GET" && ds && datasets.has(ds[1]!)) return send(200, datasets.get(ds[1]!))
      return send(404, { error: { type: "record-not-found", message: "Not found" } })
    })
  })
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok))
  const { port: bound } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${bound}/v2`, calls, close: () => new Promise((ok) => server.close(() => ok())) }
}

/**
 * Stack-side helpers for the cross-app spec, kept here so `ioredis` resolves from the API package.
 * `snapshot()` records the Apify ledger and run counters; `restore()` puts them back and drops the legacy per-leg cache keys,
 * so the month's budget ledger is unchanged. The catalog (ADR-0034) lives in Postgres and is driven in-process by test/catalog.e2e.ts, not here.
 */
export async function stackControl() {
  const { Redis } = await import("ioredis")
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6390")
  const kept = new Map<string, string | null>()
  const counters = async () => [...(await redis.keys("apify:ledger:*")), ...(await redis.keys("apify:runs:*"))]
  const clearSynthetic = async () => {
    const keys = [...(await redis.keys("apify:leg:*")), ...(await redis.keys("apify:pending:*")), ...(await redis.keys("apify:start:*")), ...(await redis.keys("apify:recheck:*"))]
    if (keys.length) await redis.del(...keys)
  }
  return {
    redis,
    async snapshot() { for (const k of await counters()) kept.set(k, await redis.get(k)); await clearSynthetic() },
    async restore() {
      await clearSynthetic()
      for (const k of await counters()) if (!kept.has(k)) await redis.del(k)
      for (const [k, v] of kept) { if (v == null) await redis.del(k); else await redis.set(k, v) }
      redis.disconnect()
    },
  }
}
