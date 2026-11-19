import { afterEach, describe, expect, it, vi } from "vitest"

import { SupplierError } from "../../adapter"
import { AviationEdgeClient } from "./client"

// A sentinel that must never appear in any error, message or raw field.
const KEY = "SENTINEL-AE-KEY-0123456789"
const BASE = "http://127.0.0.1:9"
const Q = { type: "departure", iataCode: "IKA", arrIata: "IST", date: "2026-11-18" } as const
const client = () => new AviationEdgeClient(KEY, BASE, 0)
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })

const failure = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return e as SupplierError }
  throw new Error("expected a rejection")
}
const leaks = (e: SupplierError) => JSON.stringify({ m: e.message, r: e.raw, c: e.code, s: e.stack?.split("\n")[0] }).includes(KEY)

afterEach(() => vi.restoreAllMocks())

describe("AviationEdgeClient (ADR-0036 E7, E10)", () => {
  it("asks flightsFuture with the key, type, airports and date", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, [{ a: 1 }]))
    expect(await client().futureSchedule(Q)).toEqual([{ a: 1 }])
    const url = new URL(String(spy.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe(`${BASE}/v2/public/flightsFuture`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ key: KEY, type: "departure", iataCode: "IKA", arr_iataCode: "IST", date: "2026-11-18" })
  })

  it("leaves out arr_iataCode when no destination is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, []))
    await client().futureSchedule({ type: "departure", iataCode: "IKA", date: "2026-11-18" })
    expect(new URL(String(spy.mock.calls[0]![0])).searchParams.has("arr_iataCode")).toBe(false)
  })

  it.each([401, 403])("maps %i to SUPPLIER_AUTH", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(status, { error: "x" }))
    const e = await failure(client().futureSchedule(Q))
    expect(e.code).toBe("SUPPLIER_AUTH")
    expect(leaks(e)).toBe(false)
  })

  it("maps a 200 body that names the key to SUPPLIER_AUTH", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { error: "Your API key is not valid." }))
    expect((await failure(client().futureSchedule(Q))).code).toBe("SUPPLIER_AUTH")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { error: { text: "Unauthorized subscription" } }))
    expect((await failure(client().futureSchedule(Q))).code).toBe("SUPPLIER_AUTH")
  })

  it("maps 429 and quota bodies to SUPPLIER_RATE_LIMITED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(429, ""))
    expect((await failure(client().futureSchedule(Q))).code).toBe("SUPPLIER_RATE_LIMITED")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { error: "Monthly request limit exceeded" }))
    const e = await failure(client().futureSchedule(Q))
    expect(e.code).toBe("SUPPLIER_RATE_LIMITED")
    expect(leaks(e)).toBe(false)
  })

  it("reads 'No Record Found' in any shape as an empty list", async () => {
    for (const body of [{ error: "No Record Found", success: false }, { error: { text: "no record found" } }, { message: "NO RECORD FOUND" }, "No Record Found"]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, body))
      expect(await client().futureSchedule(Q)).toEqual([])
    }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(404, { error: "No Record Found" }))
    expect(await client().futureSchedule(Q)).toEqual([])
  })

  it("rejects a non-JSON or non-array body as billed SUPPLIER_UNKNOWN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, "<html>oops</html>"))
    expect(await failure(client().futureSchedule(Q))).toMatchObject({ code: "SUPPLIER_UNKNOWN", raw: "billed" })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { data: [] }))
    expect(await failure(client().futureSchedule(Q))).toMatchObject({ code: "SUPPLIER_UNKNOWN", raw: "billed" })
  })

  it("retries once on 5xx and returns the second answer", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(503, "")).mockResolvedValueOnce(reply(200, [{ ok: true }]))
    expect(await client().futureSchedule(Q)).toEqual([{ ok: true }])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("gives up after one retry and does not retry an AUTH error", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(500, ""))
    expect((await failure(client().futureSchedule(Q))).code).toBe("SUPPLIER_UNAVAILABLE")
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockClear().mockResolvedValue(reply(401, ""))
    await failure(client().futureSchedule(Q))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("maps a timeout to SUPPLIER_TIMEOUT (billed) and a network failure to UNAVAILABLE, without the key", async () => {
    const timeout = Object.assign(new Error(`aborted ${BASE}?key=${KEY}`), { name: "TimeoutError" })
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeout)
    const t = await failure(client().futureSchedule(Q))
    expect(t).toMatchObject({ code: "SUPPLIER_TIMEOUT", raw: "billed" })
    expect(leaks(t)).toBe(false)
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new TypeError(`fetch failed ${BASE}?key=${KEY}`), { cause: new Error(KEY) }))
    const n = await failure(client().futureSchedule(Q))
    expect(n.code).toBe("SUPPLIER_UNAVAILABLE")
    expect(leaks(n)).toBe(false)
  })

  it("refuses the production host under NODE_ENV=test unless fetch is a test double", async () => {
    const real = globalThis.fetch
    // Not a mock: a plain function without the `mock` property.
    globalThis.fetch = (async () => reply(200, [])) as typeof fetch
    try {
      const e = await failure(new AviationEdgeClient(KEY, "https://aviation-edge.com", 0).futureSchedule(Q))
      expect(e.code).toBe("SUPPLIER_UNAVAILABLE")
      expect(leaks(e)).toBe(false)
    } finally { globalThis.fetch = real }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, []))
    expect(await new AviationEdgeClient(KEY, "https://aviation-edge.com", 0).futureSchedule(Q)).toEqual([])
  })
})
