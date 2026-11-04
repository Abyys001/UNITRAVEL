import { afterEach, describe, expect, it, vi } from "vitest"

import type { ApifyInput } from "./client"

import { LIMITS_RESPONSE, SUCCEEDED_RESPONSE, START_RESPONSE, TOKEN_INVALID } from "../../../../../test/fixtures/apify/google-flights"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const input: ApifyInput = { routes: [{ origin: "IST", destination: "LHR", departureDate: "2026-12-10" }], maxResults: 15, sortBy: "best", currency: "GBP", adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0, cabinClass: "economy", maxStops: "any" }

describe("Apify client", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules() })
  const load = async (appEnv = "local", base?: string) => {
    vi.stubEnv("APP_ENV", appEnv)
    if (base) vi.stubEnv("APIFY_BASE_URL", base)
    else vi.stubEnv("APIFY_BASE_URL", "")
    for (const k of ["JWT_PRIVATE_KEY", "JWT_PUBLIC_KEYS", "MASTER_ENCRYPTION_KEY", "OTP_PEPPER"]) vi.stubEnv(k, "x")
    return import("./client.js")
  }

  it("starts a run with a Bearer header, the cost cap in the query and the token nowhere else", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(START_RESPONSE, 201))
    const { ApifyClient } = await load()
    const run = await new ApifyClient("tok_secret").startRun({ ...input }, 0.016)
    expect(run).toEqual(START_RESPONSE.data)
    const [url, init] = spy.mock.calls[0]!
    expect(String(url)).toBe("https://api.apify.com/v2/acts/lergassy~google-flights-scraper/runs?build=0.1.167&maxTotalChargeUsd=0.0160")
    expect(String(url)).not.toContain("tok_secret")
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok_secret")
    expect(JSON.parse(init!.body as string)).toMatchObject({ maxResults: 15, routes: [{ origin: "IST" }] })
  })

  it("always sends the KAYAK and resolution fields as false, even if a caller tries to turn them on (ADR-0034 F2)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(START_RESPONSE, 201))
    const { ApifyClient } = await load()
    const sneaky = { ...input, kayakWhenGoogleEmpty: true, fillMissingPricesFromKayak: true, resolveBookingOptions: true, resolveReturnFlights: true } as unknown as ApifyInput
    await new ApifyClient("tok_secret").startRun(sneaky, 0.016)
    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toMatchObject({
      kayakWhenGoogleEmpty: false, fillMissingPricesFromKayak: false, resolveBookingOptions: false, resolveReturnFlights: false, exploreAnywhere: false, calendarDays: 0,
    })
  })

  it("refuses a run without maxResults or a cost cap, before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
    const { ApifyClient } = await load()
    const c = new ApifyClient("tok_secret")
    const { maxResults: _omit, ...uncapped } = input
    await expect(c.startRun(uncapped as ApifyInput, 0.016)).rejects.toMatchObject({ code: "SUPPLIER_BAD_REQUEST" })
    await expect(c.startRun({ ...input, maxResults: 0 }, 0.016)).rejects.toMatchObject({ code: "SUPPLIER_BAD_REQUEST" })
    await expect(c.startRun({ ...input }, 0)).rejects.toMatchObject({ code: "SUPPLIER_BAD_REQUEST" })
    await expect(c.startRun({ ...input }, Number.NaN)).rejects.toMatchObject({ code: "SUPPLIER_BAD_REQUEST" })
    expect(spy).not.toHaveBeenCalled()
  })

  it("reads status, items (clean=1) and limits", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(SUCCEEDED_RESPONSE)).mockResolvedValueOnce(json([{ type: "notice" }])).mockResolvedValueOnce(json(LIMITS_RESPONSE))
    const { ApifyClient } = await load()
    const c = new ApifyClient("t")
    expect((await c.runStatus("runSYNTH0001")).status).toBe("SUCCEEDED")
    expect(await c.items("dsSYNTH0001")).toHaveLength(1)
    expect(String(spy.mock.calls[1]![0])).toBe("https://api.apify.com/v2/datasets/dsSYNTH0001/items?clean=1")
    expect(await c.limits()).toEqual({ cycle: "2026-11-01T00:00:00.000Z", cycleEnd: "2026-11-30T23:59:59.999Z", maxMonthlyUsageUsd: 5, monthlyUsageUsd: 0.42 })
  })

  it.each([
    [401, "SUPPLIER_AUTH"], [403, "SUPPLIER_AUTH"], [402, "SUPPLIER_RATE_LIMITED"], [429, "SUPPLIER_RATE_LIMITED"], [404, "SUPPLIER_BAD_REQUEST"],
    [400, "SUPPLIER_BAD_REQUEST"], [500, "SUPPLIER_UNAVAILABLE"], [503, "SUPPLIER_UNAVAILABLE"], [418, "SUPPLIER_UNKNOWN"],
  ])("maps HTTP %i to %s without echoing the token", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(TOKEN_INVALID, status))
    const { ApifyClient } = await load()
    const err = await new ApifyClient("tok_secret").limits().catch((e) => e)
    expect(err).toMatchObject({ code, raw: TOKEN_INVALID.error.type })
    expect(String(err.message)).not.toContain("tok_secret")
  })

  it("maps a network failure to SUPPLIER_UNAVAILABLE and a timeout to SUPPLIER_TIMEOUT", async () => {
    const { ApifyClient } = await load()
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }))
    expect(await new ApifyClient("t").limits().catch((e) => e)).toMatchObject({ code: "SUPPLIER_UNAVAILABLE" })
    expect(await new ApifyClient("t").limits().catch((e) => e)).toMatchObject({ code: "SUPPLIER_TIMEOUT" })
  })

  it("honours APIFY_BASE_URL on a developer machine only (ADR-0029 A9)", async () => {
    expect((await load("local", "http://localhost:4999/v2/")).apifyBaseUrl()).toBe("http://localhost:4999/v2")
    vi.resetModules()
    expect((await load("staging", "http://localhost:4999/v2")).apifyBaseUrl()).toBe("https://api.apify.com/v2")
  })
})
