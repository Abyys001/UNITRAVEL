import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, DEV_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/**
 * ADR-0039 D4: Stripe Invoicing for issued invoices, run against the FAKE provider (same webhook code, Stripe-shaped
 * signed events). The real Stripe test-mode run is recorded separately in docs/stages/STAGE-30.md.
 */
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 25_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
async function customer(name: string) {
  const c = new Session("WEB")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: name, surnameLatin: "Stripe" })
  return { c, id: (await c.get("/v1/me")).body.id as string }
}
const direct = (customerUserId: string) => ({
  customerUserId, currency: "GBP", dueDays: 7, notes: null,
  lines: [
    { serviceType: "VISA", description: "Visa support", quantity: 2, unitAmountMinor: 5000 },
    { serviceType: "DISCOUNT", description: "Returning customer", quantity: 1, unitAmountMinor: -500 },
  ],
})

let admin: Session, cargo: Session, ownerAdmin: Session, owner: Session, dev: Session, compliance: Session
let previousProvider = "STRIPE"
const policies: string[] = []

beforeAll(async () => {
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
  ownerAdmin = await staffSession(STAFF.owner, ADMIN_HOST)
  owner = await staffSession(STAFF.owner, DEV_HOST)
  dev = await staffSession(STAFF.developer, DEV_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  previousProvider = (await dev.get("/v1/dev/payments/config")).body?.provider ?? "STRIPE"
  expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
})
afterAll(async () => {
  // Shared local database: put back what other suites and the owner's Stripe set-up expect.
  const off = await compliance?.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action: "BLOCK", reason: "e2e: restore" })
  if (off?.body?.id) await ownerAdmin.post(`/v1/admin/compliance/policies/${off.body.id}/approve`)
  await owner?.put(FLAG, { enabled: false })
  await dev?.patch("/v1/dev/payments/config", { provider: previousProvider })
})

describe("Stripe invoices (ADR-0039 D4)", () => {
  it("is refused with the reasons while online payment is not offered; read needs invoice access", async () => {
    const u = await customer("Refused")
    const d = await admin.post("/v1/admin/invoices", direct(u.id))
    await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const v = await admin.get(`/v1/admin/invoices/${d.body.id}/stripe`)
    expect(v.status).toBe(200)
    expect(v.body).toMatchObject({ canCreate: false, current: null, supportsInvoicing: true })
    expect(v.body.eligibility.offered).toBe(false)
    const r = await admin.post(`/v1/admin/invoices/${d.body.id}/stripe`)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe("ONLINE_PAYMENT_NOT_OFFERED")
    expect((await u.c.get(`/v1/admin/invoices/${d.body.id}/stripe`)).status).toBe(403)
    expect((await dbQuery("select 1 from stripe_invoices where invoice_id = $1", [d.body.id])).length).toBe(0)
  })

  it("issuing a direct invoice creates, itemises and finalizes the Stripe invoice; the pay page links to it; paying settles the invoice once", async () => {
    const p = await compliance.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action: "ALLOW", reason: "e2e: local test database only" })
    expect(p.status).toBe(201)
    policies.push(p.body.id)
    expect((await ownerAdmin.post(`/v1/admin/compliance/policies/${p.body.id}/approve`)).status).toBe(200)
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
    // Each process caches active policies for 15 s (compliance.service activePolicies); the worker decides at issue time.
    await wait(16_000)

    const u = await customer("Payer")
    const d = await admin.post("/v1/admin/invoices", direct(u.id))
    // Eligibility reads cached config; wait until the flag is visible to the API before issuing.
    // Issue-time eligibility needs every reason gone except NOT_ISSUED (the invoice is still a draft here).
    const reasons = await until(async () => (await admin.get(`/v1/admin/invoices/${d.body.id}/stripe`)).body.eligibility.reasons as string[], (r) => r.every((x) => x === "NOT_ISSUED"))
    expect(reasons.filter((x) => x !== "NOT_ISSUED")).toEqual([])
    const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    expect(issued.status).toBe(200)
    const number = issued.body.number as string

    // invoice.issued → payments.stripe worker → ensure()
    const v = await until(async () => (await admin.get(`/v1/admin/invoices/${d.body.id}/stripe`)).body, (b) => b.current?.status === "OPEN")
    expect(v.current).toMatchObject({ status: "OPEN", attempt: 1, amountDue: { amountMinor: 9500, currency: "GBP" }, lastError: null })
    expect(v.current.stripeInvoiceId).toMatch(/^in_fake_/)
    expect(v.current.hostedInvoiceUrl).toContain(v.current.stripeInvoiceId)
    expect(v.canCreate).toBe(false)
    const [cus] = await dbQuery<{ n: number }>("select count(*)::int as n from stripe_customers where user_id = $1", [u.id])
    expect(cus!.n).toBe(1)

    // A second create is a no-op on the live attempt.
    const again = await admin.post(`/v1/admin/invoices/${d.body.id}/stripe`)
    expect(again.status).toBe(200)
    expect(again.body.current.stripeInvoiceId).toBe(v.current.stripeInvoiceId)

    const page = (await u.c.get(`/v1/billing/invoices/${number}/payment-page`)).body
    expect(page.payUrl).toBe(v.current.hostedInvoiceUrl)
    const co = await u.c.post(`/v1/billing/invoices/${number}/checkout-session`)
    expect(co.status).toBe(403)

    const paid = await (await fetch(`${API}/v1/dev-sink/stripe-invoices/${v.current.stripeInvoiceId}/deliver`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "paid" }) })).json() as { received: boolean }
    expect(paid.received).toBe(true)
    expect((await u.c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("PAID")
    const after = (await admin.get(`/v1/admin/invoices/${d.body.id}/stripe`)).body
    expect(after.current).toMatchObject({ status: "PAID", amountPaid: { amountMinor: 9500 } })
    expect(after.current.paidAt).toBeTruthy()
    const recs = await dbQuery<{ n: number }>("select count(*)::int as n from payment_records where invoice_id = $1 and method = 'CARD_ONLINE' and status = 'VERIFIED'", [d.body.id])
    expect(recs[0]!.n).toBe(1)

    // The staff feed told whoever handles invoices.
    const feed = await until(async () => (await admin.get("/v1/admin/notifications?category=PAYMENT&limit=20")).body.items as { ref: string }[], (items) => items.some((i) => i.ref === number))
    expect(feed.some((i) => i.ref === number)).toBe(true)
  })

  it("cancelling the invoice voids the open Stripe invoice; a new attempt can follow a failure", async () => {
    const u = await customer("Cancelled")
    const d = await admin.post("/v1/admin/invoices", direct(u.id))
    await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
    const v = await until(async () => (await admin.get(`/v1/admin/invoices/${d.body.id}/stripe`)).body, (b) => b.current?.status === "OPEN")
    expect(v.current.status).toBe("OPEN")
    expect((await admin.post(`/v1/admin/invoices/${d.body.id}/cancel`, { reasonCode: "CORRECTION" })).status).toBeLessThan(300)
    const voided = await until(async () => (await admin.get(`/v1/admin/invoices/${d.body.id}/stripe`)).body, (b) => b.current?.status === "VOID")
    expect(voided.current.status).toBe("VOID")
    expect(voided.current.voidedAt).toBeTruthy()
    expect(voided.canCreate).toBe(false)
  })

  it("a quote-based invoice is not given a Stripe invoice automatically (Embedded Checkout stays)", async () => {
    const [q] = await dbQuery<{ id: string }>("select id from invoices where origin = 'QUOTE' and status = 'ISSUED' order by issued_at desc limit 1")
    if (!q) return
    const rows = await dbQuery("select 1 from stripe_invoices where invoice_id = $1", [q.id])
    expect(rows.length).toBe(0)
  })

  it("cargo staff without invoice issue cannot create one", async () => {
    const [i] = await dbQuery<{ id: string }>("select id from invoices where origin = 'DIRECT' and status = 'ISSUED' order by issued_at desc limit 1")
    expect((await cargo.post(`/v1/admin/invoices/${i!.id}/stripe`)).status).toBe(403)
  })
})
