import { afterEach, describe, expect, it, vi } from "vitest"

describe("env", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  const load = async () => (await import("./env.js")).env()
  const strong = "k".repeat(24) + "Q7v-9xZ2pL4mN8rT"
  /** A deployable set of secrets: long, random-looking, no placeholders. */
  const deployable = (appEnv: "staging" | "production") => {
    vi.stubEnv("APP_ENV", appEnv)
    for (const k of ["JWT_PRIVATE_KEY", "JWT_PUBLIC_KEYS", "MASTER_ENCRYPTION_KEY", "OTP_PEPPER"]) vi.stubEnv(k, `${k}-${strong}`)
    vi.stubEnv("OBJECT_STORAGE_SECRET_KEY", strong)
    vi.stubEnv("DATABASE_URL", `postgres://app_rw:${strong}@db:5432/unitravel`)
    vi.stubEnv("REDIS_URL", `redis://:${strong}@valkey:6379`)
    for (const k of ["PUBLIC_WEB_URL", "PUBLIC_API_URL"]) vi.stubEnv(k, "https://example.com")
  }

  // ADR-0012: the email-only test sign-in can never run in production.
  it("refuses TEST_SIGN_IN=on in production", async () => {
    deployable("production"); vi.stubEnv("TEST_SIGN_IN", "on")
    await expect(load()).rejects.toThrow(/TEST_SIGN_IN/)
  })

  it("allows it on staging and defaults to off", async () => {
    deployable("staging"); vi.stubEnv("TEST_SIGN_IN", "on")
    expect((await load()).TEST_SIGN_IN).toBe("on")
    vi.resetModules(); vi.stubEnv("TEST_SIGN_IN", "")
    delete process.env.TEST_SIGN_IN
    expect((await load()).TEST_SIGN_IN).toBe("off")
  })

  // ADR-0017: a deployed host never starts on placeholder, short or local-development secrets.
  it("refuses placeholder and short secrets outside local", async () => {
    deployable("staging"); vi.stubEnv("MASTER_ENCRYPTION_KEY", "CHANGE_ME")
    await expect(load()).rejects.toThrow(/MASTER_ENCRYPTION_KEY still holds a placeholder/)
    vi.resetModules(); deployable("staging"); vi.stubEnv("OTP_PEPPER", "short")
    await expect(load()).rejects.toThrow(/OTP_PEPPER must be at least 32/)
    vi.resetModules(); deployable("staging"); vi.stubEnv("DATABASE_URL", "postgres://app_rw:app_rw_dev@db:5432/unitravel")
    await expect(load()).rejects.toThrow(/DATABASE_URL password/)
    vi.resetModules(); deployable("staging"); vi.stubEnv("OBJECT_STORAGE_SECRET_KEY", "unitravel-secret")
    await expect(load()).rejects.toThrow(/OBJECT_STORAGE_SECRET_KEY/)
    vi.resetModules(); deployable("staging"); vi.stubEnv("REDIS_URL", "redis://:CHANGE_ME@valkey:6379")
    await expect(load()).rejects.toThrow(/REDIS_URL password/)
  })

  it("needs an authenticated Valkey and https URLs in production", async () => {
    deployable("production"); vi.stubEnv("REDIS_URL", "redis://valkey:6379")
    await expect(load()).rejects.toThrow(/REDIS_URL must carry a password/)
    vi.resetModules(); deployable("production"); vi.stubEnv("PUBLIC_WEB_URL", "http://example.com")
    await expect(load()).rejects.toThrow(/https/)
  })

  it("refuses a production image without an explicit APP_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production"); delete process.env.APP_ENV
    await expect(load()).rejects.toThrow(/APP_ENV must be set/)
  })

  it("starts locally with the development defaults", async () => {
    vi.stubEnv("APP_ENV", "local"); vi.stubEnv("NODE_ENV", "development")
    expect((await load()).APP_ENV).toBe("local")
  })
})
