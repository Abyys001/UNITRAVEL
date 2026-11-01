import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, DEV_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/** ADR-0028: invoices typed by staff for a chosen customer, emailed with a PDF, payable in the portal. Uses the FAKE provider. */
const MAILPIT = "http://localhost:8035"
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 25_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}

async function customer(name: string, email?: string) {
  const c = new Session("WEB")
  await signIn(c, randomPhone("+4477009"), { givenNamesLatin: name, surnameLatin: "Direct" })
  const me = (await c.get("/v1/me")).body
  if (email) {
    // The verified address is what the invoice email goes to.
    await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at) values (gen_random_uuid(), $1, 'EMAIL', $2, now())", [me.id, email])
  }
  return { c, id: me.id as string }
}
const body = (customerUserId: string, over: Record<string, unknown> = {}) => ({
  customerUserId, currency: "GBP", dueDays: 7, notes: "Thanks for choosing Uni Travel",
  lines: [
    { serviceType: "VISA", description: "Schengen visa support", quantity: 2, unitAmountMinor: 5000 },
    { serviceType: "BUS", description: "Airport coach", quantity: 1, unitAmountMinor: 2500 },
    { serviceType: "DISCOUNT", description: "Returning customer", quantity: 1, unitAmountMinor: -500 },
  ],
  ...over,
})

let admin: Session, cargo: Session, ownerAdmin: Session, owner: Session, dev: Session, compliance: Session, adminTwo: Session
const created: string[] = []

beforeAll(async () => {
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
  ownerAdmin = await staffSession(STAFF.owner, ADMIN_HOST)
  adminTwo = ownerAdmin
  owner = await staffSession(STAFF.owner, DEV_HOST)
  dev = await staffSession(STAFF.developer, DEV_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
})
afterAll(async () => {
  await owner?.put(FLAG, { enabled: false })
})

describe("direct invoices (ADR-0028)", () => {
  it("creating needs invoice.direct, a real customer and sane lines; the server computes every amount", async () => {
    const u = await customer("Rules")
    expect((await cargo.post("/v1/admin/invoices", body(u.id))).status).toBe(403)
    expect((await u.c.post("/v1/admin/invoices", body(u.id))).status).toBe(403)
    expect((await admin.post("/v1/admin/invoices", body("00000000-0000-4000-8000-000000000000"))).status).toBe(404)
    expect((await admin.post("/v1/admin/invoices", body((await cargo.get("/v1/me")).body.id))).status).toBe(404)
    const line = (serviceType: string, unitAmountMinor: number) => ({ serviceType, description: "Something", quantity: 1, unitAmountMinor })
    expect((await admin.post("/v1/admin/invoices", body(u.id, { lines: [line("FLIGHT", 100)] }))).status).toBe(400)
    expect((await admin.post("/v1/admin/invoices", body(u.id, { lines: [line("VISA", -100)] }))).status).toBe(400)
    expect((await admin.post("/v1/admin/invoices", body(u.id, { lines: [line("DISCOUNT", 100)] }))).status).toBe(400)
    expect((await admin.post("/v1/admin/invoices", body(u.id, { lines: [line("VISA", 100), line("DISCOUNT", -100)] }))).status).toBe(400)
    expect((await admin.post("/v1/admin/invoices", { ...body(u.id), totalMinor: 1 })).status).toBe(400)

    const d = await admin.post("/v1/admin/invoices", body(u.id))
    expect(d.status).toBe(201)
    expect(d.body).toMatchObject({ status: "DRAFT", origin: "DIRECT", number: null, productType: "SERVICE", total: { amountMinor: 12000, currency: "GBP" }, customer: { id: u.id } })
    expect(d.body.requestRef).toMatch(/^UT-D-/)
    expect(d.body.lines[0]).toMatchObject({ serviceType: "VISA", quantity: 2, amount: { amountMinor: 10000 } })
    expect((await dbQuery<{ quote_id: string | null; request_id: string }>("select quote_id, request_id from invoices where id = $1", [d.body.id]))[0]).toEqual({ quote_id: null, request_id: d.body.id })
    created.push(d.body.id)
  })

  it("a draft is invisible to the customer and editable; after issue it is frozen and appears in their billing, not anyone else's", async () => {
    const u = await customer("Owner", `direct-${Date.now()}@student.example`)
    const other = await customer("Other")
    const d = await admin.post("/v1/admin/invoices", body(u.id))
    expect((await u.c.get("/v1/billing/documents")).body.invoices).toHaveLength(0)

    const edit = await admin.put(`/v1/admin/invoices/${d.body.id}`, { currency: "GBP", dueDays: 3, notes: null, lines: [{ serviceType: "TRAIN", description: "Tehran to Mashhad", quantity: 1, unitAmountMinor: 8000 }] })
    expect(edit.status).toBe(200)
    expect(edit.body).toMatchObject({ total: { amountMinor: 8000 }, dueDays: 3, notes: null })
    expect(edit.body.lines).toHaveLength(1)

    const before = Date.now()
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe("ISSUED")
    expect(issued.body.number).toMatch(/^INV-/)
    expect(new Date(issued.body.expiresAt).getTime()).toBeLessThan(before + 3.1 * 86400_000)

    expect((await admin.put(`/v1/admin/invoices/${d.body.id}`, { currency: "GBP", dueDays: 3, notes: null, lines: [{ serviceType: "TRAIN", description: "Changed", quantity: 1, unitAmountMinor: 1 }] })).status).toBe(409)
    await expect(dbQuery("update invoices set total_minor = 1 where id = $1", [d.body.id])).rejects.toThrow()

    const docs = (await u.c.get("/v1/billing/documents")).body
    expect(docs.invoices[0]).toMatchObject({ number: issued.body.number, status: "ISSUED", total: { amountMinor: 8000 } })
    expect(docs.invoices[0].lines[0].serviceType).toBe("TRAIN")
    expect((await other.c.get(`/v1/billing/invoices/${issued.body.number}`)).status).toBe(404)
    const items = (await u.c.get("/v1/billing/purchasable")).body
    expect(items[0]).toMatchObject({ kind: "INVOICE", number: issued.body.number, title: "Tehran to Mashhad" })
  })

  it("the email carries services, total, due date and the PDF; the inbox carries no amount", async () => {
    const email = `mail-${Date.now()}@student.example`
    const u = await customer("Mailed", email)
    const d = await admin.post("/v1/admin/invoices", body(u.id))
    expect(d.body.customer.emailDeliverable).toBe(true)
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const found = await until(async () => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string; Attachments: number; Subject: string }[] }, (r) => r.messages.length > 0)
    const m = found.messages[0]!
    expect(m.Subject).toContain(issued.body.number)
    expect(m.Attachments).toBe(1)
    const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json() as { Text: string; Attachments: { FileName: string; ContentType: string }[] }
    expect(full.Attachments[0]).toMatchObject({ FileName: `invoice-${issued.body.number}.pdf`, ContentType: "application/pdf" })
    for (const s of ["Visa: Schengen visa support x 2", "Bus: Airport coach", "Discount: Returning customer", "GBP 120.00"]) expect(full.Text).toContain(s)
    expect(full.Text).not.toMatch(/\{[a-z_]+\}/)
    const inbox = await u.c.get("/v1/notifications")
    const row = (inbox.body.items ?? inbox.body).find((n: { eventType: string }) => n.eventType === "invoice.issued")
    expect(`${row.title} ${row.body}`).not.toContain("120")
  })

  it("no ALLOW policy: Pay is not offered and readiness says why; with policy and flag, session → signed webhook → PAID", async () => {
    const u = await customer("Payer")
    const d = await admin.post("/v1/admin/invoices", body(u.id))
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const number = issued.body.number as string
    const staff = (await admin.get(`/v1/admin/invoices/${d.body.id}/payments`)).body
    expect(staff.online.offered).toBe(false)

    // Policies are data: added by compliance and approved by an owner, never by a migration (rule 5).
    const p = await compliance.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action: "ALLOW", reason: "e2e: local test database only" })
    expect(p.status).toBe(201)
    expect((await ownerAdmin.post(`/v1/admin/compliance/policies/${p.body.id}/approve`)).status).toBe(200)
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
    const state = await until(async () => (await u.c.get(`/v1/billing/invoices/${number}/payment`)).body, (s) => s.offered === true)
    expect(state.offered).toBe(true)
    const page = (await u.c.get(`/v1/billing/invoices/${number}/payment-page`)).body
    if (page.payUrl) expect(page.payUrl).toContain(`/billing/${number}/pay`)

    expect((await u.c.post(`/v1/billing/invoices/${number}/checkout-session`)).status).toBeLessThan(300)
    const [row] = await dbQuery<{ provider_session_id: string }>("select provider_session_id from payment_sessions where invoice_id = $1", [d.body.id])
    const ev = await (await fetch(`${API}/v1/dev-sink/payments/${row!.provider_session_id}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "paid" }) })).json() as { payload: string; signature: string }
    const hook = await fetch(`${API}/v1/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": ev.signature }, body: ev.payload })
    expect(hook.status).toBe(200)
    expect((await u.c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("PAID")
    // Retire the test policy so later suites see the shipped state.
    const off = await compliance.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action: "BLOCK", reason: "e2e: restore" })
    await ownerAdmin.post(`/v1/admin/compliance/policies/${off.body.id}/approve`)
  })

  it("offline payment: small settles at once; above the threshold a second person verifies, then it settles", async () => {
    const pay = (minor: number) => ({ amount: { amountMinor: minor, currency: "GBP" }, method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: `E2E-${Date.now()}`, payerName: "Offline Direct" })
    const u = await customer("Offline")
    const d = await admin.post("/v1/admin/invoices", body(u.id, { lines: [{ serviceType: "OTHER", description: "Consultation", quantity: 1, unitAmountMinor: 1000 }] }))
    await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    expect((await admin.post(`/v1/admin/invoices/${d.body.id}/payments`, { ...pay(1000), amount: { amountMinor: 1000, currency: "USD" } })).status).toBe(400)
    const r = await admin.post(`/v1/admin/invoices/${d.body.id}/payments`, pay(1000))
    expect(r.status).toBe(201)
    expect((await admin.get(`/v1/admin/invoices/${d.body.id}`)).body.status).toBe("PAID")
    expect((await admin.post(`/v1/admin/invoices/${d.body.id}/payments`, pay(1000))).status).toBe(409)

    const u2 = await customer("Offline Big")
    const big = 200_000
    const d2 = await admin.post("/v1/admin/invoices", body(u2.id, { lines: [{ serviceType: "OTHER", description: "Group booking", quantity: 1, unitAmountMinor: big }] }))
    await admin.post(`/v1/admin/invoices/${d2.body.id}/issue`)
    const r2 = await admin.post(`/v1/admin/invoices/${d2.body.id}/payments`, pay(big))
    expect(r2.body.needsSecondVerifier).toBe(true)
    expect((await admin.get(`/v1/admin/invoices/${d2.body.id}`)).body.status).toBe("ISSUED")
    expect((await admin.post(`/v1/admin/payments/${r2.body.paymentId}/verify`)).status).toBe(409)
    expect((await adminTwo.post(`/v1/admin/payments/${r2.body.paymentId}/verify`)).status).toBe(200)
    expect((await admin.get(`/v1/admin/invoices/${d2.body.id}`)).body.status).toBe("PAID")
  })

  it("compliance: a REVIEW policy for a line's type holds the invoice, whatever the policy's context, until released", async () => {
    const u = await customer("Held")
    // CIP:IKA is seeded as REVIEW.
    const d = await admin.post("/v1/admin/invoices", body(u.id, { lines: [{ serviceType: "CIP", description: "CIP at the airport", quantity: 1, unitAmountMinor: 9000 }] }))
    const held = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    expect(held.status).toBe(409)
    expect(held.body.code).toBe("COMPLIANCE_REVIEW_REQUIRED")
    const view = (await admin.get(`/v1/admin/invoices/${d.body.id}`)).body
    expect(view.status).toBe("DRAFT")
    expect(view.number).toBeNull()
    expect(view.actions.find((a: { command: string }) => a.command === "issue")).toMatchObject({ allowed: false })
    expect((await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)).status).toBe(409)
    // Editing would slip past the decision.
    expect((await admin.put(`/v1/admin/invoices/${d.body.id}`, { currency: "GBP", dueDays: null, notes: null, lines: [{ serviceType: "OTHER", description: "Something else", quantity: 1, unitAmountMinor: 9000 }] })).status).toBe(409)
    const [c] = await dbQuery<{ id: string }>("select id from compliance_cases where request_id = $1", [d.body.id])
    expect((await compliance.post(`/v1/admin/compliance/cases/${c!.id}/decide`, { decision: "RELEASE", reason: "Operator cleared by counsel for this invoice" })).status).toBeLessThan(300)
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe("ISSUED")
  })

  it("a declined case blocks issue for good", async () => {
    const u = await customer("Declined")
    const d = await admin.post("/v1/admin/invoices", body(u.id, { lines: [{ serviceType: "CIP", description: "CIP at the airport", quantity: 1, unitAmountMinor: 9000 }] }))
    await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const [c] = await dbQuery<{ id: string }>("select id from compliance_cases where request_id = $1", [d.body.id])
    expect((await compliance.post(`/v1/admin/compliance/cases/${c!.id}/decide`, { decision: "DECLINE", reason: "Not cleared by counsel for this invoice", reasonCode: "COMPLIANCE" })).status).toBeLessThan(300)
    expect((await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)).status).toBe(409)
  })

  it("the staff list shows the customer, and a cancelled issued invoice stays readable with its number", async () => {
    const u = await customer("Listed")
    const d = await admin.post("/v1/admin/invoices", body(u.id))
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const list = (await admin.get("/v1/admin/invoices?limit=100")).body
    expect(list.find((i: { id: string }) => i.id === d.body.id).customer.id).toBe(u.id)
    expect((await admin.post(`/v1/admin/invoices/${d.body.id}/cancel`, { reasonCode: "CORRECTION" })).status).toBe(200)
    expect((await u.c.get(`/v1/billing/invoices/${issued.body.number}`)).body.status).toBe("CANCELLED")
  })

  it("Stripe setup: the checklist reports without switching anything on; a connected account is saved, shown and removed; live keys stay refused", async () => {
    const view = (await dev.get("/v1/dev/payments")).body
    expect(view.setup).toEqual(expect.objectContaining({ keys: expect.any(Boolean), webhook: expect.any(Boolean), flag: expect.any(Boolean), servicePolicy: expect.any(Boolean) }))
    expect(view.webhookEvents).toContain("checkout.session.completed")
    expect(JSON.stringify(view)).not.toMatch(/sk_test_|whsec_/)
    const put = (b: Record<string, unknown>) => owner.put("/v1/dev/payments/credentials", { mode: "test", ...b })
    expect((await put({ connectedAccountId: "not-an-account" })).status).toBe(400)
    expect((await put({ connectedAccountId: "acct_e2eTest123" })).body.connectedAccountId).toBe("acct_e2eTest123")
    expect((await put({ connectedAccountId: null })).body.connectedAccountId).toBeNull()
    expect((await put({ secretKey: "sk_live_0123456789abcdef" })).status).toBe(403)
    expect((await cargo.put("/v1/dev/payments/credentials", { mode: "test", connectedAccountId: "acct_e2eTest123" })).status).toBe(404) // no Developer Panel on the admin host
  })
})

