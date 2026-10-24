import { randomUUID } from "node:crypto"

import { Queue } from "bullmq"
import { afterAll, describe, expect, it } from "vitest"

import { endOfLondonDay } from "@unitravel/domain"

import { receivedShipment } from "./cargo-fixture"
import { ADMIN_HOST, API, dbQuery, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "./client"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}

const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6390")
const connection = { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined }
const timers = new Queue("timers.sla", { connection })
const maintenance = new Queue("maintenance", { connection })
afterAll(async () => { await timers.close(); await maintenance.close() })

const MAILPIT = "http://localhost:8035"
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })

/** Adds and verifies an email through the real flow (code read from Mailpit). */
async function addVerifiedEmail(c: Session): Promise<string> {
  const email = `phasec-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  const add = await c.post("/v1/me/identities", { type: "EMAIL", value: email, deviceId: c.deviceId })
  expect(add.status).toBe(202)
  const msg = await mailTo(email)
  const code = /(\d{6})/.exec(msg.Text)![1]!
  expect((await c.post("/v1/auth/otp/verify", { challengeId: add.body.challengeId, code, deviceId: c.deviceId, client: c.client })).status).toBe(200)
  return email
}

interface Mail { ID: string; Subject: string; Text: string }
/** The n-th message (oldest first) to an address, waiting for it to arrive. */
async function mailTo(email: string, n = 1): Promise<Mail> {
  const found = await until(async () => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string; Created: string }[] }, (r) => (r.messages?.length ?? 0) >= n)
  const sorted = [...found.messages!].sort((a, b) => a.Created.localeCompare(b.Created))
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${sorted[n - 1]!.ID}`)).json() as { ID: string; Subject: string; Text: string }
  return { ID: full.ID, Subject: full.Subject, Text: full.Text }
}

const shortCode = (text: string) => /\/s\/([A-Za-z0-9]{4,12})/.exec(text)![1]!

describe("Phase C — quotations and invoices (ADR-0006; booklet ch. 13.6, 13.7, 14.9, 17, 27.6)", () => {
  it("cargo: quotation number and email → draft → issue → email with a sign-in-protected link → own-only view → trigger-frozen amounts → cancel → reissue → expiry", async () => {
    const { c, admin: cargoStaff, ref } = await receivedShipment()
    const email = await addVerifiedEmail(c)
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)

    // The sent quote is the quotation: it was numbered and PDF'd when it was sent (before the email existed, so the bill list shows it).
    const billing0 = (await c.get("/v1/billing/documents")).body
    expect(billing0.invoices).toEqual([])
    const quotation = billing0.quotations.find((q: { requestRef: string }) => q.requestRef === ref)
    expect(quotation).toMatchObject({ productType: "CARGO", status: "ACCEPTED" })
    expect(quotation.number).toMatch(/^QT-\d{4}-\d{6}$/)
    expect(quotation.documentId).toBeTruthy()
    expect(JSON.stringify(billing0.quotations)).not.toMatch(/amountMinor/)
    expect((await c.get(`/v1/documents/${quotation.documentId}/download`)).status).toBe(200)

    // Drafts: server-built from the accepted quote; cargo staff may read but cannot create; the customer cannot see a draft.
    expect((await cargoStaff.post(`/v1/admin/requests/${ref}/invoices`)).status).toBe(403)
    expect((await c.post(`/v1/admin/requests/${ref}/invoices`)).status).toBe(403)
    const draft = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    expect(draft.status).toBe(201)
    expect(draft.body).toMatchObject({ status: "DRAFT", number: null, total: GBP(5000), productType: "CARGO" })
    expect(draft.body.lines.reduce((s: number, l: { amount: { amountMinor: number } }) => s + l.amount.amountMinor, 0)).toBe(5000)
    expect(draft.body.actions.map((a: { command: string; allowed: boolean }) => [a.command, a.allowed])).toEqual([["issue", true], ["cancel", true]])
    expect((await admin.post(`/v1/admin/requests/${ref}/invoices`)).status).toBe(409)
    expect((await c.get("/v1/billing/documents")).body.invoices).toEqual([])
    // Cargo staff see the invoice without its amounts (no pricing.read.internal).
    const hidden = (await cargoStaff.get(`/v1/admin/invoices/${draft.body.id}`)).body
    expect(hidden.total).toBeNull()
    expect(hidden.lines.every((l: { amount: unknown }) => l.amount === null)).toBe(true)

    // Issue: number, expiry, PDF, history, audit.
    expect((await cargoStaff.post(`/v1/admin/invoices/${draft.body.id}/issue`)).status).toBe(403)
    const issued = await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)
    expect(issued.status).toBe(200)
    const number: string = issued.body.number
    expect(number).toMatch(/^INV-\d{4}-\d{6}$/)
    expect(issued.body).toMatchObject({ status: "ISSUED", total: GBP(5000) })
    expect(Date.parse(issued.body.expiresAt) - Date.parse(issued.body.issuedAt)).toBe(14 * 86400_000)
    expect(issued.body.documentId).toBeTruthy()
    expect(issued.body.history.map((h: { command: string; toStatus: string }) => `${h.command}:${h.toStatus}`)).toEqual(["create:DRAFT", "issue:ISSUED"])
    expect((await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)).status).toBe(409)
    const pdf = await c.get(`/v1/documents/${issued.body.documentId}/download`)
    expect(pdf.status).toBe(200)
    // Delayed expiry job exists under an id without ':' (BullMQ rejects it).
    expect(await until(() => timers.getJob(`inv-${draft.body.id}--invoice.expire`), (j) => !!j)).toBeTruthy()

    // Email through the notification system, with a short link; opening it needs a sign-in.
    const mail = await until(async () => { const m = await mailTo(email, 2); return m }, (m) => m.Subject.includes(number))
    expect(mail.Subject).toContain(number)
    const link = shortCode(mail.Text)
    expect(mail.Text).not.toMatch(/5000|50\.00/) // no amount in the mailbox
    const resolved = await (await fetch(`${API}/v1/s/${link}`)).json() as { target: string }
    expect(resolved.target).toBe(`/billing/${number}`)
    expect((await new Session("WEB").get(`/v1/billing/invoices/${number}`)).status).toBe(401)

    // Own-only: the owner reads it; another customer gets 404 on the invoice and on the PDF.
    const mine = await c.get(`/v1/billing/invoices/${number}`)
    expect(mine.status).toBe(200)
    expect(mine.body).toMatchObject({ number, status: "ISSUED", total: GBP(5000), requestRef: ref })
    expect(JSON.stringify(mine.body)).not.toMatch(/createdBy|customerUserId|quoteId|reason_text|history/)
    const other = new Session("MOBILE")
    await signIn(other, randomPhone("+98912"))
    expect((await other.get(`/v1/billing/invoices/${number}`)).status).toBe(404)
    expect((await other.get(`/v1/documents/${issued.body.documentId}/download`)).status).toBe(404)
    expect((await other.get("/v1/billing/documents")).body).toEqual({ quotations: [], invoices: [] })
    expect((await c.get("/v1/billing/invoices/INV-2026-999999")).status).toBe(404)

    // Amounts are fixed at issue: even the table owner cannot change them; lines are frozen too.
    await expect(dbQuery("update invoices set total_minor = 1 where id = $1", [draft.body.id])).rejects.toThrow(/amounts are fixed/)
    await expect(dbQuery("update invoice_lines set amount_minor = 1 where invoice_id = $1", [draft.body.id])).rejects.toThrow(/fixed once the invoice is issued/)
    await expect(dbQuery("delete from invoice_status_history where invoice_id = $1", [draft.body.id])).rejects.toThrow()

    // Cancel: needs a reason; a second cancel is refused; the customer is told; the audit log has it.
    expect((await admin.post(`/v1/admin/invoices/${draft.body.id}/cancel`, { reasonCode: "OTHER" })).status).toBe(400)
    expect((await cargoStaff.post(`/v1/admin/invoices/${draft.body.id}/cancel`, { reasonCode: "CORRECTION" })).status).toBe(403)
    const cancelled = await admin.post(`/v1/admin/invoices/${draft.body.id}/cancel`, { reasonCode: "CORRECTION", note: "Wrong consignee name" })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body).toMatchObject({ status: "CANCELLED", cancelReason: "CORRECTION" })
    expect(cancelled.body.history.at(-1)).toMatchObject({ command: "cancel", toStatus: "CANCELLED", reasonCode: "CORRECTION", reasonText: "Wrong consignee name", actorKind: "STAFF" })
    expect((await admin.post(`/v1/admin/invoices/${draft.body.id}/cancel`, { reasonCode: "DUPLICATE" })).status).toBe(409)
    const seen = (await c.get(`/v1/billing/invoices/${number}`)).body
    expect(seen).toMatchObject({ status: "CANCELLED", cancelReason: "CORRECTION" })
    expect(JSON.stringify(seen)).not.toContain("Wrong consignee name") // the internal note stays internal
    const cancelMail = await until(async () => mailTo(email, 3), (m) => m.Subject.includes("cancelled"))
    expect(cancelMail.Subject).toContain(number)
    const trail = await dbQuery<{ action: string }>("select action from audit_log where entity_id = $1 order by occurred_at", [draft.body.id])
    expect(trail.map((a) => a.action)).toEqual(["invoice.draft_created", "invoice.issued", "invoice.cancelled"])

    // Correction = cancel + reissue: a new draft, a new number; the cancelled invoice stays on record.
    const second = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    expect(second.status).toBe(201)
    const reissued = (await admin.post(`/v1/admin/invoices/${second.body.id}/issue`)).body
    expect(reissued.number).not.toBe(number)
    expect(reissued.number > number).toBe(true)
    const all = (await c.get("/v1/billing/documents")).body.invoices.map((i: { number: string; status: string }) => `${i.number}:${i.status}`)
    expect(all).toEqual(expect.arrayContaining([`${number}:CANCELLED`, `${reissued.number}:ISSUED`]))

    // Expiry: the system cancels an overdue ISSUED invoice with reason EXPIRED and tells the customer.
    await dbQuery("update invoices set expires_at = now() - interval '1 minute' where id = $1", [second.body.id])
    await maintenance.add("invoices.expire-due", {})
    const expired = await until(() => admin.get(`/v1/admin/invoices/${second.body.id}`), (r) => r.body.status === "CANCELLED")
    expect(expired.body).toMatchObject({ status: "CANCELLED", cancelReason: "EXPIRED" })
    expect(expired.body.history.at(-1)).toMatchObject({ command: "expire", actorKind: "SYSTEM", reasonCode: "EXPIRED" })
    expect((await c.get(`/v1/billing/invoices/${reissued.number}`)).body).toMatchObject({ status: "CANCELLED", cancelReason: "EXPIRED" })
    const expMail = await until(async () => mailTo(email, 5), (m) => m.Subject.includes("expired"))
    expect(expMail.Subject).toContain(reissued.number)
    const expAudit = await dbQuery("select 1 from audit_log where entity_id = $1 and action = 'invoice.expired' and actor_kind = 'SYSTEM'", [second.body.id])
    expect(expAudit).toHaveLength(1)
    // A third invoice is possible after the expiry (the open-invoice-per-quote rule only blocks live ones).
    expect((await admin.post(`/v1/admin/requests/${ref}/invoices`)).status).toBe(201)

    // The Admin Panel list shows it, newest first, with amounts for pricing.read.internal.
    const list = (await admin.get("/v1/admin/invoices?limit=20")).body as { number: string | null; total: unknown }[]
    expect(list.some((i) => i.number === reissued.number && i.total !== null)).toBe(true)
    expect((await admin.get("/v1/admin/invoices?status=NOPE")).status).toBe(400)
    const forRequest = (await admin.get(`/v1/admin/requests/${ref}/invoices`)).body
    expect(forRequest.length).toBeGreaterThanOrEqual(3)
  })

  it("without a verified email the customer is told by SMS and in-app (decision 6)", async () => {
    const { c, ref } = await receivedShipment()
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    const since = Date.now() - 2000
    const draft = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    const issued = (await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)).body
    const sms = await until(async () => (await (await fetch(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string; at: string }[], (l) => l.some((m) => m.body.includes(issued.number)))
    const hit = sms.find((m) => m.body.includes(issued.number) && Date.parse(m.at) >= since)
    expect(hit?.body).toMatch(/\/s\/[A-Za-z0-9]+/)
    expect(hit?.body).not.toMatch(/5000|50\.00/)
    const inbox = (await c.get("/v1/notifications")).body.items as { eventType: string; title: string }[]
    expect(inbox.some((n) => n.eventType === "invoice.issued" && n.title.includes(issued.number))).toBe(true)
  })

  it("flight under PAY_ON_TICKETING: a draft is possible, issuing waits for ticketing the same Europe/London day, then expires at the end of that day; a verified payment settles it", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: "Invoice" })
    const me = (await c.get("/v1/me")).body
    const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: "Invoice", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
    await markVerifiedForTest(t.body.id)
    const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
    const sub = await c.post("/v1/flight-requests", {
      kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
      query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
      manual: { flexibility: "Any day", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] }, seatPreference: "WINDOW", bestTimeToCall: "10:00-14:00 Tehran", note: "Phase C", acknowledgements: { notABooking: true, privacy: true },
    }, { "idempotency-key": randomUUID() })
    expect(sub.status).toBe(201)
    const ref: string = sub.body.ref
    await until(() => c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
    const admin = await staffSession(STAFF.admin, ADMIN_HOST)
    let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
    const seg = { marketing: { carrier: "BA", flightNumber: "675" }, operating: { carrier: "BA", flightNumber: "675" }, origin: { iata: "IST", terminal: "1" }, destination: { iata: "LHR", terminal: "2" }, departure: { local: "2026-12-14T13:50", utc: "2026-12-14T10:50:00Z", tz: "Europe/Istanbul" }, arrival: { local: "2026-12-14T15:35", utc: "2026-12-14T15:35:00Z", tz: "Europe/London" }, cabin: "ECONOMY", technicalStops: [] }
    const slices = [{ origin: "IST", destination: "LHR", durationMin: 285, segments: [seg] }]
    const draftQuote = await admin.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [{
      label: "BA via Istanbul", source: "MANUAL", slices, components: [], priceBreakdown: { fare: GBP(30000), taxes: GBP(9000), serviceFee: GBP(2500), total: GBP(41500) },
      baggage: [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "KNOWN", value: { pieces: 1, kgPerPiece: 23 } }, cabin: { status: "KNOWN", value: true } }],
      conditions: { change: { status: "KNOWN", value: { allowed: true, penalty: GBP(5000) } }, refund: { status: "KNOWN", value: { allowed: false } } }, ticketingModel: "SINGLE_TICKET", internalCostMinor: 38000,
    }] })
    // No invoice before there is an accepted quote.
    expect((await admin.post(`/v1/admin/requests/${ref}/invoices`)).status).toBe(409)
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/commands/send_quote`, { quoteId: draftQuote.body.id }, { "if-match": String(d.body.version) })
    const cv = await c.get(`/v1/flight-requests/${ref}`)
    const q = cv.body.quotes[0]
    expect((await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id }, { "idempotency-key": randomUUID() })).body.status).toBe("ACCEPTED")
    const quoteNo = (await c.get("/v1/billing/documents")).body.quotations.find((x: { requestRef: string }) => x.requestRef === ref)
    expect(quoteNo.number).toMatch(/^QT-\d{4}-\d{6}$/)
    expect(quoteNo.documentId).toBeTruthy()
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    d = await admin.post(`/v1/admin/flight-requests/${ref}/reservations`, { system: "AMADEUS_TERMINAL", recordLocator: "K7Q2ZP", ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [t.body.id], slices }, { "if-match": String(d.body.version) })
    expect(d.body.status).toBe("RESERVED")

    const draft = await admin.post(`/v1/admin/requests/${ref}/invoices`)
    expect(draft.status).toBe(201)
    expect(draft.body).toMatchObject({ status: "DRAFT", total: GBP(41500) })
    expect(draft.body.lines.map((l: { amount: { amountMinor: number } }) => l.amount.amountMinor)).toEqual([30000, 9000, 2500])
    // The guard: not before ticketing; the action list says why.
    const issueAction = draft.body.actions.find((a: { command: string }) => a.command === "issue")
    expect(issueAction.allowed).toBe(false)
    expect(issueAction.reason).toMatch(/PAY_ON_TICKETING/)
    const early = await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)
    expect(early.status).toBe(409)
    expect(early.body.code).toBe("INVALID_TRANSITION")
    expect(early.body.detail).toMatch(/PAY_ON_TICKETING/)

    // Ticketing with the payment in the same step (booklet 27.6).
    const ticketNo = `125${String(Date.now()).slice(-10)}`
    d = await admin.get(`/v1/admin/flight-requests/${ref}`)
    const tk = await admin.post(`/v1/admin/flight-requests/${ref}/tickets`, { reservationId: d.body.reservations[0].id, tickets: [{ travellerId: t.body.id, ticketNumber: ticketNo, validatingCarrier: "BA", issueDate: "2026-10-24", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: "BANK-C-1", payerName: "Neda Invoice" } }, { "if-match": String(d.body.version), "idempotency-key": randomUUID() })
    expect(tk.status).toBe(201)

    // Tickets recorded on an earlier London day: the same-day window has passed, the guard refuses (simulated by moving the ticket record back).
    await dbQuery("update tickets set created_at = created_at - interval '2 days' where ticket_number = $1", [ticketNo])
    const late = await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)
    expect(late.status).toBe(409)
    expect(late.body.detail).toMatch(/earlier day/)
    await dbQuery("update tickets set created_at = created_at + interval '2 days' where ticket_number = $1", [ticketNo])

    // Same London day as the tickets: allowed. The verified payment covers the total, so the invoice is issued as PAID.
    const issued = await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe("PAID")
    expect(issued.body.history.map((h: { command: string }) => h.command)).toEqual(["create", "issue", "mark_paid"])
    expect(issued.body.history.at(-1)).toMatchObject({ actorKind: "SYSTEM", reasonText: "Payment already verified for this request" })
    expect(issued.body.paidAt).toBeTruthy()
    // It expires at the end of the Europe/London day it was issued on.
    expect(issued.body.expiresAt).toBe(endOfLondonDay(new Date(issued.body.issuedAt)).toISOString())
    const mine = (await c.get(`/v1/billing/invoices/${issued.body.number}`)).body
    expect(mine).toMatchObject({ status: "PAID", total: GBP(41500) })
    expect(mine.lines).toHaveLength(3)
    // A paid invoice cannot be cancelled, and a paid quote is not billed twice.
    expect((await admin.post(`/v1/admin/invoices/${draft.body.id}/cancel`, { reasonCode: "CORRECTION" })).status).toBe(409)
    expect((await admin.post(`/v1/admin/requests/${ref}/invoices`)).status).toBe(409)
  })

  it("numbers are gap-free and unique under concurrency, and a rolled-back allocation releases its number", async () => {
    const { Client } = await import("pg")
    const url = process.env.DATABASE_MIGRATE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel"
    const year = 2090 + Math.floor(Math.random() * 900)
    const claim = async (i: number) => {
      const cl = new Client({ connectionString: url })
      await cl.connect()
      try {
        await cl.query("begin")
        const r = await cl.query("insert into document_sequences (kind, year, last_value) values ('INVOICE', $1, 1) on conflict (kind, year) do update set last_value = document_sequences.last_value + 1 returning last_value", [year])
        const n = r.rows[0].last_value as number
        if (i % 4 === 3) { await cl.query("rollback"); return null }
        await cl.query("commit")
        return n
      } finally { await cl.end() }
    }
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => claim(i)))
    const taken = results.filter((n): n is number => n !== null).sort((a, b) => a - b)
    expect(new Set(taken).size).toBe(taken.length)
    expect(taken).toEqual(Array.from({ length: taken.length }, (_, i) => i + 1))
    expect((await dbQuery<{ last_value: number }>("select last_value from document_sequences where kind = 'INVOICE' and year = $1", [year]))[0]!.last_value).toBe(taken.length)
    await dbQuery("delete from document_sequences where year = $1", [year])
  })
})
