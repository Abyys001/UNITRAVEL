import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { findForbiddenKeys } from "../src/testing/leak"
import { ADMIN_HOST, API, dbQuery, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

/** STAGE-23 stream C: service catalogue, request interests, catalogue lines on quotes, external booking reference, Iran hold (ADR-0030, ADR-0031 I4). */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const RUN = Date.now().toString(36).toUpperCase()

const seg = (carrier: string, num: string, from: string, to: string, depLocal: string, depUtc: string, arrLocal: string, arrUtc: string, fromTz: string, toTz: string) => ({
  marketing: { carrier, flightNumber: num }, operating: { carrier, flightNumber: num }, origin: { iata: from, terminal: "1" }, destination: { iata: to, terminal: "2" },
  departure: { local: depLocal, utc: depUtc, tz: fromTz }, arrival: { local: arrLocal, utc: arrUtc, tz: toTz }, cabin: "ECONOMY", technicalStops: [],
})
const SLICES = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg("BA", "675", "IST", "LHR", "2026-12-14T13:50", "2026-12-14T10:50:00Z", "2026-12-14T15:35", "2026-12-14T15:35:00Z", "Europe/Istanbul", "Europe/London")] }]

async function customerWithTraveller(name = "Catalog") {
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: name })
  const me = await c.get("/v1/me")
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: name, dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  expect(t.status).toBe(201)
  await markVerifiedForTest(t.body.id)
  const phone = me.body.identities.find((i: { type: string }) => i.type === "PHONE")
  return { c, phoneId: phone.id as string, traveller: t.body }
}
const requestBody = (phoneId: string, travellerId: string, from: string, serviceInterests?: string[]) => ({
  kind: "MANUAL", contactIdentityId: phoneId, travellers: [{ travellerId, passengerType: "ADT" }],
  query: { tripType: "ONE_WAY", slices: [{ from: { city: from }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
  manual: { flexibility: "Any day that week", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] },
  seatPreference: "WINDOW", acknowledgements: { notABooking: true, privacy: true }, ...(serviceInterests ? { serviceInterests } : {}),
})
const item = (code: string, over: Record<string, unknown> = {}) => ({ code, nameEn: `Test ${code}`, nameFa: `آزمون ${code}`, lineType: "BAGGAGE", defaultPriceMinor: 2500, currency: "GBP", perPassenger: false, showPriceToCustomer: false, ...over })

let admin: Session, cargo: Session
const SHOWN = `SHOWN_${RUN}`
const HIDDEN = `HIDDEN_${RUN}`
const OFF = `OFF_${RUN}`
const ids: Record<string, string> = {}

beforeAll(async () => {
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  cargo = await staffSession(STAFF.cargo, ADMIN_HOST)
})

describe("service catalogue CRUD (STAGE-23)", () => {
  it("management needs service_catalog.manage: customers and other staff are refused", async () => {
    const u = await customerWithTraveller("Refused")
    const anon = new Session("WEB")
    for (const s of [u.c, cargo, anon]) {
      expect([401, 403]).toContain((await s.get("/v1/admin/services-catalog")).status)
      expect([401, 403]).toContain((await s.post("/v1/admin/services-catalog", item(`NO_${RUN}`))).status)
      expect([401, 403]).toContain((await s.patch(`/v1/admin/services-catalog/${randomUUID()}`, { active: false })).status)
    }
  })

  it("creates, edits and deactivates items; the code is immutable and unique; every change is audited", async () => {
    for (const [code, over] of [[SHOWN, { showPriceToCustomer: true }], [HIDDEN, {}], [OFF, { active: false }]] as const) {
      const r = await admin.post("/v1/admin/services-catalog", item(code, over))
      expect(r.status).toBe(201)
      ids[code] = r.body.id
    }
    expect((await admin.post("/v1/admin/services-catalog", item(HIDDEN))).body.errors?.[0]?.path).toBe("code")
    expect((await admin.post("/v1/admin/services-catalog", item(`BAD_${RUN}`, { defaultPriceMinor: -1 }))).status).toBe(400)
    const edit = await admin.patch(`/v1/admin/services-catalog/${ids[HIDDEN]}`, { defaultPriceMinor: 3000, code: "CHANGED" })
    expect(edit.status).toBe(200)
    expect(edit.body).toMatchObject({ code: HIDDEN, defaultPriceMinor: 3000, showPriceToCustomer: false })
    expect((await admin.patch(`/v1/admin/services-catalog/${ids[HIDDEN]}`, {})).status).toBe(400)
    expect((await admin.patch(`/v1/admin/services-catalog/${randomUUID()}`, { active: false })).status).toBe(404)
    const list = (await admin.get("/v1/admin/services-catalog")).body as { code: string }[]
    expect(list.map((i) => i.code)).toEqual(expect.arrayContaining([SHOWN, HIDDEN, OFF]))
    const audit = await dbQuery<{ action: string }>("select action from audit_log where entity_type = 'service_catalog_item' and entity_id = $1", [ids[HIDDEN]])
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["service_catalog.created", "service_catalog.updated"]))
  })

  it("the public list needs no sign-in, hides inactive items and shows a price only when flagged", async () => {
    const res = await fetch(`${API}/v1/services-catalog`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { code: string; priceMinor?: number }[]
    expect(findForbiddenKeys(body)).toEqual([])
    expect(JSON.stringify(body)).not.toContain("defaultPriceMinor")
    expect(body.find((i) => i.code === OFF)).toBeUndefined()
    expect(body.find((i) => i.code === SHOWN)).toMatchObject({ priceMinor: 2500, currency: "GBP" })
    expect(body.find((i) => i.code === HIDDEN)).toBeDefined()
    expect(body.find((i) => i.code === HIDDEN)).not.toHaveProperty("priceMinor")
  })
})

describe("request interests, catalogue lines and external reference", () => {
  it("stores interests on submit, rejects unknown or inactive codes, and shows codes and names to staff and the customer", async () => {
    const u = await customerWithTraveller("Interest")
    const bad = await u.c.post("/v1/flight-requests", requestBody(u.phoneId, u.traveller.id, "IST", [HIDDEN, OFF]))
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe("VALIDATION_FAILED")
    expect((await u.c.post("/v1/flight-requests", requestBody(u.phoneId, u.traveller.id, "IST", ["NOPE_NOPE"]))).status).toBe(400)
    const ok = await u.c.post("/v1/flight-requests", requestBody(u.phoneId, u.traveller.id, "IST", [HIDDEN, HIDDEN, SHOWN]))
    expect(ok.status).toBe(201)
    const ref = ok.body.ref as string
    const rows = await dbQuery("select 1 from request_service_interests i join flight_requests r on r.id = i.request_id where r.ref = $1", [ref])
    expect(rows).toHaveLength(2)
    const mine = (await u.c.get(`/v1/flight-requests/${ref}`)).body
    expect(mine.serviceInterests.map((i: { code: string }) => i.code).sort()).toEqual([HIDDEN, SHOWN].sort())
    expect(Object.keys(mine.serviceInterests[0]).sort()).toEqual(["code", "nameEn", "nameFa"])
    expect(findForbiddenKeys(mine.serviceInterests)).toEqual([])
    const staff = (await admin.get(`/v1/admin/flight-requests/${ref}`)).body
    expect(staff.serviceInterests).toHaveLength(2)
  })

  it("a quote with a catalogue line becomes an invoice line, and a reservation can carry only an external reference", async () => {
    const u = await customerWithTraveller("Quote")
    const ref = (await u.c.post("/v1/flight-requests", requestBody(u.phoneId, u.traveller.id, "IST"))).body.ref as string
    await until(() => u.c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
    let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
    const opt = (total: number, catalogueLines?: unknown[]) => ({
      label: "Economy", source: "MANUAL", slices: SLICES, components: [], priceBreakdown: { fare: GBP(100000), taxes: GBP(20000), serviceFee: GBP(5000), total: GBP(total) },
      baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }],
      conditions: { change: { status: "KNOWN", value: { allowed: true } }, refund: { status: "KNOWN", value: { allowed: true } } }, ticketingModel: "SINGLE_TICKET", ...(catalogueLines ? { catalogueLines } : {}),
    })
    // The total must include the catalogue line (override price 3000 x 2 = 6000); a total without it is refused.
    const lines = [{ catalogueItemId: ids[HIDDEN], priceMinor: 3000, quantity: 2 }]
    const wrong = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [opt(125000, lines)] })
    expect(wrong.status).toBe(400)
    expect((await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [opt(131000, [{ catalogueItemId: ids[OFF] }])] })).status).toBe(400)
    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [opt(131000, lines)] })
    expect(draft.status).toBe(201)
    expect(draft.body.options[0].priceBreakdown.extras[0]).toMatchObject({ label: `Test ${HIDDEN}`, amount: GBP(6000), catalogueItemId: ids[HIDDEN], lineType: "BAGGAGE", quantity: 2, unitAmountMinor: 3000 })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(d.body.version) })
    const q = (await u.c.get(`/v1/flight-requests/${ref}`)).body.quotes[0]
    await u.c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id })
    const inv = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    expect(inv.status).toBe(201)
    expect(inv.body.total).toEqual(GBP(131000))
    const lineRows = await dbQuery<{ description: string; amount_minor: string }>("select description, amount_minor from invoice_lines where invoice_id = $1", [inv.body.id])
    expect(lineRows.find((l) => l.description === `Test ${HIDDEN}`)).toMatchObject({ amount_minor: "6000" })

    // ADR-0030: a panel reference with no PNR is stored as given; nothing invents a locator.
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    const base = { system: "PARTNER", ticketingDeadline: new Date(Date.now() + 2 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [u.traveller.id], slices: SLICES }
    const none = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, base, { "if-match": String(d.body.version) })
    expect(none.status).toBe(400)
    const rec = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { ...base, externalReference: "PANEL-4471", note: "Booked in the consolidator portal" }, { "if-match": String(d.body.version) })
    expect(rec.status).toBe(201)
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    expect(d.body.reservations[0]).toMatchObject({ recordLocator: null, externalReference: "PANEL-4471", note: "Booked in the consolidator portal" })
    // Tickets still need payment: a reference is not a ticket.
    const tk = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { reservationId: d.body.reservations[0].id, tickets: [{ travellerId: u.traveller.id, ticketNumber: `125${String(Date.now() + 9).slice(-10)}`, validatingCarrier: "BA", issueDate: "2026-10-22", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }] }, { "if-match": String(d.body.version) })
    expect(tk.status).toBeGreaterThanOrEqual(400)
    const custView = (await u.c.get(`/v1/flight-requests/${ref}`)).body
    expect(JSON.stringify(custView.reservation)).not.toContain("PANEL-4471")
  })

  it("a request touching an Iranian airport goes to COMPLIANCE_HOLD, and one that does not goes to NEW (ADR-0031 I4)", async () => {
    const ir = await customerWithTraveller("Iran")
    const held = (await ir.c.post("/v1/flight-requests", requestBody(ir.phoneId, ir.traveller.id, "THR"))).body.ref as string
    const heldView = await until(() => ir.c.get(`/v1/flight-requests/${held}`), (r) => r.body.status !== "SUBMITTED")
    expect(heldView.body.status).toBe("COMPLIANCE_HOLD")
    const detail = (await admin.get(`/v1/admin/flight-requests/${held}`)).body
    expect(JSON.stringify(detail.compliance)).toContain("Iranian airport")
    const clear = await customerWithTraveller("NotIran")
    const ok = (await clear.c.post("/v1/flight-requests", requestBody(clear.phoneId, clear.traveller.id, "IST"))).body.ref as string
    expect((await until(() => clear.c.get(`/v1/flight-requests/${ok}`), (r) => r.body.status !== "SUBMITTED")).body.status).toBe("NEW")
  })
})
