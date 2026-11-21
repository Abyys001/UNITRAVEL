import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, randomPhone, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const seg = { marketing: { carrier: "TK", flightNumber: "1980" }, operating: { carrier: "TK", flightNumber: "1980" }, origin: { iata: "IST", terminal: "1" }, destination: { iata: "LHR", terminal: "2" }, departure: { local: "2026-12-20T09:00", utc: "2026-12-20T06:00:00Z", tz: "Europe/Istanbul" }, arrival: { local: "2026-12-20T11:00", utc: "2026-12-20T11:00:00Z", tz: "Europe/London" }, cabin: "ECONOMY", technicalStops: [] }
const option = { label: "TK direct", source: "MANUAL", slices: [{ origin: "IST", destination: "LHR", durationMin: 300, segments: [seg] }], components: [], priceBreakdown: { fare: GBP(20000), taxes: GBP(6000), serviceFee: GBP(2000), total: GBP(28000) }, baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }], conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } }, ticketingModel: "SINGLE_TICKET", internalCostMinor: 25000 }
const key = () => ({ "idempotency-key": randomUUID() })
async function until(get: () => Promise<any>, ok: (b: any) => boolean) { let r = await get(); for (let i = 0; i < 40 && !ok(r.body); i++) { await new Promise((x) => setTimeout(x, 300)); r = await get() } return r }

describe("ADR-0044 D6 — staff can add a price straight from NEW or AWAITING_CUSTOMER", () => {
  it("flight: drafting a quote on a NEW request claims it; then the quote is sent", async () => {
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const r = await admin.post("/v1/admin/intake/flight-requests", { customer: { name: "Price Early", email: `pe-${randomUUID().slice(0, 8)}@example.com` }, contactPhone: randomPhone("+4477009"), query: { tripType: "ONE_WAY", slices: [{ from: { city: "IST" }, to: { city: "LON" }, date: "2026-12-20", flexDays: 1 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" }, travellers: [{ traveller: { title: "MR", givenNames: "Price", surname: "Early", dateOfBirth: "1980-01-01", genderOnDocument: "M", nationality: "TR", relationship: "SELF" }, passengerType: "ADT" }], channel: "PHONE", customerConfirmed: true }, key())
    const ref = r.body.ref
    let d = await until(() => admin.get(`/v1/admin/flight-requests/${ref}`), (b) => b.status === "NEW")
    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option] })
    expect(draft.status).toBe(201)
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    expect(d.body.status).toBe("IN_REVIEW")
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("QUOTED")
  }, 120_000)

  it("cargo: drafting a quote while AWAITING_CUSTOMER puts the request back in review", async () => {
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const lanes = (await admin.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string }[]
    const laneId = lanes.find((l) => l.originCountry === "GB" && l.destinationCountry === "TR")!.id
    const r = await admin.post("/v1/admin/cargo/requests", { service: "PARCEL", laneId, readyDate: "2026-12-02", handoverMode: "PICKUP", customer: { name: "Cargo Price", email: `cp-${randomUUID().slice(0, 8)}@example.com` }, customerConfirmed: true, channel: "PHONE", shipper: { name: "Cargo Price", address: { line1: "1 St", city: "London", country: "GB" }, phone: "+447700900321" }, consignee: { name: "Ali Receiver", address: { line1: "2 Cd", city: "Istanbul", country: "TR" }, phone: "+905321234567" }, pieces: [{ lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 3 }], items: [{ description: "Books", category: "BOOKS", quantity: 1, unitValue: GBP(1000), originCountry: "GB", purpose: "GIFT" }], declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: false }, declaredTotal: GBP(1000) }, key())
    const ref = r.body.ref
    let d = await until(() => admin.get(`/v1/admin/cargo/requests/${ref}`), (b) => b.status === "NEW")
    const partner = d.body.eligiblePartners.find((p: { complianceStatus: string }) => p.complianceStatus === "CLEARED")
    const lines = { freight: { ratePerKg: GBP(450), chargeableKg: 3, amount: GBP(1350) }, fuelSurcharge: GBP(0), securitySurcharge: GBP(0), handling: GBP(0), customsBrokerage: GBP(0), dutiesTaxes: "PAYABLE_BY_CONSIGNEE", dutiesEstimate: true, insurance: GBP(0), pickup: GBP(0), delivery: GBP(0), total: GBP(1350) }
    // Straight from NEW.
    const q1 = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines })
    expect(q1.status).toBe(201)
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    expect(d.body.status).toBe("IN_REVIEW")
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/request_info`, { message: "Confirm the size?" }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("AWAITING_CUSTOMER")
    const q2 = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines })
    expect(q2.status).toBe(201)
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    expect(d.body.status).toBe("IN_REVIEW")
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q2.body.id }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("QUOTED")
  }, 120_000)
})
