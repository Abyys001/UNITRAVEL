import { describe, expect, it } from "vitest"

import { ADMIN_HOST, DEV_HOST, dbQuery, latestCode, randomPhone, requestOtp, Session, signIn, STAFF, staffSession } from "./client"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("Sanctions screening candidate lookup (ch. 27.3)", () => {
  it("finds an entry that shares a rare token even when 600 older entries share the common token", async () => {
    const hash = `e2e-noise-${Date.now()}`
    const [{ id: versionId }] = await dbQuery<{ id: string }>("insert into sanction_lists (id, list_id, source_url, version_hash, entry_count, status) values (gen_random_uuid(), 'UK', 'fixture://e2e-noise', $1, 601, 'ACTIVE') returning id", [hash])
    try {
      // Noise first, target last: heap order would put the target after the old LIMIT 500.
      await dbQuery(
        `insert into sanction_entries (id, list_version_id, list_id, external_id, type, names, search_tokens, search_text)
         select gen_random_uuid(), $1, 'UK', 'E2E-NOISE-' || n, 'ENTITY', jsonb_build_object('primary', 'Qznoise' || n || ' Ltd', 'aliases', '[]'::jsonb, 'nonLatin', '[]'::jsonb), array['ltd', 'qznoise' || n], 'qznoise' || n || ' ltd'
         from generate_series(1, 600) n`, [versionId])
      await dbQuery(
        `insert into sanction_entries (id, list_version_id, list_id, external_id, type, names, search_tokens, search_text)
         values (gen_random_uuid(), $1, 'UK', 'E2E-TARGET', 'ENTITY', '{"primary":"Orbitco Harbourfreight Ltd","aliases":[],"nonLatin":[]}'::jsonb, array['orbitco','harbourfreight','ltd'], 'orbitco harbourfreight ltd')`, [versionId])
      const officer = await staffSession(STAFF.compliance, ADMIN_HOST)
      const target = await officer.post("/v1/admin/compliance/screen", { name: "Orbitco Harbourfreight Ltd" })
      expect(target.status).toBe(200)
      expect(target.body.result).not.toBe("CLEAR")
      expect(target.body.hits.map((h: { externalId: string }) => h.externalId)).toContain("E2E-TARGET")

      // The fictional TEST-0002 entity screens as a party name typed into a person field as well.
      const test2 = await officer.post("/v1/admin/compliance/screen", { name: "Example Sanctioned Logistics Ltd" })
      expect(test2.body.result).not.toBe("CLEAR")
      expect(test2.body.hits.map((h: { externalId: string }) => h.externalId)).toContain("TEST-0002")
    } finally {
      // Screening hits are immutable evidence and reference their entry: retire the version, drop only entries nothing points at.
      await dbQuery("update sanction_lists set status = 'SUPERSEDED' where id = $1", [versionId])
      await dbQuery("delete from sanction_entries e where e.list_version_id = $1 and not exists (select 1 from screening_hits h where h.entry_id = e.id)", [versionId])
    }
  })
})

describe("Refresh rotation grace window (OWASP session management, ch. 25.2)", () => {
  async function mobile() {
    const s = new Session("MOBILE")
    await signIn(s, randomPhone("+4477009"), { givenNamesLatin: "Grace", surnameLatin: "Window" })
    return s
  }

  it("a concurrent second refresh from the same client gets a working sibling; a late or foreign one ends the session", async () => {
    const s = await mobile()
    const old = s.refreshToken!
    const first = await s.post("/v1/auth/refresh", { refreshToken: old })
    expect(first.status).toBe(200)
    const second = await s.post("/v1/auth/refresh", { refreshToken: old })
    expect(second.status).toBe(200)
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken)
    // Both successors work, and the session is alive.
    expect((await s.post("/v1/auth/refresh", { refreshToken: first.body.refreshToken })).status).toBe(200)
    expect((await s.post("/v1/auth/refresh", { refreshToken: second.body.refreshToken })).status).toBe(200)

    // Same token again after the window: theft rule, the family is revoked.
    await wait(11_000)
    const late = await s.post("/v1/auth/refresh", { refreshToken: old })
    expect(late.status).toBe(401)
    expect((await s.post("/v1/auth/refresh", { refreshToken: second.body.refreshToken })).status).toBe(401)
  }, 40_000)

  it("a replay inside the window from another client (different user agent) revokes the family", async () => {
    const s = await mobile()
    const old = s.refreshToken!
    expect((await s.post("/v1/auth/refresh", { refreshToken: old })).status).toBe(200)
    const thief = await s.post("/v1/auth/refresh", { refreshToken: old }, { "user-agent": "thief/1.0" })
    expect(thief.status).toBe(401)
    expect((await s.post("/v1/auth/refresh", { refreshToken: old })).status).toBe(401)
  })
})

describe("Audit hash chain (ch. 28.5)", () => {
  it("verifies the chain, distinguishing legacy rows from verified ones", async () => {
    const dev = await staffSession(STAFF.developer, DEV_HOST)
    // Any audited write; key order inside the jsonb payload is rewritten by Postgres, which used to break verification.
    const r = await dev.put("/v1/dev/sms-routes", { prefix: "+44", providers: ["sinch", "infobip"], enabled: true })
    expect(r.status).toBe(200)
    const v = await dev.get("/v1/dev/audit-log/verify")
    expect(v.status).toBe(200)
    expect(v.body.brokenAt).toBeNull()
    expect(v.body.ok).toBe(true)
    expect(v.body.verified + v.body.legacyUnverifiable).toBe(v.body.checked)
    const newest = await dbQuery<{ hash_version: number }>("select hash_version from audit_log order by id desc limit 1")
    expect(newest[0]!.hash_version).toBe(2)
  })
})

describe("Developer panel validation (ch. 10.3, 16.2, 8.1)", () => {
  it("vendor credentials are validated per vendor", async () => {
    const dev = await staffSession(STAFF.developer, DEV_HOST)
    expect((await dev.put("/v1/dev/vendors/sms:kavenegar/credentials", { values: {} })).status).toBe(400)
    expect((await dev.put("/v1/dev/vendors/sms:kavenegar/credentials", { values: { apiKey: "x", bogus: "y" } })).status).toBe(400)
    expect((await dev.put("/v1/dev/vendors/sms:nope/credentials", { values: { apiKey: "x" } })).status).toBe(404)
  })

  it("SMS routes: known providers only, and no prefix that can reach +98 through international providers", async () => {
    const dev = await staffSession(STAFF.developer, DEV_HOST)
    const put = (prefix: string, providers: string[]) => dev.put("/v1/dev/sms-routes", { prefix, providers, enabled: true })
    expect((await put("+44", ["carrierpigeon"])).status).toBe(400)
    expect((await put("98", ["kavenegar"])).status).toBe(400)
    expect((await put("", ["kavenegar"])).status).toBe(400)
    expect((await put("+98", ["sinch"])).status).toBe(400)
    expect((await put("+9891", ["infobip"])).status).toBe(400)
    expect((await put("+9", ["sinch"])).status).toBe(400)
    expect((await put("+44", ["sinch", "infobip"])).status).toBe(200)
  })

  it("test-send supplies a sample for every declared variable", async () => {
    const dev = await staffSession(STAFF.developer, DEV_HOST)
    const r = await dev.post("/v1/dev/notification-templates/test-send", { eventType: "quotation.sent", channel: "INBOX" })
    expect(r.status).toBe(202)
    await wait(2500)
    const me = (await dev.get("/v1/me")).body
    const inbox = await dev.get("/v1/notifications?limit=5")
    const latest = inbox.body.items.find((i: { eventType: string }) => i.eventType === "quotation.sent")
    expect(me.id).toBeTruthy()
    expect(latest).toBeTruthy()
    expect(`${latest.title} ${latest.body}`).not.toMatch(/[{}]/)
  }, 20_000)

  it("custom roles: privileged follows the catalogue, deletion needs an empty custom role and is audited", async () => {
    const owner = await staffSession(STAFF.owner, DEV_HOST)
    const key = `e2e_role_${Date.now().toString(36)}`
    const created = await owner.post("/v1/dev/roles", { key, name: "E2E role", permissions: ["customer.read.pii"] })
    expect(created.status).toBe(201)
    expect(created.body.privileged).toBe(true)
    const plain = await owner.post("/v1/dev/roles", { key: `${key}_p`, name: "E2E plain", permissions: ["flight_request.read.any"] })
    expect(plain.body.privileged).toBe(false)

    // A member blocks deletion.
    const member = new Session("MOBILE")
    const joined = await signIn(member, randomPhone("+4477009"), { givenNamesLatin: "Role", surnameLatin: "Member" })
    expect(joined.isNewUser).toBe(true)
    const [{ id: userId }] = await dbQuery<{ id: string }>("select id from users order by created_at desc limit 1")
    await dbQuery("insert into user_roles (user_id, role_id) select $1, id from roles where key = $2", [userId, `${key}_p`])
    expect((await owner.req("DELETE", `/v1/dev/roles/${key}_p`)).status).toBe(409)
    await dbQuery("delete from user_roles where user_id = $1 and role_id = (select id from roles where key = $2)", [userId, `${key}_p`])

    expect((await owner.req("DELETE", `/v1/dev/roles/${key}_p`)).status).toBe(200)
    expect((await owner.req("DELETE", `/v1/dev/roles/${key}`)).status).toBe(200)
    expect((await owner.req("DELETE", `/v1/dev/roles/${key}`)).status).toBe(404)
    expect((await owner.req("DELETE", "/v1/dev/roles/admin")).status).toBe(403)
    const [a] = await dbQuery<{ n: string }>("select count(*)::text n from audit_log where action = 'role.deleted' and before->>'key' = $1", [key])
    expect(a!.n).toBe("1")
  })
})

describe("Console sign-in is staff only (ch. 25.2)", () => {
  it("a phone with no account is refused on the console and no customer account is created", async () => {
    const phone = randomPhone("+4477009")
    const s = new Session("CONSOLE", ADMIN_HOST)
    const since = Date.now() - 1000
    const r = await requestOtp(s, phone)
    expect(r.status).toBe(202)
    const code = await latestCode(r.body.normalised, since)
    const v = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code, deviceId: s.deviceId, client: "CONSOLE" })
    expect(v.status).toBe(400)
    expect(v.body.tokens).toBeUndefined()
    expect(await dbQuery("select 1 from user_identities where value_normalised = $1", [phone])).toHaveLength(0)
  })

  it("an existing customer phone gets no session and no TOTP enrolment on the console", async () => {
    const phone = randomPhone("+4477009")
    await signIn(new Session("WEB"), phone, { givenNamesLatin: "Plain", surnameLatin: "Customer" })
    await dbQuery("delete from otp_challenges where identity_value = $1", [phone])
    const s = new Session("CONSOLE", ADMIN_HOST)
    const since = Date.now() - 1000
    const r = await requestOtp(s, phone)
    const code = await latestCode(r.body.normalised, since)
    const v = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code, deviceId: s.deviceId, client: "CONSOLE" })
    expect(v.status).toBe(400)
    expect((await s.post("/v1/auth/mfa/totp/enrol")).status).toBe(401)
  })
})
