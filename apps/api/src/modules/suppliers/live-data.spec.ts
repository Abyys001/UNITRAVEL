import { afterEach, describe, expect, it, vi } from "vitest"

import { providerSeedRows } from "@unitravel/db"

// ADR-0014: FAKE adapters and sandbox credentials exist only with APP_ENV=local; deployed hosts serve live data only.
describe("live data only on deployed hosts (ADR-0014)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  // Deployable-looking values: a deployed host refuses to start on placeholders or short secrets (ADR-0017).
  const asEnv = (appEnv: string) => {
    const strong = "unit-test-value-Q7v9xZ2pL4mN8rT3"
    vi.stubEnv("TEST_SIGN_IN", "off")
    vi.stubEnv("APP_ENV", appEnv)
    for (const k of ["JWT_PRIVATE_KEY", "JWT_PUBLIC_KEYS", "MASTER_ENCRYPTION_KEY", "OTP_PEPPER"]) vi.stubEnv(k, `${k}-${strong}`)
    vi.stubEnv("OBJECT_STORAGE_SECRET_KEY", strong)
    vi.stubEnv("DATABASE_URL", `postgres://app_rw:${strong}@localhost:5462/unitravel`)
    vi.stubEnv("REDIS_URL", `redis://:${strong}@localhost:6390`)
    for (const k of ["PUBLIC_WEB_URL", "PUBLIC_API_URL"]) vi.stubEnv(k, "https://example.com")
  }

  it.each(["staging", "production"])("the FAKE flight and payment adapters refuse APP_ENV=%s", async (appEnv) => {
    asEnv(appEnv)
    const { FakeAdapter } = await import("./adapters/fake.adapter.js")
    const { FakePaymentAdapter } = await import("../payments/fake-payment.adapter.js")
    expect(() => new FakeAdapter()).toThrow(/APP_ENV=local/)
    expect(() => new FakePaymentAdapter({} as never)).toThrow(/APP_ENV=local/)
  })

  it("the FAKE adapters construct with APP_ENV=local", async () => {
    asEnv("local")
    const { FakeAdapter } = await import("./adapters/fake.adapter.js")
    const { FakePaymentAdapter } = await import("../payments/fake-payment.adapter.js")
    expect(new FakeAdapter().id).toBe("fake")
    expect(new FakePaymentAdapter({} as never).id).toBe("FAKE")
  })

  it("searchable() never returns fake on staging, even with a local-style database", async () => {
    asEnv("staging")
    const { SuppliersService } = await import("./suppliers.service.js")
    // A staging database seeded before ADR-0014 still holds an enabled fake row and test-environment rows.
    const rows = providerSeedRows("local").map((r) => ({ ...r, enabled: true, shadowMode: false, version: 1 }))
    const db = { select: () => ({ from: async () => rows }) }
    const redis = { get: async () => null, hgetall: async () => ({}) }
    const svc = new SuppliersService(db as never, redis as never, {} as never, {} as never, {} as never)
    expect(svc.adapter("fake")).toBeUndefined()
    const ids = (await svc.searchable()).map((s) => s.row.id)
    expect(ids).not.toContain("fake")
    // Test-environment rows are never searched outside local: a sandbox token would return Duffel's sample content.
    expect(ids).not.toContain("duffel")
  })

  it("Duffel refuses a test token for a live environment before any network call", async () => {
    asEnv("staging")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { DuffelAdapter } = await import("./adapters/duffel.adapter.js")
    const ctx = { requestId: "t", deadline: new Date(Date.now() + 5000), pointOfSale: { country: "GB", currency: "GBP" }, reference: {} as never, credentials: { accessToken: "duffel_test_abc" }, environment: "production" as const, signal: new AbortController().signal }
    await expect(new DuffelAdapter().healthCheck(ctx)).rejects.toMatchObject({ code: "SUPPLIER_AUTH" })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("the Developer Panel refuses a Duffel test token outside local", async () => {
    asEnv("staging")
    const { SuppliersService } = await import("./suppliers.service.js")
    const svc = new SuppliersService({} as never, {} as never, {} as never, {} as never, {} as never)
    await expect(svc.setCredentials("duffel", { accessToken: "duffel_test_abc" }, "u")).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
  })
})
