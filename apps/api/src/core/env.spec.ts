import { afterEach, describe, expect, it, vi } from "vitest"

// ADR-0012: the email-only test sign-in can never run in production.
describe("env", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  const load = async () => (await import("./env.js")).env()
  const prodSecrets = () => { for (const k of ["JWT_PRIVATE_KEY", "JWT_PUBLIC_KEYS", "MASTER_ENCRYPTION_KEY", "OTP_PEPPER"]) vi.stubEnv(k, "x") }

  it("refuses TEST_SIGN_IN=on in production", async () => {
    prodSecrets(); vi.stubEnv("APP_ENV", "production"); vi.stubEnv("TEST_SIGN_IN", "on")
    await expect(load()).rejects.toThrow(/TEST_SIGN_IN/)
  })

  it("allows it on staging and defaults to off", async () => {
    vi.stubEnv("APP_ENV", "staging"); vi.stubEnv("TEST_SIGN_IN", "on")
    expect((await load()).TEST_SIGN_IN).toBe("on")
    vi.resetModules(); vi.stubEnv("TEST_SIGN_IN", "")
    delete process.env.TEST_SIGN_IN
    expect((await load()).TEST_SIGN_IN).toBe("off")
  })
})
