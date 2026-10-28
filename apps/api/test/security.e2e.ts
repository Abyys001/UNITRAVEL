import { describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, DEV_HOST, latestCode, randomPhone, requestOtp, Session, signIn, STAFF, staffSession, totp } from "./client"

// ADR-0017: regression tests for the October 2026 security review. All but the website-session and readiness checks
// fail on the code before that change (verified 28 Oct 2026).

/** A test number no account uses yet (the range has only 1000 numbers, so earlier runs may hold some). */
async function unusedPhone() {
  for (;;) {
    const phone = randomPhone("+4477009")
    if (!(await dbQuery("select 1 from user_identities where value_normalised = $1", [phone])).length) {
      await dbQuery("delete from otp_challenges where identity_value = $1", [phone])
      return phone
    }
  }
}

/** A new staff member with the admin role and no second factor yet (the bootstrap state of a real hire). */
async function newAdmin() {
  const c = new Session("MOBILE")
  const phone = await unusedPhone()
  await signIn(c, phone, { givenNamesLatin: "Sec", surnameLatin: "Review" })
  const [{ id }] = await dbQuery<{ id: string }>("select user_id as id from user_identities where value_normalised = $1", [phone])
  await dbQuery("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'admin'", [id])
  await dbQuery("update users set perm_version = perm_version + 1 where id = $1", [id])
  return { phone, userId: id }
}

/**
 * The same person signs in again at once: drop their earlier challenges so the resend cooldown does not apply.
 * The wait keeps the earlier code out of the dev sink lookup, which takes codes sent in the last second. */
async function clearCooldown(phone: string) {
  await dbQuery("delete from otp_challenges where identity_value = $1", [phone])
  await new Promise((r) => setTimeout(r, 1100))
}

/** Console sign-in with the first factor only. */
async function consoleFirstFactor(phone: string) {
  await clearCooldown(phone)
  const s = new Session("CONSOLE", ADMIN_HOST)
  const v = await signIn(s, phone)
  return { s, v }
}

/** The first factor on a new device and network: OTP codes are bound to both, so this is a real separate attacker. */
async function enrolFirstFactor(phone: string) {
  const { s, v } = await consoleFirstFactor(phone)
  expect(v.mfaEnrolmentRequired).toBe(true)
  const e = await s.post("/v1/auth/mfa/totp/enrol")
  expect(e.status).toBe(201)
  const used = totp(e.body.secret)
  expect((await s.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: used })).status).toBe(200)
  return { s, secret: e.body.secret as string, used }
}

describe("Staff second factor cannot be bypassed (ch. 16.1, 25.5)", () => {
  it("a first-factor session cannot enrol a new authenticator once one exists", async () => {
    const { phone } = await newAdmin()
    const { secret, used } = await enrolFirstFactor(phone)

    // Someone holding only the sign-in code: the session is at MFA level 0 and the account already has a factor.
    const { s: attacker, v } = await consoleFirstFactor(phone)
    expect(v.mfaRequired).toBe(true)
    const enrol = await attacker.post("/v1/auth/mfa/totp/enrol")
    expect(enrol.status).toBe(401)
    expect(enrol.body.code).toBe("STEP_UP_REQUIRED")
    expect((await attacker.post("/v1/auth/mfa/webauthn/registration-options")).body.code).toBe("STEP_UP_REQUIRED")
    // Staff routes answer MFA_REQUIRED, not data.
    const queue = await attacker.get("/v1/admin/flight-requests")
    expect(queue.status).toBe(401)
    expect(queue.body.code).toBe("MFA_REQUIRED")

    // The real authenticator still works (the code used at enrolment is not accepted twice; the next step's code is),
    // and a session that passed it may add another factor.
    expect((await attacker.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: used })).body.code).toBe("OTP_INVALID")
    expect((await attacker.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: totp(secret, Date.now() + 30_000) })).status).toBe(200)
    expect([200, 201]).toContain((await attacker.post("/v1/auth/mfa/totp/enrol")).status)
  })

  it("a pending factor never raises a session when a confirmed one exists", async () => {
    const { phone, userId } = await newAdmin()
    const { s } = await enrolFirstFactor(phone)
    const pending = await s.post("/v1/auth/mfa/totp/enrol")
    expect([200, 201]).toContain(pending.status)
    // A fresh first-factor session tries the pending factor's code (as if it had seen the enrolment secret).
    const { s: other } = await consoleFirstFactor(phone)
    const r = await other.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: totp(pending.body.secret) })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe("OTP_INVALID")
    const [{ n }] = await dbQuery<{ n: number }>("select count(*)::int as n from mfa_factors where user_id = $1 and confirmed_at is not null", [userId])
    expect(n).toBe(1)
  })

  it("an owner can reset a lost second factor; a developer cannot", async () => {
    const { phone, userId } = await newAdmin()
    await enrolFirstFactor(phone)
    const dev = await staffSession(STAFF.developer, DEV_HOST)
    expect((await dev.post(`/v1/dev/users/${userId}/mfa/reset`)).status).toBe(403)
    const owner = await staffSession(STAFF.owner, DEV_HOST)
    const r = await owner.post(`/v1/dev/users/${userId}/mfa/reset`)
    expect(r.status).toBe(200)
    expect(r.body.factorsRemoved).toBe(1)
    const [{ n }] = await dbQuery<{ n: number }>("select count(*)::int as n from audit_log where action = 'user.mfa_reset' and entity_id = $1", [userId])
    expect(n).toBe(1)
    // The next console sign-in starts a fresh enrolment.
    const { v } = await consoleFirstFactor(phone)
    expect(v.mfaEnrolmentRequired).toBe(true)
  })

  it("staff permissions are not usable from a website session", async () => {
    const { phone } = await newAdmin()
    const web = new Session("WEB")
    await clearCooldown(phone)
    await signIn(web, phone)
    const r = await web.get("/v1/admin/flight-requests")
    expect(r.status).toBe(403)
    // The customer side keeps working.
    expect((await web.get("/v1/me")).status).toBe(200)
  })
})

describe("Sign-in codes are counted atomically (ch. 25.1)", () => {
  it("parallel wrong guesses each spend an attempt, then the right code is locked out", async () => {
    const s = new Session("MOBILE")
    const phone = randomPhone("+4477009")
    const since = Date.now() - 1000
    const r = await requestOtp(s, phone)
    expect(r.status).toBe(202)
    const code = await latestCode(r.body.normalised, since)
    const wrong = code === "000000" ? "111111" : "000000"
    // Eight at once (the per-IP verify limit is 10 per 10 minutes, the code allows 5 attempts).
    const guesses = await Promise.all(Array.from({ length: 8 }, () => s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code: wrong, deviceId: s.deviceId, client: "MOBILE" })))
    expect(guesses.every((g) => g.status !== 200)).toBe(true)
    const late = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code, deviceId: s.deviceId, client: "MOBILE" })
    expect(late.status).not.toBe(200)
    expect(late.body.code).toBe("OTP_LOCKED")
  })

  it("a code signs in once even when sent twice at the same moment", async () => {
    const s = new Session("MOBILE")
    const phone = randomPhone("+4477009")
    const since = Date.now() - 1000
    const r = await requestOtp(s, phone)
    const code = await latestCode(r.body.normalised, since)
    const body = { challengeId: r.body.challengeId, code, deviceId: s.deviceId, client: "MOBILE" }
    const both = await Promise.all([s.post("/v1/auth/otp/verify", body), s.post("/v1/auth/otp/verify", body)])
    expect(both.filter((x) => x.status === 200)).toHaveLength(1)
  })

  it("a client that used up its own budget cannot fill someone else's per-number window", async () => {
    const attacker = new Session("MOBILE")
    const victim = randomPhone("+4477009")
    // The test range has only 1000 numbers: drop codes an earlier test sent to this one, so its resend cooldown is not what answers.
    await dbQuery("delete from otp_challenges where identity_value = $1", [victim])
    // Use up the attacker device's hourly budget (10) on numbers of its own.
    for (let i = 0; i < 10; i++) await requestOtp(attacker, randomPhone("+4477009"))
    for (let i = 0; i < 5; i++) expect((await requestOtp(attacker, victim)).status).toBe(429)
    // The victim, from their own device, still gets a code.
    expect((await requestOtp(new Session("MOBILE"), victim)).status).toBe(202)
  })
})

describe("Sessions", () => {
  it("sign out all other devices keeps only the current session", async () => {
    const phone = await unusedPhone()
    const a = new Session("MOBILE")
    await signIn(a, phone, { givenNamesLatin: "Multi", surnameLatin: "Device" })
    const b = new Session("WEB")
    await clearCooldown(phone)
    await signIn(b, phone)
    const out = await a.post("/v1/me/sessions/revoke-others")
    expect(out.status).toBe(200)
    expect(out.body.revoked).toBeGreaterThanOrEqual(1)
    expect((await b.get("/v1/me")).status).toBe(401)
    expect((await a.get("/v1/me")).status).toBe(200)
  })
})

describe("Uploads are held to what was announced (ch. 28.1)", () => {
  it("the store refuses a body larger than the declared size", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+4477009"), { givenNamesLatin: "Up", surnameLatin: "Load" })
    const up = await c.post("/v1/uploads", { filename: "a.pdf", mime: "application/pdf", size: 16, type: "OTHER" })
    expect([200, 201]).toContain(up.status)
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4096, 65)])
    const put = await fetch(up.body.uploadUrl, { method: "PUT", headers: up.body.headers, body: new Uint8Array(big) })
    expect(put.status).toBeGreaterThanOrEqual(400)
    // Nothing stored, so completing is refused too.
    const done = await c.post(`/v1/uploads/${up.body.documentId}/complete`)
    expect(done.status).toBe(400)
  })

  it("a file whose bytes are not the declared type is rejected by the scan", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+4477009"), { givenNamesLatin: "Up", surnameLatin: "Load" })
    const html = Buffer.from("<html><script>alert(1)</script></html>")
    const up = await c.post("/v1/uploads", { filename: "a.pdf", mime: "application/pdf", size: html.length, type: "OTHER" })
    const put = await fetch(up.body.uploadUrl, { method: "PUT", headers: up.body.headers, body: new Uint8Array(html) })
    expect(put.status).toBeLessThan(300)
    expect((await c.post(`/v1/uploads/${up.body.documentId}/complete`)).status).toBe(200)
    let status = "PENDING"
    for (let i = 0; i < 40 && status === "PENDING"; i++) {
      await new Promise((r) => setTimeout(r, 250))
      status = (await c.get(`/v1/uploads/${up.body.documentId}`)).body.scanStatus
    }
    expect(status).toBe("INFECTED")
  })
})

describe("Readiness is cheap and public", () => {
  it("answers database and Valkey state only", async () => {
    const r = await (await fetch(`${API}/ready`)).json()
    expect(r).toEqual({ ready: true, database: true, redis: true })
  })
})
