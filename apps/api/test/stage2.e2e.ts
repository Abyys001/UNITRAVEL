import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, API, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}

const seg = (carrier: string, num: string, from: string, to: string, depLocal: string, depUtc: string, arrLocal: string, arrUtc: string, fromTz: string, toTz: string) => ({
  marketing: { carrier, flightNumber: num }, operating: { carrier, flightNumber: num }, origin: { iata: from, terminal: "1" }, destination: { iata: to, terminal: "2" },
  departure: { local: depLocal, utc: depUtc, tz: fromTz }, arrival: { local: arrLocal, utc: arrUtc, tz: toTz }, cabin: "ECONOMY", technicalStops: [],
})
const SLICES = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg("BA", "675", "IST", "LHR", "2026-12-14T13:50", "2026-12-14T10:50:00Z", "2026-12-14T15:35", "2026-12-14T15:35:00Z", "Europe/Istanbul", "Europe/London")] }]
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })

async function customerWithTraveller(name = { givenNames: "Neda", surname: "Testtraveller" }, doc = true, dob = "1998-05-02") {
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: name.givenNames, surnameLatin: name.surname })
  const me = await c.get("/v1/me")
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: name.givenNames, surname: name.surname, dateOfBirth: dob, genderOnDocument: "F", nationality: "IR", relationship: "SELF", ...(doc ? { document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } } : {}) })
  expect(t.status).toBe(201)
  if (doc) await markVerifiedForTest(t.body.id)
  return { c, me: me.body, traveller: t.body }
}

function manualBody(contactIdentityId: string, travellerId: string) {
  return {
    kind: "MANUAL", contactIdentityId, travellers: [{ travellerId, passengerType: "ADT" }],
    query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
    manual: { flexibility: "Any day that week", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] },
    seatPreference: "WINDOW", bestTimeToCall: "10:00–14:00 Tehran", note: "Student, first time travelling to the UK",
    acknowledgements: { notABooking: true, privacy: true },
  }
}

describe("Stage 2 — M1 manual request service (ch. 31.4)", () => {
  it("runs a manual request end to end: submit → screen → claim → info → quote (unknown baggage blocked) → accept → reserve → ticket (ATOL + four-eyes)", async () => {
    const { c, me, traveller } = await customerWithTraveller()
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const key = randomUUID()
    const sub = await c.post("/v1/flight-requests", manualBody(phone.id, traveller.id), { "idempotency-key": key })
    expect(sub.status).toBe(201)
    expect(sub.body.ref).toMatch(/^UT-F-[0-9A-HJKMNP-TV-Z]{6}$/)
    const replay = await c.post("/v1/flight-requests", manualBody(phone.id, traveller.id), { "idempotency-key": key })
    expect(replay.body.ref).toBe(sub.body.ref)
    expect(replay.headers.get("idempotent-replayed")).toBe("true")
    const ref = sub.body.ref

    const screened = await until(() => c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
    expect(screened.body.status).toBe("NEW")
    const sms = await until(async () => (await (await fetch(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string }[], (l) => l.some((m) => m.body.includes(ref)))
    expect(sms.some((m) => m.to === phone.value && m.body.includes(ref))).toBe(true)

    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    expect(d.body.actions.find((a: { command: string }) => a.command === "claim").allowed).toBe(true)
    const stale = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version - 1) })
    expect(stale.body.code).toBe("VERSION_CONFLICT")
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("IN_REVIEW")
    await admin.post(`/v1/admin/flight-requests/${ref}/contact-attempts`, { channel: "PHONE", outcome: "REACHED", note: "Prefers the gateway option via Van" })
    await admin.post(`/v1/admin/flight-requests/${ref}/notes`, { body: "Internal: check Van–IST timetable" })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/request_info`, { message: "Please confirm your passport expiry date." }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("AWAITING_CUSTOMER")

    let cv = await c.get(`/v1/flight-requests/${ref}`)
    expect(cv.body.statusLabel).toBe("Action needed")
    expect(JSON.stringify(cv.body)).not.toContain("Van–IST timetable") // internal notes never reach customers
    await c.post(`/v1/flight-requests/${ref}/messages`, { body: "My passport expires in 2030." })
    cv = await c.get(`/v1/flight-requests/${ref}`)
    expect(cv.body.status).toBe("IN_REVIEW")

    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    const option = (bags: "KNOWN" | "UNKNOWN") => ({
      label: "BA via Istanbul", source: "MANUAL", slices: SLICES, components: [],
      priceBreakdown: { fare: GBP(30000), taxes: GBP(9000), serviceFee: GBP(2500), total: GBP(41500) },
      baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: bags === "KNOWN" ? { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } } : { status: "UNKNOWN" }, cabin: { status: "KNOWN", value: true } }],
      conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } },
      ticketingModel: "SINGLE_TICKET", internalCostMinor: 38000,
    })
    const blockedDraft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option("UNKNOWN")] })
    expect(blockedDraft.body).toMatchObject({ status: "DRAFT" })
    expect(blockedDraft.body.sendBlockedBy[0]).toContain("baggage[0].checked")
    const blockedSend = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: blockedDraft.body.id }, { "if-match": String(d.body.version) })
    expect(blockedSend.status).toBe(409)
    expect(blockedSend.body.code).toBe("INVALID_TRANSITION")
    const draft = await admin.patch(`/v1/admin/flight-requests/${ref}/quotes/${blockedDraft.body.id}`, { currency: "GBP", options: [option("KNOWN")] }, { "if-match": String(blockedDraft.body.rowVersion) })
    expect(draft.body.sendBlockedBy).toEqual([])
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("QUOTED")

    cv = await c.get(`/v1/flight-requests/${ref}`)
    expect(cv.body.statusLabel).toBe("Options sent")
    expect(JSON.stringify(cv.body.quotes)).not.toContain("internalCostMinor")
    expect(cv.body.documents.some((x: { type: string }) => x.type === "QUOTE_PDF")).toBe(true)
    const q = cv.body.quotes[0]
    const acc = await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id }, { "idempotency-key": randomUUID() })
    expect(acc.body.status).toBe("ACCEPTED")

    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    const badLocator = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { system: "AMADEUS_TERMINAL", recordLocator: "ABC12", ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [traveller.id], slices: SLICES }, { "if-match": String(d.body.version) })
    expect(badLocator.status).toBe(400)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { system: "AMADEUS_TERMINAL", recordLocator: "K7Q2ZP", ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [traveller.id], slices: SLICES }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("RESERVED")
    cv = await c.get(`/v1/flight-requests/${ref}`)
    expect(cv.body.statusLabel).toBe("Awaiting payment")

    // ATOL PAY_ON_TICKETING: no standalone payment before tickets (ch. 27.6).
    const early = await admin.post(`/v1/admin/flight-requests/${ref}/payments`, { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: "BANK-REF-1", payerName: "Neda Testtraveller" })
    expect(early.body.code).toBe("ATOL_PAYMENT_NOT_ALLOWED")
    const resId = d.body.reservations[0].id
    const badTicket = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { reservationId: resId, tickets: [{ travellerId: traveller.id, ticketNumber: "2351234567890", validatingCarrier: "BA", issueDate: "2026-10-22", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: "BANK-REF-1", payerName: "Neda Testtraveller" } }, { "if-match": String(d.body.version) })
    expect(badTicket.status).toBe(400)
    expect(badTicket.body.errors[0].code).toBe("INVALID_TICKET")
    const ticketNo = `125${String(Date.now()).slice(-10)}`
    const tk = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { reservationId: resId, tickets: [{ travellerId: traveller.id, ticketNumber: ticketNo, validatingCarrier: "BA", issueDate: "2026-10-22", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: "BANK-REF-1", payerName: "Neda Testtraveller" } }, { "if-match": String(d.body.version), "idempotency-key": randomUUID() })
    expect(tk.status).toBe(201)
    expect(tk.body.awaitingPaymentVerification).toBe(false)
    expect(tk.body.status).toBe("TICKETED")
    cv = await c.get(`/v1/flight-requests/${ref}`)
    expect(cv.body.statusLabel).toBe("Ticket issued")
    expect(cv.body.paymentStatus).toBe("PAID")
    expect(cv.body.tickets[0].ticketNumber).toBe(ticketNo)
    const audit = (await (await staffSession(STAFF.owner)).get(`/v1/dev/audit-log?ref=${ref}`)).body.items.map((a: { action: string }) => a.action)
    expect(audit).toEqual(expect.arrayContaining(["flight_request.submitted", "flight_request.claim", "flight_request.send_quote", "flight_request.accept_quote", "reservation.recorded", "payment.recorded", "tickets.recorded"]))
  })

  it("payments above the threshold need a second staff member before ticketing completes (four-eyes)", async () => {
    const { c, me, traveller } = await customerWithTraveller({ givenNames: "Arash", surname: "Foureyes" })
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const ref = (await c.post("/v1/flight-requests", manualBody(phone.id, traveller.id))).body.ref
    await until(() => c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
    const opt = { label: "Business", source: "MANUAL", slices: SLICES, components: [], priceBreakdown: { fare: GBP(100000), taxes: GBP(20000), serviceFee: GBP(5000), total: GBP(125000) }, baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 2, kgPerPiece: 32 } }, cabin: { status: "KNOWN", value: true } }], conditions: { change: { status: "KNOWN", value: { allowed: true } }, refund: { status: "KNOWN", value: { allowed: true } } }, ticketingModel: "SINGLE_TICKET" }
    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [opt] })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(d.body.version) })
    const q = (await c.get(`/v1/flight-requests/${ref}`)).body.quotes[0]
    await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id })
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { system: "AMADEUS_TERMINAL", recordLocator: "ZX9Q2A", ticketingDeadline: new Date(Date.now() + 2 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [traveller.id], slices: SLICES }, { "if-match": String(d.body.version) })
    const tk = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { reservationId: d.body.reservations[0].id, tickets: [{ travellerId: traveller.id, ticketNumber: `125${String(Date.now() + 7).slice(-10)}`, validatingCarrier: "BA", issueDate: "2026-10-22", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(125000), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: "BANK-REF-2", payerName: "Arash Foureyes" } }, { "if-match": String(d.body.version) })
    expect(tk.body.awaitingPaymentVerification).toBe(true)
    expect(tk.body.request.status).toBe("RESERVED")
    const payId = tk.body.request.payments[0].id
    const self = await admin.post(`/v1/admin/payments/${payId}/verify`)
    expect(self.body.code).toBe("FOUR_EYES_REQUIRED")
    const owner = await staffSession(STAFF.owner, ADMIN_HOST)
    const ok = await owner.post(`/v1/admin/payments/${payId}/verify`)
    expect(ok.body.paymentStatus).toBe("PAID")
    expect((await c.get(`/v1/flight-requests/${ref}`)).body.status).toBe("TICKETED")
  })

  it("a traveller matching a list entry is held; only a compliance officer can release, with a reason", async () => {
    const { c, me, traveller } = await customerWithTraveller({ givenNames: "Kurosh", surname: "Testfarzane" }, true, "1970-03-21")
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const ref = (await c.post("/v1/flight-requests", manualBody(phone.id, traveller.id))).body.ref
    const held = await until(() => c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status !== "SUBMITTED")
    expect(held.body.status).toBe("COMPLIANCE_HOLD")
    expect(held.body.statusLabel).toBe("Being reviewed")
    expect(JSON.stringify(held.body)).not.toMatch(/screening|Testfarzaneh/i)
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    expect(d.body.compliance[0].status).toBe("OPEN")
    const caseId = d.body.compliance[0].id
    expect((await admin.post(`/v1/admin/compliance/cases/${caseId}/decide`, { decision: "RELEASE", reason: "not allowed" })).status).toBe(403)
    const officer = await staffSession(STAFF.compliance, ADMIN_HOST)
    const cs = await officer.get(`/v1/admin/compliance/cases/${caseId}`)
    expect(cs.body.screenings[0].hits[0].externalId).toBe("TEST-0001")
    expect((await officer.post(`/v1/admin/compliance/cases/${caseId}/decide`, { decision: "RELEASE", reason: "x" })).status).toBe(400)
    const rel = await officer.post(`/v1/admin/compliance/cases/${caseId}/decide`, { decision: "RELEASE", reason: "Different person: date of birth and passport checked against the entry" })
    expect(rel.body.status).toBe("RELEASED")
    expect((await c.get(`/v1/flight-requests/${ref}`)).body.status).toBe("NEW")
  })

  it("references are lookup handles, not credentials: another customer gets 404", async () => {
    const { c, me, traveller } = await customerWithTraveller({ givenNames: "Sara", surname: "Owner" })
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const ref = (await c.post("/v1/flight-requests", manualBody(phone.id, traveller.id))).body.ref
    const other = new Session("MOBILE")
    await signIn(other, randomPhone("+98912"))
    expect((await other.get(`/v1/flight-requests/${ref}`)).status).toBe(404)
    expect((await other.get(`/v1/admin/flight-requests/${ref}`)).status).toBe(403)
    expect((await other.post(`/v1/flight-requests`, manualBody(phone.id, traveller.id))).status).toBe(400)
  })
})
