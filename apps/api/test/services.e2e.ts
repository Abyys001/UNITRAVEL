import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ADMIN_HOST, API, DEV_HOST, randomPhone, Session, signIn, solvePow, STAFF, staffSession } from "./client"

/** ADR-0015 (service requests, site config, purchase tracking); booklet ch. 13, 27, spec docs/CONTENT-MENU-LIVE-DATA.md section 4. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const FLAGS = ["services.visa.enabled", "services.tours.enabled", "services.cip.enabled", "services.insurance.enabled", "hotels.enabled"] as const
const MENU: Record<(typeof FLAGS)[number], string> = { "services.visa.enabled": "visa", "services.tours.enabled": "tours", "services.cip.enabled": "cip", "services.insurance.enabled": "insurance", "hotels.enabled": "hotels" }

let dev: Session, admin: Session, compliance: Session
const anon = new Session("WEB")
const initial: Record<string, boolean> = {}

async function setFlag(key: (typeof FLAGS)[number], enabled: boolean) {
  expect((await dev.put(`/v1/dev/feature-flags/${key}`, { enabled })).status).toBe(200)
  await until(async () => (await anon.get("/v1/site")).body.menu[MENU[key]], (v) => v === enabled)
}

beforeAll(async () => {
  dev = await staffSession(STAFF.developer, DEV_HOST)
  admin = await staffSession(STAFF.admin, ADMIN_HOST)
  compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  const menu = (await anon.get("/v1/site")).body.menu
  for (const k of FLAGS) initial[k] = menu[MENU[k]]
  for (const k of FLAGS) if (initial[k]) await setFlag(k, false)
})
afterAll(async () => {
  // Every service flag is off by default; leave the local database as found.
  for (const k of FLAGS) await dev.put(`/v1/dev/feature-flags/${k}`, { enabled: initial[k] ?? false })
})

const codesTo = async (phone: string) => ((await (await fetch(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string }[]).filter((m) => m.to === phone).flatMap((m) => /code: (\d{6})/.exec(m.body)?.[1] ?? [])

async function customer(name = "Leila") {
  const c = new Session("MOBILE")
  const phone = randomPhone("+98912")
  await signIn(c, phone, { givenNamesLatin: name, surnameLatin: "Applicant" })
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: name, surname: "Applicant", dateOfBirth: "1990-02-03", genderOnDocument: "F", nationality: "IR", relationship: "SELF" })
  expect(t.status).toBe(201)
  return { c, phone, contactIdentityId: me.identities[0].id as string, travellerId: t.body.id as string }
}
type Cust = Awaited<ReturnType<typeof customer>>
const ack = { notABooking: true, privacy: true }
const visaBody = (u: Cust) => ({ type: "VISA", contactIdentityId: u.contactIdentityId, acknowledgements: ack, details: { destinationCountry: "TR", purpose: "TOURISM", travellerIds: [u.travellerId], intendedTravelDate: "2027-03-01", note: "e-Visa please" } })
const tourBody = (u: Cust) => ({ type: "TOUR_CALLBACK", contactIdentityId: u.contactIdentityId, acknowledgements: ack, details: { destination: "Istanbul", approxDates: "April 2027", travellersCount: 2, bestTimeToCall: "evenings" } })
const cipBody = (u: Cust) => ({ type: "CIP", contactIdentityId: u.contactIdentityId, acknowledgements: ack, details: { airport: "IKA", direction: "ARRIVAL", flightNumber: "BA 6641", date: "2027-03-01", passengersCount: 2 } })

const adminDetail = (ref: string) => admin.get(`/v1/admin/service-requests/${ref}`)
const cmd = (ref: string, command: string, version: number, input: Record<string, unknown> = {}) => admin.post(`/v1/admin/service-requests/${ref}/transition`, { command, expectedVersion: version, input })
const quoteInput = (extra: Record<string, unknown>[] = []) => ({ lines: [{ kind: "SERVICE_FEE", label: "Uni Travel service fee", amount: GBP(5000) }, { kind: "THIRD_PARTY_FEE", label: "Consulate fee", amount: GBP(2000) }, ...extra], validUntil: new Date(Date.now() + 2 * 86400_000).toISOString(), note: "Processing takes about 5 working days" })

describe("Service requests (ADR-0015)", () => {
  it("a flag that is off answers FEATURE_DISABLED; turning it on opens the type and the menu follows", async () => {
    const u = await customer()
    const off = await u.c.post("/v1/service-requests", visaBody(u))
    expect(off.status).toBe(403)
    expect(off.body.code).toBe("FEATURE_DISABLED")
    expect((await anon.get("/v1/site")).body.menu.visa).toBe(false)
    await setFlag("services.visa.enabled", true)
    expect((await u.c.post("/v1/service-requests", visaBody(u))).status).toBe(201)
    await setFlag("services.visa.enabled", false)
    expect((await u.c.post("/v1/service-requests", visaBody(u))).body.code).toBe("FEATURE_DISABLED")
  })

  it("visa lifecycle: submit, ownership 404, claim, quote (numbered), accept, complete, invoice", async () => {
    await setFlag("services.visa.enabled", true)
    const u = await customer()
    const other = await customer("Mina")
    const sub = await u.c.post("/v1/service-requests", visaBody(u))
    expect(sub.status).toBe(201)
    const ref = sub.body.ref as string
    expect(ref).toMatch(/^UT-S-/)
    // Another customer's reference is a 404 on every customer route; a traveller that is not theirs is refused at submit.
    for (const [m, p] of [["get", ""], ["post", "/cancel"], ["post", "/quote/accept"], ["post", "/messages"]] as const) {
      const r = m === "get" ? await other.c.get(`/v1/service-requests/${ref}${p}`) : await other.c.post(`/v1/service-requests/${ref}${p}`, p === "/messages" ? { body: "hi" } : {})
      expect({ p, status: r.status }).toEqual({ p, status: 404 })
    }
    // Someone else's phone is refused (400), someone else's traveller is a 404.
    expect((await other.c.post("/v1/service-requests", visaBody(u))).status).toBe(400)
    const foreign = visaBody(other)
    expect((await other.c.post("/v1/service-requests", { ...foreign, details: { ...foreign.details, travellerIds: [u.travellerId] } })).status).toBe(404)
    expect((await other.c.get("/v1/service-requests")).body).toEqual([])

    const mine = (await u.c.get(`/v1/service-requests/${ref}`)).body
    expect(mine).toMatchObject({ ref, type: "VISA", status: "SUBMITTED", quote: null, canCancel: true, canAcceptQuote: false })
    for (const k of ["version", "assignee", "customer", "slaDueAt", "complianceCaseId", "allowedCommands", "quotes", "travellers"]) expect(mine).not.toHaveProperty(k)

    let d = await until(() => adminDetail(ref), (r) => r.status === 200)
    expect(d.body.customer.name).toBeTruthy()
    // Customer routes are not staff routes and the other way round.
    expect((await u.c.get(`/v1/admin/service-requests/${ref}`)).status).toBe(403)
    expect((await admin.get(`/v1/service-requests/${ref}`)).status).toBe(403)

    expect((await cmd(ref, "send_quote", d.body.version, quoteInput())).body.code).toBe("INVALID_TRANSITION")
    d = await cmd(ref, "claim", d.body.version)
    expect(d.status).toBe(200)
    expect(d.body.status).toBe("IN_PROGRESS")
    expect((await cmd(ref, "claim", 1)).body.code).toBe("VERSION_CONFLICT")
    // The club hook: a discount line is refused while the club is off (loyalty.enabled).
    const club = await cmd(ref, "send_quote", d.body.version, quoteInput([{ kind: "CLUB_DISCOUNT", label: "Customer club discount", amount: GBP(500), benefitId: "019a0000-0000-7000-8000-000000000001" }]))
    expect(club.status).toBe(400)
    expect(club.body.code).toBe("VALIDATION_FAILED")
    expect(JSON.stringify(club.body)).toContain("Customer club is not enabled")
    // A quote with a past validity is refused by the machine.
    expect((await cmd(ref, "send_quote", d.body.version, { ...quoteInput(), validUntil: new Date(Date.now() - 1000).toISOString() })).status).toBe(409)

    d = await cmd(ref, "send_quote", d.body.version, quoteInput())
    expect(d.body.status).toBe("QUOTED")
    expect(d.body.quote.quotationNumber).toMatch(/\d/)
    expect(d.body.quote.total).toEqual(GBP(7000))
    const seen = (await u.c.get(`/v1/service-requests/${ref}`)).body
    expect(seen).toMatchObject({ status: "QUOTED", canAcceptQuote: true, quote: { status: "SENT", total: GBP(7000), quotationNumber: d.body.quote.quotationNumber } })
    expect(seen.timeline.map((t: { toStatus: string }) => t.toStatus)).toEqual(["SUBMITTED", "IN_PROGRESS", "QUOTED"])

    expect((await u.c.post(`/v1/service-requests/${ref}/messages`, { body: "Is a single-entry visa enough?" })).status).toBe(201)
    expect((await admin.post(`/v1/admin/service-requests/${ref}/messages`, { body: "Yes, single entry" })).status).toBe(201)
    const withMessages = (await u.c.get(`/v1/service-requests/${ref}`)).body.messages
    expect(withMessages.map((m: { direction: string }) => m.direction)).toEqual(["FROM_CUSTOMER", "TO_CUSTOMER"])

    const acc = await u.c.post(`/v1/service-requests/${ref}/quote/accept`)
    expect(acc.status).toBe(200)
    expect(acc.body).toMatchObject({ status: "CONFIRMED", canCancel: false, canAcceptQuote: false, quote: { status: "ACCEPTED" } })
    // Cancelling is for before the service is confirmed.
    const late = await u.c.post(`/v1/service-requests/${ref}/cancel`, {})
    expect(late.body.code).toBe("INVALID_TRANSITION")

    d = await adminDetail(ref)
    // A quotation and an invoice are numbered and have a PDF, exactly as for flights and cargo (ADR-0006).
    const inv = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    expect(inv.status).toBe(201)
    expect(inv.body).toMatchObject({ productType: "SERVICE", total: GBP(7000) })
    const issued = await admin.post(`/v1/admin/invoices/${inv.body.id}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.body.number).toBeTruthy()
    expect(issued.body.documentId).toBeTruthy()
    const billing = (await u.c.get("/v1/billing/documents")).body
    expect(billing.quotations.find((q: { requestRef: string }) => q.requestRef === ref)).toMatchObject({ productType: "SERVICE", number: d.body.quote.quotationNumber })
    expect(billing.invoices.find((i: { requestRef: string }) => i.requestRef === ref)).toMatchObject({ productType: "SERVICE", status: "ISSUED" })
    expect((await other.c.get(`/v1/billing/invoices/${issued.body.number}`)).status).toBe(404)

    d = await cmd(ref, "complete", d.body.version, { note: "Visa issued and sent" })
    expect(d.body.status).toBe("COMPLETED")
    expect((await u.c.post(`/v1/service-requests/${ref}/messages`, { body: "thanks" })).body.code).toBe("INVALID_TRANSITION")
  })

  it("a customer can cancel before confirmation", async () => {
    const u = await customer()
    const ref = (await u.c.post("/v1/service-requests", visaBody(u))).body.ref as string
    const r = await u.c.post(`/v1/service-requests/${ref}/cancel`, { reason: "Changed plans" })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: "CANCELLED", canCancel: false })
  })

  it("a tour call-back completes from IN_PROGRESS without a quote and can never be quoted", async () => {
    await setFlag("services.tours.enabled", true)
    const u = await customer()
    const ref = (await u.c.post("/v1/service-requests", tourBody(u))).body.ref as string
    let d = await until(() => adminDetail(ref), (r) => r.status === 200)
    d = await cmd(ref, "claim", d.body.version)
    const q = await cmd(ref, "send_quote", d.body.version, quoteInput())
    expect(q.body.code).toBe("INVALID_TRANSITION")
    d = await cmd(ref, "complete", d.body.version, { note: "Called, brochure sent" })
    expect(d.body.status).toBe("COMPLETED")
    expect((await u.c.get(`/v1/service-requests/${ref}`)).body).toMatchObject({ status: "COMPLETED", quote: null })
  })

  it("CIP at IKA is a SERVICE policy REVIEW: the request goes to COMPLIANCE_HOLD with a case, the customer sees it as received", async () => {
    await setFlag("services.cip.enabled", true)
    const u = await customer()
    const ref = (await u.c.post("/v1/service-requests", cipBody(u))).body.ref as string
    const d = await until(() => adminDetail(ref), (r) => r.body.status === "COMPLIANCE_HOLD")
    expect(d.body.status).toBe("COMPLIANCE_HOLD")
    expect(d.body.complianceCaseId).toBeTruthy()
    const seen = (await u.c.get(`/v1/service-requests/${ref}`)).body
    expect(seen.status).toBe("SUBMITTED")
    expect(seen.timeline.map((t: { toStatus: string }) => t.toStatus)).toEqual(["SUBMITTED"])
    // Staff with only service_request.write cannot claim a held request; the officer decides the case.
    expect((await cmd(ref, "claim", d.body.version)).body.code).toBe("INVALID_TRANSITION")
    const c = (await compliance.get(`/v1/admin/compliance/cases/${d.body.complianceCaseId}`)).body
    expect(c).toMatchObject({ requestType: "SERVICE", requestRef: ref, status: "OPEN" })
    expect(JSON.stringify(c.evidence)).toContain("CIP:IKA")
    const rel = await compliance.post(`/v1/admin/compliance/cases/${c.id}/decide`, { decision: "RELEASE", reason: "Operator cleared by counsel for this request" })
    expect(rel.status).toBe(200)
    const after = await until(() => adminDetail(ref), (r) => r.body.status === "SUBMITTED")
    expect(after.body.status).toBe("SUBMITTED")
  })

  it("the admin queue filters by type and status and needs service_request.read.any", async () => {
    const u = await customer()
    expect((await u.c.get("/v1/admin/service-requests")).status).toBe(403)
    const list = await admin.get("/v1/admin/service-requests?type=TOUR_CALLBACK&status=COMPLETED&limit=5")
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
    for (const row of list.body.items) expect(row).toMatchObject({ type: "TOUR_CALLBACK", status: "COMPLETED" })
    expect((await admin.get("/v1/admin/service-requests?type=NOPE")).status).toBe(400)
  })
})

describe("Site configuration (spec 4.1, 4.6)", () => {
  it("is public, lists the menu from the flags, hides placeholder contacts and never claims 24-hour support", async () => {
    const r = await anon.get("/v1/site")
    expect(r.status).toBe(200)
    expect(r.body.menu).toMatchObject({ flights: true, track: true, support: true, hotels: false, club: false })
    expect(Object.keys(r.body.menu).sort()).toEqual(["buses", "cargo", "cip", "club", "flights", "hotels", "insurance", "stays", "support", "tours", "track", "trains", "visa"])
    expect(r.body.support).toEqual({ phone: null, email: null, hours: null })
    expect(r.body.payments).toEqual({ online: false })
    await setFlag("services.insurance.enabled", true)
    expect((await anon.get("/v1/site")).body.menu.insurance).toBe(true)
    await setFlag("services.insurance.enabled", false)
  })
})

describe("Purchase tracking (spec 4.5)", () => {
  it("signed in: one list of own requests; signed out: lookup never enumerates, verify returns the timeline only", async () => {
    await setFlag("services.tours.enabled", true)
    const u = await customer("Leila")
    const ref = (await u.c.post("/v1/service-requests", tourBody(u))).body.ref as string

    const mine = (await u.c.get("/v1/track")).body
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ kind: "SERVICE", ref, serviceType: "TOUR_CALLBACK", status: "SUBMITTED", statusLabel: "Received" })
    expect((await anon.get("/v1/track")).status).toBe(401)

    // Lookups: matching and non-matching pairs answer identically (202, same body) and only the match sends an SMS.
    const stranger = new Session("WEB")
    const noPhone = randomPhone("+98912")
    const miss = await stranger.post("/v1/track/lookup", { ref, phone: noPhone, deviceId: stranger.deviceId })
    const unknownRef = await stranger.post("/v1/track/lookup", { ref: "UT-S-ZZZZZZ", phone: randomPhone("+98912"), deviceId: stranger.deviceId })
    const known = new Set((await codesTo(u.phone)))
    const hit = await stranger.post("/v1/track/lookup", { ref, phone: u.phone, deviceId: stranger.deviceId })
    for (const r of [miss, unknownRef, hit]) expect({ status: r.status, body: r.body }).toEqual({ status: 202, body: { accepted: true } })
    // The sign-in code is already in the sink; the tracking code is the new one.
    const code = (await until(async () => (await codesTo(u.phone)).filter((c) => !known.has(c)), (v) => v.length > 0))[0]!
    await wait(1500)
    const sms = (await (await fetch(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string }[]
    expect(sms.filter((m) => m.to === noPhone)).toEqual([])

    const bad = await stranger.post("/v1/track/verify", { ref, phone: u.phone, code: code === "000000" ? "111111" : "000000", deviceId: stranger.deviceId })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe("OTP_INVALID")
    const unknown = await stranger.post("/v1/track/verify", { ref: "UT-S-ZZZZZZ", phone: u.phone, code, deviceId: stranger.deviceId })
    expect({ status: unknown.status, code: unknown.body.code }).toEqual({ status: 400, code: "OTP_INVALID" })
    const ok = await stranger.post("/v1/track/verify", { ref, phone: u.phone, code, deviceId: stranger.deviceId })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ ref, kind: "SERVICE", serviceType: "TOUR_CALLBACK", status: "SUBMITTED" })
    expect(Object.keys(ok.body).sort()).toEqual(["kind", "ref", "serviceType", "status", "timeline"])
    expect(ok.body.timeline).toHaveLength(1)
    const text = JSON.stringify(ok.body)
    for (const leak of ["Leila", "Applicant", "Istanbul", u.phone, "GBP"]) expect(text).not.toContain(leak)
    // A code works once.
    expect((await stranger.post("/v1/track/verify", { ref, phone: u.phone, code, deviceId: stranger.deviceId })).body.code).toBe("OTP_INVALID")
  })

  it("lookups from one address face the proof-of-work challenge like OTP sign-in", async () => {
    const s = new Session("WEB")
    const post = (phone: string, extra: Record<string, unknown> = {}) => s.post("/v1/track/lookup", { ref: "UT-S-ZZZZZZ", phone, deviceId: s.deviceId, ...extra })
    for (let i = 0; i < 3; i++) expect((await post(randomPhone("+98912"))).status).toBe(202)
    const phone = randomPhone("+98912")
    const challenged = await post(phone)
    expect(challenged.status).toBe(428)
    expect(challenged.body.code).toBe("CHALLENGE_REQUIRED")
    const solved = await post(phone, { challenge: solvePow(challenged.body.challenge) })
    expect(solved.status).toBe(202)
  })
})
