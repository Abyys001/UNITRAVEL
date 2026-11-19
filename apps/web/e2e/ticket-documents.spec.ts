import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

import { ADMIN_HOST, dbQuery, markVerifiedForTest, randomPhone, Session, signIn as apiSignIn, STAFF, staffSession } from "../../api/test/client"
import { makeTicketPdf } from "../../api/test/fixtures/ticket-pdf"
import { signIn } from "./helpers"

// STAGE-29 (ADR-0038) customer web: "My flight tickets" list, detail, PNR copy, the code viewer and the request page link.
const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const idem = () => ({ "idempotency-key": randomUUID() })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

/** The browser signs up by email; a verified phone is added in the test DB so the API session can act as the same customer. */
async function customerSession(email: string): Promise<Session> {
  const [u] = await dbQuery<{ user_id: string }>("select user_id from user_identities where type = 'EMAIL' and value_normalised = $1", [email])
  for (let i = 0; i < 40; i++) {
    const phone = randomPhone("+4477009")
    const added = await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at) values (gen_random_uuid(), $1, 'PHONE', $2, now()) on conflict do nothing returning id", [u!.user_id, phone])
    if (!added.length) continue
    const c = new Session("WEB")
    await apiSignIn(c, phone)
    return c
  }
  throw new Error("no free test phone number")
}

/** Accepted request → write-once original → draft with records (D5) → issue, all through the API as staff would. */
async function issuedBoardingPass(c: Session) {
  const me = (await c.get("/v1/me")).body
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: "Portal", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2030-01-01" } })
  await markVerifiedForTest(t.body.id)
  const phone = me.identities.find((i: { type: string }) => i.type === "PHONE")
  const sub = await c.post("/v1/flight-requests", {
    kind: "MANUAL", contactIdentityId: phone.id, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
    query: { tripType: "ONE_WAY", slices: [{ from: { city: "IST" }, to: { city: "LON" }, date: "2026-12-14", flexDays: 2 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
    manual: { flexibility: "Any day", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] }, seatPreference: "WINDOW", bestTimeToCall: "10:00-14:00 Tehran", note: "STAGE-29 web", acknowledgements: { notABooking: true, privacy: true },
  }, idem())
  expect(sub.status, JSON.stringify(sub.body)).toBe(201)
  const ref: string = sub.body.ref
  for (let i = 0; i < 60 && (await c.get(`/v1/flight-requests/${ref}`)).body.status !== "NEW"; i++) await wait(300)
  const admin = await staffSession(STAFF.admin, ADMIN_HOST)
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
  expect((await c.post(`/v1/flight-requests/${ref}/quotes/${q.id}/accept`, { optionId: q.options[0].id }, idem())).body.status).toBe("ACCEPTED")

  const pnr = `W${String(Date.now()).slice(-5)}`
  const ticketNumber = `125${String(Date.now()).slice(-10)}`
  const pdf = await makeTicketPdf({ pnr, passengers: [{ name: "PORTAL/NEDA MS", ticketNumber }], flight: { carrier: "BA", number: "675", from: "IST", to: "LHR", date: "2026-12-14" } })
  const s = await admin.post("/v1/admin/ticket-documents/uploads", { requestRef: ref, filename: "airline-ticket.pdf", mime: "application/pdf", size: pdf.length })
  expect((await fetch(s.body.uploadUrl, { method: "PUT", headers: s.body.headers, body: pdf })).status).toBe(200)
  await admin.post(`/v1/admin/ticket-documents/uploads/${s.body.documentId}/complete`)
  for (let i = 0; i < 100 && (await admin.get(`/v1/admin/ticket-documents/uploads/${s.body.documentId}`)).body.scanStatus === "PENDING"; i++) await wait(300)
  const draft = await admin.post("/v1/admin/ticket-documents", {
    requestRef: ref, originalDocumentId: s.body.documentId, kind: "BOARDING_PASS", travellerIds: [t.body.id],
    records: {
      reservation: { system: "AMADEUS_TERMINAL", recordLocator: pnr, ticketingDeadline: new Date(Date.now() + 3 * 86400_000).toISOString(), quoteOptionId: q.options[0].id, travellerIds: [t.body.id], slices },
      tickets: { tickets: [{ travellerId: t.body.id, ticketNumber, validatingCarrier: "BA", issueDate: "2026-11-19", coupons: [{ sliceIndex: 0, segmentIndex: 0 }] }], payment: { amount: GBP(41500), method: "BANK_TRANSFER", receivedAt: new Date().toISOString(), externalReference: `BANK-${pnr}`, payerName: "Neda Portal" } },
    },
  }, idem())
  expect(draft.status, JSON.stringify(draft.body)).toBe(201)
  const issued = await admin.post(`/v1/admin/ticket-documents/${draft.body.id}/issue`, {}, idem())
  expect(issued.status, JSON.stringify(issued.body)).toBe(200)
  return { id: draft.body.id as string, ref, pnr, ticketNumber, pdf }
}

test("customer sees issued tickets, the PNR, both files and the airline codes; the request links to the ticket @mobile", async ({ page, context }) => {
  const email = `portal-${Date.now()}@example.test`
  await signIn(page, email)
  const { id, ref, pnr, ticketNumber, pdf } = await issuedBoardingPass(await customerSession(email))

  await page.goto("/en/account/tickets")
  await expect(page.getByRole("link", { name: "My flight tickets" }).first()).toHaveAttribute("aria-current", "page")
  const card = page.getByTestId("tickets-upcoming").getByTestId("ticket-card").filter({ hasText: pnr })
  await expect(card).toContainText("BA675")
  await expect(card).toContainText(ticketNumber)
  await expect(card).toContainText("Boarding pass")
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await card.getByRole("button", { name: "Copy booking reference" }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pnr)

  await card.getByRole("link", { name: "View ticket" }).click()
  await expect(page).toHaveURL(new RegExp(`/en/account/tickets/${id}$`))
  await expect(page.getByRole("button", { name: "Download Uni Travel PDF" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Download original PDF" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Open boarding pass/ })).toBeVisible()

  // The downloaded original is byte-identical to the provider PDF staff uploaded.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download original PDF" }).click()])
  expect(sha(await readFile((await download.path())!))).toBe(sha(pdf))
  // "Open" asks for an inline URL: the store answers with Content-Disposition: inline, so the browser shows the PDF in a tab.
  const opened = context.waitForEvent("response", { predicate: (r) => r.url().includes("response-content-disposition=inline") })
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /Open boarding pass/ }).click()])
  const res = await opened
  expect(res.status()).toBe(200)
  expect(res.headers()["content-disposition"]).toMatch(/^inline;/)
  await tab.close()

  // The code viewer shows the PNG crops from the original page (never re-encoded) inside a focus-trapped dialog.
  const trigger = page.getByRole("button", { name: "Show QR / barcode" })
  await trigger.click()
  const dialog = page.getByRole("dialog", { name: "Airline codes" })
  await expect(dialog).toBeVisible()
  const imgs = dialog.getByRole("img")
  await expect(imgs).toHaveCount(3)
  for (const img of await imgs.all()) await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  // The request page lists the ticket document instead of the bare receipt for the covered ticket.
  await page.goto(`/en/requests/${ref}`)
  const docs = page.getByTestId("request-ticket-documents")
  await expect(docs).toContainText(pnr)
  await docs.getByRole("link", { name: "View ticket" }).click()
  await expect(page).toHaveURL(new RegExp(`/en/account/tickets/${id}$`))

  // Persian: same page, RTL, Persian labels.
  await page.goto(`/fa/account/tickets/${id}`)
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.getByRole("button", { name: "نمایش QR / بارکد" })).toBeVisible()
})
