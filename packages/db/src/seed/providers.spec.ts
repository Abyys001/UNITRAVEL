import { describe, expect, it } from "vitest"

import { providerSeedRows, shouldSeedDemo } from "./providers"

// ADR-0014: deployed hosts never get the FAKE supplier, sandbox provider rows or demo accounts.
describe("seed for deployed hosts", () => {
  it.each(["staging", "production"])("APP_ENV=%s inserts no fake row and only live-environment providers", (appEnv) => {
    const rows = providerSeedRows(appEnv)
    expect(rows.map((r) => r.id)).not.toContain("fake")
    expect(rows.every((r) => r.environment === "production")).toBe(true)
    expect(rows.filter((r) => r.id !== "manual").every((r) => r.enabled === false)).toBe(true)
  })

  it("APP_ENV=local keeps the FAKE supplier and sandbox rows for tests", () => {
    const rows = providerSeedRows("local")
    expect(rows.find((r) => r.id === "fake")?.enabled).toBe(true)
    expect(rows.find((r) => r.id === "duffel")?.environment).toBe("test")
  })

  it("seeds demo users only locally", () => {
    expect(shouldSeedDemo("staging")).toBe(false)
    expect(shouldSeedDemo("production")).toBe(false)
    expect(shouldSeedDemo("local")).toBe(true)
    expect(shouldSeedDemo("local", "0")).toBe(false)
    expect(shouldSeedDemo(undefined)).toBe(true)
  })
})
