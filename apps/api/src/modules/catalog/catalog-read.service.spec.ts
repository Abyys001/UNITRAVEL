import { describe, expect, it, vi } from "vitest"

import type { CatalogSearchQuery } from "@unitravel/contracts"
import { DEFAULT_CATALOG_SETTINGS } from "@unitravel/contracts"

import { FakeRedis, reference } from "../../../test/fixtures/apify/helpers"
import { bumpDemand, CatalogReadService } from "./catalog-read.service"

const route = (origin: string, destination: string, kind = "DIRECT") => ({ id: `route-${origin}-${destination}`, origin, destination, kind, enabled: true, horizonDays: 14 })
const q = (over: Partial<CatalogSearchQuery> = {}): CatalogSearchQuery => ({ from: "THR", to: "LON", date: "2026-11-10", flex: 0, cabin: "economy", adults: 1, ...over })
const viewer = { ip: "10.0.0.1", ua: "vitest" }
const NOW = new Date("2026-11-04T12:00:00Z")

/** The read service with its three seams replaced: route list, snapshot lookup and settings. Nothing here has a database or Redis. */
function service(opts: { routes?: unknown[] | Error; blobs?: Map<string, unknown> | Error } = {}) {
  const redis = new FakeRedis()
  const svc = new CatalogReadService({} as never, redis as never, { get: async () => DEFAULT_CATALOG_SETTINGS } as never, { lookup: () => reference } as never)
  const priv = svc as unknown as Record<string, unknown>
  priv.routes = async () => { if (opts.routes instanceof Error) throw opts.routes; return opts.routes ?? [] }
  priv.blobs = async () => { if (opts.blobs instanceof Error) throw opts.blobs; return opts.blobs ?? new Map() }
  priv.datesWithResults = async () => []
  return { svc, redis }
}

describe("catalog read service (no provider, no database)", () => {
  it("resolves city codes to the watchlist: THR → LON is IKA → LHR", async () => {
    const { svc } = service({ routes: [route("IKA", "LHR", "COMBINED"), route("IKA", "IST")] })
    const r = await svc.search(q(), viewer, NOW)
    expect(r.body).toMatchObject({ tracked: true, state: "EMPTY", origin: "THR", destination: "LON" })
    expect((await svc.search(q({ from: "THR", to: "IST" }), viewer, NOW)).body.tracked).toBe(true)
    expect((await svc.search(q({ from: "LON", to: "THR" }), viewer, NOW)).body.state).toBe("NOT_TRACKED")
    expect((await svc.search(q({ from: "VAN", to: "LON" }), viewer, NOW)).body.state).toBe("NOT_TRACKED")
  })

  it("UNAVAILABLE only when the catalog itself cannot be read; the answer is not cacheable", async () => {
    const down = await service({ routes: new Error("pg down") }).svc.search(q(), viewer, NOW)
    expect(down).toMatchObject({ cacheable: false, body: { state: "UNAVAILABLE", results: [] } })
    const noSnapshots = await service({ routes: [route("IKA", "LHR")], blobs: new Error("redis and pg down") }).svc.search(q(), viewer, NOW)
    expect(noSnapshots).toMatchObject({ cacheable: false, body: { state: "UNAVAILABLE" } })
    // An untracked pair never touches the snapshot stores, so it stays answerable.
    expect((await service({ routes: [], blobs: new Error("x") }).svc.search(q(), viewer, NOW)).body.state).toBe("NOT_TRACKED")
  })

  it("a past date is EMPTY, never an error; the party note follows cabin and adults", async () => {
    const { svc } = service({ routes: [route("IKA", "LHR")] })
    expect((await svc.search(q({ date: "2026-11-01" }), viewer, NOW)).body.state).toBe("EMPTY")
    expect((await svc.search(q(), viewer, NOW)).body.partyNote).toBe(false)
    expect((await svc.search(q({ cabin: "first" }), viewer, NOW)).body.partyNote).toBe(true)
    expect((await svc.search(q({ adults: 2 }), viewer, NOW)).body.partyNote).toBe(true)
  })

  it("counts a view once per visitor per hour and keeps no raw address or user agent", async () => {
    const { svc, redis } = service({ routes: [route("IKA", "LHR")] })
    await svc.search(q(), viewer, NOW)
    await svc.search(q(), viewer, NOW)
    expect(Number(redis.kv.get("demand:IKA:LHR:2026-11-10"))).toBe(1)
    await svc.search(q(), { ip: "10.0.0.2", ua: "other" }, NOW)
    expect(Number(redis.kv.get("demand:IKA:LHR:2026-11-10"))).toBe(2)
    expect([...redis.kv.keys()].filter((k) => k.startsWith("demand:seen:")).every((k) => /^demand:seen:[0-9a-f]{32}:/.test(k) && !k.includes("10.0.0") && !k.includes("vitest"))).toBe(true)
  })

  it("an untracked pair is counted under the codes as typed", async () => {
    const { svc, redis } = service({ routes: [] })
    await svc.search(q({ from: "MHD", to: "FRA" }), viewer, NOW)
    expect(Number(redis.kv.get("demand:MHD:FRA:2026-11-10"))).toBe(1)
  })

  it("the counter helper never throws when Redis does", async () => {
    await expect(bumpDemand({ incrby: vi.fn().mockRejectedValue(new Error("down")), expire: vi.fn() } as never, "A", "B", "2026-11-10", 5)).resolves.toBeUndefined()
  })
})
