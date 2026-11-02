import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, DEV_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/**
 * STAGE-23 stream D: bank-transfer instructions in the invoice email, the offline payment path end to end, failed and
 * replayed or out-of-order card webhooks (FAKE provider, signed locally; no Stripe key is ever used).
 * Needs the local stack (Mailpit, API, worker). Email-provider-down retry is covered by notifications/email-retry.spec.ts,
 * because breaking the shared SMTP credentials would disturb other sessions.
 */
const MAILPIT = "http://localhost:8035"
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 25_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}

interface Mail { Subject: string; Text: string }
const mailsTo = async (email: string, n: number): Promise<Mail[]> => {
  const found = await until(async () => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string; Created: string }[] }, (r) => (r.messages?.length ?? 0) >= n)
  const sorted = [...(found.messages ?? [])].sort((a, b) => a.Created.localeCompare(b.Created))
  return Promise.all(sorted.map(async (m) => { const f = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as Mail; return { Subject: f.Subject, Text: f.Text } }))
}
/** Mail order is not stable (a sign-in alert can arrive first), so wait for the message whose subject matches. */
const mailWith = async (email: string, subject: string): Promise<Mail> => (await until(() => mailsTo(email, 1), (ms) => ms.some((m) => m.Subject.includes(subject)))).find((m) => m.Subject.includes(subject))!
const notes = (userId: string, eventType: string) => dbQuery<{ id: string }>("select id from notifications where user_id = $1 and event_type = $2", [userId, eventType])

async function customer(name: string) {
  const c = new Session("WEB")
  await signIn(c, randomPhone("+4477009"), { givenNamesLatin: name, surnameLatin: "Stage23" })
  const me = (await c.get("/v1/me")).body
  const email = `s23-${Date.now()}-${Math.floor(Math.random() * 1e6)}@student.example`
  await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at) values (gen_random_uuid(), $1, 'EMAIL', $2, now())", [me.id, email])
  return { c, id: me.id as string, email }
}
const invoiceBody = (customerUserId: string, amount = 5000) => ({
  customerUserId, currency: "GBP", dueDays: 7,
  lines: [{ serviceType: "OTHER", description: "Consultation", quantity: 1, unitAmountMinor: amount }],
})
const BANK = { en: "Pay to sort code 00-00-00, account 12345678, quoting the invoice number.", fa: "به حساب ۱۲۳۴۵۶۷۸ واریز کنید و شماره فاکتور را بنویسید." }

let admin: Session, owner: Session, dev: Session, compliance: Session, ownerAdmin: Session
let settings: Record<string, unknown>
const hook = (e: { payload: string; signature: string }) => fetch(`${API}/v1/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": e.signature }, body: e.payload }).then((r) => r.status)
const sign = async (sessionId: string, body: Record<string, unknown>) => (await (await fetch(`${API}/v1/dev-sink/payments/${sessionId}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as { payload: string; signature: string }

beforeAll(async () => {
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  ownerAdmin = await staffSession(STAFF.owner, ADMIN_HOST)
  owner = await staffSession(STAFF.owner, DEV_HOST)
  dev = await staffSession(STAFF.developer, DEV_HOST)
  expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
  settings = (await dev.get("/v1/dev/settings")).body
  expect((await dev.put("/v1/dev/settings", { ...settings, payment: { offlineInstructions: BANK } })).status).toBe(200)
})
afterAll(async () => {
  await owner?.put(FLAG, { enabled: false })
  await dev?.put("/v1/dev/settings", settings)
})

describe("offline instructions in the invoice email", () => {
  it("the instructions text is length-validated", async () => {
    const tooLong = { en: "x".repeat(1501), fa: "y" }
    expect((await dev.put("/v1/dev/settings", { ...settings, payment: { offlineInstructions: tooLong } })).status).toBe(400)
  })

  it("online off: issue → email carries the instructions and our total only → staff records payment → PAID → receipt email", async () => {
    expect((await owner.put(FLAG, { enabled: false })).status).toBe(200)
    const u = await customer("Offline")
    const d = await admin.post("/v1/admin/invoices", invoiceBody(u.id))
    expect(d.status).toBe(201)
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    expect(issued.status).toBe(200)
    const issuedMail = await mailWith(u.email, issued.body.number)
    expect(issuedMail!.Subject).toContain(issued.body.number)
    expect(issuedMail!.Text).toContain("How to pay (bank transfer):")
    expect(issuedMail!.Text).toContain(BANK.en)
    expect(issuedMail!.Text).toContain("GBP 50.00")
    expect(issuedMail!.Text).not.toMatch(/\{[a-z_]+\}|sk_(test|live)_|client_secret/)

    const r = await admin.post(`/v1/admin/invoices/${d.body.id}/payments`, { amount: { amountMinor: 5000, currency: "GBP" }, method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: `S23-${Date.now()}`, payerName: "Offline Stage23" })
    expect(r.status).toBe(201)
    expect((await admin.get(`/v1/admin/invoices/${d.body.id}`)).body.status).toBe("PAID")
    const receipt = await mailWith(u.email, "Payment received")
    expect(receipt?.Subject).toContain(issued.body.number)
  })

  it("online on: the email has the sign-in pay link and no bank block", async () => {
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
    const u = await customer("Online")
    const d = await admin.post("/v1/admin/invoices", invoiceBody(u.id))
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const m = await mailWith(u.email, issued.body.number)
    expect(m!.Text).not.toContain("How to pay (bank transfer):")
    expect(m!.Text).toMatch(/Sign in to view and pay this invoice:\s+\S+\/s\/\w+/)
  })
})

describe("card webhooks: failure, replay, order (FAKE provider)", () => {
  let policy: string | undefined
  beforeAll(async () => {
    const p = await compliance.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action: "ALLOW", reason: "e2e: local test database only" })
    expect(p.status).toBe(201)
    policy = p.body.id
    expect((await ownerAdmin.post(`/v1/admin/compliance/policies/${policy}/approve`)).status).toBe(200)
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
  })
  afterAll(async () => {
    const off = await compliance.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action: "BLOCK", reason: "e2e: restore" })
    await ownerAdmin.post(`/v1/admin/compliance/policies/${off.body.id}/approve`)
  })

  async function open(name: string) {
    const u = await customer(name)
    const d = await admin.post("/v1/admin/invoices", invoiceBody(u.id))
    const number = (await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)).body.number as string
    await until(async () => (await u.c.get(`/v1/billing/invoices/${number}/payment`)).body, (s) => s.offered === true)
    expect((await u.c.post(`/v1/billing/invoices/${number}/checkout-session`)).status).toBeLessThan(300)
    const [row] = await dbQuery<{ provider_session_id: string }>("select provider_session_id from payment_sessions where invoice_id = $1 order by attempt desc limit 1", [d.body.id])
    return { u, number, invoiceId: d.body.id as string, session: row!.provider_session_id }
  }

  it("a failed asynchronous payment keeps the invoice ISSUED and notifies once, even when Stripe replays the event", async () => {
    const { u, number, session } = await open("Failed")
    expect(await hook(await sign(session, { kind: "async_pending" }))).toBe(200)
    const failed = await sign(session, { kind: "async_failed" })
    expect(await hook(failed)).toBe(200)
    expect(await hook(failed)).toBe(200)
    await until(() => notes(u.id, "payment.failed"), (n) => n.length === 1)
    await wait(1500)
    expect(await notes(u.id, "payment.failed")).toHaveLength(1)
    expect((await u.c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("ISSUED")
  })

  it("a duplicate paid event settles once; a failure that arrives after payment never moves the invoice back", async () => {
    const { u, number, invoiceId, session } = await open("Ordering")
    const paid = await sign(session, { kind: "paid" })
    expect(await hook(paid)).toBe(200)
    expect(await hook(paid)).toBe(200)
    expect(await hook(await sign(session, { kind: "async_failed" }))).toBe(200)
    expect(await hook(await sign(session, { kind: "expired" }))).toBe(200)
    expect((await u.c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("PAID")
    expect(Number((await dbQuery<{ n: string }>("select count(*) n from payment_records where invoice_id = $1", [invoiceId]))[0]!.n)).toBe(1)
    await wait(1500)
    expect(await notes(u.id, "payment.failed")).toHaveLength(0)
    expect(await notes(u.id, "invoice.paid")).toHaveLength(1)
  })
})
