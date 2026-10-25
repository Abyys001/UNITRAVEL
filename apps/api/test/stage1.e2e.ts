import { describe, expect, it } from "vitest"

import { ADMIN_HOST, randomPhone, requestOtp, Session, signIn, STAFF, staffSession } from "./client"

describe("Stage 1 exit criteria (ch. 31.3)", () => {
  it("a customer signs up with a +98 number typed locally in Persian digits, UI in Persian", async () => {
    const s = new Session("MOBILE")
    const local = randomPhone("+98912").replace("+98", "0").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!)
    const v = await signIn(s, local, { givenNamesLatin: "Maryam", surnameLatin: "Testpour" })
    expect(v.isNewUser).toBe(true)
    const me = await s.get("/v1/me", { "accept-language": "fa" })
    expect(me.status).toBe(200)
    expect(me.body.identities[0].value).toMatch(/^\+98912\d{7}$/)
    expect(me.body.identities[0].verifiedAt).toBeTruthy()
    expect(me.body.timezone).toBe("Asia/Tehran")
    expect(me.body.roles).toEqual(["customer"])
  })

  it("a customer signs up with a +44 number; wrong codes get a generic error and lock after 5 attempts", async () => {
    const s = new Session("WEB")
    const phone = randomPhone("+4477009")
    const r = await requestOtp(s, phone)
    expect(r.status).toBe(202)
    for (let i = 0; i < 5; i++) {
      const bad = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code: "000000", deviceId: s.deviceId, client: "WEB" })
      expect([400, 429]).toContain(bad.status)
      expect(["OTP_INVALID", "OTP_LOCKED"]).toContain(bad.body.code)
    }
    const locked = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code: "000000", deviceId: s.deviceId, client: "WEB" })
    expect(locked.body.code).toBe("OTP_LOCKED")
    const again = await requestOtp(s, phone)
    expect(again.status).toBe(429) // resend cooldown
  })

  it("an owner promotes a customer to admin; the user's next call returns PERMISSIONS_CHANGED, then /me lists admin permissions; both are audited", async () => {
    const customer = new Session("MOBILE")
    await signIn(customer, randomPhone("+98912"), { givenNamesLatin: "Ali", surnameLatin: "Promoted" })
    const me = await customer.get("/v1/me")
    const owner = await staffSession(STAFF.owner)
    const put = await owner.put(`/v1/dev/users/${me.body.id}/roles`, { roles: ["customer", "admin"] })
    expect(put.status).toBe(200)
    expect(put.body.permVersion).toBe(me.body.permVersion + 1)
    const stale = await customer.get("/v1/me")
    expect(stale.status).toBe(401)
    expect(stale.body.code).toBe("PERMISSIONS_CHANGED")
    const ref = await customer.post("/v1/auth/refresh", { refreshToken: customer.refreshToken })
    expect(ref.status).toBe(200)
    customer.accessToken = ref.body.accessToken
    customer.refreshToken = ref.body.refreshToken
    const fresh = await customer.get("/v1/me")
    expect(fresh.body.permissions).toContain("flight_request.read.any")
    expect(fresh.body.surfaces.admin).toBe(true)
    const audit = await owner.get(`/v1/dev/audit-log?ref=${me.body.id}`)
    expect(audit.body.items.map((a: { action: string }) => a.action)).toContain("user.roles_replaced")
    const signup = await owner.get(`/v1/dev/audit-log?actor=${me.body.id}`)
    expect(signup.body.items.map((a: { action: string }) => a.action)).toContain("user.signed_up")
    // Demotion takes effect on the very next request.
    await owner.put(`/v1/dev/users/${me.body.id}/roles`, { roles: ["customer"] })
    expect((await customer.get("/v1/me")).body.code).toBe("PERMISSIONS_CHANGED")
  })

  it("privileged roles need user.role.assign.privileged; the last owner cannot be demoted", async () => {
    const dev = await staffSession(STAFF.developer)
    const target = new Session("MOBILE")
    await signIn(target, randomPhone("+98912"))
    const me = await target.get("/v1/me")
    const denied = await dev.put(`/v1/dev/users/${me.body.id}/roles`, { roles: ["customer", "owner"] })
    expect(denied.status).toBe(403)
    const owner = await staffSession(STAFF.owner)
    const users = await owner.get(`/v1/dev/users?role=owner`)
    expect(users.body.items.length).toBe(1)
    const last = await owner.put(`/v1/dev/users/${users.body.items[0].id}/roles`, { roles: ["customer"] })
    expect(last.status).toBe(409)
    expect(last.body.code).toBe("LAST_OWNER")
  })

  it("Developer Panel routes are unreachable from the admin host and from customer sessions", async () => {
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    expect((await admin.get("/v1/dev/users")).status).toBe(404)
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"))
    expect((await c.get("/v1/dev/users", { "x-forwarded-host": "dev.localhost:4200" })).status).toBe(404)
    expect((await new Session("WEB").get("/v1/me")).status).toBe(401)
  })

  it("web sessions use HTTP-only cookies and require the CSRF token on state changes", async () => {
    const s = new Session("WEB")
    await signIn(s, randomPhone("+4477009"))
    expect(s.cookies.has("ut_at")).toBe(true)
    const csrf = s.cookies.get("ut_csrf")!
    s.cookies.delete("ut_csrf")
    const noCsrf = await s.patch("/v1/me", { preferredLocale: "fa" })
    expect(noCsrf.status).toBe(403)
    s.cookies.set("ut_csrf", csrf)
    const ok = await s.patch("/v1/me", { preferredLocale: "fa", calendar: "JALALI" })
    expect(ok.status).toBe(200)
    expect(ok.body.calendar).toBe("JALALI")
  })

  it("refresh token reuse revokes the session (theft detection)", async () => {
    const s = new Session("MOBILE")
    await signIn(s, randomPhone("+98912"))
    const first = s.refreshToken!
    const r1 = await s.post("/v1/auth/refresh", { refreshToken: first })
    expect(r1.status).toBe(200)
    // Reuse inside the grace window is a concurrent refresh (hardening.e2e.ts); theft is reuse after it.
    await new Promise((r) => setTimeout(r, 10_500))
    const reuse = await s.post("/v1/auth/refresh", { refreshToken: first })
    expect(reuse.status).toBe(401)
    const r2 = await s.post("/v1/auth/refresh", { refreshToken: r1.body.refreshToken })
    expect(r2.status).toBe(401)
  }, 30_000)

  it("configuration is versioned: publishing needs step-up and produces an audited new version", async () => {
    const dev = await staffSession(STAFF.developer)
    const versions = await dev.get("/v1/dev/config/WORKFLOW/versions")
    const current = versions.body.find((v: { status: string }) => v.status === "PUBLISHED")
    const draft = await dev.post("/v1/dev/config/WORKFLOW/versions", { payload: { ...current.payload, quoteDefaultValidityHours: 24 }, changeNote: "e2e" })
    expect(draft.status).toBe(201)
    const pub = await dev.post(`/v1/dev/config/WORKFLOW/versions/${draft.body.version}/publish`, { changeNote: "e2e publish" })
    expect(pub.status).toBe(200)
    expect(pub.body.status).toBe("PUBLISHED")
    const health = await dev.get("/v1/dev/health")
    expect(health.body.database.ok).toBe(true)
    expect(health.body.configVersions.WORKFLOW).toBeGreaterThanOrEqual(draft.body.version)
  })
})
