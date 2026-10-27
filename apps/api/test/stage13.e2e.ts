import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { receivedShipment } from "./cargo-fixture"
import { ADMIN_HOST, API, dbQuery, DEV_HOST, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/** ADR-0013: traveller PATCH fix, discount and extra-service lines, staff amendments, payment emails (FAKE provider; no real Stripe key). */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const MAILPIT = "http://localhost:8035"
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"

interface Mail { ID: string; Subject: string; Text: string }
async function mailsTo(email: string, n: number): Promise<Mail[]> {
  const found = await until(async () => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string; Created: string }[] }, (r) => (r.messages?.length ?? 0) >= n)
  const sorted = [...(found.messages ?? [])].sort((a, b) => a.Created.localeCompare(b.Created))
  return Promise.all(sorted.map(async (m) => { const f = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as Mail; return { ID: f.ID, Subject: f.Subject, Text: f.Text } }))
}
async function addVerifiedEmail(c: Session): Promise<string> {
  const email = `adr13-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  const add = await c.post("/v1/me/identities", { type: "EMAIL", value: email, deviceId: c.deviceId })
  expect(add.status).toBe(202)
  const code = /(\d{6})/.exec((await mailsTo(email, 1))[0]!.Text)![1]!
  expect((await c.post("/v1/auth/otp/verify", { challengeId: add.body.challengeId, code, deviceId: c.deviceId, client: c.client })).status).toBe(200)
  return email
}
/** Customer notifications of one event type, newest first. */
const notes = async (userId: string, eventType: string) => dbQuery<{ id: string }>("select id from notifications where user_id = $1 and event_type = $2", [userId, eventType])

const seg = (carrier: string, num: string, from: string, to: string, depLocal: string, depUtc: string, arrLocal: string, arrUtc: string, fromTz: string, toTz: string) => ({
  marketing: { carrier, flightNumber: num }, operating: { carrier, flightNumber: num }, origin: { iata: from, terminal: "1" }, destination: { iata: to, terminal: "2" },
  departure: { local: depLocal, utc: depUtc, tz: fromTz }, arrival: { local: arrLocal, utc: arrUtc, tz: toTz }, cabin: "ECONOMY", technicalStops: [],
})
const SLICES = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg("BA", "675", "IST", "LHR", "2026-12-14T13:50", "2026-12-14T10:50:00Z", "2026-12-14T15:35", "2026-12-14T15:35:00Z", "Europe/Istanbul", "Europe/London")] }]
const option = (priceBreakdown: Record<string, unknown>) => ({
  label: "BA via Istanbul", source: "MANUAL", slices: SLICES, components: [], priceBreakdown,
  baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }],
  conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } },
  ticketingModel: "SINGLE_TICKET", internalCostMinor: 30000,
})
const query = (date: string, pax: { type: string; age?: number }[] = [{ type: "ADT" }]) => ({ tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date, flexDays: 2 }], passengers: pax, cabin: "ECONOMY" })

async function customer(name = { givenNames: "Sima", surname: "Testamend" }) {
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: name.givenNames, surnameLatin: name.surname })
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: name.givenNames, surname: name.surname, dateOfBirth: "1995-04-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  expect(t.status).toBe(201)
  await markVerifiedForTest(t.body.id)
  return { c, me, traveller: t.body }
}

/** A manual request claimed by an admin: IN_REVIEW. */
async function inReview(cu: Awaited<ReturnType<typeof customer>>) {
  const phone = cu.me.identities.find((i: { type: string }) => i.type === "PHONE")
  const sub = await cu.c.post("/v1/flight-requests", {
    kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: cu.traveller.id, passengerType: "ADT" }], query: query("2026-12-14"),
    manual: { flexibility: "Any day that week", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] },
    seatPreference: "WINDOW", bestTimeToCall: "10:00-14:00 Tehran", acknowledgements: { notABooking: true, privacy: true },
  })
  expect(sub.status).toBe(201)
  const ref = sub.body.ref as string
  await until(() => cu.c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
  let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
  d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
  expect(d.body.status).toBe("IN_REVIEW")
  return { ref, d: d.body }
}

let admin: Session, owner: Session, dev: Session, cargo: Session
beforeAll(async () => {
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  owner = await staffSession(STAFF.owner, DEV_HOST)
  dev = await staffSession(STAFF.developer, DEV_HOST)
  cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
})
afterAll(async () => { await owner?.put(FLAG, { enabled: false }) })

describe("ADR-0013 A9 — traveller PATCH", () => {
  it("a partial update keeps the relationship (Zod .partial() kept the SELF default)", async () => {
    const { c } = await customer({ givenNames: "Parisa", surname: "Testpatch" })
    const kid = await c.post("/v1/me/travellers", { title: "MISS", givenNames: "Tara", surname: "Testpatch", dateOfBirth: "2018-06-01", genderOnDocument: "F", nationality: "IR", relationship: "FAMILY" })
    expect(kid.status).toBe(201)
    const p = await c.patch(`/v1/me/travellers/${kid.body.id}`, { givenNames: "Taraneh" })
    expect(p.status).toBe(200)
    expect(p.body).toMatchObject({ givenNames: "TARANEH", relationship: "FAMILY" })
  })
})

describe("ADR-0013 A5/A6 — discount and extra-service lines", () => {
  it("the server computes the total, refuses manipulated amounts, and the invoice carries extras and a negative discount line", async () => {
    const cu = await customer({ givenNames: "Mina", surname: "Testprice" })
    const { ref } = await inReview(cu)
    const pb = { fare: GBP(35000), taxes: GBP(0), serviceFee: GBP(1000), extras: [{ label: "Extra bag", amount: GBP(2500) }], discount: { label: "Loyalty", amount: GBP(1500) } }
    const wrong = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option({ ...pb, total: GBP(38500) })] })
    expect(wrong.status).toBe(400)
    expect(wrong.body.errors[0]).toMatchObject({ path: "options[0].priceBreakdown.total", code: "SUM" })
    const tooBig = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option({ ...pb, discount: { label: "x", amount: GBP(50000) }, total: GBP(-11500) })] })
    expect(tooBig.status).toBe(400)
    expect(tooBig.body.errors[0].code).toBe("DISCOUNT_TOO_LARGE")
    const zeroExtra = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option({ ...pb, extras: [{ label: "free", amount: GBP(0) }], total: GBP(34500) })] })
    expect(zeroExtra.status).toBe(400)

    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option({ ...pb, total: GBP(37000) })] })
    expect(draft.status).toBe(201)
    let d = (await admin.get(`/v1/admin/flight-requests/${ref}`)).body
    d = (await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(d.version) })).body
    expect(d.status).toBe("QUOTED")

    const cv = (await cu.c.get(`/v1/flight-requests/${ref}`)).body
    const o = cv.quotes[0].options[0]
    expect(o.priceBreakdown).toMatchObject({ extras: [{ label: "Extra bag", amount: GBP(2500) }], discount: { label: "Loyalty", amount: GBP(1500) }, total: GBP(37000) })
    expect(JSON.stringify(cv.quotes)).not.toContain("internalCostMinor")
    expect((await cu.c.post(`/v1/flight-requests/${ref}/quotes/${cv.quotes[0].id}/accept`, { optionId: o.id })).body.status).toBe("ACCEPTED")

    const inv = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    expect(inv.status).toBe(201)
    expect(inv.body.total).toEqual(GBP(37000))
    const lines = inv.body.lines.map((l: { description: string; amount: { amountMinor: number } }) => [l.description, l.amount.amountMinor])
    expect(lines).toEqual([["Airfare - BA via Istanbul", 35000], ["Uni Travel service fee", 1000], ["Extra bag", 2500], ["Discount - Loyalty", -1500]])
  })
})

describe("ADR-0013 A1-A4 — staff amendments", () => {
  it("amends the trip with a reason and a version check, keeps before/after, tells the customer, and never rewrites the quote", async () => {
    const cu = await customer({ givenNames: "Leila", surname: "Testamend" })
    const { ref, d } = await inReview(cu)
    expect(d.amendment).toEqual({ allowed: true, needsAcknowledge: false })

    expect((await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "no", query: query("2026-12-20") })).status).toBe(400)
    const stale = await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version - 1, reason: "Customer phoned: one week later", query: query("2026-12-20") })
    expect(stale.body.code).toBe("VERSION_CONFLICT")
    expect((await cu.c.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "Customer phoned", query: query("2026-12-20") })).status).toBe(403)
    expect((await cargo.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "Customer phoned", query: query("2026-12-20") })).status).toBe(403)
    // The traveller mix must still match the passengers (ADR-0008 W6).
    const mix = await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "Adding a second adult", query: query("2026-12-20", [{ type: "ADT" }, { type: "ADT" }]) })
    expect(mix.status).toBe(400)
    expect(mix.body.errors[0].code).toBe("PASSENGER_MIX_MISMATCH")
    // Someone else's traveller is not found.
    const stranger = await customer({ givenNames: "Omid", surname: "Teststranger" })
    expect((await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "Wrong traveller test", travellers: [{ travellerId: stranger.traveller.id, passengerType: "ADT" }] })).status).toBe(404)

    const ok = await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "Customer phoned: one week later", query: query("2026-12-20") })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: "IN_REVIEW", version: d.version + 1 })
    const row = (await dbQuery<{ version_before: number; reason: string; before: { query: { slices: { date: string }[] } }; after: { query: { slices: { date: string }[] } } }>("select version_before, reason, before, after from request_amendments where request_id = (select id from flight_requests where ref = $1)", [ref]))
    expect(row).toHaveLength(1)
    expect(row[0]!.before.query.slices[0]!.date).toBe("2026-12-14")
    expect(row[0]!.after.query.slices[0]!.date).toBe("2026-12-20")
    await expect(dbQuery("update request_amendments set reason = 'x' where request_id = (select id from flight_requests where ref = $1)", [ref])).rejects.toThrow()
    const staffItem = ok.body.timeline.find((t: { kind: string }) => t.kind === "AMENDMENT")
    expect(staffItem.detail).toContain("2026-12-14")
    expect(staffItem.detail).toContain("-> ")
    expect(staffItem.detail).toContain("2026-12-20")
    const cv = (await cu.c.get(`/v1/flight-requests/${ref}`)).body
    expect(cv.timeline.some((t: { kind: string; label: string }) => t.kind === "AMENDMENT" && t.label === "Details updated by Uni Travel")).toBe(true)
    expect(JSON.stringify(cv.timeline)).not.toContain("Customer phoned") // the staff reason stays internal
    expect((await dbQuery("select 1 from audit_log where action = 'flight_request.amended' and context_ref = $1", [ref])).length).toBe(1)
    await until(() => notes(cu.me.id, "request.amended"), (n) => n.length === 1)
    expect(await notes(cu.me.id, "request.amended")).toHaveLength(1)

    // With a quote out, staff must acknowledge that it stays as sent.
    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option({ fare: GBP(30000), taxes: GBP(9000), serviceFee: GBP(2500), total: GBP(41500) })] })
    let s = (await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(ok.body.version) })).body
    expect(s.status).toBe("QUOTED")
    expect(s.amendment).toEqual({ allowed: true, needsAcknowledge: true })
    const noAck = await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: s.version, reason: "Back to the 14th", query: query("2026-12-14") })
    expect(noAck.status).toBe(400)
    expect(noAck.body.errors[0].path).toBe("acknowledgeOpenQuote")
    s = (await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: s.version, reason: "Back to the 14th", query: query("2026-12-14"), acknowledgeOpenQuote: true })).body
    expect(s.status).toBe("QUOTED")
    expect((await dbQuery<{ status: string }>("select status from quotes where id = $1", [draft.body.id]))[0]!.status).toBe("SENT")
  })

  it("a new traveller who matches a list entry refuses the amendment and opens a compliance case; nothing changes", async () => {
    const cu = await customer({ givenNames: "Nasrin", surname: "Testamend" })
    const { ref, d } = await inReview(cu)
    const listed = await cu.c.post("/v1/me/travellers", { title: "MR", givenNames: "Kurosh", surname: "Testfarzane", dateOfBirth: "1970-03-21", genderOnDocument: "M", nationality: "IR", relationship: "FAMILY", document: { number: "X99999999", issuingCountry: "IR", expiryDate: "2030-01-01" } })
    expect(listed.status).toBe(201)
    const before = (await dbQuery("select 1 from compliance_cases where request_ref = $1", [ref])).length
    const r = await admin.post(`/v1/admin/flight-requests/${ref}/amend`, { expectedVersion: d.version, reason: "Customer's father joins", query: query("2026-12-14", [{ type: "ADT" }, { type: "ADT" }]), travellers: [{ travellerId: cu.traveller.id, passengerType: "ADT" }, { travellerId: listed.body.id, passengerType: "ADT" }] })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("COMPLIANCE_REVIEW_REQUIRED")
    expect((await dbQuery("select 1 from compliance_cases where request_ref = $1", [ref])).length).toBe(before + 1)
    const after = (await admin.get(`/v1/admin/flight-requests/${ref}`)).body
    expect(after.version).toBe(d.version)
    expect(after.travellers).toHaveLength(1)
    expect((await dbQuery("select 1 from request_amendments where request_id = (select id from flight_requests where ref = $1)", [ref])).length).toBe(0)
  })
})

describe("ADR-0013 A7 — payment emails (FAKE provider, signed webhooks)", () => {
  const sink = (sessionId: string, body: Record<string, unknown>) => fetch(`${API}/v1/dev-sink/payments/${sessionId}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => (await r.json()) as { payload: string; signature: string })
  const webhook = (e: { payload: string; signature: string }) => fetch(`${API}/v1/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": e.signature }, body: e.payload }).then((r) => r.status)
  const session = async (invoiceId: string) => (await dbQuery<{ provider_session_id: string }>("select provider_session_id from payment_sessions where invoice_id = $1 order by attempt desc limit 1", [invoiceId]))[0]!.provider_session_id

  beforeAll(async () => {
    expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
  })

  it("payment required, failed, received (once, despite a replay) and refunded (once per amount), by email without amounts", async () => {
    const { c, ref } = await receivedShipment("MOBILE", cargo)
    const email = await addVerifiedEmail(c)
    const userId = (await c.get("/v1/me")).body.id as string
    const draft = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    const issued = (await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)).body
    const id = draft.body.id as string, number = issued.number as string

    // Staff resend: a dedicated "payment required" message, not a second "invoice issued".
    expect((await c.post(`/v1/admin/invoices/${id}/payment-link/resend`)).status).toBe(403)
    expect((await admin.post(`/v1/admin/invoices/${id}/payment-link/resend`)).status).toBe(200)
    await until(() => notes(userId, "payment.requested"), (n) => n.length === 1)
    expect(await notes(userId, "invoice.issued")).toHaveLength(1)
    const requested = (await mailsTo(email, 4)).find((m) => m.Subject.includes("payment required"))!
    expect(requested.Subject).toBe(`Your booking request ${ref} - payment required`)
    expect(requested.Text).toContain(number)
    expect(requested.Text).not.toMatch(/£|GBP|50\.00/) // no amounts in a mailbox (ADR-0004)

    // An asynchronous card payment that fails: the customer is told; the invoice stays payable.
    await until(async () => (await c.get(`/v1/billing/invoices/${number}/payment`)).body, (v) => v.offered === true)
    expect((await c.post(`/v1/billing/invoices/${number}/checkout-session`)).status).toBe(200)
    const s1 = await session(id)
    expect(await webhook(await sink(s1, { kind: "async_pending" }))).toBe(200)
    const failed = await sink(s1, { kind: "async_failed" })
    expect(await webhook(failed)).toBe(200)
    expect(await webhook(failed)).toBe(200) // replay
    await until(() => notes(userId, "payment.failed"), (n) => n.length === 1)
    await wait(1500)
    expect(await notes(userId, "payment.failed")).toHaveLength(1)

    // A successful payment: one "payment received", even when the provider repeats the event.
    expect((await c.post(`/v1/billing/invoices/${number}/checkout-session`)).status).toBe(200)
    const s2 = await session(id)
    const paid = await sink(s2, { kind: "paid" })
    expect(await webhook(paid)).toBe(200)
    expect(await webhook(paid)).toBe(200)
    await until(() => notes(userId, "invoice.paid"), (n) => n.length === 1)
    await wait(1500)
    expect(await notes(userId, "invoice.paid")).toHaveLength(1)
    const receipt = (await mailsTo(email, 6)).find((m) => m.Subject.startsWith("Payment received"))!
    expect(receipt.Subject).toContain(number)
    expect(receipt.Text).toContain("not a ticket")

    // Refunds: one message per increase of the refunded amount; a replay sends nothing.
    const part = await sink(s2, { kind: "refunded", amountMinor: 1000 })
    expect(await webhook(part)).toBe(200)
    expect(await webhook(part)).toBe(200)
    await until(() => notes(userId, "payment.refunded"), (n) => n.length === 1)
    expect(await webhook(await sink(s2, { kind: "refunded", amountMinor: 5000 }))).toBe(200)
    await until(() => notes(userId, "payment.refunded"), (n) => n.length === 2)
    await wait(1500)
    expect(await notes(userId, "payment.refunded")).toHaveLength(2)
    expect((await c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("REFUNDED")
  })
})
