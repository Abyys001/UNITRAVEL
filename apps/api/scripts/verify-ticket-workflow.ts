// ADR-0038 / STAGE-29 acceptance evidence: drives the running API (localhost:4100), Mailpit (8035) and the object store
// end to end, and checks the airline codes independently of the API's own check (pdf.js render + zxing-wasm decode here).
// Usage (from apps/api, stack running per docs/LOCAL-DEV.md):
//   node --experimental-transform-types scripts/verify-ticket-workflow.ts [evidence.json]
//   node --experimental-transform-types scripts/verify-ticket-workflow.ts --prepare <dir>   (an accepted request + fixture PDF for the console UI run)
// Prints one PASS/FAIL line per acceptance step; exits 1 if any step fails. Test data only (fixture PDFs, test phone ranges).
import { createHash, randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { createCanvas } from "@napi-rs/canvas"
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader"

import { ADMIN_HOST, dbQuery, markVerifiedForTest, randomPhone, Session, signIn, STAFF, staffSession } from "../test/client.ts"
import { makeTicketPdf, symbolPayloads } from "../test/fixtures/ticket-pdf.ts"

const MAILPIT = "http://localhost:8035"
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
const idem = () => ({ "idempotency-key": randomUUID() })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(300); v = await fn() }
  return v
}
const bytesOf = async (url: string) => { const r = await fetch(url); return { res: r, body: Buffer.from(await r.arrayBuffer()) } }

// ---------------- independent decode (not the API's code-integrity module) ----------------
const req = createRequire(import.meta.url)
const pdfjsDir = dirname(req.resolve("pdfjs-dist/package.json"))
let zx: Promise<unknown> | undefined
type Code = { format: string; bytesHex: string; text: string }
async function decodePdf(bytes: Uint8Array): Promise<Code[]> {
  zx ??= prepareZXingModule({ overrides: { wasmBinary: (await import("node:fs")).readFileSync(req.resolve("zxing-wasm/reader/zxing_reader.wasm")).buffer as ArrayBuffer }, fireImmediately: true })
  await zx
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = lib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0, standardFontDataUrl: join(pdfjsDir, "standard_fonts") + "/", wasmUrl: join(pdfjsDir, "wasm") + "/" })
  const doc = await task.promise
  const found = new Map<string, Code>()
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 3 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (const r of await readBarcodes(img as never, { formats: [], tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 64 })) {
        if (!r.isValid) continue
        const c = { format: r.format, bytesHex: Buffer.from(r.bytes).toString("hex"), text: r.text }
        found.set(`${c.format}:${c.bytesHex}`, c)
      }
    }
  } finally {
    await task.destroy()
  }
  return [...found.values()].sort((a, b) => a.format.localeCompare(b.format))
}
const codeSet = (cs: Code[]) => cs.map((c) => `${c.format}:${c.bytesHex}`).sort()

// ---------------- API flow helpers (mirrors test/ticket-documents.e2e.ts) ----------------
interface MailSummary { ID: string; Subject: string; Created: string }
interface Mail { ID: string; Subject: string; Text: string; Attachments: { FileName: string; ContentType: string; PartID: string }[] }
const mails = async (to: string) => ((await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages?: MailSummary[] }).messages ?? []
async function mailWhere(to: string, ok: (m: MailSummary) => boolean): Promise<Mail[]> {
  const found = await until(() => mails(to), (l) => l.some(ok))
  return Promise.all(found.filter(ok).map(async (m) => (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as Mail))
}
const part = async (id: string, partId: string) => Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${id}/part/${partId}`)).arrayBuffer())

async function customer() {
  const c = new Session("WEB")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: "Verify" })
  const email = `verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  const add = await c.post("/v1/me/identities", { type: "EMAIL", value: email, deviceId: c.deviceId })
  const [msg] = await mailWhere(email, () => true)
  await c.post("/v1/auth/otp/verify", { challengeId: add.body.challengeId, code: /(\d{6})/.exec(msg!.Text)![1], deviceId: c.deviceId, client: c.client })
  return { c, email }
}

async function acceptedRequest(c: Session, admin: Session) {
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: "Verify", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  await markVerifiedForTest(t.body.id)
  const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
  const sub = await c.post("/v1/flight-requests", {
    kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
    query: { tripType: "ONE_WAY", slices: [{ from: { city: "IST" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
    manual: { flexibility: "Any day", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] }, seatPreference: "WINDOW", bestTimeToCall: "10:00-14:00 Tehran", note: "STAGE-29 verification", acknowledgements: { notABooking: true, privacy: true },
  }, idem())
  if (sub.status !== 201) throw new Error(`request submit ${sub.status} ${JSON.stringify(sub.body)}`)
  const ref: string = sub.body.ref
  await until(() => c.get(`/v1/flight-requests/${ref}`), (r) => r.body.status === "NEW")
  let d = await admin.get(`/v1/admin/flight-requests/${ref}`)
  await admin.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(d.body.version) })
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
  await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id }, idem())
  return { ref, travellerId: t.body.id as string, optionId: q.options[0].id as string, slices, customerUserId: me.id as string }
}

async function upload(admin: Session, ref: string, pdf: Buffer, filename = "airline-ticket.pdf") {
  const s = await admin.post("/v1/admin/ticket-documents/uploads", { requestRef: ref, filename, mime: "application/pdf", size: pdf.length })
  const put = await fetch(s.body.uploadUrl, { method: "PUT", headers: s.body.headers, body: pdf })
  const overwrite = await fetch(s.body.uploadUrl, { method: "PUT", headers: s.body.headers, body: pdf })
  await admin.post(`/v1/admin/ticket-documents/uploads/${s.body.documentId}/complete`)
  const st = await until(() => admin.get(`/v1/admin/ticket-documents/uploads/${s.body.documentId}`), (r) => r.body.scanStatus !== "PENDING")
  return { documentId: s.body.documentId as string, put: put.status, overwrite: overwrite.status, scan: st.body.scanStatus as string }
}

const records = (a: Awaited<ReturnType<typeof acceptedRequest>>, pnr: string, ticketNumber: string) => ({
  reservation: { system: "AMADEUS_TERMINAL", recordLocator: pnr, ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: a.optionId, travellerIds: [a.travellerId], slices: a.slices },
  tickets: { tickets: [{ travellerId: a.travellerId, ticketNumber, validatingCarrier: "BA", issueDate: "2026-11-19", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: `BANK-${pnr}`, payerName: "Neda Verify" } },
})

// ---------------- run ----------------
const results: { step: string; pass: boolean; evidence: Record<string, unknown> }[] = []
function record(step: string, pass: boolean, evidence: Record<string, unknown>) {
  results.push({ step, pass, evidence })
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}  ${JSON.stringify(evidence)}`)
}

const admin = await staffSession(STAFF.admin, ADMIN_HOST)
if (process.argv[2] === "--prepare") {
  const dir = process.argv[3] ?? "."
  const p = await customer()
  const r = await acceptedRequest(p.c, admin)
  const pdfPath = join(dir, `ticket-${r.ref}.pdf`)
  writeFileSync(pdfPath, await makeTicketPdf({ pnr: `U${String(Date.now()).slice(-5)}`, passengers: [{ name: "VERIFY/NEDA MS", ticketNumber: `125${String(Date.now()).slice(-10)}` }], flight: { carrier: "BA", number: "675", from: "IST", to: "LHR", date: "2026-12-14" } }))
  console.log(JSON.stringify({ REF: r.ref, CUSTOMER: p.email.split("@")[0], PDF: pdfPath }))
  process.exit(0)
}
const { c, email } = await customer()
const a = await acceptedRequest(c, admin)
const pnr = `V${String(Date.now()).slice(-5)}`
const ticketNumber = `125${String(Date.now()).slice(-10)}`
const fixtureOpts = { pnr, passengers: [{ name: "VERIFY/NEDA MS", ticketNumber }], flight: { carrier: "BA", number: "675", from: "IST", to: "LHR", date: "2026-12-14" } }
const pdf = await makeTicketPdf(fixtureOpts)
const payloads = symbolPayloads(fixtureOpts)

// 1. customer and passenger selection: the request is found through the customer filter, the traveller is on it.
const list = await admin.get(`/v1/admin/flight-requests?customerUserId=${a.customerUserId}&limit=100`)
const fr = await admin.get(`/v1/admin/flight-requests/${a.ref}`)
record("1 admin selects customer/passenger", list.body.items.length === 1 && list.body.items[0].ref === a.ref && fr.body.travellers.some((t: { travellerId: string }) => t.travellerId === a.travellerId), { ref: a.ref, requestsForCustomer: list.body.items.map((x: { ref: string }) => x.ref), travellerId: a.travellerId })

// 2. upload: write-once (second PUT 412), scanned clean.
const up = await upload(admin, a.ref, pdf)
record("2 admin uploads airline PDF (write-once)", up.put === 200 && up.overwrite === 412 && up.scan === "CLEAN", { uploadedSha256: sha(pdf), size: pdf.length, firstPut: up.put, overwritePut: up.overwrite, scan: up.scan })

const draft = await admin.post("/v1/admin/ticket-documents", { requestRef: a.ref, originalDocumentId: up.documentId, kind: "BOARDING_PASS", travellerIds: [a.travellerId], records: records(a, pnr, ticketNumber) }, idem())
const id: string = draft.body.id
const preview = await admin.get(`/v1/admin/ticket-documents/${id}/preview`)
const prevOriginal = await bytesOf(preview.body.original.url)
const prevBranded = await bytesOf(preview.body.branded.url)

// 3. original shown unchanged; 4. branded version created with the original embedded.
record("3 original displayed (preview bytes == upload)", sha(prevOriginal.body) === sha(pdf), { previewOriginalSha256: sha(prevOriginal.body) })
record("4 branded version created", draft.status === 201 && draft.body.wrapperMode === "FULL" && prevBranded.body.subarray(0, 5).toString() === "%PDF-" && prevBranded.body.includes(Buffer.from("/EmbeddedFile")), { draftStatus: draft.status, wrapperMode: draft.body.wrapperMode, brandedSha256: sha(prevBranded.body), brandedBytes: prevBranded.body.length })

// 5. codes: API check, and an independent decode of both stored files.
const decOriginal = await decodePdf(prevOriginal.body)
const decBranded = await decodePdf(prevBranded.body)
const missing = codeSet(decOriginal).filter((k) => !codeSet(decBranded).includes(k))
record("5 QR/PDF417/barcode original vs branded", draft.body.allMatched === true && decOriginal.length === 3 && missing.length === 0, { apiAllMatched: draft.body.allMatched, apiFormats: draft.body.verification.codesOriginal.map((x: { format: string }) => x.format).sort(), independentOriginal: decOriginal.map((x) => x.format), independentBranded: decBranded.map((x) => x.format), missingInBranded: missing })

// 6. issue.
const issued = await admin.post(`/v1/admin/ticket-documents/${id}/issue`, {}, idem())
record("6 admin issues", issued.status === 200 && issued.body.status === "ISSUED", { status: issued.status, ticketStatus: issued.body.status, brandedDocumentId: issued.body.brandedDocumentId })

// 7. email with both attachments; the original attachment is the uploaded bytes and its codes decode.
const [mail] = await mailWhere(email, (m) => m.Subject.includes(a.ref) && !/again|دوباره/.test(m.Subject))
const attached = await Promise.all(mail!.Attachments.map((x) => part(mail!.ID, x.PartID)))
const attachedOriginal = attached.find((b) => sha(b) === sha(pdf))
const attachedBranded = attached.find((b) => sha(b) !== sha(pdf))
const decMailBranded = attachedBranded ? await decodePdf(attachedBranded) : []
record("7 email in Mailpit with both attachments", attached.length === 2 && !!attachedOriginal && codeSet(decOriginal).every((k) => codeSet(decMailBranded).includes(k)), { subject: mail!.Subject, attachments: mail!.Attachments.map((x, i) => ({ name: x.FileName, type: x.ContentType, sha256: sha(attached[i]!) })), originalAttachmentEqualsUpload: !!attachedOriginal })

// 8. customer signed in sees the ticket.
const mine = await c.get(`/v1/ticket-documents?requestRef=${a.ref}`)
record("8 customer logs in and sees the ticket", mine.status === 200 && mine.body.items.length === 1 && mine.body.items[0].pnr === pnr, { items: mine.body.items.map((x: { id: string; pnr: string; status?: string }) => ({ id: x.id, pnr: x.pnr })) })

// 9. download (attachment) and open (inline).
const dl = await bytesOf((await c.get(`/v1/ticket-documents/${id}/files/original`)).body.url)
const op = await bytesOf((await c.get(`/v1/ticket-documents/${id}/files/original?disposition=inline`)).body.url)
const br = await bytesOf((await c.get(`/v1/ticket-documents/${id}/files/branded`)).body.url)
record("9 customer downloads / opens", dl.res.status === 200 && sha(dl.body) === sha(pdf) && /^attachment;/.test(dl.res.headers.get("content-disposition") ?? "") && /^inline;/.test(op.res.headers.get("content-disposition") ?? "") && sha(op.body) === sha(pdf) && br.res.status === 200, { downloadSha256: sha(dl.body), downloadDisposition: dl.res.headers.get("content-disposition"), openDisposition: op.res.headers.get("content-disposition"), brandedSha256: sha(br.body) })

// 10. QR decoded from the customer's download equals the fixture payload byte for byte.
const decDl = await decodePdf(dl.body)
const qr = decDl.find((x) => x.format === "QRCode")
const pdf417 = decDl.find((x) => x.format === "PDF417")
const expectedHex = Buffer.from(payloads.qrcode, "latin1").toString("hex")
record("10 QR from customer download == fixture payload", qr?.bytesHex === expectedHex && pdf417?.bytesHex === Buffer.from(payloads.pdf417, "latin1").toString("hex"), { qrPayload: qr?.text, qrBytesHex: qr?.bytesHex, expectedHex, pdf417Equal: pdf417?.bytesHex === Buffer.from(payloads.pdf417, "latin1").toString("hex") })

// Extra paths.
const other = new Session("WEB")
await signIn(other, randomPhone("+98912"))
const otherStatuses = await Promise.all([`/v1/ticket-documents/${id}`, `/v1/ticket-documents/${id}/files/original`, `/v1/ticket-documents/${id}/files/original?disposition=inline`, `/v1/ticket-documents/${id}/codes/0`].map(async (p) => (await other.get(p)).status))
record("x other customer gets 404", otherStatuses.every((s) => s === 404), { statuses: otherStatuses })

const resend = await admin.post(`/v1/admin/ticket-documents/${id}/resend`, { toAccount: true }, idem())
const afterResend = await until(() => admin.get(`/v1/admin/ticket-documents/${id}`), (r) => r.body.deliveries.some((x: { event: string; status: string }) => x.event === "ticket.resent" && x.status !== "QUEUED"))
const summary = (await admin.get(`/v1/admin/ticket-documents?requestRef=${a.ref}`)).body.items.find((x: { id: string }) => x.id === id)
record("x resend creates a new delivery; list shows last delivery", resend.status === 200 && afterResend.body.deliveries.filter((x: { event: string }) => x.event === "ticket.resent").length === 1 && summary?.lastDelivery?.channel === "EMAIL", { deliveries: afterResend.body.deliveries.map((x: { event: string; channel: string; recipient: string; status: string }) => `${x.event}:${x.channel}:${x.recipient}:${x.status}`), lastDelivery: summary?.lastDelivery })

const pdf2 = await makeTicketPdf({ ...fixtureOpts, payloadOverride: { qrcode: `NEW-SEAT-${pnr}` } })
const up2 = await upload(admin, a.ref, pdf2)
const v2 = await admin.post(`/v1/admin/ticket-documents/${id}/replace`, { originalDocumentId: up2.documentId, reason: "Seat changed by the airline" }, idem())
const v2Issued = await admin.post(`/v1/admin/ticket-documents/${v2.body.id}/issue`, {}, idem())
const v1After = await admin.get(`/v1/admin/ticket-documents/${id}`)
record("x replace → v2 DRAFT, issue → v1 SUPERSEDED", v2.body.status === "DRAFT" && v2Issued.body.status === "ISSUED" && v1After.body.status === "SUPERSEDED" && (await c.get(`/v1/ticket-documents/${id}`)).status === 404, { v2: `${v2.body.version}:${v2.body.status}`, v2AfterIssue: v2Issued.body.status, v1: v1After.body.status, versions: v1After.body.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`) })

// A second customer: the first already has a request in flight.
const b = await acceptedRequest((await customer()).c, admin)
const signedPdf = await makeTicketPdf({ ...fixtureOpts, signed: true })
const upS = await upload(admin, b.ref, signedPdf)
const sPnr = `S${String(Date.now()).slice(-5)}`
const sDraft = await admin.post("/v1/admin/ticket-documents", { requestRef: b.ref, originalDocumentId: upS.documentId, kind: "E_TICKET", travellerIds: [b.travellerId], records: records(b, sPnr, `125${String(Date.now() + 9).slice(-10)}`) }, idem())
record("x signed PDF → COVER_ONLY", sDraft.body.wrapperMode === "COVER_ONLY" && sDraft.body.verification?.wrapperReason === "SIGNED", { wrapperMode: sDraft.body.wrapperMode, reason: sDraft.body.verification?.wrapperReason, codesBranded: sDraft.body.verification?.codesBranded?.length })

const eicar = Buffer.from("%PDF-1.4\n% X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n%%EOF\n", "latin1")
const upE = await upload(admin, b.ref, eicar, "infected.pdf")
const eDraft = await admin.post("/v1/admin/ticket-documents", { requestRef: b.ref, originalDocumentId: upE.documentId, kind: "E_TICKET", travellerIds: [b.travellerId] }, idem())
record("x infected upload (EICAR) rejected", upE.scan === "INFECTED" && eDraft.status >= 400 && eDraft.status < 500, { scan: upE.scan, draftStatus: eDraft.status, draftCode: eDraft.body.code })

const [audit] = await dbQuery<{ n: number }>("select count(*)::int n from audit_log where entity_type = 'ticket_document' and entity_id = $1 and action = 'ticket_document.downloaded'", [id])
record("x customer downloads audited", (audit?.n ?? 0) >= 3, { downloadedAuditRows: audit?.n })

const out = process.argv[2]
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), requestRef: a.ref, ticketDocumentId: id, results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
