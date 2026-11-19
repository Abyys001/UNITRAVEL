import { createHash, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ADMIN_HOST, dbQuery, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "./client"
import { makeTicketPdf } from "./fixtures/ticket-pdf"

/** ADR-0038: upload → scan → draft → preview → issue → email with both files → customer views → resend → replace → supersede. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const MAILPIT = "http://localhost:8035"
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const idem = () => ({ "idempotency-key": randomUUID() })

interface MailSummary { ID: string; Subject: string; Created: string }
interface Mail { ID: string; Subject: string; Text: string; Attachments: { FileName: string; ContentType: string; PartID: string; Size: number }[] }
async function mails(to: string): Promise<MailSummary[]> {
  const r = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages?: MailSummary[] }
  return [...(r.messages ?? [])].sort((a, b) => a.Created.localeCompare(b.Created))
}
async function mailWhere(to: string, ok: (m: MailSummary) => boolean, n = 1): Promise<Mail[]> {
  const found = await until(() => mails(to), (l) => l.filter(ok).length >= n)
  return Promise.all(found.filter(ok).map(async (m) => (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as Mail))
}
const part = async (id: string, partId: string) => Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${id}/part/${partId}`)).arrayBuffer())

async function addVerifiedEmail(c: Session): Promise<string> {
  const email = `tickets-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  const add = await c.post("/v1/me/identities", { type: "EMAIL", value: email, deviceId: c.deviceId })
  expect(add.status).toBe(202)
  const [msg] = await mailWhere(email, () => true)
  const code = /(\d{6})/.exec(msg!.Text)![1]!
  expect((await c.post("/v1/auth/otp/verify", { challengeId: add.body.challengeId, code, deviceId: c.deviceId, client: c.client })).status).toBe(200)
  return email
}

/** A request with an accepted option and no records yet: the wizard records them (D5). */
async function acceptedRequest() {
  const c = new Session("WEB")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: "Ticket" })
  const email = await addVerifiedEmail(c)
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: "Ticket", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  await markVerifiedForTest(t.body.id)
  const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
  const sub = await c.post("/v1/flight-requests", {
    kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
    query: { tripType: "ONE_WAY", slices: [{ from: { city: "IST" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
    manual: { flexibility: "Any day", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] }, seatPreference: "WINDOW", bestTimeToCall: "10:00-14:00 Tehran", note: "ADR-0038", acknowledgements: { notABooking: true, privacy: true },
  }, idem())
  expect(sub.status).toBe(201)
  const ref: string = sub.body.ref
  await until(() => c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
  const admin = await staffSession(STAFF.admin, ADMIN_HOST)
  let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
  d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
  const seg = { marketing: { carrier: "BA", flightNumber: "675" }, operating: { carrier: "BA", flightNumber: "675" }, origin: { iata: "IST", terminal: "1" }, destination: { iata: "LHR", terminal: "2" }, departure: { local: "2026-12-14T13:50", utc: "2026-12-14T10:50:00Z", tz: "Europe/Istanbul" }, arrival: { local: "2026-12-14T15:35", utc: "2026-12-14T15:35:00Z", tz: "Europe/London" }, cabin: "ECONOMY", technicalStops: [] }
  const slices = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg] }]
  const quote = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [{
    label: "BA direct", source: "MANUAL", slices, components: [], priceBreakdown: { fare: GBP(30000), taxes: GBP(9000), serviceFee: GBP(2500), total: GBP(41500) },
    baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }],
    conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } }, ticketingModel: "SINGLE_TICKET", internalCostMinor: 38000,
  }] })
  d = await admin.get(`/v1/admin/flight-requests/${ref}`)
  await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: quote.body.id }, { "if-match": String(d.body.version) })
  const q = (await c.get(`/v1/flight-requests/${ref}`)).body.quotes[0]
  expect((await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id }, idem())).body.status).toBe("ACCEPTED")
  return { c, email, admin, ref, travellerId: t.body.id as string, optionId: q.options[0].id as string, slices }
}

async function uploadOriginal(admin: Session, ref: string, pdf: Buffer, opts: { tryOverwrite?: boolean } = {}) {
  const s = await admin.post("/v1/admin/ticket-documents/uploads", { requestRef: ref, filename: "airline-ticket.pdf", mime: "application/pdf", size: pdf.length })
  expect(s.status).toBe(201)
  expect(s.body.headers).toMatchObject({ "content-type": "application/pdf", "if-none-match": "*" })
  const put = await fetch(s.body.uploadUrl, { method: "PUT", headers: s.body.headers, body: pdf })
  expect(put.status).toBe(200)
  if (opts.tryOverwrite) {
    // D2: the original is write-once; the same signed URL cannot replace it.
    const again = await fetch(s.body.uploadUrl, { method: "PUT", headers: s.body.headers, body: pdf })
    expect(again.status).toBe(412)
  }
  expect((await admin.post(`/v1/admin/ticket-documents/uploads/${s.body.documentId}/complete`)).status).toBe(200)
  const st = await until(() => admin.get(`/v1/admin/ticket-documents/uploads/${s.body.documentId}`), (r) => r.body.scanStatus !== "PENDING")
  expect(st.body.scanStatus).toBe("CLEAN")
  return s.body.documentId as string
}

describe("issued ticket documents (ADR-0038)", () => {
  it("upload → scan → draft → preview → issue → email with both files → customer views → resend → replace → supersede; others get 404", async () => {
    const { c, email, admin, ref, travellerId, optionId, slices } = await acceptedRequest()
    const pnr = `T${String(Date.now()).slice(-5)}`
    const ticketNumber = `125${String(Date.now()).slice(-10)}`
    const pdf = await makeTicketPdf({ pnr, passengers: [{ name: "TICKET/NEDA MS", ticketNumber }], flight: { carrier: "BA", number: "675", from: "IST", to: "LHR", date: "2026-12-14" } })

    // A customer cannot open the staff surface, nor mint ticket files through the generic upload.
    expect((await c.post("/v1/admin/ticket-documents/uploads", { requestRef: ref, filename: "x.pdf", mime: "application/pdf", size: 10 })).status).toBe(403)
    expect((await c.post("/v1/uploads", { filename: "x.pdf", mime: "application/pdf", size: 10, type: "TICKET_ORIGINAL" })).status).toBe(400)
    // PDF only for originals.
    expect((await admin.post("/v1/admin/ticket-documents/uploads", { requestRef: ref, filename: "x.png", mime: "image/png", size: 10 })).status).toBe(400)

    const originalId = await uploadOriginal(admin, ref, pdf, { tryOverwrite: true })
    const passengerEmail = `passenger-${Date.now()}@example.test`
    const draft = await admin.post("/v1/admin/ticket-documents", {
      requestRef: ref, originalDocumentId: originalId, kind: "BOARDING_PASS", travellerIds: [travellerId], notes: "Check-in closes 60 minutes before departure.", passengerEmail,
      records: {
        reservation: { system: "AMADEUS_TERMINAL", recordLocator: pnr, ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: optionId, travellerIds: [travellerId], slices },
        tickets: { tickets: [{ travellerId, ticketNumber, validatingCarrier: "BA", issueDate: "2026-11-19", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: `BANK-${pnr}`, payerName: "Neda Ticket" } },
      },
    }, idem())
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const id: string = draft.body.id
    expect(draft.body).toMatchObject({ status: "DRAFT", version: 1, kind: "BOARDING_PASS", pnr, wrapperMode: "FULL", allMatched: true, textWarnings: false, recordsComplete: false, pendingRecords: true, passengerEmailOnFile: true })
    expect(draft.body.verification.codesOriginal.map((x: { format: string }) => x.format).sort()).toEqual(["Code128", "PDF417", "QRCode"])
    expect(draft.body.verification.missing).toEqual([])
    expect(draft.body.commands.filter((x: { allowed: boolean }) => x.allowed).map((x: { command: string }) => x.command)).toEqual(["issue", "revoke"])
    // The staff search shows the last delivery; a draft has none yet.
    expect((await admin.get(`/v1/admin/ticket-documents?requestRef=${ref}`)).body.items.find((x: { id: string }) => x.id === id)).toMatchObject({ lastDelivery: null })
    // The wizard lists one customer's requests through the server-side filter (staff permission unchanged).
    const [owner] = await dbQuery<{ customer_user_id: string }>("select customer_user_id from flight_requests where ref = $1", [ref])
    const mine = await admin.get(`/v1/admin/flight-requests?customerUserId=${owner!.customer_user_id}&limit=100`)
    expect(mine.status).toBe(200)
    expect(mine.body.items.map((x: { ref: string }) => x.ref)).toEqual([ref])
    expect((await admin.get(`/v1/admin/flight-requests?customerUserId=${randomUUID()}`)).body.items).toEqual([])
    expect((await admin.get("/v1/admin/flight-requests?customerUserId=not-a-uuid")).status).toBe(400)
    expect((await c.get(`/v1/admin/flight-requests?customerUserId=${owner!.customer_user_id}`)).status).toBe(403)
    // A draft is invisible to the customer.
    expect((await c.get(`/v1/ticket-documents/${id}`)).status).toBe(404)
    expect((await c.get(`/v1/ticket-documents?requestRef=${ref}`)).body.items).toEqual([])

    const preview = await admin.get(`/v1/admin/ticket-documents/${id}/preview`)
    expect(preview.status).toBe(200)
    const previewOriginal = Buffer.from(await (await fetch(preview.body.original.url)).arrayBuffer())
    expect(sha(previewOriginal)).toBe(sha(pdf))
    const branded = Buffer.from(await (await fetch(preview.body.branded.url)).arrayBuffer())
    expect(branded.subarray(0, 5).toString()).toBe("%PDF-")
    // The original is embedded byte for byte in the branded file (FULL mode).
    expect(branded.includes(Buffer.from("/EmbeddedFile"))).toBe(true)

    const issued = await admin.post(`/v1/admin/ticket-documents/${id}/issue`, {}, idem())
    expect(issued.status, JSON.stringify(issued.body)).toBe(200)
    expect(issued.body).toMatchObject({ status: "ISSUED", recordsComplete: true })
    expect((await admin.get(`/v1/admin/flight-requests/${ref}`)).body.status).toMatch(/TICKETED|RESERVED/)
    const [tk] = await dbQuery<{ document_id: string }>("select document_id from tickets where ticket_number = $1", [ticketNumber])
    expect(tk!.document_id).toBe(issued.body.brandedDocumentId)

    // D6: one email to the account holder with both files; the original attachment is the uploaded bytes. The passenger gets a copy.
    const isTicketMail = (m: MailSummary) => m.Subject.includes(ref) && /ticket|بلیت/i.test(m.Subject) && !/again|دوباره/.test(m.Subject)
    const [mail] = await mailWhere(email, isTicketMail)
    expect(mail!.Attachments.map((a) => a.ContentType)).toEqual(["application/pdf", "application/pdf"])
    const attached = await Promise.all(mail!.Attachments.map((a) => part(mail!.ID, a.PartID)))
    expect(attached.map(sha)).toContain(sha(pdf))
    const [copy] = await mailWhere(passengerEmail, () => true)
    expect(copy!.Attachments).toHaveLength(2)
    // The plain "tickets recorded" notice is not sent as well (the document email is the notice).
    await wait(2000)
    expect((await mails(email)).filter(isTicketMail)).toHaveLength(1)

    // Customer views: list, detail, both downloads (original byte-identical) and the code crop from the original page.
    const list = await c.get(`/v1/ticket-documents?requestRef=${ref}`)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).toMatchObject({ id, pnr, requestRef: ref, kind: "BOARDING_PASS", wrapperMode: "FULL", airlines: [{ code: "BA" }], passengers: [{ travellerId, ticketNumber }] })
    expect(list.body.items[0].segments[0]).toMatchObject({ carrier: "BA", flightNumber: "675", origin: "IST", destination: "LHR", departureLocal: "2026-12-14T13:50", arrivalLocal: "2026-12-14T15:35" })
    expect(list.body.items[0].codes).toHaveLength(3)
    const dl = await c.get(`/v1/ticket-documents/${id}/files/original`)
    const dlRes = await fetch(dl.body.url)
    expect(dlRes.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(sha(Buffer.from(await dlRes.arrayBuffer()))).toBe(sha(pdf))
    // The portal's "open" asks for inline; the store echoes it as the Content-Disposition header.
    const inline = await fetch((await c.get(`/v1/ticket-documents/${id}/files/original?disposition=inline`)).body.url)
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/)
    expect(sha(Buffer.from(await inline.arrayBuffer()))).toBe(sha(pdf))
    expect((await c.get(`/v1/ticket-documents/${id}/files/original?disposition=evil`)).status).toBe(400)
    expect((await c.get(`/v1/ticket-documents/${id}/files/branded`)).status).toBe(200)
    const crop = await c.get(`/v1/ticket-documents/${id}/codes/0`)
    expect(crop.status).toBe(200)
    expect(crop.headers.get("content-type")).toMatch(/^image\/png/)
    expect((await c.get(`/v1/ticket-documents/${id}/codes/9`)).status).toBe(404)
    const audit = await dbQuery<{ action: string }>("select action from audit_log where entity_type = 'ticket_document' and entity_id = $1", [id])
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ticket_document.drafted", "ticket_document.issued", "ticket_document.downloaded", "ticket_document.code_viewed"]))

    // Another customer: 404 everywhere.
    const other = new Session("WEB")
    await signIn(other, randomPhone("+98912"))
    for (const p of [`/v1/ticket-documents/${id}`, `/v1/ticket-documents/${id}/files/original`, `/v1/ticket-documents/${id}/files/branded`, `/v1/ticket-documents/${id}/codes/0`]) expect({ p, s: (await other.get(p)).status }).toEqual({ p, s: 404 })
    expect((await other.get("/v1/ticket-documents")).body.items).toEqual([])

    // Resend: same templates, resend wording, a delivery row linked to the version.
    expect((await admin.post(`/v1/admin/ticket-documents/${id}/resend`, { toAccount: true }, idem())).status).toBe(200)
    const [again] = await mailWhere(email, (m) => m.Subject.includes(ref) && /again|دوباره/.test(m.Subject))
    expect(again!.Attachments).toHaveLength(2)
    const detail = await until(() => admin.get(`/v1/admin/ticket-documents/${id}`), (r) => r.body.deliveries.filter((x: { status: string }) => x.status === "SENT").length >= 3)
    expect(detail.body.deliveries.map((x: { event: string; recipient: string }) => `${x.event}:${x.recipient}`).sort()).toEqual(expect.arrayContaining(["ticket.issued:ACCOUNT", "ticket.issued:PASSENGER", "ticket.resent:ACCOUNT"]))

    // Search finds it by PNR, ticket number, passenger and request.
    for (const qs of [`pnr=${pnr}`, `ticketNumber=${ticketNumber}`, "passenger=neda%20ticket", `q=${ref}`]) {
      const s = await admin.get(`/v1/admin/ticket-documents?${qs}`)
      expect({ qs, ids: s.body.items.map((x: { id: string }) => x.id) }).toEqual({ qs, ids: expect.arrayContaining([id]) })
    }
    // The summary carries the newest external send of the version (the resend), in one query with the page.
    const summary = (await admin.get(`/v1/admin/ticket-documents?requestRef=${ref}`)).body.items.find((x: { id: string }) => x.id === id)
    const newest = [...detail.body.deliveries].sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt))[0]
    expect(summary.lastDelivery).toMatchObject({ status: newest.status, channel: "EMAIL" })
    expect(Date.parse(summary.lastDelivery.at)).toBe(Date.parse(newest.deliveredAt ?? newest.sentAt ?? newest.createdAt))

    // Replace: a new provider file (reason required) → version 2 as a DRAFT; the customer keeps v1 until v2 is issued.
    const pdf2 = await makeTicketPdf({ pnr, passengers: [{ name: "TICKET/NEDA MS", ticketNumber }], flight: { carrier: "BA", number: "675", from: "IST", to: "LHR", date: "2026-12-14" }, payloadOverride: { qrcode: `NEW-SEAT-${pnr}` } })
    expect((await admin.post(`/v1/admin/ticket-documents/${id}/replace`, { originalDocumentId: originalId, reason: "x" })).status).toBe(400)
    const original2 = await uploadOriginal(admin, ref, pdf2)
    const v2 = await admin.post(`/v1/admin/ticket-documents/${id}/replace`, { originalDocumentId: original2, reason: "Seat changed by the airline" }, idem())
    expect(v2.status, JSON.stringify(v2.body)).toBe(201)
    expect(v2.body).toMatchObject({ status: "DRAFT", version: 2, supersedesId: id, chainId: issued.body.chainId, recordsComplete: true, reason: "Seat changed by the airline" })
    expect((await admin.get(`/v1/admin/ticket-documents/${id}`)).body.status).toBe("ISSUED")
    expect((await admin.post(`/v1/admin/ticket-documents/${v2.body.id}/issue`, {}, idem())).body.status).toBe("ISSUED")
    const old = (await admin.get(`/v1/admin/ticket-documents/${id}`)).body
    expect(old).toMatchObject({ status: "SUPERSEDED", supersededById: v2.body.id })
    expect(old.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(["1:SUPERSEDED", "2:ISSUED"])
    expect((await c.get(`/v1/ticket-documents/${id}`)).status).toBe(404)
    expect((await c.get(`/v1/ticket-documents?requestRef=${ref}`)).body.items.map((x: { id: string }) => x.id)).toEqual([v2.body.id])
    const [tk2] = await dbQuery<{ document_id: string }>("select document_id from tickets where ticket_number = $1", [ticketNumber])
    expect(tk2!.document_id).toBe(v2.body.brandedDocumentId)
    // Nothing leaves SUPERSEDED.
    expect((await admin.post(`/v1/admin/ticket-documents/${id}/revoke`, { reason: "Not needed any more" })).status).toBe(409)

    // Reissue from the same original → v3 DRAFT; revoking that draft leaves v2 issued.
    const v3 = await admin.post(`/v1/admin/ticket-documents/${v2.body.id}/reissue`, { reason: "Logo updated on the cover" }, idem())
    expect(v3.body).toMatchObject({ status: "DRAFT", version: 3, supersedesId: v2.body.id, originalDocumentId: original2 })
    expect((await admin.post(`/v1/admin/ticket-documents/${v3.body.id}/revoke`, { reason: "Drafted by mistake" })).body.status).toBe("REVOKED")
    expect((await admin.get(`/v1/admin/ticket-documents/${v2.body.id}`)).body.status).toBe("ISSUED")
  })

  it("a signed provider PDF is wrapped as the cover only; text that does not match needs an acknowledgement", async () => {
    const { admin, ref, travellerId, optionId, slices } = await acceptedRequest()
    const pdf = await makeTicketPdf({ signed: true, pnr: "ZZZ999", passengers: [{ name: "TICKET/NEDA MS", ticketNumber: "1250000000000" }] })
    const originalId = await uploadOriginal(admin, ref, pdf)
    const pnr = `S${String(Date.now()).slice(-5)}`
    const ticketNumber = `125${String(Date.now() + 7).slice(-10)}`
    const draft = await admin.post("/v1/admin/ticket-documents", {
      requestRef: ref, originalDocumentId: originalId, kind: "E_TICKET", travellerIds: [travellerId],
      records: {
        reservation: { system: "AMADEUS_TERMINAL", recordLocator: pnr, ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: optionId, travellerIds: [travellerId], slices },
        tickets: { tickets: [{ travellerId, ticketNumber, validatingCarrier: "BA", issueDate: "2026-11-19", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: `BANK-${pnr}`, payerName: "Neda Ticket" } },
      },
    }, idem())
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    expect(draft.body).toMatchObject({ wrapperMode: "COVER_ONLY", allMatched: true, textWarnings: true })
    expect(draft.body.verification).toMatchObject({ signed: true, wrapperReason: "SIGNED", codesBranded: [], textMatches: { pnr: { value: pnr, found: false } } })
    const refused = await admin.post(`/v1/admin/ticket-documents/${draft.body.id}/issue`, {}, idem())
    expect(refused.status).toBe(409)
    expect(refused.body.detail).toMatch(/text warnings/i)
    const ok = await admin.post(`/v1/admin/ticket-documents/${draft.body.id}/issue`, { acknowledgeTextWarnings: true }, idem())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe("ISSUED")
  })

  it("an infected upload (EICAR) is refused and cannot be drafted", async () => {
    const { admin, ref, travellerId } = await acceptedRequest()
    const eicar = Buffer.from("%PDF-1.4\n% X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n%%EOF\n", "latin1")
    const s = await admin.post("/v1/admin/ticket-documents/uploads", { requestRef: ref, filename: "infected.pdf", mime: "application/pdf", size: eicar.length })
    expect((await fetch(s.body.uploadUrl, { method: "PUT", headers: s.body.headers, body: eicar })).status).toBe(200)
    expect((await admin.post(`/v1/admin/ticket-documents/uploads/${s.body.documentId}/complete`)).status).toBe(200)
    const st = await until(() => admin.get(`/v1/admin/ticket-documents/uploads/${s.body.documentId}`), (r) => r.body.scanStatus !== "PENDING")
    expect(st.body.scanStatus).toBe("INFECTED")
    const draft = await admin.post("/v1/admin/ticket-documents", { requestRef: ref, originalDocumentId: s.body.documentId, kind: "E_TICKET", travellerIds: [travellerId] }, idem())
    expect(draft.status).toBeGreaterThanOrEqual(400)
    expect(draft.status).toBeLessThan(500)
  })
})
