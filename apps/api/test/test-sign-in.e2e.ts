import { describe, expect, it } from "vitest"

import { ADMIN_HOST, Session } from "./client"

// ADR-0012. Local .env.example and CI run with TEST_SIGN_IN=on; staging opts in, production refuses it at boot.
describe("ADR-0012 test sign-in", () => {
  const email = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.example`

  it("reports whether it is enabled", async () => {
    const r = await new Session("WEB").get("/v1/auth/test-sign-in")
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ enabled: true })
  })

  it("signs a new customer in on the web with only an email, then asks for the profile", async () => {
    const c = new Session("WEB")
    const r = await c.post("/v1/auth/test-sign-in", { email: email(), deviceId: c.deviceId, client: "WEB" })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ isNewUser: true, needsProfile: true, mfaRequired: false, mfaEnrolmentRequired: false })
    expect(r.body.tokens).toBeUndefined()
    expect((await c.get("/v1/me")).status).toBe(200)
  })

  it("returns bearer tokens to the mobile app", async () => {
    const c = new Session("MOBILE")
    const r = await c.post("/v1/auth/test-sign-in", { email: email(), deviceId: c.deviceId, client: "MOBILE" })
    expect(r.status).toBe(200)
    c.accessToken = r.body.tokens.accessToken
    expect((await c.get("/v1/me")).status).toBe(200)
  })

  it("never creates accounts on the console and refuses customers there", async () => {
    const c = new Session("CONSOLE", ADMIN_HOST)
    // Same answer as the OTP flow, so the console says nothing about who exists.
    for (const e of [email(), "neda@student.example"]) {
      const r = await c.post("/v1/auth/test-sign-in", { email: e, deviceId: c.deviceId, client: "CONSOLE" })
      expect(r.status).toBe(400)
      expect(JSON.stringify(r.body)).toContain("OTP_INVALID")
    }
  })

  it("lets staff into an admin route without the second factor", async () => {
    const c = new Session("CONSOLE", ADMIN_HOST)
    const r = await c.post("/v1/auth/test-sign-in", { email: "Owner@UniTravel.example", deviceId: c.deviceId, client: "CONSOLE" })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ isNewUser: false, mfaRequired: false, mfaEnrolmentRequired: false })
    expect((await c.get("/v1/admin/dashboard/metrics")).status).toBe(200)
  })

  it("validates the email", async () => {
    const c = new Session("WEB")
    expect((await c.post("/v1/auth/test-sign-in", { email: "not-an-email", deviceId: c.deviceId, client: "WEB" })).status).toBe(400)
  })
})
