import { describe, expect, it } from "vitest"

import { ADMIN_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const party = (name: string, country: string, company?: string) => ({ name, company, address: { line1: "1 Test Street", city: country === "GB" ? "London" : "Istanbul", postcode: "N1 1AA", country }, phone: "+447700900555" })

async function customer() {
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Leila", surnameLatin: "Shipper" })
  const me = (await c.get("/v1/me")).body
  const lanes = (await c.get("/v1/cargo/lanes")).body as { id: string; originCountry: string; destinationCountry: string; enabled: boolean; services: string[] }[]
  return { c, phoneId: me.identities[0].id as string, lane: (o: string, d: string) => lanes.find((l) => l.originCountry === o && l.destinationCountry === d)!, lanes }
}

function cargoBody(laneId: string, phoneId: string, items: { description: string; category: string; hsCode?: string }[], service = "PARCEL") {
  return {
    service, laneId, shipperIdentityId: phoneId, shipper: party("Leila Shipper", "GB"), consignee: party("Mina Receiver", "TR"), readyDate: "2026-11-02", handoverMode: "PICKUP",
    pieces: [{ lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 8 }],
    items: items.map((i) => ({ ...i, quantity: 1, unitValue: GBP(5000), originCountry: "GB", purpose: "PERSONAL_EFFECTS" })),
    declarations: { batteries: false, liquids: false, medicines: false, magnets: false, dangerousGoods: false, insuranceRequested: true }, declaredTotal: GBP(5000 * items.length),
    consents: { accuracy: true, prohibitedItems: true, privacy: true },
  }
}

async function status(c: Session, ref: string, not = "SUBMITTED") {
  for (let i = 0; i < 40; i++) { const r = await c.get(`/v1/cargo-requests/${ref}`); if (r.body.status !== not) return r.body; await wait(300) }
  return (await c.get(`/v1/cargo-requests/${ref}`)).body
}

describe("Stage 5 — cargo (ch. 31.7)", () => {
  it("Iran lanes start disabled; excess baggage on Iran lanes stays blocked; enabling needs owner + compliance with counsel's reference", async () => {
    const { c, phoneId, lane } = await customer()
    const ir = lane("GB", "IR")
    expect(ir.enabled).toBe(false)
    expect(ir.services).not.toContain("EXCESS_BAGGAGE")
    const r = await c.post("/v1/cargo-requests", cargoBody(ir.id, phoneId, [{ description: "Books", category: "BOOKS" }]))
    expect(r.body.code).toBe("LANE_DISABLED")
    const owner = await staffSession(STAFF.owner, ADMIN_HOST)
    const body = { enabled: true, services: ["DOCUMENTS"], requiresComplianceApproval: true, volumetricDivisor: 6000, customerNotice: null, counselReference: null }
    expect((await owner.put(`/v1/admin/cargo/lanes/${ir.id}`, body)).body.errors?.[0]?.path).toBe("counselReference")
    const half = await owner.put(`/v1/admin/cargo/lanes/${ir.id}`, { ...body, counselReference: "COUNSEL-2026-11-TEST" })
    expect(half.body.enabled).toBe(false)
    expect(half.body.pendingSecondApproval).toBe(true)
    const officer = await staffSession(STAFF.compliance, ADMIN_HOST)
    const full = await officer.put(`/v1/admin/cargo/lanes/${ir.id}`, { ...body, counselReference: "COUNSEL-2026-11-TEST" })
    expect(full.body.enabled).toBe(true)
    expect(full.body.requiresComplianceApproval).toBe(true)
    // Restore the default: Iran lanes disabled until counsel approves for real.
    expect((await owner.put(`/v1/admin/cargo/lanes/${ir.id}`, { ...body, enabled: false })).body.enabled).toBe(false)
  })

  it("prohibited goods auto-decline with a neutral message; review categories create a compliance case", async () => {
    const { c, phoneId, lane } = await customer()
    const tr = lane("GB", "TR")
    const bad = await c.post("/v1/cargo-requests", cargoBody(tr.id, phoneId, [{ description: "Replica pistol for a film", category: "OTHER" }]))
    const declined = await status(c, bad.body.ref)
    expect(declined.status).toBe("DECLINED")
    expect(declined.statusLabel).toBe("Unable to arrange")
    expect(JSON.stringify(declined)).not.toMatch(/keyword|pistol"/i)
    const review = await c.post("/v1/cargo-requests", cargoBody(tr.id, phoneId, [{ description: "Used laptop", category: "ELECTRONICS" }]))
    const held = await status(c, review.body.ref)
    expect(held.status).toBe("COMPLIANCE_HOLD")
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const d = await admin.get(`/v1/admin/cargo/requests/${review.body.ref}`)
    expect(d.body.items[0].screeningOutcome).toBe("REVIEW")
    expect((await admin.post(`/v1/admin/cargo/requests/${review.body.ref}/quotes`, { partnerId: "00000000-0000-0000-0000-000000000000", lines: {} })).status).toBeGreaterThanOrEqual(400)
    const officer = await staffSession(STAFF.compliance, ADMIN_HOST)
    const rel = await officer.post(`/v1/admin/compliance/cases/${d.body.compliance[0].id}/decide`, { decision: "RELEASE", reason: "Personal used laptop; no export licence needed for this lane" })
    expect(rel.body.status).toBe("RELEASED")
    expect((await status(c, review.body.ref, "COMPLIANCE_HOLD")).status).toBe("NEW")
  })

  it("parcel GB → TR end to end: quote → accept → partner booking (AWB check digit) → re-weigh exception → revised quote → transit → customs → POD", async () => {
    const { c, phoneId, lane } = await customer()
    const sub = await c.post("/v1/cargo-requests", cargoBody(lane("GB", "TR").id, phoneId, [{ description: "Winter clothes", category: "CLOTHING" }, { description: "Textbooks", category: "BOOKS" }]))
    expect(sub.status).toBe(201)
    expect(sub.body.weights).toMatchObject({ actualKg: 8, volumetricKg: 12, chargeableKg: 12, estimate: true })
    const ref = sub.body.ref
    expect((await status(c, ref)).status).toBe("NEW")
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    let d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
    const partner = d.body.eligiblePartners.find((p: { complianceStatus: string }) => p.complianceStatus === "CLEARED")
    const lines = (kg: number) => ({ freight: { ratePerKg: GBP(450), chargeableKg: kg, amount: GBP(450 * kg) }, fuelSurcharge: GBP(600), securitySurcharge: GBP(300), handling: GBP(500), customsBrokerage: GBP(0), dutiesTaxes: "PAYABLE_BY_CONSIGNEE", dutiesEstimate: false, insurance: GBP(250), pickup: GBP(1200), delivery: GBP(0), total: GBP(450 * kg + 2850) })
    const q = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines: lines(12), transitNote: "3–6 working days", partnerCostMinor: 5000 })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q.body.id }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("QUOTED")
    let cv = await c.get(`/v1/cargo-requests/${ref}`)
    expect(JSON.stringify(cv.body.quotes)).not.toContain("partnerCostMinor")
    await c.post(`/v1/cargo-requests/${ref}/quotes/${q.body.id}/accept`)
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    const badAwb = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/record_booking`, { partnerId: partner.id, partnerReference: "DCP-55821", awbNumber: "176-12345676" }, { "if-match": String(d.body.version) })
    expect(badAwb.body.code).toBe("INVALID_TRANSITION")
    expect(badAwb.body.detail).toContain("Check digit")
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/record_booking`, { partnerId: partner.id, partnerReference: "DCP-55821", awbNumber: "176-12345675" }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("BOOKED")
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/schedule_handover`, { note: "Courier pickup Tuesday 10:00–14:00" }, { "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/receive`, { verifiedWeights: [{ pieceId: d.body.pieces[0].id, weightKg: 15 }], location: "London hub" }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("EXCEPTION")
    expect(d.body.exceptionReason).toBe("REWEIGH")
    expect((await admin.post(`/v1/admin/cargo/requests/${ref}/commands/resolve_exception`, { note: "x-ok" }, { "if-match": String(d.body.version) })).body.code).toBe("INVALID_TRANSITION")
    const q2 = await admin.post(`/v1/admin/cargo/requests/${ref}/quotes`, { partnerId: partner.id, lines: lines(15), transitNote: "Re-weighed at 15 kg" })
    d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/send_quote`, { quoteId: q2.body.id }, { "if-match": String(d.body.version) })
    cv = await c.get(`/v1/cargo-requests/${ref}`)
    expect(cv.body.statusLabel).toBe("Problem with shipment")
    expect(cv.body.actions).toContain("ACCEPT_QUOTE")
    cv = await c.post(`/v1/cargo-requests/${ref}/quotes/${q2.body.id}/accept`)
    expect(cv.body.status).toBe("RECEIVED")
    d = await admin.get(`/v1/admin/cargo/requests/${ref}`)
    for (const [cmd, body] of [["depart", { location: "LHR", occurredAt: new Date().toISOString() }], ["arrive_customs", { location: "IST customs", occurredAt: new Date().toISOString() }], ["clear_customs", { location: "IST", occurredAt: new Date().toISOString() }], ["deliver", { location: "Istanbul", occurredAt: new Date().toISOString(), podName: "M. Receiver" }], ["close", {}]] as const) {
      d = await admin.post(`/v1/admin/cargo/requests/${ref}/commands/${cmd}`, body, { "if-match": String(d.body.version) })
      expect(d.status).toBe(200)
    }
    expect(d.body.status).toBe("COMPLETED")
    await admin.post(`/v1/admin/cargo/requests/${ref}/documents/generate`)
    cv = await c.get(`/v1/cargo-requests/${ref}`)
    expect(cv.body.tracking.map((t: { eventCode: string }) => t.eventCode)).toEqual(expect.arrayContaining(["RECEIVED", "DEPARTED", "AT_CUSTOMS", "CLEARED", "DELIVERED"]))
    expect(cv.body.booking.awbNumber).toBe("176-12345675")
    expect(cv.body.documents.map((x: { type: string }) => x.type)).toEqual(expect.arrayContaining(["SHIPMENT_SUMMARY", "COMMERCIAL_INVOICE"]))
    const all = await c.get("/v1/requests")
    expect(all.body.some((x: { ref: string; productType: string }) => x.ref === ref && x.productType === "CARGO")).toBe(true)
  })

  it("the availability register flags entries older than 30 days", async () => {
    const admin = await staffSession(STAFF.cargo, ADMIN_HOST)
    const rows = (await admin.get("/v1/admin/cargo/availability")).body
    expect(rows.find((r: { providerName: string }) => r.providerName.startsWith("Royal Mail")).status).toBe("SUSPENDED")
    const add = await admin.post("/v1/admin/cargo/availability", { providerName: "Demo Courier Partner (fictional)", lane: "GB-TR", service: "PARCEL", status: "AVAILABLE", sourceUrl: "https://courier.example/coverage" })
    expect(add.status).toBe(201)
    expect((await admin.get("/v1/admin/cargo/availability")).body.find((r: { id: string }) => r.id === add.body.id).stale).toBe(false)
  })
})
