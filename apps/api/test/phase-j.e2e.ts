import { createHmac, randomUUID } from "node:crypto"

import { Queue } from "bullmq"
import { Redis } from "ioredis"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, API, DEV_HOST, dbQuery, randomPhone, Session, signIn, solvePow, STAFF, staffSession } from "./client"

/**
 * Phase J backend (ADR-0018 to 0021): customer activity, support and calls, admin-assigned services with the payment page,
 * curated and cached listings. Run alone: `pnpm vitest run --project e2e test/phase-j.e2e.ts` (OTP limits make long runs flaky).
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6390"
const redis = new Redis(REDIS_URL)
const maintenance = new Queue("maintenance", { connection: { host: "localhost", port: 6390 } })
const key = () => `e2e-${Math.random().toString(36).slice(2)}${Date.now()}`

let dev: Session, admin: Session, owner: Session, cargo: Session, compliance: Session
const anon = new Session("WEB")
let cipWasOn = false

async function customer(name: string) {
  const c = new Session("WEB")
  const phone = randomPhone("+4477009")
  await signIn(c, phone, { givenNamesLatin: name, surnameLatin: "Phasej" })
  const me = (await c.get("/v1/me")).body
  return { c, phone, id: me.id as string, contactIdentityId: me.identities[0].id as string }
}
type Cust = Awaited<ReturnType<typeof customer>>

beforeAll(async () => {
  dev = await staffSession(STAFF.developer, DEV_HOST)
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  owner = await staffSession(STAFF.owner, ADMIN_HOST)
  cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  cipWasOn = (await anon.get("/v1/site")).body.menu.cip
})
afterAll(async () => {
  await dev.put("/v1/dev/feature-flags/services.cip.enabled", { enabled: cipWasOn })
  await maintenance.close()
  redis.disconnect()
})

// ---------------------------------------------------------------- J4
describe("Customer activity (ADR-0018)", () => {
  let u: Cust
  const adminView = (id: string) => admin.get(`/v1/admin/customers/${id}/activity`)
  const rows = async (id: string) => Number((await dbQuery<{ n: string }>("select count(*) n from customer_activity where user_id = $1 and kind = 'SCREEN_VIEW'", [id]))[0]!.n)

  it("a sign-in is recorded and the staff list shows it, masked, with online, last screen and counts", async () => {
    u = await customer("Activity")
    expect((await u.c.post("/v1/me/activity", { screen: "billing", ref: "INV-000123" })).status).toBe(204)
    const list = await admin.get(`/v1/admin/customers?q=${u.phone.slice(-8)}`)
    expect(list.status).toBe(200)
    const item = list.body.items.find((i: { id: string }) => i.id === u.id)
    expect(item).toBeTruthy()
    expect(item.phone).not.toBe(u.phone)
    expect(item.phone).toContain("•")
    expect(item).toMatchObject({ displayName: expect.any(String), verified: true, status: "ACTIVE", online: true, lastScreen: "billing", openRequests: 0, signInCount: 1 })
    expect(typeof item.lastActiveAt).toBe("string")
    expect(JSON.stringify(list.body)).not.toContain(u.phone)
    const act = (await adminView(u.id)).body
    expect(act).toMatchObject({ customerId: u.id, retentionDays: 90, trackingEnabled: true, sessions: { active: 1, total: 1 } })
    expect(act.activity.items.map((a: { kind: string }) => a.kind)).toEqual(["SCREEN_VIEW", "SIGN_IN"])
    expect(act.activity.items[0]).toMatchObject({ screen: "billing", ref: "INV-000123", client: "WEB" })
    // Only the network prefix is kept, never the full address.
    expect(act.activity.items[1].network).toMatch(/\.0\/24$|::\/48$/)
  })

  it("the screen name is an allow-list; free text, extra fields and bad references are refused", async () => {
    for (const bad of [{ screen: "checkout" }, { screen: "home", note: "x" }, { screen: "home", ref: "my passport number" }, {}]) expect({ bad, status: (await u.c.post("/v1/me/activity", bad)).status }).toEqual({ bad, status: 400 })
    expect((await anon.post("/v1/me/activity", { screen: "home" })).status).toBe(401)
  })

  it("is throttled, and Do Not Track, Global Privacy Control and the customer's own opt-out store nothing (still 204)", async () => {
    await wait(2100)
    const before = await rows(u.id)
    expect((await u.c.post("/v1/me/activity", { screen: "inbox" })).status).toBe(204)
    expect((await u.c.post("/v1/me/activity", { screen: "support" })).status).toBe(204) // inside the 2 s window
    await wait(2100)
    expect(await rows(u.id)).toBe(before + 1)
    expect((await u.c.post("/v1/me/activity", { screen: "club" }, { dnt: "1" })).status).toBe(204)
    await wait(2100)
    expect((await u.c.post("/v1/me/activity", { screen: "club" }, { "sec-gpc": "1" })).status).toBe(204)
    await wait(2100)
    expect(await rows(u.id)).toBe(before + 1)
    expect((await u.c.patch("/v1/me", { notificationPrefs: { activity_tracking: false } })).status).toBe(200)
    expect((await u.c.post("/v1/me/activity", { screen: "faq" })).status).toBe(204)
    expect(await rows(u.id)).toBe(before + 1)
    expect((await adminView(u.id)).body.trackingEnabled).toBe(false)
    expect((await u.c.patch("/v1/me", { notificationPrefs: { activity_tracking: true } })).status).toBe(200)
  })

  it("filters by status, verified and last seen; the cursor pages through", async () => {
    const all = await admin.get("/v1/admin/customers?limit=2")
    expect(all.body.items).toHaveLength(2)
    expect(all.body.nextCursor).toBeTruthy()
    const next = await admin.get(`/v1/admin/customers?limit=2&cursor=${all.body.nextCursor}`)
    expect(next.body.items.every((i: { id: string }) => !all.body.items.some((j: { id: string }) => j.id === i.id))).toBe(true)
    const recent = await admin.get(`/v1/admin/customers?seenFrom=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}&verified=true&status=ACTIVE&limit=100`)
    expect(recent.body.items.some((i: { id: string }) => i.id === u.id)).toBe(true)
    expect((await admin.get(`/v1/admin/customers?seenTo=${encodeURIComponent(new Date(Date.now() - 365 * 86400_000).toISOString())}&q=${u.phone.slice(-8)}`)).body.items).toEqual([])
    expect((await admin.get("/v1/admin/customers?limit=500")).status).toBe(400)
  })

  it("permission and ownership: customers and staff without customer.read are refused; staff accounts are not customers (404); every timeline read is audited", async () => {
    expect((await u.c.get("/v1/admin/customers")).status).toBe(403)
    expect((await cargo.get("/v1/admin/customers")).status).toBe(403)
    expect((await cargo.get(`/v1/admin/customers/${u.id}/activity`)).status).toBe(403)
    const adminId = (await admin.get("/v1/me")).body.id
    expect((await adminView(adminId)).status).toBe(404)
    expect((await adminView("00000000-0000-4000-8000-000000000000")).status).toBe(404)
    const listed = await admin.get("/v1/admin/customers?limit=100&q=unitravel.example")
    expect(listed.body.items.some((i: { id: string }) => i.id === adminId)).toBe(false)
    expect(Number((await dbQuery<{ n: string }>("select count(*) n from audit_log where action = 'customer.activity_viewed' and entity_id = $1", [u.id]))[0]!.n)).toBeGreaterThan(0)
  })

  it("sign-out writes the audit action user.signed_out and a SIGN_OUT row", async () => {
    const c2 = await customer("Leaver")
    expect((await c2.c.post("/v1/auth/logout")).status).toBe(204)
    const [a] = await dbQuery<{ action: string; actor_user_id: string }>("select action, actor_user_id from audit_log where action = 'user.signed_out' and actor_user_id = $1", [c2.id])
    expect(a?.action).toBe("user.signed_out")
    expect((await dbQuery<{ kind: string }>("select kind from customer_activity where user_id = $1 order by id", [c2.id])).map((r) => r.kind)).toEqual(["SIGN_IN", "SIGN_OUT"])
    expect((await c2.c.get("/v1/me")).status).toBe(401)
  })

  it("the worker prunes activity older than 90 days and keeps recent rows", async () => {
    const [old, recent] = [randomUUID(), randomUUID()]
    await dbQuery("insert into customer_activity (id, user_id, kind, screen, occurred_at) values ($1, $2, 'SCREEN_VIEW', 'home', now() - interval '91 days'), ($3, $2, 'SCREEN_VIEW', 'home', now() - interval '89 days')", [old, u.id, recent])
    await maintenance.add("activity.prune", {})
    const left = await until(() => dbQuery<{ id: string }>("select id from customer_activity where id in ($1, $2)", [old, recent]), (r) => r.length === 1)
    expect(left.map((r) => r.id)).toEqual([recent])
  })
})

// ---------------------------------------------------------------- J5
describe("Support tickets and calls (ADR-0019)", () => {
  const form = (over: Record<string, unknown> = {}) => ({ name: "Guest Person", email: `guest-${Math.random().toString(36).slice(2, 8)}@example.com`, topic: "BOOKING", message: "I would like to change my travel date please.", deviceId: `dev-${key()}`, ...over })
  let signedIn: Cust, other: Cust
  let guestRef: string, ownRef: string, guestEmail: string

  it("a guest opens a ticket; the same Idempotency-Key replays it and a different body is refused", async () => {
    const g = new Session("WEB")
    const body = form()
    guestEmail = body.email
    const k = key()
    const a = await g.post("/v1/support/tickets", body, { "idempotency-key": k })
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ status: "OPEN" })
    expect(a.body.ref).toMatch(/^TK-[0-9A-HJKMNP-TV-Z]{6}$/)
    guestRef = a.body.ref
    const again = await g.post("/v1/support/tickets", body, { "idempotency-key": k })
    expect(again.status).toBe(201)
    expect(again.headers.get("idempotent-replayed")).toBe("true")
    expect(again.body.ref).toBe(guestRef)
    expect((await g.post("/v1/support/tickets", { ...body, message: "A different message entirely." }, { "idempotency-key": k })).body.code).toBe("IDEMPOTENCY_MISMATCH")
    expect(Number((await dbQuery<{ n: string }>("select count(*) n from support_tickets where contact_email = $1", [body.email]))[0]!.n)).toBe(1)
  })

  it("validates the form: a way to answer is required, extra fields and short messages are refused", async () => {
    const g = new Session("WEB")
    const { email: _e, ...noContact } = form()
    for (const bad of [noContact, form({ message: "short" }), form({ topic: "NOPE" }), form({ extra: 1 }), form({ email: "not-an-email" }), form({ requestRef: "free text" })]) {
      expect((await g.post("/v1/support/tickets", bad)).status).toBe(400)
    }
    expect((await g.post("/v1/support/tickets", { ...noContact, phone: "+44 7700 900123" })).status).toBe(201)
  })

  it("asks for proof of work after a burst from one address, and accepts the solved challenge", async () => {
    const g = new Session("WEB")
    for (let i = 0; i < 3; i++) expect((await g.post("/v1/support/tickets", form())).status).toBe(201)
    const blocked = await g.post("/v1/support/tickets", form())
    expect(blocked.status).toBe(428)
    expect(blocked.body.code).toBe("CHALLENGE_REQUIRED")
    const ok = await g.post("/v1/support/tickets", form({ challenge: solvePow(blocked.body.challenge) }))
    expect(ok.status).toBe(201)
  })

  it("a signed-in customer's ticket is theirs only: lists, reads and replies are own-scoped (404 for anyone else)", async () => {
    signedIn = await customer("Ticketer")
    other = await customer("Bystander")
    const t = await signedIn.c.post("/v1/support/tickets", form({ name: "Ticketer Phasej", email: `own-${Date.now()}@example.com` }))
    expect(t.status).toBe(201)
    ownRef = t.body.ref
    const mine = (await signedIn.c.get("/v1/support/tickets")).body
    expect(mine.map((x: { ref: string }) => x.ref)).toContain(ownRef)
    expect(mine.map((x: { ref: string }) => x.ref)).not.toContain(guestRef)
    expect((await other.c.get("/v1/support/tickets")).body).toEqual([])
    for (const [m, p] of [["get", ""], ["post", "/messages"]] as const) {
      const r = m === "get" ? await other.c.get(`/v1/support/tickets/${ownRef}${p}`) : await other.c.post(`/v1/support/tickets/${ownRef}${p}`, { body: "hello" })
      expect({ p, status: r.status }).toEqual({ p, status: 404 })
    }
    // A guest ticket belongs to no account, so no signed-in customer can read it either.
    expect((await signedIn.c.get(`/v1/support/tickets/${guestRef}`)).status).toBe(404)
    expect((await anon.get(`/v1/support/tickets/${ownRef}`)).status).toBe(401)
    expect((await signedIn.c.get(`/v1/support/tickets/${ownRef}`)).body).toMatchObject({ ref: ownRef, status: "OPEN", canReply: true, messages: [{ direction: "FROM_CUSTOMER" }] })
  })

  it("staff list and filter; an internal note stays internal; a reply emails the contact and waits for the customer", async () => {
    const list = await admin.get("/v1/admin/support/tickets?status=OPEN&assignee=none&limit=100")
    expect(list.status).toBe(200)
    expect(list.body.items.some((i: { ref: string }) => i.ref === ownRef)).toBe(true)
    expect((await admin.get(`/v1/admin/support/tickets?q=${ownRef}`)).body.items).toHaveLength(1)
    expect((await admin.get("/v1/admin/support/tickets?overdue=false&topic=BOOKING&limit=5")).status).toBe(200)

    const note = await admin.post(`/v1/admin/support/tickets/${ownRef}/replies`, { body: "Internal: customer is travelling on a student fare.", internal: true })
    expect(note.status).toBe(200)
    expect(note.body.status).toBe("OPEN")
    const seen = (await signedIn.c.get(`/v1/support/tickets/${ownRef}`)).body
    expect(JSON.stringify(seen)).not.toContain("student fare")
    expect(seen.messages).toHaveLength(1)

    const since = Date.now() - 2000
    const reply = await admin.post(`/v1/admin/support/tickets/${ownRef}/replies`, { body: "We can change the date for a fee. Which date do you prefer?" })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ status: "PENDING_CUSTOMER", assignee: { name: expect.any(String) } })
    expect(reply.body.messages.map((m: { kind: string }) => m.kind)).toEqual(["CUSTOMER", "INTERNAL", "STAFF"])
    expect(reply.body.messages[2].emailed).toBe(true)
    const email = await until(async () => ((await (await fetch(`${API}/v1/dev-sink/email`)).json()) as { to: string; subject: string; body: string; at: string }[]).find((m) => m.subject.includes(ownRef) && Date.parse(m.at) >= since), Boolean)
    expect(email?.body).toContain("change the date")
    expect(email?.body).not.toContain("student fare")
    expect((await signedIn.c.get(`/v1/support/tickets/${ownRef}`)).body.messages.map((m: { direction: string }) => m.direction)).toEqual(["FROM_CUSTOMER", "TO_CUSTOMER"])
  })

  it("the customer's answer reopens it; staff assign, resolve, reopen and close through the machine; CLOSED is final", async () => {
    const back = await signedIn.c.post(`/v1/support/tickets/${ownRef}/messages`, { body: "The twelfth of December, please." })
    expect(back.status).toBe(200)
    expect(back.body.status).toBe("OPEN")
    let d = (await admin.get(`/v1/admin/support/tickets/${ownRef}`)).body
    const adminId = (await admin.get("/v1/me")).body.id
    expect((await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "resolve", expectedVersion: d.version + 5 })).body.code).toBe("VERSION_CONFLICT")
    expect((await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "assign", expectedVersion: d.version })).status).toBe(400)
    // Someone without support.reply cannot be assigned.
    const cargoId = (await cargo.get("/v1/me")).body.id
    expect((await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "assign", assigneeUserId: cargoId, expectedVersion: d.version })).body.code).toBe("INVALID_TRANSITION")
    d = (await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "assign", assigneeUserId: adminId, expectedVersion: d.version })).body
    expect(d.assignee.userId).toBe(adminId)
    expect((await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "close", expectedVersion: d.version })).body.code).toBe("INVALID_TRANSITION")
    d = (await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "resolve", expectedVersion: d.version })).body
    expect(d.status).toBe("RESOLVED")
    d = (await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "reopen", expectedVersion: d.version })).body
    expect(d.status).toBe("OPEN")
    d = (await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "resolve", expectedVersion: d.version })).body
    d = (await admin.post(`/v1/admin/support/tickets/${ownRef}/commands`, { command: "close", expectedVersion: d.version })).body
    expect(d.status).toBe("CLOSED")
    expect((await signedIn.c.post(`/v1/support/tickets/${ownRef}/messages`, { body: "One more thing" })).body.code).toBe("INVALID_TRANSITION")
    expect((await admin.post(`/v1/admin/support/tickets/${ownRef}/replies`, { body: "late reply" })).body.code).toBe("INVALID_TRANSITION")
    expect((await signedIn.c.get(`/v1/support/tickets/${ownRef}`)).body.canReply).toBe(false)
  })

  it("a reply to a guest goes to the address they gave; a phone-only contact is not emailed", async () => {
    const since = Date.now() - 2000
    const r = await admin.post(`/v1/admin/support/tickets/${guestRef}/replies`, { body: "Thanks, we have your request and will email the options." })
    expect(r.status).toBe(200)
    const mail = await until(async () => ((await (await fetch(`${API}/v1/dev-sink/email`)).json()) as { to: string; subject: string; at: string }[]).find((m) => m.to === guestEmail && Date.parse(m.at) >= since), Boolean)
    expect(mail?.subject).toContain(guestRef)
    const phoneOnly = await new Session("WEB").post("/v1/support/tickets", { ...form(), email: undefined, phone: "+44 7700 900456" })
    const pr = await admin.post(`/v1/admin/support/tickets/${phoneOnly.body.ref}/replies`, { body: "We will call you this afternoon." })
    expect(pr.body.messages.at(-1)).toMatchObject({ kind: "STAFF", emailed: false })
  })

  it("staff without support permissions are refused", async () => {
    expect((await cargo.get("/v1/admin/support/tickets")).status).toBe(403)
    expect((await dev.get("/v1/admin/support/tickets")).status).toBe(403)
    expect((await signedIn.c.get("/v1/admin/support/tickets")).status).toBe(403)
  })

  it("the manual call log works without Bonline and links to a ticket and a customer", async () => {
    const call = { direction: "INBOUND", fromNumber: signedIn.phone, toNumber: "+442000000000", durationSeconds: 125, status: "ANSWERED", startedAt: new Date().toISOString(), note: "Asked about the date change" }
    const bad = await admin.post("/v1/admin/calls", { ...call, ticketRef: "TK-ZZZZZZ" })
    expect(bad.status).toBe(400)
    const made = await admin.post("/v1/admin/calls", { ...call, ticketRef: guestRef, customerId: signedIn.id })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ source: "MANUAL", ticketRef: guestRef, customerId: signedIn.id, durationSeconds: 125 })
    expect((await admin.get(`/v1/admin/calls?ticketRef=${guestRef}`)).body.items.map((c: { id: string }) => c.id)).toEqual([made.body.id])
    expect((await admin.get(`/v1/admin/calls?customerId=${signedIn.id}&direction=INBOUND&status=ANSWERED`)).body.items.length).toBeGreaterThan(0)
    expect((await admin.get(`/v1/admin/support/tickets/${guestRef}`)).body.calls[0].id).toBe(made.body.id)
    expect((await cargo.post("/v1/admin/calls", call)).status).toBe(403)
    expect((await admin.post("/v1/admin/calls", { ...call, durationSeconds: -1 })).status).toBe(400)
  })

  it("click-to-call answers NOT_CONFIGURED (501) until the Bonline API exists", async () => {
    const r = await admin.post("/v1/admin/calls/click-to-call", { toNumber: "+447700900123" })
    expect(r.status).toBe(501)
    expect(r.body.code).toBe("NOT_CONFIGURED")
  })

  it("the Bonline webhook needs the signed secret from the Developer Panel; replays do not duplicate; the secret is never shown", async () => {
    const secret = `e2e-secret-${key()}`
    const sign = (raw: string, s = secret) => `sha256=${createHmac("sha256", s).update(raw).digest("hex")}`
    const post = (raw: string, sig?: string) => fetch(`${API}/v1/webhooks/bonline`, { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-bonline-signature": sig } : {}) }, body: raw })
    const callId = `bl-${key()}`
    const raw = JSON.stringify({ callId, direction: "INBOUND", fromNumber: signedIn.phone, toNumber: "+442000000000", durationSeconds: 30, status: "ANSWERED", startedAt: new Date().toISOString() })
    // Before any credential exists, even a "valid" signature is refused with the same answer as a wrong one.
    expect((await post(raw, sign(raw))).status).toBe(400)
    expect((await dev.put("/v1/dev/vendors/telephony:bonline/credentials", { values: { webhookSecret: "short" } })).status).toBe(400)
    expect((await dev.put("/v1/dev/vendors/telephony:bonline/credentials", { values: { webhookSecret: secret, extra: "x" } })).status).toBe(400)
    expect((await admin.put("/v1/dev/vendors/telephony:bonline/credentials", { values: { webhookSecret: secret } })).status).toBe(404)
    expect((await dev.put("/v1/dev/vendors/telephony:bonline/credentials", { values: { webhookSecret: secret } })).status).toBe(200)
    const vendors = await dev.get("/v1/dev/vendors")
    expect(JSON.stringify(vendors.body)).not.toContain(secret)
    expect(vendors.body.find((v: { vendor: string }) => v.vendor === "telephony:bonline")).toMatchObject({ fields: expect.arrayContaining(["webhookSecret"]) })
    expect(vendors.body.find((v: { vendor: string }) => v.vendor === "email:smtp")?.fields).toEqual(["host", "port", "user", "pass", "secure", "from"])

    expect((await post(raw)).status).toBe(400)
    expect((await post(raw, sign(raw, "another-secret-of-length"))).status).toBe(400)
    expect((await post(`${raw} `, sign(raw))).status).toBe(400) // body altered after signing
    expect((await post(JSON.stringify({ callId }), sign(JSON.stringify({ callId })))).status).toBe(400) // signed but not a call event
    const first = await post(raw, sign(raw))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ accepted: true, duplicate: false })
    expect(await (await post(raw, sign(raw))).json()).toEqual({ accepted: true, duplicate: true })
    const listed = (await admin.get(`/v1/admin/calls?customerId=${signedIn.id}`)).body.items.filter((c: { source: string }) => c.source === "BONLINE")
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ direction: "INBOUND", status: "ANSWERED", customerId: signedIn.id })
    expect(Number((await dbQuery<{ n: string }>("select count(*) n from call_logs where provider_ref = $1", [callId]))[0]!.n)).toBe(1)
  })
})

// ---------------------------------------------------------------- J6
describe("Admin-assigned services and the payment page (ADR-0020)", () => {
  let u: Cust, stranger: Cust
  let ref: string
  const cipDetails = { airport: "IKA", direction: "ARRIVAL", flightNumber: "BA 6641", date: "2027-03-01", passengersCount: 2 }
  const validUntil = new Date(Date.now() + 2 * 86400_000).toISOString()
  const quote = (over: Record<string, unknown> = {}) => ({ lines: [{ kind: "SERVICE_FEE", label: "Uni Travel service fee", amount: GBP(5000) }, { kind: "THIRD_PARTY_FEE", label: "Airport CIP lounge", amount: GBP(2000) }], validUntil, note: "Arranged by phone", ...over })
  const assign = (id: string, over: Record<string, unknown> = {}, who: Session = admin, k = key()) => who.post(`/v1/admin/customers/${id}/assignments`, { type: "CIP", details: cipDetails, quote: quote(), ...over }, { "idempotency-key": k })

  beforeAll(async () => {
    expect((await dev.put("/v1/dev/feature-flags/services.cip.enabled", { enabled: true })).status).toBe(200)
    await until(async () => (await anon.get("/v1/site")).body.menu.cip, Boolean)
    u = await customer("Assigned")
    stranger = await customer("Stranger")
  })

  it("is refused without service.assign, for unknown or staff customers, for tour call-backs and bad details", async () => {
    expect((await assign(u.id, {}, cargo)).status).toBe(403)
    expect((await assign(u.id, {}, dev)).status).toBe(403)
    expect((await u.c.post(`/v1/admin/customers/${u.id}/assignments`, {})).status).toBe(403)
    expect((await assign("00000000-0000-4000-8000-000000000000")).status).toBe(404)
    expect((await assign((await cargo.get("/v1/me")).body.id)).status).toBe(404)
    expect((await assign(u.id, { type: "TOUR_CALLBACK", details: { destination: "Istanbul", approxDates: "April", travellersCount: 2, bestTimeToCall: "evenings" } })).status).toBe(400)
    expect((await assign(u.id, { details: { ...cipDetails, airport: "THR" } })).status).toBe(400)
    expect((await assign(u.id, { quote: quote({ lines: [{ kind: "SERVICE_FEE", label: "x", amount: GBP(0) }] }) })).status).toBe(400)
    expect((await assign(u.id, { details: { ...cipDetails, linkedFlightRequestRef: "UT-F-ABC234" } })).status).toBe(400)
  })

  it("a disabled service cannot be assigned (FEATURE_DISABLED)", async () => {
    await dev.put("/v1/dev/feature-flags/services.cip.enabled", { enabled: false })
    await until(async () => (await anon.get("/v1/site")).body.menu.cip, (v) => v === false)
    const r = await assign(u.id)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe("FEATURE_DISABLED")
    await dev.put("/v1/dev/feature-flags/services.cip.enabled", { enabled: true })
    await until(async () => (await anon.get("/v1/site")).body.menu.cip, Boolean)
  })

  it("creates the request for the customer on the console channel; CIP at IKA is a REVIEW policy, so it is held for the compliance officer and no quote goes out", async () => {
    const k = key()
    const r = await assign(u.id, {}, admin, k)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ type: "CIP", status: "COMPLIANCE_HOLD", quoteSent: false })
    ref = r.body.ref
    expect((await assign(u.id, {}, admin, k)).body.ref).toBe(ref)

    const staff = (await admin.get(`/v1/admin/service-requests/${ref}`)).body
    expect(staff).toMatchObject({ submittedVia: "CONSOLE", status: "COMPLIANCE_HOLD", customer: { userId: u.id }, quote: null })
    const seen = (await u.c.get(`/v1/service-requests/${ref}`)).body
    expect(seen).toMatchObject({ ref, type: "CIP", status: "SUBMITTED", canAcceptQuote: false, quote: null })
    expect((await stranger.c.get(`/v1/service-requests/${ref}`)).status).toBe(404)
    expect((await u.c.get("/v1/billing/purchasable")).body).toEqual([])
    // The held case is decided by the officer; the assignment gives staff no way round it.
    const c = (await compliance.get(`/v1/admin/compliance/cases/${staff.complianceCaseId}`)).body
    expect(c).toMatchObject({ requestType: "SERVICE", requestRef: ref, status: "OPEN" })
    expect((await compliance.post(`/v1/admin/compliance/cases/${c.id}/decide`, { decision: "RELEASE", reason: "Operator cleared by counsel for this request" })).status).toBe(200)
    await until(() => admin.get(`/v1/admin/service-requests/${ref}`), (x) => x.body.status === "SUBMITTED")
  })

  it("after release staff quote through the normal transition; the customer sees a normal quote, listed for acceptance (ACCEPT); accepting is the customer's act, not payment", async () => {
    let d = await admin.get(`/v1/admin/service-requests/${ref}`)
    d = await admin.post(`/v1/admin/service-requests/${ref}/transition`, { command: "claim", expectedVersion: d.body.version, input: {} })
    expect(d.body.status).toBe("IN_PROGRESS")
    d = await admin.post(`/v1/admin/service-requests/${ref}/transition`, { command: "send_quote", expectedVersion: d.body.version, input: quote() })
    expect(d.body.status).toBe("QUOTED")
    const mine = (await u.c.get(`/v1/service-requests/${ref}`)).body
    expect(mine).toMatchObject({ status: "QUOTED", canAcceptQuote: true, quote: { status: "SENT", total: GBP(7000) } })
    expect((await u.c.get("/v1/track")).body.some((t: { ref: string; kind: string }) => t.ref === ref && t.kind === "SERVICE")).toBe(true)

    const items = (await u.c.get("/v1/billing/purchasable")).body
    expect(items).toContainEqual(expect.objectContaining({ kind: "QUOTE", action: "ACCEPT", requestRef: ref, productType: "SERVICE", amount: GBP(7000) }))
    expect((await stranger.c.get("/v1/billing/purchasable")).body).toEqual([])
    expect((await anon.get("/v1/billing/purchasable")).status).toBe(401)
    const acc = await u.c.post(`/v1/service-requests/${ref}/quote/accept`)
    expect(acc.body).toMatchObject({ status: "CONFIRMED" })
    expect((await u.c.get("/v1/billing/purchasable")).body.filter((i: { kind: string }) => i.kind === "QUOTE")).toEqual([])
  })

  it("an invoice from the accepted quote gives a payment page with issuer, due date, lines and offline instructions, and no pay link while online payment is off", async () => {
    const settings = (await dev.get("/v1/dev/settings")).body
    const withText = { ...settings, payment: { offlineInstructions: { en: "Bank transfer to the account on your invoice, quoting the invoice number.", fa: "حواله بانکی با ذکر شماره فاکتور" } } }
    expect((await dev.put("/v1/dev/settings", withText)).status).toBe(200)
    try {
      const inv = await admin.post(`/v1/admin/requests/${ref}/invoices`)
      expect(inv.status).toBe(201)
      const issued = await admin.post(`/v1/admin/invoices/${inv.body.id}/issue`)
      expect(issued.status).toBe(200)
      const number = issued.body.number as string
      expect((await u.c.get("/v1/billing/purchasable")).body).toContainEqual(expect.objectContaining({ kind: "INVOICE", action: "PAY", number, requestRef: ref, amount: GBP(7000) }))

      const page = await u.c.get(`/v1/billing/invoices/${number}/payment-page`)
      expect(page.status).toBe(200)
      expect(page.body).toMatchObject({
        invoiceNumber: number, status: "ISSUED", requestRef: ref, productType: "SERVICE", currency: "GBP", total: GBP(7000), customerName: expect.stringContaining("Assigned"),
        issuer: { name: expect.any(String), address: expect.any(String), email: expect.any(String) }, online: { offered: false }, payUrl: null,
        offlineInstructions: "Bank transfer to the account on your invoice, quoting the invoice number.",
      })
      expect(page.body.lines.map((l: { description: string; quantity: number; unitAmount: unknown; amount: unknown }) => [l.description, l.quantity, l.unitAmount, l.amount])).toEqual([
        ["Uni Travel service fee", 1, GBP(5000), GBP(5000)], ["Airport CIP lounge", 1, GBP(2000), GBP(2000)],
      ])
      expect(typeof page.body.dueAt).toBe("string")
      expect(page.body).toHaveProperty("pdfUrl")
      expect((await stranger.c.get(`/v1/billing/invoices/${number}/payment-page`)).status).toBe(404)
      expect((await anon.get(`/v1/billing/invoices/${number}/payment-page`)).status).toBe(401)
      // Paying (or not) never changes the request: it stays CONFIRMED, never "booked".
      expect((await u.c.get(`/v1/service-requests/${ref}`)).body.status).toBe("CONFIRMED")
    } finally {
      await dev.put("/v1/dev/settings", settings)
    }
  })

  it("the Developer Panel exposes the SMTP vendor form; values are validated and never read back", async () => {
    const bad = await dev.put("/v1/dev/vendors/email:smtp/credentials", { values: { host: "smtp.example.com", port: "abc", user: "u", pass: "p" } })
    expect(bad.status).toBe(400)
    expect((await dev.put("/v1/dev/vendors/email:smtp/credentials", { values: { host: "smtp.example.com", port: "587" } })).status).toBe(400)
  })
})

// ---------------------------------------------------------------- J7
describe("Curated and cached listings (ADR-0021)", () => {
  const body = (over: Record<string, unknown> = {}) => ({ vertical: "STAY", title: { en: "Family villa in Tabriz", fa: "ویلا در تبریز" }, summary: { en: "Garden villa, sleeps six", fa: "ویلا" }, toPlace: `Tabriz-${key().slice(4, 10)}`, operator: "Local host", ...over })
  let id: string, version: number, place: string

  it("staff curate: a draft is invisible; publishing makes it public as INDICATIVE with no price", async () => {
    const b = body()
    place = b.toPlace
    const made = await admin.post("/v1/admin/listings", b)
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ status: "DRAFT", priceQuoted: false, price: null })
    id = made.body.id
    version = made.body.version
    expect((await anon.get(`/v1/listings/stays?to=${place}`)).body.items).toEqual([])
    const pub = await admin.patch(`/v1/admin/listings/${id}`, { version, status: "PUBLISHED" })
    expect(pub.status).toBe(200)
    version = pub.body.version
    const view = await anon.get(`/v1/listings/stays?to=${place.toLowerCase()}`)
    expect(view.status).toBe(200)
    expect(view.body).toMatchObject({ vertical: "STAY", notice: "INDICATIVE_ONLY" })
    expect(view.body.items).toHaveLength(1)
    expect(view.body.items[0]).toMatchObject({ id, label: "INDICATIVE", price: null, toPlace: place })
    expect(JSON.stringify(view.body)).not.toMatch(/amountMinor/)
  })

  it("a price needs priceQuoted and the other way round; a quoted price then shows; stale edits conflict", async () => {
    expect((await admin.patch(`/v1/admin/listings/${id}`, { version, price: GBP(9000) })).status).toBe(400)
    expect((await admin.patch(`/v1/admin/listings/${id}`, { version, priceQuoted: true })).status).toBe(400)
    expect((await admin.post("/v1/admin/listings", body({ price: GBP(1000) }))).status).toBe(400)
    const q = await admin.patch(`/v1/admin/listings/${id}`, { version, priceQuoted: true, price: GBP(9000) })
    expect(q.status).toBe(200)
    expect((await admin.patch(`/v1/admin/listings/${id}`, { version, sortOrder: 5 })).body.code).toBe("VERSION_CONFLICT")
    version = q.body.version
    expect((await anon.get(`/v1/listings/stays?to=${place}`)).body.items[0].price).toEqual(GBP(9000))
    const unq = await admin.patch(`/v1/admin/listings/${id}`, { version, priceQuoted: false, price: null })
    expect(unq.status).toBe(200)
    version = unq.body.version
    expect((await anon.get(`/v1/listings/stays?to=${place}`)).body.items[0].price).toBeNull()
  })

  it("buses and trains need an origin, stays must not have one; filters by origin and destination; archived rows vanish", async () => {
    expect((await admin.post("/v1/admin/listings", body({ vertical: "BUS" }))).status).toBe(400)
    expect((await admin.post("/v1/admin/listings", body({ fromPlace: "Istanbul" }))).status).toBe(400)
    const to = `Van-${key().slice(4, 10)}`
    const bus = await admin.post("/v1/admin/listings", body({ vertical: "BUS", fromPlace: "Istanbul", toPlace: to }))
    expect(bus.status).toBe(201)
    const bp = await admin.patch(`/v1/admin/listings/${bus.body.id}`, { version: bus.body.version, status: "PUBLISHED" })
    expect(bp.status).toBe(200)
    expect((await anon.get(`/v1/listings/buses?from=istanbul&to=${to}`)).body.items.map((i: { id: string }) => i.id)).toEqual([bus.body.id])
    expect((await anon.get(`/v1/listings/buses?from=ankara&to=${to}`)).body.items).toEqual([])
    expect((await anon.get(`/v1/listings/trains?to=${to}`)).body.items).toEqual([])
    const cur = (await admin.get(`/v1/admin/listings/${bus.body.id}`)).body
    await admin.patch(`/v1/admin/listings/${bus.body.id}`, { version: cur.version, status: "ARCHIVED" })
    expect((await anon.get(`/v1/listings/buses?to=${to}`)).body.items).toEqual([])
    expect((await anon.get("/v1/listings/hotels")).status).toBe(400)
  })

  it("staff access: listings.write only; customers and other staff are refused", async () => {
    expect((await cargo.get("/v1/admin/listings")).status).toBe(403)
    expect((await dev.post("/v1/admin/listings", body())).status).toBe(403)
    expect((await new Session("WEB").post("/v1/admin/listings", body())).status).toBe(401)
    expect((await admin.get("/v1/admin/listings?vertical=STAY&status=PUBLISHED&limit=100")).body.items.some((i: { id: string }) => i.id === id)).toBe(true)
    expect((await admin.get("/v1/admin/listings/00000000-0000-4000-8000-000000000000")).status).toBe(404)
  })

  it("flights: empty with NO_SOURCES when nothing is cached; a cached live result carries its label and fetch time and no amount; stale or foreign data is not served", async () => {
    const empty = await anon.get("/v1/listings/flights?from=LHR&to=IKA")
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ items: [], notice: "NO_SOURCES" })
    const fetchedAt = new Date().toISOString()
    const item = { label: "CACHED_OFFER", fetchedAt, origin: "LHR", destination: "IKA", departureDate: "2027-01-10", carriers: ["TK"], stops: 1, durationMin: 640, departureLocal: "2027-01-10T09:00", arrivalLocal: "2027-01-10T20:40" }
    await redis.set("listings:flights:LHR-IKA", JSON.stringify({ fetchedAt, items: [item] }), "EX", 120)
    try {
      const hit = await anon.get("/v1/listings/flights?from=lhr&to=ika")
      expect(hit.body.notice).toBeNull()
      expect(hit.body.items).toEqual([item])
      expect(JSON.stringify(hit.body)).not.toMatch(/amount|price|GBP/i)
      expect((await anon.get("/v1/listings/flights?from=LHR&to=THR")).body).toEqual({ items: [], notice: "NO_SOURCES" })
      expect((await anon.get("/v1/listings/flights?from=LH&to=IKA")).body.notice).toBe("NO_SOURCES")
    } finally {
      await redis.del("listings:flights:LHR-IKA")
    }
  })

  it("the worker warms configured routes through the supplier gateway and the result is served labelled; with no source it caches nothing", async () => {
    const settings = (await dev.get("/v1/dev/settings")).body
    await redis.del("listings:flights:THR-MHD")
    expect((await dev.put("/v1/dev/settings", { ...settings, listings: { flightRoutes: [{ from: "THR", to: "MHD" }] } })).status).toBe(200)
    try {
      await maintenance.add("listings.warm-flights", {})
      const cached = await until(() => redis.get("listings:flights:THR-MHD"), Boolean, 25_000)
      if (cached) {
        const view = (await anon.get("/v1/listings/flights")).body
        expect(view.notice).toBeNull()
        expect(view.items.length).toBeGreaterThan(0)
        for (const i of view.items) expect(i).toMatchObject({ origin: "THR", destination: "MHD", label: expect.stringMatching(/^(SANDBOX|CACHED_OFFER)$/), fetchedAt: expect.any(String) })
        // A FAKE result is labelled SANDBOX and only exists where sandboxAllowed() (this developer machine).
        expect(view.items.every((i: { label: string }) => i.label === "SANDBOX")).toBe(true)
      } else {
        expect((await anon.get("/v1/listings/flights")).body).toEqual({ items: [], notice: "NO_SOURCES" })
      }
    } finally {
      await dev.put("/v1/dev/settings", settings)
      await redis.del("listings:flights:THR-MHD")
    }
  })

  // ADR-0032 B4, ADR-0004, ADR-0029 A5: no fare field reaches a customer, whatever the source. The FAKE source carries prices, so it proves the projection.
  it("no price, price level, booking token or Google link in the flight listing, its itinerary or a customer search", async () => {
    const FARE = /priceLevel|bookingToken|googleFlightsUrl|google\.com\/travel|"price"|"amount"|"total"/
    const settings = (await dev.get("/v1/dev/settings")).body
    await redis.del("listings:flights:IST-LHR")
    expect((await dev.put("/v1/dev/settings", { ...settings, listings: { flightRoutes: [{ from: "IST", to: "LHR" }] } })).status).toBe(200)
    try {
      // The worker picks the new route list up through the settings reload; warm again until it has.
      const warmed = await until(async () => { await maintenance.add("listings.warm-flights", {}); await wait(3000); return redis.get("listings:flights:IST-LHR") }, Boolean, 60_000)
      expect(warmed).toBeTruthy()
      const listing = await anon.get("/v1/listings/flights")
      expect(listing.body.items.length).toBeGreaterThan(0)
      expect(JSON.stringify(listing.body)).not.toMatch(FARE)
      const ref = (listing.body.items as { offerRef?: { itineraryId: string } | null }[]).find((i) => i.offerRef)?.offerRef
      expect(ref).toBeTruthy()
      // A SYSTEM listing search is readable by any caller (ADR-0032 B5), always through the customer projection.
      const itin = await anon.get(`/v1/itineraries/${ref!.itineraryId}`)
      expect(itin.status).toBe(200)
      expect(JSON.stringify(itin.body)).not.toMatch(FARE)

      const { c } = await customer("Leak")
      const started = await c.post("/v1/flight-searches", { tripType: "ONE_WAY", slices: [{ from: { airport: "IST" }, to: { airport: "LHR" }, date: new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10) }], passengers: [{ type: "ADT" }] })
      expect(started.status).toBe(202)
      const state = await until(() => c.get(`/v1/flight-searches/${started.body.id}?limit=60`), (r) => r.body.status !== "RUNNING", 30_000)
      expect(state.body.results.length).toBeGreaterThan(0)
      // `total` at the top of the page is the result count, not a fare; the results themselves carry none of these keys.
      expect(JSON.stringify(state.body.results)).not.toMatch(FARE)
      const { total: _count, results: _r, ...rest } = state.body
      expect(JSON.stringify(rest)).not.toMatch(FARE)
    } finally {
      await dev.put("/v1/dev/settings", settings)
      await redis.del("listings:flights:IST-LHR")
    }
  }, 120_000)
})
