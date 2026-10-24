import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, API, dbQuery, randomPhone, refreshPermCache, Session, signIn, STAFF, staffSession } from "./client"

/**
 * Phase B (ADR-0005): My details, passport scan (separate encrypted bucket, metadata stripped), review-then-confirm,
 * staff verification, audited downloads, material changes and the record_tickets guard.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })

const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload])
/** A tiny JPEG with an EXIF segment that carries a GPS marker and an XMP owner name. */
const scanBytes = (tag = "GPS-LATITUDE-51.5N") => Buffer.concat([
  Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")), seg(0xe1, Buffer.from(`Exif\0\0${tag} Orientation=6 Canon`)), seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<owner>Neda</owner>")),
  seg(0xdb, Buffer.alloc(65, 1)), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xc4, Buffer.alloc(20, 2)), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9]),
])

async function uploadScan(c: Session, bytes = scanBytes(), type = "PASSPORT_SCAN", filename = "passport.jpg", mime = "image/jpeg") {
  const up = await c.post("/v1/uploads", { filename, mime, size: bytes.length, type })
  if (up.status !== 201 && up.status !== 200) return { up, documentId: undefined as string | undefined }
  if (type === "PASSPORT_SCAN") expect(up.body.headers["x-amz-server-side-encryption"]).toBe("AES256")
  const put = await fetch(up.body.uploadUrl, { method: "PUT", headers: up.body.headers, body: new Uint8Array(bytes) })
  expect(put.status, await put.clone().text()).toBeLessThan(300)
  expect((await c.post(`/v1/uploads/${up.body.documentId}/complete`)).status).toBe(200)
  return { up, documentId: up.body.documentId as string }
}
const scanStatus = (c: Session, id: string) => until(() => c.get(`/v1/uploads/${id}`), (r) => r.body.scanStatus !== "PENDING")

async function customerWithPassport(surname = "Verifyme") {
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: surname })
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname, nameFa: "ندا", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X98765432", issuingCountry: "IR", expiryDate: "2031-01-01" } })
  expect(t.status).toBe(201)
  return { c, traveller: t.body as { id: string; verification: { status: string; reviewHash: string } } }
}
const mine = async (c: Session) => (await c.get("/v1/me/details")).body.self

describe("Phase B — identity, profile, passport, verification", () => {
  it("My details: optional address with validation; contact methods listed with their verification", async () => {
    const { c } = await customerWithPassport()
    const d0 = await c.get("/v1/me/details")
    expect(d0.status).toBe(200)
    expect(d0.body.address).toBeNull()
    expect(d0.body.identities[0]).toMatchObject({ type: "PHONE", verified: true })
    expect(d0.body.self.verification.status).toBe("UNVERIFIED")
    expect((await c.patch("/v1/me/details", { address: { line1: "1 Test Street", city: "London", postcode: "!!", country: "GB" } })).status).toBe(400)
    expect((await c.patch("/v1/me/details", { address: { line1: "1 Test Street", city: "London", postcode: "SW1A 1AA", country: "gb" } })).status).toBe(400)
    const ok = await c.patch("/v1/me/details", { address: { line1: "1 Test Street", city: "London", postcode: "SW1A 1AA", country: "GB" }, nameFa: "ندا" })
    expect(ok.status).toBe(200)
    expect(ok.body.address).toMatchObject({ line1: "1 Test Street", postcode: "SW1A 1AA", country: "GB" })
    expect((await c.patch("/v1/me/details", { address: null })).body.address).toBeNull()
  })

  it("second identity: add an email, verify it with the code from the sink; the phone stays", async () => {
    const { c } = await customerWithPassport()
    const email = `phaseb-${Date.now()}@example.test`
    const add = await c.post("/v1/me/identities", { type: "EMAIL", value: email, deviceId: c.deviceId })
    expect(add.status).toBe(202)
    const mail = await until(async () => (await (await fetch("http://localhost:8035/api/v1/search?query=" + encodeURIComponent(`to:${email}`))).json()) as { messages?: { ID: string }[] }, (r) => !!r.messages?.length)
    const msg = await (await fetch(`http://localhost:8035/api/v1/message/${mail.messages![0]!.ID}`)).json() as { Text: string }
    const code = /(\d{6})/.exec(msg.Text)![1]!
    const v = await c.post("/v1/auth/otp/verify", { challengeId: add.body.challengeId, code, deviceId: c.deviceId, client: "MOBILE" })
    expect(v.status).toBe(200)
    const d = await c.get("/v1/me/details")
    expect(d.body.identities.find((i: { type: string }) => i.type === "EMAIL")).toMatchObject({ value: email, verified: true })
    expect(d.body.identities.find((i: { type: string }) => i.type === "PHONE").verified).toBe(true)
  })

  it("scan → confirm → queue → correction → resubmit → verify → material change resets → audited downloads", async () => {
    const { c, traveller } = await customerWithPassport()
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)

    // A PDF is not an acceptable passport scan; the text types stay unaffected.
    const pdf = await c.post("/v1/uploads", { filename: "p.pdf", mime: "application/pdf", size: 1000, type: "PASSPORT_SCAN" })
    expect(pdf.status).toBe(400)

    // Confirming before a scan exists is refused.
    const early = await c.post(`/v1/me/travellers/${traveller.id}/identity/confirm`, { reviewHash: traveller.verification.reviewHash })
    expect(early.status).toBe(409)

    const { documentId } = await uploadScan(c)
    expect((await scanStatus(c, documentId!)).body.scanStatus).toBe("CLEAN")
    const stored = (await dbQuery<{ storage_bucket: string; size: number; sha256: string }>("select storage_bucket, size, sha256 from documents where id = $1", [documentId]))[0]!
    expect(stored.storage_bucket).toMatch(/-identity$/)

    // Another customer cannot attach it (404); the owner can.
    const other = new Session("MOBILE")
    await signIn(other, randomPhone("+98912"), { givenNamesLatin: "Other", surnameLatin: "Person" })
    const ot = await other.post("/v1/me/travellers", { title: "MR", givenNames: "Other", surname: "Person", dateOfBirth: "1990-01-01", genderOnDocument: "M", nationality: "IR", document: { number: "Z11111111", issuingCountry: "IR", expiryDate: "2031-01-01" } })
    expect((await other.post(`/v1/me/travellers/${ot.body.id}/identity/scan`, { documentId })).status).toBe(404)
    const attached = await c.post(`/v1/me/travellers/${traveller.id}/identity/scan`, { documentId })
    expect(attached.status).toBe(200)
    expect(attached.body.verification.scan.documentId).toBe(documentId)

    // Review then confirm: a stale hash is refused, the current one moves the document to SUBMITTED.
    expect((await c.post(`/v1/me/travellers/${traveller.id}/identity/confirm`, { reviewHash: "0".repeat(64) })).status).toBe(409)
    const confirmed = await c.post(`/v1/me/travellers/${traveller.id}/identity/confirm`, { reviewHash: attached.body.verification.reviewHash })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.verification.status).toBe("SUBMITTED")
    expect(confirmed.body.verification.confirmedAt).toBeTruthy()

    // Staff: queue and side-by-side detail; customers and roles without identity.verify are refused.
    expect((await c.get("/v1/admin/verifications")).status).toBe(403)
    const compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
    expect((await compliance.get("/v1/admin/verifications")).status).toBe(403)
    const queue = await admin.get("/v1/admin/verifications")
    expect(queue.status).toBe(200)
    const item = queue.body.find((x: { travellerId: string }) => x.travellerId === traveller.id)
    expect(item).toBeTruthy()
    const detail = await admin.get(`/v1/admin/verifications/${item.id}`)
    expect(detail.body).toMatchObject({ status: "SUBMITTED", traveller: { surname: "VERIFYME", nationality: "IR" }, document: { last4: "5432", issuingCountry: "IR" }, scan: { documentId } })
    expect(JSON.stringify(detail.body)).not.toContain("X98765432") // the number only comes through the audited Reveal
    const reveal = await admin.post(`/v1/admin/customers/travellers/${traveller.id}/reveal-document`, {})
    expect(reveal.body.number).toBe("X98765432")

    // Download: audited, metadata stripped, forbidden without customer.read.documents (404, no existence leak).
    const dl = await admin.get(`/v1/documents/${documentId}/download`)
    expect(dl.status).toBe(200)
    const bytes = Buffer.from(await (await fetch(dl.body.url)).arrayBuffer())
    expect(bytes[0]).toBe(0xff)
    for (const needle of ["GPS-LATITUDE", "Orientation", "Canon", "<owner>"]) expect(bytes.includes(Buffer.from(needle)), needle).toBe(false)
    const audited = await dbQuery<{ action: string; actor_user_id: string }>("select action, actor_user_id from audit_log where action = 'document.downloaded' and entity_id = $1", [documentId])
    expect(audited.length).toBe(1)
    // The side-by-side view streams the scan inline: sandboxed, the stripped bytes, and audited like a download.
    const inline = await fetch(`${API}/v1/admin/verifications/${item.id}/scan`, { headers: admin.headers() })
    expect(inline.status).toBe(200)
    expect(inline.headers.get("content-type")).toBe("image/jpeg")
    expect(inline.headers.get("content-security-policy")).toContain("sandbox")
    expect(Buffer.from(await inline.arrayBuffer()).includes(Buffer.from("GPS-LATITUDE"))).toBe(false)
    expect((await dbQuery("select 1 from audit_log where action = 'document.downloaded' and entity_id = $1", [documentId])).length).toBe(2)
    expect((await compliance.get(`/v1/admin/verifications/${item.id}/scan`)).status).toBe(403)
    const dev = await staffSession(STAFF.developer)
    expect((await dev.get(`/v1/documents/${documentId}/download`)).status).toBe(404)
    expect((await other.get(`/v1/documents/${documentId}/download`)).status).toBe(404)
    expect((await c.get(`/v1/documents/${documentId}/download`)).status).toBe(200) // the owner keeps their own file

    // Holding only a broad read permission is no longer enough to open an identity document.
    const viewer = new Session("MOBILE")
    await signIn(viewer, randomPhone("+98912"), { givenNamesLatin: "Read", surnameLatin: "Only" })
    const me = (await viewer.get("/v1/me")).body
    const roleKey = `viewer_${Date.now()}`
    const [role] = await dbQuery<{ id: string }>("insert into roles (id, key, name) values ($1, $2, 'Request reader (test)') returning id", [randomUUID(), roleKey])
    await dbQuery("insert into role_permissions (role_id, permission) values ($1, 'flight_request.read.any')", [role!.id])
    await dbQuery("insert into user_roles (user_id, role_id) values ($1, $2)", [me.id, role!.id])
    await dbQuery("update users set perm_version = perm_version + 1 where id = $1", [me.id])
    await refreshPermCache(me.id)
    expect((await viewer.get("/v1/me")).body.code).toBe("PERMISSIONS_CHANGED")
    const rf = await viewer.post("/v1/auth/refresh", { refreshToken: viewer.refreshToken })
    viewer.accessToken = rf.body.accessToken
    viewer.refreshToken = rf.body.refreshToken
    expect((await viewer.get("/v1/me")).body.permissions).toContain("flight_request.read.any")
    expect((await viewer.get(`/v1/documents/${documentId}/download`)).status).toBe(404)
    await dbQuery("delete from user_roles where role_id = $1", [role!.id])
    await dbQuery("delete from role_permissions where role_id = $1", [role!.id])
    await dbQuery("delete from roles where id = $1", [role!.id])

    // Decisions: needs a reason and a message; a stale hash is a conflict; the customer sees code and message, never the reviewer.
    expect((await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "CORRECTION_REQUIRED", reviewHash: detail.body.reviewHash })).status).toBe(400)
    expect((await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "REJECTED", reviewHash: "f".repeat(64), reasonCode: "OTHER", reasonText: "x" })).status).toBe(409)
    const fix = await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "CORRECTION_REQUIRED", reviewHash: detail.body.reviewHash, reasonCode: "NAME_MISMATCH", reasonText: "The surname does not match the scan. Please check it." })
    expect(fix.status).toBe(200)
    let self = await mine(c)
    expect(self.verification.status).toBe("CORRECTION_REQUIRED")
    expect(self.verification.reason).toEqual({ code: "NAME_MISMATCH", text: "The surname does not match the scan. Please check it." })
    expect(JSON.stringify(self)).not.toMatch(/reviewer|X98765432/i)
    expect((await dbQuery("select 1 from verification_reviews where traveller_id = $1 and decision = 'CORRECTION_REQUIRED' and reason_code = 'NAME_MISMATCH'", [traveller.id])).length).toBe(1)
    const inbox = await until(() => c.get("/v1/notifications"), (r) => r.body.items?.some((n: { eventType: string }) => n.eventType === "identity.verification_correction"))
    expect(inbox.body.items.find((n: { eventType: string }) => n.eventType === "identity.verification_correction").body).toContain("surname does not match")
    // Insert-only: the review table refuses edits.
    await expect(dbQuery("update verification_reviews set reason_text = 'x' where traveller_id = $1", [traveller.id])).rejects.toThrow(/append-only/)

    // Resubmit: a Persian-name edit is not material and leaves the correction state alone; fixing the surname is, and clears the confirmation.
    const fa = await c.patch(`/v1/me/travellers/${traveller.id}`, { nameFa: "ندا ت" })
    expect(fa.body.verification.status).toBe("CORRECTION_REQUIRED")
    const edited = await c.patch(`/v1/me/travellers/${traveller.id}`, { surname: "Verifyme-Fixed" })
    expect(edited.body.verification).toMatchObject({ status: "CORRECTION_REQUIRED", confirmedAt: null })
    const resub = await c.post(`/v1/me/travellers/${traveller.id}/identity/confirm`, { reviewHash: edited.body.verification.reviewHash })
    expect(resub.body.verification.status).toBe("SUBMITTED")

    // The reviewer who loaded the older version gets a conflict; the fresh one verifies.
    expect((await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "VERIFIED", reviewHash: detail.body.reviewHash })).status).toBe(409)
    const fresh = await admin.get(`/v1/admin/verifications/${item.id}`)
    expect(fresh.body.history[0]).toMatchObject({ decision: "CORRECTION_REQUIRED", reasonCode: "NAME_MISMATCH" })
    const verified = await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "VERIFIED", reviewHash: fresh.body.reviewHash })
    expect(verified.status).toBe(200)
    self = await mine(c)
    expect(self.verification.status).toBe("VERIFIED")
    expect((await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "VERIFIED", reviewHash: fresh.body.reviewHash })).status).toBe(409)

    // Material changes send VERIFIED back to SUBMITTED; a Persian-name edit does not.
    expect((await c.patch(`/v1/me/travellers/${traveller.id}`, { nameFa: "ندا تست" })).body.verification.status).toBe("VERIFIED")
    expect((await c.patch(`/v1/me/travellers/${traveller.id}`, { title: "MRS" })).body.verification.status).toBe("VERIFIED")
    const expiry = await c.patch(`/v1/me/travellers/${traveller.id}`, { document: { number: "X98765432", issuingCountry: "IR", expiryDate: "2032-01-01" } })
    expect(expiry.body.verification.status).toBe("SUBMITTED")

    // A replaced scan is material too, and the old scan is deleted.
    const queue2 = await admin.get("/v1/admin/verifications")
    const again = queue2.body.find((x: { travellerId: string }) => x.travellerId === traveller.id)
    const d2 = await admin.get(`/v1/admin/verifications/${again.id}`)
    expect((await admin.post(`/v1/admin/verifications/${again.id}/decide`, { decision: "VERIFIED", reviewHash: d2.body.reviewHash })).status).toBe(200)
    const second = await uploadScan(c, scanBytes("GPS-SECOND"))
    expect((await scanStatus(c, second.documentId!)).body.scanStatus).toBe("CLEAN")
    const replaced = await c.post(`/v1/me/travellers/${traveller.id}/identity/scan`, { documentId: second.documentId })
    expect(replaced.body.verification.status).toBe("SUBMITTED")
    expect((await dbQuery<{ erased_at: string | null }>("select erased_at from documents where id = $1", [documentId]))[0]!.erased_at).not.toBeNull()
    expect((await admin.get(`/v1/documents/${documentId}/download`)).status).toBe(404)
  })

  it("record_tickets needs VERIFIED travellers; quote acceptance does not", async () => {
    const { c, traveller } = await customerWithPassport("Ticketguard")
    const { documentId } = await uploadScan(c)
    await scanStatus(c, documentId!)
    const att = await c.post(`/v1/me/travellers/${traveller.id}/identity/scan`, { documentId })
    const conf = await c.post(`/v1/me/travellers/${traveller.id}/identity/confirm`, { reviewHash: att.body.verification.reviewHash })
    expect(conf.body.verification.status).toBe("SUBMITTED")
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)

    const me = (await c.get("/v1/me")).body
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const submit = await c.post("/v1/flight-requests", {
      kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: traveller.id, passengerType: "ADT" }],
      query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
      manual: { flexibility: "Any day", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] }, seatPreference: "WINDOW", acknowledgements: { notABooking: true, privacy: true },
    })
    expect(submit.status).toBe(201)
    const ref = submit.body.ref as string
    await until(() => c.get(`/v1/flight-requests/${ref}`), (x) => x.body.status === "NEW")
    let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
    const mk = (n: string, f: string, t: string) => ({ marketing: { carrier: "BA", flightNumber: n }, operating: { carrier: "BA", flightNumber: n }, origin: { iata: f, terminal: "1" }, destination: { iata: t, terminal: "2" }, departure: { local: "2026-12-14T13:50", utc: "2026-12-14T10:50:00Z", tz: "Europe/Istanbul" }, arrival: { local: "2026-12-14T15:35", utc: "2026-12-14T15:35:00Z", tz: "Europe/London" }, cabin: "ECONOMY", technicalStops: [] })
    const slices = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [mk("675", "IST", "LHR")] }]
    const opt = { label: "Economy", source: "MANUAL", slices, components: [], priceBreakdown: { fare: GBP(36000), taxes: GBP(5000), serviceFee: GBP(500), total: GBP(41500) }, baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }], conditions: { change: { status: "KNOWN", value: { allowed: true } }, refund: { status: "KNOWN", value: { allowed: true } } }, ticketingModel: "SINGLE_TICKET" }
    const draft = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [opt] })
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draft.body.id }, { "if-match": String(d.body.version) })
    const q = (await c.get(`/v1/flight-requests/${ref}`)).body.quotes[0]
    // Not blocked: the traveller is only SUBMITTED, the customer can still accept.
    const acc = await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id }, { "idempotency-key": randomUUID() })
    expect(acc.body.status).toBe("ACCEPTED")
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { system: "AMADEUS_TERMINAL", recordLocator: "V8Q2ZP", ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [traveller.id], slices }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("RESERVED")

    const body = () => ({ reservationId: d.body.reservations[0].id, tickets: [{ travellerId: traveller.id, ticketNumber: `125${String(Date.now()).slice(-10)}`, validatingCarrier: "BA", issueDate: "2026-10-22", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: "BANK-REF-V8", payerName: "Neda Ticketguard" } })
    const blocked = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, body(), { "if-match": String(d.body.version), "idempotency-key": randomUUID() })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe("IDENTITY_NOT_VERIFIED")
    expect((await admin.get(`/v1/admin/flight-requests/${ref}`)).body.status).toBe("RESERVED")
    const actions = (await admin.get(`/v1/admin/flight-requests/${ref}`)).body.actions as { command: string; allowed: boolean; reason?: string }[]
    expect(actions.find((a) => a.command === "record_tickets")?.reason ?? "").toMatch(/VERIFIED/)

    const queue = await admin.get("/v1/admin/verifications")
    const item = queue.body.find((x: { travellerId: string }) => x.travellerId === traveller.id)
    const det = await admin.get(`/v1/admin/verifications/${item.id}`)
    expect((await admin.post(`/v1/admin/verifications/${item.id}/decide`, { decision: "VERIFIED", reviewHash: det.body.reviewHash })).status).toBe(200)
    const ok = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, body(), { "if-match": String(d.body.version), "idempotency-key": randomUUID() })
    expect(ok.status).toBe(201)
    expect(ok.body.status).toBe("TICKETED")
  })
})
