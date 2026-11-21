import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const decl = { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }
const fields = (laneId: string, consigneeEmail?: string) => ({
  service: "PARCEL", laneId, readyDate: "2026-12-02", handoverMode: "PICKUP", handlingInstructions: "Keep dry",
  shipper: { name: "Walk In Customer", address: { line1: "5 Desk Road", city: "London", postcode: "E1 1AA", country: "GB" }, phone: "+447700900444" },
  consignee: { name: "Reza Receiver", address: { line1: "Bagdat Cd. 3", city: "Istanbul", country: "TR" }, phone: "+905551112233", ...(consigneeEmail ? { email: consigneeEmail } : {}) },
  pieces: [{ lengthCm: 30, widthCm: 30, heightCm: 30, weightKg: 6 }], items: [{ description: "Books", category: "BOOKS", quantity: 3, unitValue: GBP(1500), originCountry: "GB", purpose: "GIFT" }],
  declarations: decl, declaredTotal: GBP(4500),
})
const key = () => ({ "idempotency-key": randomUUID() })

describe("ADR-0042 D13 / D10a — staff intake and recipient notices", () => {
  it("staff create a request for an existing customer (exact lookup) and for a new one; screened like any other; customers cannot", async () => {
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const lanes = (await admin.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
    const laneId = lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id

    // Existing customer, found by phone only (exact).
    const phone = randomPhone("+98912")
    const c = new Session("WEB")
    await signIn(c, phone, { givenNamesLatin: "Nima", surnameLatin: "Customer" })
    expect((await admin.get(`/v1/admin/cargo/customers?q=Nima`)).body).toEqual([])
    const found = await admin.get(`/v1/admin/cargo/customers?q=${encodeURIComponent(phone)}`)
    expect(found.body).toHaveLength(1)
    expect(found.body[0]).toMatchObject({ phone, phoneVerified: true })
    const r1 = await admin.post("/v1/admin/cargo/requests", { ...fields(laneId), customer: { userId: found.body[0].userId }, customerConfirmed: true, channel: "PHONE", staffNote: "Called in" }, key())
    expect(r1.status).toBe(201)
    // Screened, then visible to the customer as their own request.
    const d = await (async () => { for (let i = 0; i < 40; i++) { const x = await admin.get(`/v1/admin/cargo/requests/${r1.body.ref}`); if (x.body.status === "NEW") return x; await new Promise((r) => setTimeout(r, 300)) } throw new Error("not screened") })()
    expect(d.body.customer.id).toBe(found.body[0].userId)
    expect((await c.get(`/v1/cargo-requests/${r1.body.ref}`)).body).toMatchObject({ ref: r1.body.ref, handlingInstructions: "Keep dry" })
    const [row] = await dbQuery<{ intake_channel: string; created_by_staff_id: string | null }>("select intake_channel, created_by_staff_id from cargo_requests where ref = $1", [r1.body.ref])
    expect(row).toMatchObject({ intake_channel: "PHONE" })
    expect(row!.created_by_staff_id).toBeTruthy()
    const audit = await dbQuery<{ action: string }>("select action from audit_log where context_ref = $1", [r1.body.ref])
    expect(audit.map((a) => a.action)).toContain("cargo_request.submitted_by_staff")

    // New customer by email; a second request with the same email reuses the account.
    const email = `walkin-${randomUUID().slice(0, 8)}@example.com`
    const r2 = await admin.post("/v1/admin/cargo/requests", { ...fields(laneId), customer: { name: "Walk In Customer", email }, customerConfirmed: true, channel: "IN_PERSON" }, key())
    expect(r2.status).toBe(201)
    const r3 = await admin.post("/v1/admin/cargo/requests", { ...fields(laneId), customer: { name: "Someone Else", email }, customerConfirmed: true, channel: "EMAIL" }, key())
    expect(r3.status).toBe(201)
    const owners = await dbQuery<{ n: number }>("select count(distinct customer_user_id)::int n from cargo_requests where ref = any($1)", [[r2.body.ref, r3.body.ref]])
    expect(owners[0]!.n).toBe(1)
    expect((await admin.get(`/v1/admin/cargo/customers?q=${email}`)).body[0]).toMatchObject({ email, cargoRequests: 2 })

    // Staff must confirm the declarations; a staff account is never a cargo customer; customers cannot use the route.
    expect((await admin.post("/v1/admin/cargo/requests", { ...fields(laneId), customer: { userId: found.body[0].userId }, channel: "PHONE" }, key())).status).toBe(400)
    expect((await admin.post("/v1/admin/cargo/requests", { ...fields(laneId), customer: { name: "Owner", email: "owner@unitravel.example" }, customerConfirmed: true, channel: "PHONE" }, key())).status).toBe(400)
    expect((await c.post("/v1/admin/cargo/requests", { ...fields(laneId), customer: { userId: found.body[0].userId }, customerConfirmed: true, channel: "PHONE" }, key())).status).toBe(403)
  }, 120_000)

  it("the recipient gets one bilingual email per last-mile status, with no sender details", async () => {
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const lanes = (await admin.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
    const laneId = lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id
    const c = new Session("WEB")
    const phone = randomPhone("+98912")
    await signIn(c, phone, { givenNamesLatin: "Sara", surnameLatin: "Sender" })
    const cust = (await admin.get(`/v1/admin/cargo/customers?q=${encodeURIComponent(phone)}`)).body[0]
    const rcpt = `rcpt-${randomUUID().slice(0, 8)}@example.com`
    const r = await admin.post("/v1/admin/cargo/requests", { ...fields(laneId, rcpt), customer: { userId: cust.userId }, customerConfirmed: true, channel: "PHONE" }, key())
    const ref = r.body.ref as string
    let d: any
    for (let i = 0; i < 40; i++) { d = await admin.get(`/v1/admin/cargo/requests/${ref}`); if (d.body.status === "NEW") break; await new Promise((x) => setTimeout(x, 300)) }
    const v = () => ({ "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/claim`, {}, v())
    const partner = d.body.eligiblePartners.find((p: { complianceStatus: string }) => p.complianceStatus === "CLEARED")
    const lines = { freight: { ratePerKg: GBP(450), chargeableKg: 6, amount: GBP(2700) }, fuelSurcharge: GBP(0), securitySurcharge: GBP(0), handling: GBP(0), customsBrokerage: GBP(0), dutiesTaxes: "PAYABLE_BY_CONSIGNEE", dutiesEstimate: true, insurance: GBP(0), pickup: GBP(0), delivery: GBP(0), total: GBP(2700) }
    const q = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q.body.id }, v())
    await c.post(`/v1/cargo-requests/${ref}/quotes/${q.body.id}/accept`)
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    for (const [cmd, body] of [["record_booking", { partnerId: partner.id, partnerReference: "DCP-1" }], ["schedule_handover", { note: "x" }]] as const) d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/${cmd}`, body, v())
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/receive`, { verifiedWeights: [{ pieceId: d.body.pieces[0].id, weightKg: 6 }], location: "London hub" }, v())
    const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/depart`, { location: "LHR", occurredAt: at(1) }, v())
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/out_for_delivery`, { location: "Istanbul", occurredAt: at(2) }, v())
    // The same status twice still sends once.
    await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-events`, { eventCode: "OUT_FOR_DELIVERY", location: "Istanbul", occurredAt: at(3) })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/deliver`, { location: "Istanbul", occurredAt: at(4), podName: "Reza Receiver" }, v())
    expect(d.body.status).toBe("DELIVERED")
    const sinkFor = async () => ((await (await fetch(`${API}/v1/dev-sink/email`)).json()) as { to: string; subject: string; body: string }[]).filter((m) => m.to === rcpt)
    let mails = await sinkFor()
    for (let i = 0; i < 60 && mails.length < 2; i++) { await new Promise((x) => setTimeout(x, 250)); mails = await sinkFor() }
    expect(mails.map((m) => m.subject.split(" · ")[0]).sort()).toEqual(["Delivered", "Out for delivery"])
    for (const m of mails) {
      expect(m.body).toContain("/fa/tracking/UT")
      expect(m.body).toContain("کد رهگیری")
      for (const secret of ["Walk In", "Desk Road", "+447700900444", "Books", "Sara", ref]) expect(m.body).not.toContain(secret)
    }
    const log = await dbQuery<{ key: string; delivery_status: string }>("select key, delivery_status from cargo_notifications where audience = 'RECIPIENT' and cargo_request_id = (select id from cargo_requests where ref = $1)", [ref])
    expect(log.map((x) => x.key).sort()).toEqual(["RECIPIENT:DELIVERED", "RECIPIENT:OUT_FOR_DELIVERY"])
    expect(log.every((x) => x.delivery_status === "SENT")).toBe(true)
  }, 180_000)
})
