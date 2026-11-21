import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, dbQuery, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const seg = { marketing: { carrier: "BA", flightNumber: "675" }, operating: { carrier: "BA", flightNumber: "675" }, origin: { iata: "IST", terminal: "1" }, destination: { iata: "LHR", terminal: "2" }, departure: { local: "2026-12-14T13:50", utc: "2026-12-14T10:50:00Z", tz: "Europe/Istanbul" }, arrival: { local: "2026-12-14T15:35", utc: "2026-12-14T15:35:00Z", tz: "Europe/London" }, cabin: "ECONOMY", technicalStops: [] }
const SLICES = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg] }]
const option = { label: "BA via Istanbul", source: "MANUAL", slices: SLICES, components: [], priceBreakdown: { fare: GBP(30000), taxes: GBP(9000), serviceFee: GBP(2500), total: GBP(41500) }, baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }], conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } }, ticketingModel: "SINGLE_TICKET", internalCostMinor: 38000 }
const query = { tripType: "ONE_WAY", slices: [{ from: { city: "IST" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" }
const key = () => ({ "idempotency-key": randomUUID() })

describe("ADR-0044 — staff create flight requests; tickets without identity verification need a recorded reason", () => {
  it("new customer + new unverified traveller → manual request → quote → accepted by phone → reservation → tickets with an identity override", async () => {
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const email = `walkin-${randomUUID().slice(0, 8)}@example.com`
    const phone = randomPhone("+4477009")
    // A new customer with no phone needs one; the contact phone is stored unverified.
    const noPhone = await admin.post("/v1/admin/intake/flight-requests", { customer: { name: "Sima Walkin", email }, query, travellers: [{ traveller: { title: "MS", givenNames: "Sima", surname: "Walkin", dateOfBirth: "1990-03-04", genderOnDocument: "F", nationality: "IR", relationship: "SELF" }, passengerType: "ADT" }], channel: "IN_PERSON", customerConfirmed: true }, key())
    expect(noPhone.status).toBe(400)
    const r = await admin.post("/v1/admin/intake/flight-requests", {
      customer: { name: "Sima Walkin", email }, contactPhone: phone, query, manual: { flexibility: "Any day that week", airlinesAvoid: [], airlinesPrefer: [], overlandAcceptable: false },
      travellers: [{ traveller: { title: "MS", givenNames: "Sima", surname: "Walkin", dateOfBirth: "1990-03-04", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "Z98765432", issuingCountry: "IR", expiryDate: "2031-01-01" } }, passengerType: "ADT" }],
      channel: "IN_PERSON", staffNote: "Came to the office", customerConfirmed: true, note: "Wants a window seat",
    }, key())
    expect(r.status).toBe(201)
    const ref = r.body.ref as string
    expect(ref).toMatch(/^UT-F-/)
    // Found again by the same email, phone or reference.
    expect((await admin.get(`/v1/admin/intake/customers?q=${email}`)).body[0]).toMatchObject({ email, phoneVerified: false })
    expect((await admin.get(`/v1/admin/intake/customers?q=${ref}`)).body).toHaveLength(1)

    let d: any
    for (let i = 0; i < 40; i++) { d = await admin.get(`/v1/admin/flight-requests/${ref}`); if (d.body.status === "NEW") break; await new Promise((x) => setTimeout(x, 300)) }
    expect(d.body.status).toBe("NEW")
    expect(d.body.intake).toMatchObject({ channel: "IN_PERSON" })
    expect(d.body.intake.createdByStaff).toBeTruthy()
    const v = () => ({ "if-match": String(d.body.version) })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, v())
    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option] })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, v())
    expect(d.body.status).toBe("QUOTED")
    const q = d.body.quotes.find((x: { status: string }) => x.status === "SENT")
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/record_acceptance`, { quoteId: q.id, optionId: q.options[0].id, calledAt: new Date().toISOString(), note: "Accepted at the counter" }, v())
    expect(d.body.status).toBe("ACCEPTED")
    const travellerId = d.body.travellers[0].travellerId
    d = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { system: "AMADEUS_TERMINAL", recordLocator: "Q7W2ZP", ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [travellerId], slices: SLICES }, v())
    expect(d.body.status).toBe("RESERVED")
    // The command is offered even though the traveller is not verified; the dialog takes the reason.
    expect(d.body.actions.find((a: { command: string }) => a.command === "record_tickets")).toMatchObject({ allowed: true })
    const resId = d.body.reservations[0].id
    const ticket = (n: string) => ({ reservationId: resId, tickets: [{ travellerId, ticketNumber: n, validatingCarrier: "BA", issueDate: "2026-11-19", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "CASH", receivedAt: new Date().toISOString(), externalReference: "COUNTER-1", payerName: "Sima Walkin" } })
    const no = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, ticket(`125${String(Date.now()).slice(-10)}`), { ...v(), ...key() })
    expect(no.status).toBe(409)
    expect(no.body).toMatchObject({ code: "IDENTITY_NOT_VERIFIED", overrideAllowed: true })
    const short = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { ...ticket(`125${String(Date.now()).slice(-10)}`), identityOverride: { reason: "ok" } }, { ...v(), ...key() })
    expect(short.status).toBe(400)
    const ok = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { ...ticket(`125${String(Date.now() + 7).slice(-10)}`), identityOverride: { reason: "Passport seen in person at the office by staff" } }, { ...v(), ...key() })
    expect(ok.status).toBe(201)
    expect(ok.body.status).toBe("TICKETED")
    expect((await admin.get(`/v1/admin/flight-requests/${ref}`)).body.identityOverride).toMatchObject({ reason: "Passport seen in person at the office by staff" })
    const audit = await dbQuery<{ action: string }>("select action from audit_log where context_ref = $1", [ref])
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["flight_request.submitted_by_staff", "flight_request.identity_override", "tickets.recorded"]))
    // The traveller stays unverified: the override is about this ticketing, not the document.
    const [t] = await dbQuery<{ verification_status: string }>("select verification_status from traveller_documents where traveller_id = $1", [travellerId])
    expect(t?.verification_status).not.toBe("VERIFIED")
  }, 180_000)

  it("existing customer by phone; customers and cargo-only staff cannot use flight intake", async () => {
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const c = new Session("WEB")
    const phone = randomPhone("+98912")
    await signIn(c, phone, { givenNamesLatin: "Omid", surnameLatin: "Existing" })
    const found = (await admin.get(`/v1/admin/intake/customers?q=${encodeURIComponent(phone)}`)).body[0]
    const r = await admin.post("/v1/admin/intake/flight-requests", { customer: { userId: found.userId }, query, travellers: [{ traveller: { title: "MR", givenNames: "Omid", surname: "Existing", dateOfBirth: "1985-01-01", genderOnDocument: "M", nationality: "IR", relationship: "SELF" }, passengerType: "ADT" }], channel: "PHONE", customerConfirmed: true }, key())
    expect(r.status).toBe(201)
    expect((await c.get(`/v1/flight-requests/${r.body.ref}`)).status).toBe(200)
    expect((await c.post("/v1/admin/intake/flight-requests", { customer: { userId: found.userId }, query, travellers: [], channel: "PHONE", customerConfirmed: true }, key())).status).toBe(403)
    const cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
    expect((await cargo.post("/v1/admin/intake/flight-requests", { customer: { userId: found.userId }, query, travellers: [{ travellerId: randomUUID(), passengerType: "ADT" }], channel: "PHONE", customerConfirmed: true }, key())).status).toBe(403)
  }, 120_000)
})
