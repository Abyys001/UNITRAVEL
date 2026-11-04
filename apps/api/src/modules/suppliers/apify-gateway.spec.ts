import { afterEach, describe, expect, it, vi } from "vitest"

import { providers, providerCredentials, providerSeedRows } from "@unitravel/db"

import { FakeRedis } from "../../../test/fixtures/apify/helpers"
import { type FlightSupplierAdapter, SupplierError } from "./adapter"
import { SuppliersService } from "./suppliers.service"

vi.mock("../../core/crypto", () => ({ encryptField: () => ({ ciphertext: "c", keyId: "k" }), decryptField: () => "{}" }))

const ID = "apify-google-flights" as const
const seed = () => providerSeedRows("production").find((r) => r.id === ID)!

function gateway(opts: { invalidAt?: Date | null; shadow?: boolean } = {}) {
  const row = { ...seed(), enabled: true, shadowMode: !!opts.shadow, version: 1 }
  const meta = { rotatedAt: new Date(), rotatedBy: null, invalidAt: opts.invalidAt ?? null, ciphertext: "" }
  const updates: unknown[] = []
  const inserts: unknown[] = []
  const db = {
    select: () => ({ from: (t: unknown) => Object.assign(Promise.resolve([row]), { where: async () => (t === providerCredentials ? [meta] : []) }) }),
    update: (t: unknown) => ({ set: (v: Record<string, unknown>) => ({ where: () => ({ returning: async () => { updates.push([t, v]); if (v.invalidAt) meta.invalidAt = v.invalidAt as Date; return [{ id: ID }] } }) }) }),
    insert: () => ({ values: async (v: unknown) => void inserts.push(v) }),
  }
  const outbox = { add: vi.fn(async () => undefined) }
  const svc = new SuppliersService(db as never, new FakeRedis() as never, { lookup: () => ({}) } as never, outbox as never, { putCallPayload: async () => undefined } as never)
  const search = vi.fn(async () => [])
  const adapter: FlightSupplierAdapter = { id: ID, capabilities: () => ({ search: true, price: false, seatMap: false, order: false, cancel: false, ancillaries: false, cityCodes: false }), search, price: async () => { throw new Error("no") }, healthCheck: async () => ({ ok: true, latencyMs: 1, detail: "" }) }
  svc.registerAdapter(adapter, async () => 7)
  vi.spyOn(svc, "credentials").mockResolvedValue({ token: "t" })
  return { svc, search, updates, inserts, outbox, meta }
}
const opts = () => ({ deadline: new Date(Date.now() + 5000), searchId: "s", requestId: "r" })

describe("metered provider in the gateway (ADR-0029)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("the seed row is disabled, production, unpriced and carries the default metering", () => {
    expect(seed()).toMatchObject({ enabled: false, environment: "production", vertical: "FLIGHT", capabilities: { search: true, price: false, seatMap: false, order: false } })
    expect(seed().shadowMode ?? false).toBe(false)
    expect(seed().metering).toMatchObject({ monthlyBudgetUsd: 5, staffReserveUsd: 0.75, poolSplit: { customer: 0.4, prewarm: 0.3, staff: 0.3 }, maxResultsCustomer: 15, maxResultsStaff: 30, watchlist: [] })
  })

  it("SUPPLIER_PENDING is not a failure: no call record, no circuit outcome, no retry", async () => {
    const { svc, search, inserts } = gateway()
    search.mockRejectedValue(new SupplierError("SUPPLIER_PENDING", "later"))
    const r = await svc.search(ID, { slices: [{ origin: "IST", destination: "LHR", date: "2026-12-10" }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", maxConnections: 1 }, opts())
    expect(r).toMatchObject({ ok: false, error: { code: "SUPPLIER_PENDING" } })
    expect(search).toHaveBeenCalledTimes(1)
    expect(inserts).toEqual([])
    expect((svc as unknown as { redis: FakeRedis }).redis.keys("cbw:")).toEqual([])
  })

  it("the planner budget comes from the money ledger, not the call count", async () => {
    const { svc } = gateway()
    expect((await svc.searchable()).find((s) => s.row.id === ID)?.budgetRemaining).toBe(7)
  })

  it("the call-count daily budget does not apply to a source with a dollar budget; other providers keep it (ADR-0034)", async () => {
    const { svc, search } = gateway()
    const redis = (svc as unknown as { redis: FakeRedis }).redis
    const q = { slices: [{ origin: "IST", destination: "LHR", date: "2026-12-10" }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", maxConnections: 1 }
    redis.kv.set(`budget:${ID}:${new Date().toISOString().slice(0, 10)}`, "1000000")
    expect(await svc.search(ID, q, opts())).toMatchObject({ ok: true })
    expect(search).toHaveBeenCalledTimes(1)
    expect(Number(redis.kv.get(`budget:${ID}:${new Date().toISOString().slice(0, 10)}`))).toBe(1000000)
  })

  it("is never called in shadow mode", async () => {
    expect((await gateway({ shadow: true }).svc.shadowProviders()).map((r) => r.id)).not.toContain(ID)
  })

  describe("a rejected credential stops all calls until it is replaced (A8)", () => {
    it("a 401 from the provider marks the credential invalid (persisted) and raises the health event", async () => {
      const { svc, search, updates, outbox } = gateway()
      search.mockRejectedValue(new SupplierError("SUPPLIER_AUTH", "Apify 401"))
      const q = { slices: [{ origin: "IST", destination: "LHR", date: "2026-12-10" }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", maxConnections: 1 }
      await svc.search(ID, q, opts())
      expect(updates).toEqual([[providerCredentials, { invalidAt: expect.any(Date) }]])
      expect(outbox.add).toHaveBeenCalled()
      expect(await svc.credentialInvalid(ID)).toBe(true)
      expect((await svc.credentialMeta(ID))?.invalidAt).toBeInstanceOf(Date)
    })

    it("while invalid, search and price calls are refused before reaching the adapter; the health check still runs", async () => {
      const { svc, search } = gateway({ invalidAt: new Date() })
      const r = await svc.search(ID, { slices: [{ origin: "IST", destination: "LHR", date: "2026-12-10" }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", maxConnections: 1 }, opts())
      expect(r).toMatchObject({ ok: false, error: { code: "SUPPLIER_AUTH" } })
      expect(search).not.toHaveBeenCalled()
      const t = await svc.testConnection(ID)
      expect(t.ok).toBe(true)
    })

    it("setting a new credential clears the flag", async () => {
      const inserted: Record<string, unknown>[] = []
      const { svc } = gateway({ invalidAt: new Date() })
      // The upsert is the only write setCredentials makes to provider_credentials.
      ;(svc as unknown as { db: unknown }).db = {
        insert: () => ({ values: (v: Record<string, unknown>) => { inserted.push(v); return { onConflictDoUpdate: async (c: { set: Record<string, unknown> }) => void inserted.push(c.set) } } }),
      }
      await svc.setCredentials(ID, { token: "new" }, "00000000-0000-7000-8000-000000000001")
      // Both the insert values and the conflict update reset invalidAt.
      expect(inserted).toHaveLength(2)
      expect(inserted.every((v) => v.invalidAt === null)).toBe(true)
    })
  })
})
