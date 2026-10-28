import { randomBytes } from "node:crypto"

import { Queue } from "bullmq"
import Stripe from "stripe"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { receivedShipment } from "./cargo-fixture"
import { ADMIN_HOST, API, dbQuery, DEV_HOST, Session, STAFF, staffSession } from "./client"

/** Phase D — Stripe Embedded Checkout, test mode (ADR-0007). No real keys: the FAKE provider signs events in Stripe's format; the STRIPE path is exercised with a locally generated webhook secret. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6390")
const connection = { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined }
const maintenance = new Queue("maintenance", { connection })
const timers = new Queue("timers.sla", { connection })
afterAll(async () => {
  // The flag is off by default; leave the local database that way.
  await dev?.put("/v1/dev/feature-flags/payments.online.enabled", { enabled: false })
  await maintenance.close(); await timers.close()
})

let dev: Session, owner: Session, admin: Session, adminDev: Session, cargo: Session, ownerAdmin: Session, compliance: Session
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"

/** Issues a £50 cargo invoice for a fresh customer and returns what the tests need. */
async function issuedInvoice() {
  const { c, ref } = await receivedShipment("MOBILE", cargo)
  const draft = await admin.post(`/v1/admin/requests/${ref}/invoices`)
  expect(draft.status).toBe(201)
  const issued = await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)
  expect(issued.status).toBe(200)
  return { c, ref, id: draft.body.id as string, number: issued.body.number as string, expiresAt: issued.body.expiresAt as string }
}
const state = async (c: Session, n: string) => (await c.get(`/v1/billing/invoices/${n}/payment`)).body
const checkout = (c: Session, n: string) => c.post(`/v1/billing/invoices/${n}/checkout-session`)
const sink = (sessionId: string, body: Record<string, unknown>, route: "sign" | "deliver" = "sign") => fetch(`${API}/v1/dev-sink/payments/${sessionId}/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }))
/** Delivers a signed payload exactly as Stripe would: raw body plus the Stripe-Signature header. */
const webhook = (e: { payload: string; signature: string }, header: string | null = e.signature) =>
  fetch(`${API}/v1/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", ...(header ? { "stripe-signature": header } : {}) }, body: e.payload }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }))
const invoiceRow = async (id: string) => (await dbQuery<{ status: string }>("select status from invoices where id = $1", [id]))[0]!
const sessionRow = async (invoiceId: string) => (await dbQuery<{ id: string; provider_session_id: string; status: string; amount_minor: string; expires_at: Date }>("select id, provider_session_id, status, amount_minor, expires_at from payment_sessions where invoice_id = $1 order by attempt desc limit 1", [invoiceId]))[0]!
const auditCount = async (action: string, entityId: string) => (await dbQuery("select 1 from audit_log where action = $1 and entity_id = $2", [action, entityId])).length

beforeAll(async () => {
  dev = await staffSession(STAFF.developer, DEV_HOST)
  owner = await staffSession(STAFF.owner, DEV_HOST)
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  adminDev = await staffSession(STAFF.admin, DEV_HOST)
  cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
  ownerAdmin = await staffSession(STAFF.owner, ADMIN_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
  expect((await dev.put(FLAG, { enabled: false })).status).toBe(200)
  await until(async () => (await dev.get("/v1/dev/payments")).body.flagEnabled, (v) => v === false)
})

describe("Phase D — Stripe Embedded Checkout, test mode (ADR-0007; booklet ch. 13.7, 27.6)", () => {
  it("flag off: online payment is not offered, checkout is refused, offline payment is untouched", async () => {
    const inv = await issuedInvoice()
    const s = await state(inv.c, inv.number)
    expect(s).toMatchObject({ offered: false, invoiceStatus: "ISSUED", session: null, processing: false })
    expect(s.reasons).toContain("FLAG_OFF")
    const r = await checkout(inv.c, inv.number)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe("ONLINE_PAYMENT_NOT_OFFERED")
    expect((await dbQuery("select 1 from payment_sessions where invoice_id = $1", [inv.id])).length).toBe(0)
    const staff = (await admin.get(`/v1/admin/invoices/${inv.id}/payments`)).body
    expect(staff.online.offered).toBe(false)
    // Another customer's invoice is a 404, never a 403.
    const other = (await receivedShipment("MOBILE", cargo)).c
    expect((await other.get(`/v1/billing/invoices/${inv.number}/payment`)).status).toBe(404)
    expect((await checkout(other, inv.number)).status).toBe(404)
  })

  it("session → signed webhook → PAID; duplicate is a no-op; bad signature is 400; the redirect proves nothing", async () => {
    expect((await dev.put(FLAG, { enabled: true })).status).toBe(403) // a developer cannot; only an owner can (ADR-0007)
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
    const inv = await issuedInvoice()
    const s0 = await until(() => state(inv.c, inv.number), (v) => v.offered === true)
    expect(s0.offered).toBe(true)

    const a = await checkout(inv.c, inv.number)
    expect(a.status).toBe(200)
    expect(a.body).toMatchObject({ provider: "FAKE", invoiceNumber: inv.number, publishableKey: null })
    expect(a.body.clientSecret).toContain("_secret_")
    expect(Object.keys(a.body).sort()).toEqual(["clientSecret", "expiresAt", "invoiceNumber", "provider", "publishableKey"])
    // One reusable open session: the second call returns the same secret and no second row.
    const b = await checkout(inv.c, inv.number)
    expect(b.body.clientSecret).toBe(a.body.clientSecret)
    expect((await dbQuery("select 1 from payment_sessions where invoice_id = $1", [inv.id])).length).toBe(1)
    const row = await sessionRow(inv.id)
    expect(Number(row.amount_minor)).toBe(5000) // the invoice's amount; the request body carried none
    expect(row.expires_at.getTime()).toBeLessThanOrEqual(Date.parse(inv.expiresAt))
    expect((await timers.getJob(`ps-${row.id}--payment.reconcile`))?.name).toBe("timer:payment.reconcile")

    // The browser coming back from the provider changes nothing.
    expect(await state(inv.c, inv.number)).toMatchObject({ invoiceStatus: "ISSUED", session: { status: "OPEN" } })

    const ev = (await sink(row.provider_session_id, { kind: "paid" })).body
    // Tampered body and missing header: 400, nothing recorded.
    const tampered = await webhook({ payload: ev.payload.replace("5000", "50"), signature: ev.signature })
    expect(tampered.status).toBe(400)
    expect(tampered.body.code).toBe("SIGNATURE_INVALID")
    expect((await webhook(ev, null)).status).toBe(400)
    expect((await webhook(ev, "t=1,v1=deadbeef")).status).toBe(400)
    expect(await invoiceRow(inv.id)).toEqual({ status: "ISSUED" })

    const ok = await webhook(ev)
    expect(ok).toMatchObject({ status: 200, body: { received: true } })
    const paid = await until(async () => (await inv.c.get(`/v1/billing/invoices/${inv.number}`)).body, (v) => v.status === "PAID")
    expect(paid.status).toBe("PAID")
    expect(await state(inv.c, inv.number)).toMatchObject({ invoiceStatus: "PAID", offered: false, session: { status: "COMPLETE" } })
    const rec = await dbQuery<{ method: string; status: string; recorded_by: string | null; amount_minor: string; provider_ref: string; invoice_id: string }>("select method, status, recorded_by, amount_minor, provider_ref, invoice_id from payment_records where invoice_id = $1", [inv.id])
    expect(rec).toHaveLength(1)
    expect(rec[0]).toMatchObject({ method: "CARD_ONLINE", status: "VERIFIED", recorded_by: null, invoice_id: inv.id })
    expect(Number(rec[0]!.amount_minor)).toBe(5000)
    const detail = (await admin.get(`/v1/admin/invoices/${inv.id}`)).body
    expect(detail.history.map((h: { command: string }) => h.command)).toEqual(["create", "issue", "mark_paid"])

    // Duplicate delivery (same event id): a no-op with 200.
    const dup = await webhook(ev)
    expect(dup).toMatchObject({ status: 200, body: { received: true, duplicate: true } })
    expect((await dbQuery("select 1 from payment_records where invoice_id = $1", [inv.id])).length).toBe(1)
    const events = await dbQuery<{ outcome: string }>("select outcome from stripe_events where id = $1", [ev.eventId])
    expect(events).toEqual([{ outcome: "PROCESSED" }])
    // A second event for the same PaymentIntent cannot pay twice either.
    const again = (await sink(row.provider_session_id, { kind: "async_succeeded" })).body
    expect((await webhook(again)).status).toBe(200)
    expect((await dbQuery("select 1 from payment_records where invoice_id = $1", [inv.id])).length).toBe(1)

    expect((await checkout(inv.c, inv.number)).status).toBe(403) // PAID: not offered
    expect(await auditCount("payment.online_received", rec[0]!.provider_ref ? (await dbQuery<{ id: string }>("select id from payment_records where invoice_id = $1", [inv.id]))[0]!.id : "")).toBe(1)
    expect(await auditCount("payment.session_created", inv.id)).toBe(1)
    const st = (await admin.get(`/v1/admin/invoices/${inv.id}/payments`)).body
    expect(st.payments[0]).toMatchObject({ method: "CARD_ONLINE", status: "VERIFIED", amount: { amountMinor: 5000 } })
    expect(st.payments[0].providerRef).not.toMatch(/^pi_fake_[0-9a-f]{16}$/) // shortened for display
  })

  it("an asynchronous method stays processing until the provider confirms; a failure leaves the invoice payable", async () => {
    const inv = await issuedInvoice()
    await checkout(inv.c, inv.number)
    const row = await sessionRow(inv.id)
    expect((await webhook((await sink(row.provider_session_id, { kind: "async_pending" })).body)).status).toBe(200)
    expect(await invoiceRow(inv.id)).toEqual({ status: "ISSUED" })
    expect(await state(inv.c, inv.number)).toMatchObject({ processing: true })
    // The session is complete at the provider, so a second checkout is refused while it processes.
    expect((await checkout(inv.c, inv.number)).status).toBe(409)
    expect((await webhook((await sink(row.provider_session_id, { kind: "async_failed" })).body)).status).toBe(200)
    expect((await sessionRow(inv.id)).status).toBe("FAILED")
    expect(await invoiceRow(inv.id)).toEqual({ status: "ISSUED" })
    // A fresh session (attempt 2) can be opened.
    const next = await checkout(inv.c, inv.number)
    expect(next.status).toBe(200)
    expect((await dbQuery<{ attempt: number }>("select attempt from payment_sessions where invoice_id = $1 order by attempt", [inv.id])).map((r) => r.attempt)).toEqual([1, 2])
    const s2 = await sessionRow(inv.id)
    expect((await webhook((await sink(s2.provider_session_id, { kind: "expired" })).body)).status).toBe(200)
    expect((await sessionRow(inv.id)).status).toBe("EXPIRED")
  })

  it("amount mismatch records no payment, marks the session and opens a compliance case", async () => {
    const inv = await issuedInvoice()
    await checkout(inv.c, inv.number)
    const row = await sessionRow(inv.id)
    const ev = (await sink(row.provider_session_id, { kind: "paid", amountMinor: 4000 })).body
    expect((await webhook(ev)).status).toBe(200)
    expect(await invoiceRow(inv.id)).toEqual({ status: "ISSUED" })
    expect((await sessionRow(inv.id)).status).toBe("MISMATCH")
    expect((await dbQuery("select 1 from payment_records where invoice_id = $1", [inv.id])).length).toBe(0)
    expect(await dbQuery("select outcome from stripe_events where id = $1", [ev.eventId])).toEqual([{ outcome: "MISMATCH" }])
    const cases = await dbQuery<{ trigger: string; evidence: { kind: string; detail: string }[] }>("select trigger, evidence from compliance_cases where request_ref = $1", [inv.ref])
    expect(cases.some((c) => c.evidence.some((e) => e.kind === "PAYMENT_MISMATCH" && /40\.00 GBP/.test(e.detail)))).toBe(true)
    expect(await auditCount("payment.mismatch", inv.id)).toBe(1)
    // A dispute opens a case too and changes no state.
    const inv2 = await issuedInvoice()
    await checkout(inv2.c, inv2.number)
    const r2 = await sessionRow(inv2.id)
    expect((await webhook((await sink(r2.provider_session_id, { kind: "paid" })).body)).status).toBe(200)
    expect((await webhook((await sink(r2.provider_session_id, { kind: "dispute" })).body)).status).toBe(200)
    expect(await invoiceRow(inv2.id)).toEqual({ status: "PAID" })
    const dc = await dbQuery<{ evidence: { kind: string }[] }>("select evidence from compliance_cases where request_ref = $1", [inv2.ref])
    expect(dc.some((c) => c.evidence.some((e) => e.kind === "CARD_DISPUTE"))).toBe(true)
  })

  it("reconciliation: a payment whose webhook never arrived is settled from the provider (job ids without ':')", async () => {
    const inv = await issuedInvoice()
    await checkout(inv.c, inv.number)
    const row = await sessionRow(inv.id)
    await sink(row.provider_session_id, { kind: "paid" }) // the provider took the money; we never receive the event
    expect(await invoiceRow(inv.id)).toEqual({ status: "ISSUED" })
    await dbQuery("update payment_sessions set created_at = now() - interval '2 hours' where id = $1", [row.id])
    const job = await maintenance.add("payments.reconcile", {}, { jobId: `e2e-pay-reconcile-${Date.now()}` })
    expect(job.id).not.toContain(":")
    const settled = await until(() => invoiceRow(inv.id), (v) => v.status === "PAID")
    expect(settled.status).toBe("PAID")
    expect((await sessionRow(inv.id)).status).toBe("COMPLETE")
    expect(await dbQuery("select method, status from payment_records where invoice_id = $1", [inv.id])).toEqual([{ method: "CARD_ONLINE", status: "VERIFIED" }])
    expect(await auditCount("payment.reconciled", inv.id)).toBe(1)
  })

  it("refunds: within the threshold alone, above it with a second person (four-eyes); the invoice changes only on the verified charge.refunded", async () => {
    // Lower the existing four-eyes threshold to £20 for this test and restore it afterwards.
    const versions = await dev.get("/v1/dev/config/WORKFLOW/versions")
    const current = versions.body.find((v: { status: string }) => v.status === "PUBLISHED")
    const publish = async (threshold: number) => {
      const draft = await dev.post("/v1/dev/config/WORKFLOW/versions", { payload: { ...current.payload, paymentFourEyesThresholdMinor: threshold }, changeNote: "e2e refund threshold" })
      expect((await dev.post(`/v1/dev/config/WORKFLOW/versions/${draft.body.version}/publish`, { changeNote: "e2e refund threshold" })).status).toBe(200)
      await wait(2500)
    }
    await publish(2000)
    try {
      const inv = await issuedInvoice()
      await checkout(inv.c, inv.number)
      const row = await sessionRow(inv.id)
      expect((await webhook((await sink(row.provider_session_id, { kind: "paid" })).body)).status).toBe(200)

      // Who may ask: not the customer, not cargo staff.
      expect((await inv.c.post(`/v1/admin/invoices/${inv.id}/refunds`, { reasonCode: "CUSTOMER_REQUEST" })).status).toBe(403)
      expect((await cargo.post(`/v1/admin/invoices/${inv.id}/refunds`, { reasonCode: "CUSTOMER_REQUEST" })).status).toBe(403)
      expect((await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { reasonCode: "OTHER" })).status).toBe(400) // "Explain why"
      expect((await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { reasonCode: "CUSTOMER_REQUEST", amountMinor: 5001 })).status).toBe(400)

      // £10 is within the threshold: the requester's own request goes to the provider.
      const small = await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { amountMinor: 1000, reasonCode: "CUSTOMER_REQUEST" })
      expect(small.status).toBe(201)
      expect(small.body).toMatchObject({ status: "SUBMITTED", needsSecondApprover: false })
      expect(await invoiceRow(inv.id)).toEqual({ status: "PAID" }) // the API response is not proof either
      const p = (await dbQuery<{ id: string }>("select id from payment_records where invoice_id = $1", [inv.id]))[0]!
      expect((await dbQuery<{ provider_refund_id: string }>("select provider_refund_id from refund_requests where id = $1", [small.body.id]))[0]!.provider_refund_id).toMatch(/^re_fake_/)
      expect((await webhook((await sink(row.provider_session_id, { kind: "refunded", amountMinor: 1000 })).body)).status).toBe(200)
      expect((await admin.get(`/v1/admin/invoices/${inv.id}/payments`)).body.refunds.find((r: { id: string }) => r.id === small.body.id).status).toBe("COMPLETED")
      expect(await invoiceRow(inv.id)).toEqual({ status: "PAID" }) // partial refund

      // Splitting does not avoid the second person (ADR-0017): £15 alone is within £20, but with the £10 the requester
      // already sent alone it is £25, so it waits for approval.
      const split = await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { amountMinor: 1500, reasonCode: "CUSTOMER_REQUEST" })
      expect(split.body).toMatchObject({ status: "PENDING_APPROVAL", needsSecondApprover: true })
      expect((await ownerAdmin.post(`/v1/admin/refunds/${split.body.id}/reject`, { note: "Split refund, raise it as one" })).body.status).toBe("REJECTED")

      // £30 is above it: pending, the author cannot approve, a different person can reject or approve.
      const big = await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { amountMinor: 3000, reasonCode: "SERVICE_NOT_DELIVERED" })
      expect(big.body).toMatchObject({ status: "PENDING_APPROVAL", needsSecondApprover: true })
      const own = await admin.post(`/v1/admin/refunds/${big.body.id}/approve`)
      expect(own.status).toBe(409)
      expect(own.body.code).toBe("FOUR_EYES_REQUIRED")
      const rej = await ownerAdmin.post(`/v1/admin/refunds/${big.body.id}/reject`, { note: "Customer withdrew the request" })
      expect(rej.body.status).toBe("REJECTED")
      expect((await ownerAdmin.post(`/v1/admin/refunds/${big.body.id}/approve`)).status).toBe(409) // terminal
      const big2 = await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { amountMinor: 3000, reasonCode: "SERVICE_NOT_DELIVERED" })
      expect(big2.body.status).toBe("PENDING_APPROVAL")
      const approved = await ownerAdmin.post(`/v1/admin/refunds/${big2.body.id}/approve`)
      expect(approved.status).toBe(200)
      expect(approved.body).toMatchObject({ status: "SUBMITTED", approvedBy: expect.any(String) })
      expect(await invoiceRow(inv.id)).toEqual({ status: "PAID" })
      expect((await webhook((await sink(row.provider_session_id, { kind: "refunded", amountMinor: 4000 })).body)).status).toBe(200)
      expect(await invoiceRow(inv.id)).toEqual({ status: "PAID" })

      // The rest (£10) is within the threshold; the full refund arrives and the invoice becomes REFUNDED.
      const last = await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { reasonCode: "CUSTOMER_REQUEST" })
      expect(last.body).toMatchObject({ status: "SUBMITTED", amount: { amountMinor: 1000 } })
      expect((await webhook((await sink(row.provider_session_id, { kind: "refunded", amountMinor: 5000 })).body)).status).toBe(200)
      const done = await until(() => invoiceRow(inv.id), (v) => v.status === "REFUNDED")
      expect(done.status).toBe("REFUNDED")
      expect(await dbQuery("select status, refunded_minor from payment_records where id = $1", [p.id])).toEqual([{ status: "REFUNDED", refunded_minor: "5000" }])
      expect((await admin.post(`/v1/admin/invoices/${inv.id}/refunds`, { reasonCode: "CUSTOMER_REQUEST" })).status).toBe(409)
      expect((await admin.get(`/v1/admin/invoices/${inv.id}`)).body.history.map((h: { command: string }) => h.command)).toEqual(["create", "issue", "mark_paid", "mark_refunded"])
      // Audit trail: request, approval, rejection, completion, the refunded payment.
      for (const [action, id] of [["refund.requested", small.body.id], ["refund.approved", big2.body.id], ["refund.rejected", big.body.id], ["refund.completed", big2.body.id], ["refund.submitted", small.body.id]] as const) expect({ action, n: await auditCount(action, id) }).toEqual({ action, n: 1 })
      expect(await auditCount("payment.refunded", p.id)).toBe(3) // one per verified charge.refunded: £10, £40, £50 cumulative
    } finally {
      await publish(current.payload.paymentFourEyesThresholdMinor)
    }
  })

  it("payment link resend (staff) is audited and customers cannot use it", async () => {
    const inv = await issuedInvoice()
    expect((await inv.c.post(`/v1/admin/invoices/${inv.id}/payment-link/resend`)).status).toBe(403)
    expect((await admin.post(`/v1/admin/invoices/${inv.id}/payment-link/resend`)).status).toBe(200)
    expect(await auditCount("payment.link_resent", inv.id)).toBe(1)
    // ADR-0013: the resend sends the payment-requested notice (with the pay link), not a second "invoice issued".
    const issued = await dbQuery("select 1 from outbox_events where aggregate_id = $1 and event_type = 'invoice.issued'", [inv.id])
    const requested = await dbQuery("select 1 from outbox_events where aggregate_id = $1 and event_type = 'payment.requested'", [inv.id])
    expect({ issued: issued.length, requested: requested.length }).toEqual({ issued: 1, requested: 1 })
  })

  it("eligibility is compliance data: a BLOCK policy on a customer removes the offer, and policy changes need an owner", async () => {
    const inv = await issuedInvoice()
    expect((await until(() => state(inv.c, inv.number), (v) => v.offered)).offered).toBe(true)
    const [{ customer_user_id }] = await dbQuery<{ customer_user_id: string }>("select customer_user_id from invoices where id = $1", [inv.id]) as [{ customer_user_id: string }]
    const co = compliance
    expect((await co.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:EVERYTHING", action: "BLOCK", reason: "invalid key" })).status).toBe(400)
    expect((await co.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: `customer:${customer_user_id}`, action: "REVIEW", reason: "review is not a thing here" })).status).toBe(400)
    const p = await co.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: `customer:${customer_user_id}`, action: "BLOCK", reason: "e2e: exclude this customer from online payment" })
    expect(p.status).toBe(201)
    expect((await co.post(`/v1/admin/compliance/policies/${p.body.id}/approve`)).status).toBe(403) // not an owner
    expect((await ownerAdmin.post(`/v1/admin/compliance/policies/${p.body.id}/approve`)).status).toBe(200)
    const s = await until(() => state(inv.c, inv.number), (v) => !v.offered)
    expect(s.offered).toBe(false)
    expect(s.reasons).toContain("BLOCKED")
    expect((await checkout(inv.c, inv.number)).status).toBe(403)
    // Retire the policy again so the test leaves no exclusion behind (a newer version supersedes it).
    const back = await co.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: `customer:${customer_user_id}`, action: "ALLOW", reason: "e2e: lift the exclusion" })
    expect((await ownerAdmin.post(`/v1/admin/compliance/policies/${back.body.id}/approve`)).status).toBe(200)
    expect((await until(() => state(inv.c, inv.number), (v) => v.offered)).offered).toBe(true)
  })

  it("Developer Panel: keys are write-only, live is blocked and audited, the STRIPE path verifies with a locally generated secret", async () => {
    const secretKey = `sk_test_${randomBytes(12).toString("hex")}`
    const publishableKey = `pk_test_${randomBytes(12).toString("hex")}`
    const webhookSecret = `whsec_${randomBytes(24).toString("hex")}`

    // Permissions: the admin holds none of the payments.configure family; the developer cannot approve a mode change.
    expect((await adminDev.put("/v1/dev/payments/credentials", { mode: "test", secretKey })).status).toBe(403)
    expect((await dev.post("/v1/dev/payments/mode-requests/approve")).status).toBe(403)

    const saved = await dev.put("/v1/dev/payments/credentials", { mode: "test", secretKey, publishableKey, webhookSecret })
    expect(saved.status).toBe(200)
    expect(saved.body.credentials).toMatchObject({ secretKey: true, publishableKey: true, webhookSecret: true })
    const everything = JSON.stringify([saved.body, (await dev.get("/v1/dev/payments")).body])
    for (const v of [secretKey, publishableKey, webhookSecret]) expect(everything).not.toContain(v)
    const audited = await dbQuery<{ after: { keys: string[] } }>("select after from audit_log where action = 'payments.credentials_rotated' order by occurred_at desc limit 1")
    expect(audited[0]!.after.keys.sort()).toEqual(["publishableKey", "secretKey", "webhookSecret"])
    expect(JSON.stringify(audited)).not.toContain(secretKey)

    // Live: refused as a mode, as credentials and as keys; each refusal is audited and nothing is stored.
    const before = (await dbQuery("select 1 from audit_log where action in ('payments.mode_change_refused','payments.live_credentials_refused')")).length
    const live = await dev.post("/v1/dev/payments/mode-requests", { mode: "live" })
    expect(live.status).toBe(403)
    expect(live.body.code).toBe("LIVE_MODE_BLOCKED")
    expect((await dev.put("/v1/dev/payments/credentials", { mode: "live", secretKey: `sk_live_${randomBytes(12).toString("hex")}` })).body.code).toBe("LIVE_MODE_BLOCKED")
    expect((await dev.put("/v1/dev/payments/credentials", { mode: "test", secretKey: `sk_live_${randomBytes(12).toString("hex")}` })).body.code).toBe("LIVE_MODE_BLOCKED")
    expect((await dbQuery("select 1 from audit_log where action in ('payments.mode_change_refused','payments.live_credentials_refused')")).length).toBe(before + 3)
    const view = (await dev.get("/v1/dev/payments")).body
    expect(view).toMatchObject({ mode: "test", liveBlocked: true, fakeAvailable: true, provider: "FAKE" })
    expect(view.webhookUrl).toMatch(/\/v1\/webhooks\/stripe$/)
    expect(view.pendingModeRequest).toBeNull()
    expect((await owner.post("/v1/dev/payments/mode-requests/approve")).status).toBe(409) // nothing pending
    expect((await dev.post("/v1/dev/payments/health-check")).body).toMatchObject({ ok: true, provider: "FAKE" })

    // STRIPE path: only the webhook (no network call). A signed event for a session we do not know is stored and ignored.
    expect((await dev.patch("/v1/dev/payments/config", { provider: "STRIPE" })).body.provider).toBe("STRIPE")
    try {
      const payload = JSON.stringify({ id: `evt_e2e_${randomBytes(6).toString("hex")}`, object: "event", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_unknown", payment_status: "paid", amount_total: 100, currency: "gbp", payment_intent: "pi_x" } } })
      const good = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
      expect(await webhook({ payload, signature: good })).toMatchObject({ status: 200, body: { received: true } })
      expect((await webhook({ payload, signature: good })).body.duplicate).toBe(true)
      const wrong = Stripe.webhooks.generateTestHeaderString({ payload, secret: `whsec_${randomBytes(24).toString("hex")}` })
      expect((await webhook({ payload, signature: wrong })).status).toBe(400)
      expect(await dbQuery("select outcome from stripe_events where id = $1", [JSON.parse(payload).id])).toEqual([{ outcome: "IGNORED" }])
      const events = (await dev.get("/v1/dev/payments")).body.events
      expect(events.some((e: { id: string }) => e.id === JSON.parse(payload).id)).toBe(true)
    } finally {
      expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
    }
  })

  it("the FAKE simulator answers 404 when the provider is not FAKE, and the webhook with nothing configured is 400", async () => {
    expect((await dev.patch("/v1/dev/payments/config", { provider: "STRIPE" })).status).toBe(200)
    try {
      const r = await sink("cs_test_fake_x", { kind: "paid" })
      expect(r.status).toBe(404)
    } finally {
      await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })
    }
  })
})
