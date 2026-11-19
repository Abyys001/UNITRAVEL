import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { FlightRequestCustomerView, PublicFare } from "@unitravel/contracts"

import { findForbiddenKeys } from "../src/testing/leak"
import { cleanupTestData, type Catalog, inDays, makeCatalog, seedTestRoutes } from "./catalog-harness"
import { ADMIN_HOST, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "./client"
import { dbQuery } from "./client"

/**
 * ADR-0037 over HTTP against the running API: who may capture, what a customer can see of a captured fare, what the audit trail carries,
 * and that a CATALOG request creates no payment, invoice, reservation or ticket. Runs on the made-up TBZ→SAW route, removed afterwards.
 */
let c: Catalog
let ids: Record<string, string>
let admin: Session
let customer: Session
let me: { identities: { id: string; type: string }[] }
let traveller: { id: string }
const D = inDays(5)
const AMOUNT = /amountMinor|totalMinor|baseMinor|taxesMinor|penalty|priceBreakdown|"price"|currency|fareBasis|rulesText|fareType|staffFare|sourceRecordId/i
const MARK = "SRC-REC-77123"

const capture = (number = "7001") => ({
  observedAt: new Date().toISOString(), sourceRecordId: MARK, note: "from the panel",
  segments: [{ carrier: "TK", flightNumber: number, from: "TBZ", to: "SAW", departLocal: `${D}T08:40`, arriveLocal: `${D}T11:55` }],
  fares: [
    { cabin: "ECONOMY", bookingClasses: ["Y"], seats: ["9"], fareBasis: ["YOWIR"], fareType: "NEGO", totalMinor: 21345, baseMinor: 20000, taxesMinor: 1345, currency: "EUR", rulesText: "RULE-TEXT-SECRET",
      baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "UNKNOWN" } }],
      change: { state: "KNOWN_ALLOWED", penaltyMinor: 7777 }, refund: { state: "UNKNOWN" } },
    { cabin: "BUSINESS", bookingClasses: ["J"], seats: ["4"], fareType: "PUB", totalMinor: 99999, currency: "EUR",
      baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" } }],
      change: { state: "UNKNOWN" }, refund: { state: "NOT_ALLOWED" } },
  ],
})

beforeAll(async () => {
  c = await makeCatalog()
  ids = await seedTestRoutes(c)
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  customer = new Session("MOBILE")
  await signIn(customer, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: "Catalogtraveller" })
  me = (await customer.get("/v1/me")).body
  const t = await customer.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: "Catalogtraveller", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  expect(t.status).toBe(201)
  await markVerifiedForTest(t.body.id)
  traveller = t.body
})
afterAll(async () => {
  await dbQuery("delete from flight_result_fares where result_id in (select id from flight_results where origin = 'TBZ' and destination = 'SAW')")
  await cleanupTestData(c.since)
  await c.close()
})

describe("capture and customer exposure", () => {
  let resultId = ""
  let fareId = ""

  it("a customer and an anonymous caller cannot capture, retire, or read staff options; staff with catalog.capture can", async () => {
    const anon = new Session("WEB")
    for (const s of [anon, customer]) {
      expect([401, 403]).toContain((await s.post("/v1/admin/flight-builder/options", capture())).status)
      expect([401, 403]).toContain((await s.get("/v1/admin/flight-builder/options")).status)
      expect([401, 403]).toContain((await s.post("/v1/admin/flight-builder/usage", {})).status)
    }
    const r = await admin.post("/v1/admin/flight-builder/options", capture())
    expect(r.status).toBe(201)
    resultId = r.body.resultId
    fareId = r.body.fares[0].id
    expect(r.body.fares).toHaveLength(2)
  })

  it("the public result detail carries customer-safe fares: strict PublicFare, no amounts, no staff-only keys", async () => {
    // Contaminate the stored fare the way a bug or a bad import might: extra price-like keys inside the JSON columns.
    await dbQuery(`update flight_result_fares set conditions = conditions || '{"penaltyMinor":5,"staffFare":{"totalMinor":1},"username":"u","password":"p"}'::jsonb where result_id = $1`, [resultId])
    const res = await new Session("WEB").get(`/v1/flights/results/${resultId}`)
    expect(res.status).toBe(200)
    expect(res.body.fares).toHaveLength(2)
    for (const f of res.body.fares) expect(PublicFare.strict().safeParse(f).success).toBe(true)
    expect(findForbiddenKeys(res.body)).toEqual([])
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(AMOUNT)
    expect(text).not.toMatch(/21345|99999|7777|RULE-TEXT-SECRET|YOWIR|NEGO|username|password/)
    expect(text).not.toContain(MARK)
    // Order is by cabin then class, never by price.
    expect(res.body.fares.map((f: { cabin: string }) => f.cabin)).toEqual(["ECONOMY", "BUSINESS"])
    await dbQuery("update flight_result_fares set conditions = conditions - 'penaltyMinor' - 'staffFare' - 'username' - 'password' where result_id = $1", [resultId])
  })

  it("the audit trail of a capture names the flights and counts, never an amount, a note, the source record or rules text", async () => {
    const rows = await dbQuery<{ action: string; after: unknown; before: unknown }>("select action, before, after from audit_log where entity_id = $1 or (entity_type = 'flight_result' and context_ref is null and occurred_at >= $2)", [resultId, c.since])
    expect(rows.some((r) => r.action === "flight_builder.option.captured")).toBe(true)
    expect(JSON.stringify(rows)).not.toMatch(/amount|total|minor|penalt|RULE-TEXT|YOWIR|password|username|secret|token|from the panel/i)
    expect(JSON.stringify(rows)).not.toContain(MARK)
  })

  it("every Flight Builder, settings and credential audit event ever written is free of amounts and secrets", async () => {
    const rows = await dbQuery<{ action: string; before: unknown; after: unknown }>("select action, before, after from audit_log where action like 'flight_builder.%' or action like 'provider.authorisation.%' or action like 'provider.credentials%' or entity_id = 'flight-builder'")
    expect(rows.length).toBeGreaterThan(0)
    // Credential events list key names only (never values); everything else carries no money and no credential field at all.
    for (const r of rows.filter((x) => x.action.startsWith("provider.credentials"))) expect(Object.keys((r.after ?? {}) as object)).toEqual(["keys"])
    expect(JSON.stringify(rows.filter((x) => !x.action.startsWith("provider.credentials")))).not.toMatch(/amountMinor|totalMinor|baseMinor|taxesMinor|penaltyMinor|"password"|"username"|apiKey|secret|"token"/i)
  })

  it("a CATALOG request is derived from the stored fare, shows the customer no price, and creates no payment, invoice, reservation or ticket", async () => {
    const phone = me.identities.find((i) => i.type === "PHONE")!
    const body = {
      kind: "CATALOG", catalog: { resultId, fareId }, contactIdentityId: phone.id, travellers: [{ travellerId: traveller.id, passengerType: "ADT" }],
      seatPreference: "NONE", acknowledgements: { notABooking: true, privacy: true },
    }
    const sub = await customer.post("/v1/flight-requests", body)
    expect(sub.status).toBe(201)
    const ref = sub.body.ref as string
    const detail = await customer.get(`/v1/flight-requests/${ref}`)
    expect(detail.status).toBe(200)
    expect(FlightRequestCustomerView.safeParse(detail.body).success).toBe(true)
    expect(findForbiddenKeys(detail.body)).toEqual([])
    expect(JSON.stringify(detail.body)).not.toMatch(/staffFare|21345|99999|7777|RULE-TEXT-SECRET|YOWIR|NEGO/)
    expect(PublicFare.strict().safeParse(detail.body.snapshot?.fare).success).toBe(true)
    const [req] = await dbQuery<{ id: string; kind: string; payment_status: string }>("select id, kind, payment_status from flight_requests where ref = $1", [ref])
    expect(req).toMatchObject({ kind: "CATALOG", payment_status: "NONE" })
    for (const table of ["payment_records", "invoices", "reservations", "tickets", "quotes"]) {
      expect({ table, n: (await dbQuery(`select 1 from ${table} where request_id = $1`, [req!.id])).length }).toEqual({ table, n: 0 })
    }
    // Another customer cannot read it (ownership, 404).
    const other = new Session("MOBILE")
    await signIn(other, randomPhone("+98912"), { givenNamesLatin: "Other", surnameLatin: "Person" })
    expect((await other.get(`/v1/flight-requests/${ref}`)).status).toBe(404)
  })

  it("a retired option leaves the public detail's live fares", async () => {
    expect((await admin.post(`/v1/admin/flight-builder/options/${resultId}/retire`, {})).status).toBe(200)
    const res = await new Session("WEB").get(`/v1/flights/results/${resultId}`)
    expect(res.body.fares ?? []).toEqual([])
  })
})

describe("Developer Panel view of the Flight Builder source", () => {
  it("never carries credential values: no username or password key or value anywhere in the state or provider view", async () => {
    const dev = await staffSession(STAFF.developer)
    for (const path of ["/v1/dev/providers/flight-builder/state", "/v1/dev/providers/flight-builder"]) {
      const r = await dev.get(path)
      expect([200, 404]).toContain(r.status)
      if (r.status === 200) {
        // panelUrl is a staff setting shown here on purpose (it is forbidden only in customer DTOs); a credential never is.
        expect(findForbiddenKeys(r.body).filter((p) => !p.endsWith(".panelUrl"))).toEqual([])
        expect(JSON.stringify(r.body)).not.toMatch(/"(username|password)"/i)
      }
    }
  })
})
