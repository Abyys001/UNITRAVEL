import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, dbQuery, randomPhone, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const key = () => ({ "idempotency-key": randomUUID() })
async function until(get: () => Promise<any>, ok: (b: any) => boolean) {
  let r = await get()
  for (let i = 0; i < 40 && !ok(r.body); i++) { await new Promise((x) => setTimeout(x, 300)); r = await get() }
  return r
}

describe("ADR-0044 D5 — staff continue a request without the customer's reply", () => {
  it("flight: AWAITING_CUSTOMER → resume_review (note required) → IN_REVIEW, recorded in history and notes", async () => {
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const r = await admin.post("/v1/admin/intake/flight-requests", {
      customer: { name: "Neda Waiting", email: `wait-${randomUUID().slice(0, 8)}@example.com` }, contactPhone: randomPhone("+4477009"),
      query: { tripType: "ONE_WAY", slices: [{ from: { city: "IST" }, to: { city: "LON" }, date: "2026-12-20", flexDays: 1 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
      travellers: [{ traveller: { title: "MS", givenNames: "Neda", surname: "Waiting", dateOfBirth: "1991-01-01", genderOnDocument: "F", nationality: "TR", relationship: "SELF" }, passengerType: "ADT" }],
      channel: "PHONE", customerConfirmed: true,
    }, key())
    expect(r.status).toBe(201)
    const ref = r.body.ref
    let d = await until(() => admin.get(`/v1/admin/flight-requests/${ref}`), (b) => b.status === "NEW")
    const v = () => ({ "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, v())
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/request_info`, { message: "Please confirm the travel date." }, v())
    expect(d.body.status).toBe("AWAITING_CUSTOMER")
    expect(d.body.actions.find((a: { command: string }) => a.command === "resume_review")).toMatchObject({ allowed: true })
    expect((await admin.post(`/v1/admin/flight-requests/${ref}/commands/resume_review`, { note: "" }, v())).status).toBe(400)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/resume_review`, { note: "Customer confirmed the date by phone" }, v())
    expect(d.status).toBe(200)
    expect(d.body.status).toBe("IN_REVIEW")
    expect(d.body.notes.map((n: { body: string }) => n.body).join()).toContain("Customer confirmed the date by phone")
    const hist = await dbQuery<{ command: string; reason_text: string }>("select command, reason_text from request_status_history where request_id = (select id from flight_requests where ref = $1) and command = 'resume_review'", [ref])
    expect(hist[0]).toMatchObject({ reason_text: "Customer confirmed the date by phone" })
    // Customers cannot run it.
    const cargoStaff = await staffSession(STAFF.cargo, ADMIN_HOST)
    expect((await cargoStaff.post(`/v1/admin/flight-requests/${ref}/commands/resume_review`, { note: "nope nope" }, v())).status).toBe(403)
  }, 120_000)

  it("cargo: AWAITING_CUSTOMER → resume_review → IN_REVIEW", async () => {
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const lanes = (await admin.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
    const laneId = lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id
    const r = await admin.post("/v1/admin/cargo/requests", {
      service: "PARCEL", laneId, readyDate: "2026-12-02", handoverMode: "PICKUP", customer: { name: "Cargo Waiting", email: `cw-${randomUUID().slice(0, 8)}@example.com` }, customerConfirmed: true, channel: "PHONE",
      shipper: { name: "Cargo Waiting", address: { line1: "1 Wait St", city: "London", country: "GB" }, phone: "+447700900321" }, consignee: { name: "Ali Receiver", address: { line1: "2 Cd", city: "Istanbul", country: "TR" }, phone: "+905321234567" },
      pieces: [{ lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 3 }], items: [{ description: "Books", category: "BOOKS", quantity: 1, unitValue: GBP(1000), originCountry: "GB", purpose: "GIFT" }],
      declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }, declaredTotal: GBP(1000),
    }, key())
    const ref = r.body.ref
    let d = await until(() => admin.get(`/v1/admin/cargo/requests/${ref}`), (b) => b.status === "NEW")
    const v = () => ({ "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/claim`, {}, v())
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/request_info`, { message: "Please send a photo of the box." }, v())
    expect(d.body.status).toBe("AWAITING_CUSTOMER")
    expect(d.body.actions.find((a: { command: string }) => a.command === "resume_review")).toMatchObject({ allowed: true })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/resume_review`, { note: "Photo received on WhatsApp" }, v())
    expect(d.body.status).toBe("IN_REVIEW")
  }, 120_000)
})
