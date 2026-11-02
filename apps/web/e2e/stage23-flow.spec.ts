import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type Browser, type Page } from "@playwright/test"

import { dbQuery, randomPhone, Session, signIn as apiSignIn, STAFF, staffSession } from "../../api/test/client"
import { apiSessionFrom, staffPage as consolePage } from "../../console/e2e/helpers"
import { signIn } from "./helpers"
import { API_ORIGIN, crawler } from "./support/leak"

/**
 * STAGE-23 flow tests against an isolated stack (MASTER_PLAN section 5, ADR-0030, ADR-0031).
 *  1. offline flow  : search (no prices) -> request with an INSURANCE interest -> staff quote with the catalogue line ->
 *                     accept -> invoice -> issued email with bank-transfer instructions -> offline payment -> PAID -> reservation
 *                     with an external reference only.
 *  2. compliance    : an Iranian airport puts the request on COMPLIANCE_HOLD; release shows the pending-counsel warning.
 *  3. stripe flow   : same as 1 with online payments on; guarded, needs Stripe test keys and `stripe listen`.
 * Console, API and mail sink hosts come from the environment (CONSOLE_ADMIN_URL, CONSOLE_DEV_URL, API_URL, MAILPIT_URL).
 */
const ADMIN = process.env.CONSOLE_ADMIN_URL ?? "http://admin.localhost:4200"
const ADMIN_HOST = new URL(ADMIN).host
// The Developer Panel routes answer only to the host the API itself is configured with (PUBLIC_CONSOLE_DEV_URL), whatever port the console listens on.
const API_DEV_HOST = process.env.API_DEV_HOST ?? "dev.localhost:4200"
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8035"
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"
const BANK = { en: "Pay to sort code 00-00-00, account 12345678, quoting the invoice number.", fa: "به حساب ۱۲۳۴۵۶۷۸ واریز کنید و شماره فاکتور را بنویسید." }

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(here, "../../../docs/screens/stage23")
mkdirSync(SHOTS, { recursive: true })

const GBP = (n: number) => ({ amountMinor: n, currency: "GBP" })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) { await wait(400); v = await fn() }
  return v
}

// ---- screenshots: customer pages at 390 and 1360 wide, en and fa; console at 390 and 1440 ----
const WIDTHS = [{ tag: "mobile", width: 390, height: 844 }, { tag: "desktop", width: 1360, height: 900 }] as const
async function shots(page: Page, name: string, widths: ReadonlyArray<{ tag: string; width: number; height: number }> = WIDTHS) {
  const original = page.viewportSize()
  for (const w of widths) {
    await page.setViewportSize({ width: w.width, height: w.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS}/${name}-${w.tag}.png`, fullPage: w.tag === "mobile" })
  }
  if (original) await page.setViewportSize(original)
}
/** Customer page in both locales: the current URL as it is, then the same path under the other locale prefix. */
async function shotsBothLocales(page: Page, name: string) {
  const url = page.url()
  const m = /^(https?:\/\/[^/]+)\/(en|fa)(\/.*)?$/.exec(url)
  if (!m) throw new Error(`not a localised customer URL: ${url}`)
  const [, origin, locale, path = ""] = m
  const other = locale === "en" ? "fa" : "en"
  await shots(page, `${name}-${locale}`)
  await page.goto(`${origin}/${other}${path}`)
  await page.waitForLoadState("networkidle")
  await shots(page, `${name}-${other}`)
  await page.goto(url)
  await page.waitForLoadState("networkidle")
}

// ---- mail sink (Mailpit): match by recipient and subject, never by position ----
interface Mail { Subject: string; Text: string }
async function mailWith(to: string, subject: string): Promise<Mail> {
  const find = async () => {
    const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages?: { ID: string; Subject: string }[] }
    const hit = found.messages?.find((m) => m.Subject.includes(subject))
    return hit ? ((await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as Mail) : null
  }
  const m = await until(find, (x) => x !== null, 40_000)
  if (!m) throw new Error(`no mail to ${to} with subject containing "${subject}"`)
  return m
}

// ---- staff API sessions (the console has no UI for some steps; those calls are marked API in the report) ----
const staffApi = async (browser: Browser, phone: string, base: string) => {
  const page = await consolePage(browser, base, phone)
  return { page, api: await apiSessionFrom(page, base) }
}

/** Developer Panel API session (settings, feature flags): no browser needed. */
const devApi = (phone: string) => staffSession(phone, API_DEV_HOST)

/**
 * The default ATOL mode, PAY_ON_TICKETING, lets a flight invoice be issued only after ticketing and takes payment in the ticketing
 * step (ADR-0006 C5, bookings.service.ts). The requested order (issue, pay offline, then record the reservation) is the
 * AGENT_FOR_ATOL_HOLDER shape, so the test switches the WORKFLOW config in this throwaway database and rolls it back afterwards.
 * Returns the function that restores the original published version.
 */
async function useAtolMode(mode: "AGENT_FOR_ATOL_HOLDER"): Promise<() => Promise<void>> {
  const dev = await devApi(STAFF.owner)
  const rows = (await dev.get("/v1/dev/config/WORKFLOW/versions")).body as { version: number; status: string; payload: { atolMode: string } }[]
  const current = rows.find((r) => r.status === "PUBLISHED")!
  expect(current, "a published WORKFLOW config").toBeTruthy()
  if (current.payload.atolMode === mode) return async () => {}
  const draft = await dev.post("/v1/dev/config/WORKFLOW/versions", { payload: { ...current.payload, atolMode: mode }, changeNote: "e2e: STAGE-23 flow (restored after)" })
  expect(draft.status).toBe(201)
  expect((await dev.post(`/v1/dev/config/WORKFLOW/versions/${draft.body.version}/publish`, { changeNote: "e2e: STAGE-23 flow, temporary" })).status).toBe(200)
  return async () => {
    const back = await dev.post(`/v1/dev/config/WORKFLOW/versions/${current.version}/publish`, { changeNote: "e2e: restore the original ATOL mode" })
    expect(back.status).toBe(200)
  }
}

// ---- shared steps ----
const uniqueEmail = (tag: string) => `s23-${tag}-${Date.now().toString(36)}@student.example`

async function addTraveller(page: Page) {
  const travellers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Who is travelling" }) }).locator("li input[type=checkbox]")
  await page.waitForLoadState("networkidle")
  if ((await travellers.count()) === 0) {
    await page.getByRole("button", { name: "Add a traveller" }).click()
    const form = page.locator("form").filter({ has: page.getByLabel(/Surname/) })
    await form.getByLabel(/Given names/).fill("Daniel")
    await form.getByLabel(/Surname/).fill("Hart")
    await form.getByLabel(/Date of birth/).fill("1988-04-12")
    await form.locator("button[type=submit]").click()
    await expect(travellers.first()).toBeVisible()
  }
  await travellers.first().check()
}

/**
 * Logged-out search with the FAKE provider on Van to Istanbul: a route with results that touches no Iranian airport (the home
 * default, Tehran to London, goes to COMPLIANCE_HOLD under ADR-0031 I4) and whose offers carry UNKNOWN baggage and fare rules.
 * The home form builds the same `q` parameter; results carry no price. Returns the itinerary URL.
 */
async function searchAndOpen(page: Page, crawl: ReturnType<typeof crawler>) {
  await page.goto("/en")
  await crawl.snap("home")
  const q = {
    trip: "ONE_WAY", from: { kind: "AIRPORT", code: "VAN", label: "Van" }, to: { kind: "AIRPORT", code: "IST", label: "Istanbul" },
    date: new Date(Date.now() + 23 * 86400_000).toISOString().slice(0, 10), adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360],
  }
  await page.goto(`/en/search?q=${encodeURIComponent(Buffer.from(JSON.stringify(q)).toString("base64"))}`)
  await expect(page).toHaveURL(/\/en\/search/)
  const cards = page.locator("main ol li a, main ul li a").filter({ hasText: "Price confirmed in your quote" })
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  expect(await page.locator("main").innerText()).not.toMatch(/£|GBP|€|\$/)
  await crawl.snap("results")
  await shotsBothLocales(page, "01-results")
  await cards.first().click()
  await expect(page).toHaveURL(/\/en\/itinerary\//)
  await expect(page.getByRole("heading", { name: "Itinerary" })).toBeVisible()
  expect(await page.locator("main").innerText()).not.toMatch(/£|GBP|€|\$/)
  await crawl.snap("itinerary")
  await shotsBothLocales(page, "02-itinerary")
  return page.url()
}

/** Logged out: "Request this itinerary" lands on sign-in; sign in, return to the itinerary and open the form. */
async function signInAndOpenForm(page: Page, itineraryUrl: string, email: string, crawl: ReturnType<typeof crawler>) {
  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/sign-in/)
  await crawl.snap("sign-in")
  await signIn(page, email)
  await addVerifiedPhone(email)
  await page.goto(itineraryUrl)
  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/\/en\/request\/new/)
}

/**
 * A customer who signed in by email has no verified phone, and requests need one as the contact. Phone verification is not part
 * of STAGE-23, so the identity is added as verified directly in the test database (same shortcut as stage23-payments.e2e.ts).
 */
async function addVerifiedPhone(email: string) {
  const [u] = await dbQuery<{ user_id: string }>("select user_id from user_identities where type = 'EMAIL' and value_normalised = $1", [email])
  expect(u, `user for ${email}`).toBeTruthy()
  // The drama-range numbers are few (900); a number left by an earlier run is skipped, not reused.
  for (let i = 0; i < 40; i++) {
    const added = await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at) values (gen_random_uuid(), $1, 'PHONE', $2, now()) on conflict do nothing returning id", [u!.user_id, randomPhone("+4477009")])
    if (added.length) return
  }
  throw new Error("no free test phone number")
}

async function submitRequest(page: Page, crawl: ReturnType<typeof crawler>, interests: string[]): Promise<string> {
  await addTraveller(page)
  const box = page.getByTestId("service-interests")
  await expect(box).toBeVisible()
  for (const name of interests) await box.getByRole("checkbox", { name: new RegExp(name) }).check()
  // Interests are names only for the customer: nothing priced unless the item is flagged as showing its price.
  await crawl.snap("request-new")
  for (const b of await page.locator("section[data-ack] input[type=checkbox]").all()) await b.check()
  // The form keeps its state only on this page, so the Persian view is captured after submitting, from a fresh load.
  const formUrl = page.url()
  await shots(page, "03-request-form-en")
  await page.getByRole("button", { name: "Send request" }).click()
  const ref = page.locator("p.font-mono")
  await expect(ref).toHaveText(/^UT-F-[0-9A-Z]{6}$/, { timeout: 20_000 })
  const reference = (await ref.textContent())!
  await shots(page, "03-request-sent-en")
  await page.goto(formUrl.replace("/en/", "/fa/"))
  await page.waitForLoadState("networkidle")
  await crawl.snap("request-new-fa")
  await shots(page, "03-request-form-fa")
  return reference
}

/** Staff claims the request and builds a quote from the snapshot with the INSURANCE catalogue line. */
async function staffQuote(page: Page, ref: string, currencyCheck = true) {
  await page.goto(`${ADMIN}/requests/${ref}`)
  await expect(page.getByTestId("ref")).toHaveText(ref)
  await expect(page.getByTestId("service-interests")).toContainText("Travel insurance")
  await page.getByTestId("actions").locator('[data-command="claim"]').click()
  await expect(page.getByTestId("status")).toHaveText("IN REVIEW")
  // Staff see the offer snapshot with its prices (the customer view had none).
  if (currencyCheck) await expect(page.locator("main")).toContainText(/£|GBP/)
  await shots(page, "20-console-request", [WIDTHS[1]])
}

test.describe.configure({ mode: "serial" })
test.setTimeout(600_000)
test.use({ actionTimeout: 20_000 })

test.describe("offline flow", () => {
  test("search to PAID invoice and external-reference reservation, bank transfer only", async ({ page, browser }) => {
    const email = uniqueEmail("offline")
    const crawl = crawler(page, API_ORIGIN)

    // Setup (API): online payments off, bank instructions configured; restored at the end.
    const dev = { api: await devApi(STAFF.developer) }
    const owner = { api: await devApi(STAFF.owner) }
    const settings = (await dev.api.get("/v1/dev/settings")).body
    const restoreAtol = await useAtolMode("AGENT_FOR_ATOL_HOLDER")
    expect((await owner.api.put(FLAG, { enabled: false })).status).toBe(200)
    expect((await dev.api.put("/v1/dev/settings", { ...settings, payment: { offlineInstructions: BANK } })).status).toBe(200)
    try {
      // 1. Customer, logged out: results and itinerary show no prices (UI).
      const itineraryUrl = await searchAndOpen(page, crawl)
      // 2. Request, sign in, submit with INSURANCE ticked as an interest (UI).
      await signInAndOpenForm(page, itineraryUrl, email, crawl)
      const ref = await submitRequest(page, crawl, ["Travel insurance"])
      await page.goto(`/en/requests/${ref}`)
      await expect(page.getByTestId("requested-interests")).toContainText("Travel insurance")
      await crawl.snap("request-detail")
      await shotsBothLocales(page, "04-request-detail")
      // Wait for screening so staff can claim it (API poll through the staff session, read only).
      const admin = await staffApi(browser, STAFF.admin, ADMIN)
      await until(() => admin.api.get(`/v1/admin/flight-requests/${ref}`), (r) => r.body.status === "NEW")

      // 3. Admin console: the request, its prices, the interest; recheck (UI button).
      await staffQuote(admin.page, ref)
      const ap = admin.page
      await expect(ap.getByTestId("service-interests")).toContainText("Travel insurance")
      await ap.getByRole("button", { name: /re-?check|price check/i }).first().click()
      await expect(ap.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 40_000 })

      // 4. Quote: from snapshot, catalogue line INSURANCE; unknown facts block sending until staff confirm them (UI).
      await ap.getByTestId("open-quote-builder").click()
      await ap.getByRole("button", { name: "+ From snapshot" }).click()
      const option = ap.getByTestId("option-0")
      await expect(option).toBeVisible()
      const send = ap.getByRole("button", { name: "Send quote" })
      const flagged = option.locator("select[aria-invalid=true]")
      for (let guard = 0; guard < 20 && (await flagged.count()) > 0; guard++) await flagged.first().selectOption({ index: 1 })
      // Rule 3 (booklet ch. 35.1): a manual option starts with every fact UNKNOWN, and an UNKNOWN attribute blocks sending.
      await ap.getByRole("button", { name: "+ Manual entry" }).click()
      await expect(ap.getByTestId("option-1").getByTestId("unknown-count")).toBeVisible()
      await expect(send).toBeDisabled()
      await ap.getByTestId("option-1").scrollIntoViewIfNeeded()
      await shots(ap, "21-console-quote-unknowns-block-send", [WIDTHS[1]])
      await ap.getByTestId("option-1").getByRole("button", { name: "Remove option" }).click()
      await expect(ap.getByTestId("option-1")).toHaveCount(0)
      await option.getByLabel("Service fee").fill("25.00")
      await attachCatalogue(option, "Travel insurance")
      await option.getByTestId("catalogue-add").click()
      await expect(option.getByTestId("catalogue-line-0")).toBeVisible()
      await ap.getByRole("button", { name: "Preview" }).click()
      await expect(ap.getByTestId("quote-preview")).toBeVisible()
      await expect(ap.getByTestId("quote-preview")).toContainText(/£\d+\.\d{2}/)
      await shots(ap, "22-console-quote-preview")
      await send.click()
      await expect(ap).toHaveURL(new RegExp(`/requests/${ref}$`), { timeout: 20_000 })
      await expect(ap.getByTestId("status")).toHaveText("QUOTED")

      // 5. Customer accepts the quote (UI; passport first when the traveller has none).
      await page.goto(`/en/requests/${ref}`)
      await acceptQuote(page)
      await expect(page.getByTestId("accepted-option")).toBeVisible()
      await crawl.snap("quote-accepted")
      await shotsBothLocales(page, "05-quote-accepted")
      await until(() => admin.api.get(`/v1/admin/flight-requests/${ref}`), (r) => r.body.status === "ACCEPTED")

      // 6. Staff drafts the invoice from the quote and issues it (UI).
      await ap.goto(`${ADMIN}/requests/${ref}`)
      await ap.getByTestId("create-invoice").click()
      const item = ap.getByTestId("invoice-item").first()
      await expect(item).toBeVisible()
      const detailUrl = await item.getByRole("link").first().getAttribute("href")
      await ap.goto(`${ADMIN}${detailUrl}`)
      await expect(ap.getByTestId("invoice-lines-table")).toContainText("Travel insurance")
      await shots(ap, "23-console-invoice-draft", [WIDTHS[1]])
      await ap.locator('[data-command="issue_invoice"]').first().click()
      await expect(ap.getByTestId("invoice-status")).toContainText(/ISSUED/i, { timeout: 20_000 })
      const number = (await ap.getByTestId("invoice-number").textContent())!.trim()
      expect(number).toMatch(/^INV-/)
      await shots(ap, "24-console-invoice-issued")

      // 7. Issued email: bank-transfer instructions, our total only, no card or provider wording.
      const mail = await mailWith(email, number)
      expect(mail.Text).toContain("How to pay (bank transfer):")
      expect(mail.Text).toContain(BANK.en)
      expect(mail.Text).toMatch(/GBP\s?[\d,]+\.\d{2}/)
      expect(mail.Text).not.toMatch(/\{[a-z_]+\}|sk_(test|live)_|client_secret|stripe|google/i)

      // 8. Customer panel: invoice with the INSURANCE line, status and offline instructions, no pay button.
      await page.goto("/en/billing")
      await expect(page.getByTestId("invoice-row").filter({ hasText: number })).toBeVisible()
      await crawl.snap("billing")
      await page.goto(`/en/billing/${number}`)
      const detail = page.getByTestId("invoice-detail")
      await expect(detail).toContainText("Travel insurance")
      await expect(detail).toContainText(/Issued|Awaiting|Unpaid|Due/i)
      await expect(page.getByTestId("pay-online")).toHaveCount(0)
      await expect(page.getByTestId("offline-instructions")).toContainText(BANK.en)
      await crawl.snap("billing-detail")
      await shotsBothLocales(page, "06-invoice-issued")
      const total = (await page.getByTestId("invoice-total").last().textContent())!

      // 9. Offline payment through the console, second user verifies when four-eyes applies (UI for the first, API for the second).
      // A flight invoice takes its payment from the request page (the invoice page records payments for direct service invoices only).
      await ap.goto(`${ADMIN}/requests/${ref}`)
      await ap.locator('[data-command="record_payment"]').first().click()
      const pay = ap.getByTestId("dlg-payment")
      await expect(pay.getByLabel("Amount")).not.toHaveValue("")
      await pay.getByLabel("External reference").fill(`S23-${Date.now()}`)
      await pay.getByLabel("Payer name").fill("Daniel Hart")
      await shots(ap, "24b-console-record-payment", [WIDTHS[1]])
      await pay.locator("button[type=submit]").click()
      await expect(pay).toBeHidden({ timeout: 20_000 })
      const invoiceId = detailUrl!.split("/").pop()!
      const state = async () => (await admin.api.get(`/v1/admin/invoices/${invoiceId}`)).body
      let inv = await state()
      let secondVerifier = false
      if (inv.status !== "PAID") {
        secondVerifier = true
        const owner = await staffApi(browser, STAFF.owner, ADMIN)
        const pending = ((await admin.api.get(`/v1/admin/flight-requests/${ref}`)).body.payments as { id: string; status: string }[]).filter((p) => p.status === "RECORDED")
        expect(pending.length).toBeGreaterThan(0)
        for (const p of pending) expect([200, 201]).toContain((await owner.api.post(`/v1/admin/payments/${p.id}/verify`)).status)
        inv = (await until(state, (b) => b.status === "PAID", 20_000))
      }
      expect(inv.status, `four-eyes second verifier used: ${secondVerifier}`).toBe("PAID")

      // 10. PAID in both panels.
      await ap.goto(`${ADMIN}${detailUrl}`)
      await expect(ap.getByTestId("invoice-status")).toContainText(/PAID/i, { timeout: 20_000 })
      await shots(ap, "25-console-invoice-paid")
      await page.goto(`/en/billing/${number}`)
      await expect(page.getByTestId("invoice-detail")).toContainText(/Paid/i)
      await expect(page.getByTestId("invoice-total").last()).toHaveText(total)
      await crawl.snap("billing-paid")
      await shotsBothLocales(page, "07-invoice-paid")
      const receipt = await mailWith(email, "Payment received")
      expect(receipt.Subject).toContain(number)

      // 11. Reservation with an external reference only, no PNR (UI dialog).
      await ap.goto(`${ADMIN}/requests/${ref}`)
      await ap.locator('[data-command="record_reservation"]').first().click()
      const dlg = ap.getByRole("dialog").filter({ hasText: "Record reservation" })
      await dlg.locator("select").first().selectOption("PARTNER")
      await dlg.getByLabel(/External reference|Panel reference/i).fill("PANEL-S23-4471")
      await dlg.getByTestId("res-note").fill("Booked in the consolidator portal")
      await shots(ap, "26-console-reservation-dialog", [WIDTHS[1]])
      await dlg.getByRole("button", { name: /Record reservation/ }).click()
      await expect(dlg).toBeHidden({ timeout: 20_000 })
      const detailJson = (await admin.api.get(`/v1/admin/flight-requests/${ref}`)).body
      expect(detailJson.reservations[0]).toMatchObject({ recordLocator: null, externalReference: "PANEL-S23-4471" })
      await ap.reload()
      await expect(ap.getByTestId("status")).toHaveText(/RESERVED/i)
      await shots(ap, "27-console-reserved")

      // 12. Customer sees the final state, with no reference or PNR leaking to them.
      await page.goto(`/en/requests/${ref}`)
      await expect(page.getByText(/Reserved|Booking in progress|Reservation/i).first()).toBeVisible()
      expect(await page.locator("main").innerText()).not.toContain("PANEL-S23-4471")
      await crawl.snap("request-final")
      await shotsBothLocales(page, "08-request-final")

      // Leak check over every customer page visited in this flow.
      expect(crawl.stats().html).toBeGreaterThanOrEqual(8)
      expect(crawl.leaks()).toEqual([])
    } finally {
      await restoreAtol()
      await dev.api.put("/v1/dev/settings", settings)
    }
  })
})

/** Picks a catalogue item by its visible name in the quote option editor (does not press Add). */
async function attachCatalogue(option: import("@playwright/test").Locator, name: string) {
  const pick = option.getByTestId("catalogue-pick")
  const value = await pick.locator("option", { hasText: name }).first().getAttribute("value")
  await pick.selectOption(value as string)
}

/** Customer accepts the open quote; adds the passport number first when the request asks for it. */
async function acceptQuote(page: Page) {
  await page.waitForLoadState("networkidle")
  const provide = page.getByRole("button", { name: /Add passport details/ }).first()
  if (await provide.isVisible().catch(() => false)) {
    await provide.click()
    const form = page.locator("form").filter({ has: page.getByLabel(/Passport number/i) })
    await form.getByLabel(/Passport number/i).fill("X12345678")
    await form.getByLabel(/Expiry/i).fill("2033-01-01")
    await form.locator("button[type=submit]").click()
    await expect(provide).toBeHidden({ timeout: 15_000 })
  }
  await page.getByRole("button", { name: /^Accept/ }).first().click()
  await page.getByTestId("confirm-accept").getByRole("button").first().click()
}

// ---------------------------------------------------------------------------------------------------------------------

test.describe("compliance flow", () => {
  test("an Iranian airport holds the request; release shows the counsel warning and moves it on", async ({ browser }) => {
    // Customer and request through the API (the manual request form is not under test here).
    const c = new Session("MOBILE")
    await apiSignIn(c, randomPhone("+98912"), { givenNamesLatin: "Neda", surnameLatin: "Holdtest" })
    const me = (await c.get("/v1/me")).body
    const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Neda", surname: "Holdtest", dateOfBirth: "1998-05-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF", document: { number: "X12345678", issuingCountry: "IR", expiryDate: "2033-01-01" } })
    expect(t.status).toBe(201)
    const phoneId = (me.identities as { id: string; type: string }[]).find((i) => i.type === "PHONE")!.id
    const date = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10)
    const r = await c.post("/v1/flight-requests", {
      kind: "MANUAL", contactIdentityId: phoneId, travellers: [{ travellerId: t.body.id, passengerType: "ADT" }],
      query: { tripType: "ONE_WAY", slices: [{ from: { airport: "IKA" }, to: { airport: "IST" }, date, flexDays: 1 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY" },
      manual: { flexibility: "Any day that week", budget: GBP(60000), overlandAcceptable: true, airlinesAvoid: [], airlinesPrefer: [] },
      seatPreference: "WINDOW", acknowledgements: { notABooking: true, privacy: true },
    }, { "idempotency-key": `s23-iran-${Date.now()}` })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const ref = r.body.ref as string

    const compliance = await staffApi(browser, STAFF.compliance, ADMIN)
    const held = await until(() => compliance.api.get(`/v1/admin/flight-requests/${ref}`), (x) => x.body.status !== "SUBMITTED" && x.body.status !== "SCREENING")
    expect(held.body.status).toBe("COMPLIANCE_HOLD")
    const customerView = (await c.get(`/v1/flight-requests/${ref}`)).body
    expect(JSON.stringify(customerView)).not.toMatch(/IRAN_AIRPORT|sanction|counsel/i)

    const cp = compliance.page
    await cp.goto(`${ADMIN}/requests/${ref}`)
    await expect(cp.getByTestId("status")).toHaveText(/COMPLIANCE.?HOLD/i)
    await shots(cp, "30-console-compliance-hold", [WIDTHS[1]])
    const caseId = await dbQuery<{ id: string }>("select c.id from compliance_cases c join flight_requests f on f.id = c.request_id where f.ref = $1", [ref])
    expect(caseId).toHaveLength(1)
    await cp.goto(`${ADMIN}/compliance/${caseId[0]!.id}`)
    await cp.getByLabel("Release", { exact: false }).first().check()
    const warning = cp.getByTestId("iran-counsel-warning")
    await expect(warning).toBeVisible()
    await expect(warning).toContainText(/counsel/i)
    await cp.getByLabel(/Reason \(recorded/).fill("e2e: reviewed, no hit on the traveller, release for quoting")
    await shots(cp, "31-console-compliance-release-warning")
    await cp.getByRole("button", { name: "Record decision" }).click()
    await expect(cp.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 })
    const after = await until(() => compliance.api.get(`/v1/admin/flight-requests/${ref}`), (x) => x.body.status === "NEW", 30_000)
    expect(after.body.status, JSON.stringify(after.body.status)).toBe("NEW")
    await cp.goto(`${ADMIN}/requests/${ref}`)
    await expect(cp.getByTestId("status")).toHaveText(/NEW/i)
  })
})

// ---------------------------------------------------------------------------------------------------------------------

test.describe("stripe flow", () => {
  test.skip(!process.env.STRIPE_E2E, "needs Stripe test keys and stripe listen")

  // Online payments never stay on after this block, whichever step failed.
  test.afterAll(async () => {
    const owner = { api: await devApi(STAFF.owner) }
    await owner.api.put(FLAG, { enabled: false })
  })

  test("online payments on: the customer pays by test card on our page, the webhook marks the invoice PAID", async ({ page, browser }) => {
    const email = uniqueEmail("stripe")
    const crawl = crawler(page, API_ORIGIN)
    const owner = { api: await devApi(STAFF.owner) }
    expect((await owner.api.put(FLAG, { enabled: true })).status).toBe(200)
    try {
      const itineraryUrl = await searchAndOpen(page, crawl)
      await signInAndOpenForm(page, itineraryUrl, email, crawl)
      const ref = await submitRequest(page, crawl, ["Travel insurance"])
      const admin = await staffApi(browser, STAFF.admin, ADMIN)
      await until(() => admin.api.get(`/v1/admin/flight-requests/${ref}`), (r) => r.body.status === "NEW")
      await staffQuote(admin.page, ref)
      const ap = admin.page
      await ap.getByTestId("open-quote-builder").click()
      await ap.getByRole("button", { name: "+ From snapshot" }).click()
      const option = ap.getByTestId("option-0")
      const flagged = option.locator("select[aria-invalid=true]")
      for (let guard = 0; guard < 20 && (await flagged.count()) > 0; guard++) await flagged.first().selectOption({ index: 1 })
      await option.getByLabel("Service fee").fill("25.00")
      await attachCatalogue(option, "Travel insurance")
      await option.getByTestId("catalogue-add").click()
      await ap.getByRole("button", { name: "Preview" }).click()
      await ap.getByRole("button", { name: "Send quote" }).click()
      await expect(ap.getByTestId("status")).toHaveText("QUOTED", { timeout: 20_000 })
      await page.goto(`/en/requests/${ref}`)
      await acceptQuote(page)
      await until(() => admin.api.get(`/v1/admin/flight-requests/${ref}`), (r) => r.body.status === "ACCEPTED")
      await ap.goto(`${ADMIN}/requests/${ref}`)
      await ap.getByTestId("create-invoice").click()
      const href = await ap.getByTestId("invoice-item").first().getByRole("link").first().getAttribute("href")
      await ap.goto(`${ADMIN}${href}`)
      await ap.locator('[data-command="issue_invoice"]').first().click()
      await expect(ap.getByTestId("invoice-status")).toContainText(/ISSUED/i, { timeout: 20_000 })
      const number = (await ap.getByTestId("invoice-number").textContent())!.trim()

      await page.goto(`/en/billing/${number}`)
      await page.getByTestId("pay-online").click()
      await page.getByTestId("pay-start").click()
      // Stripe-hosted card form: the standard test card, any future expiry and CVC.
      const frame = page.frameLocator("iframe[name^=__privateStripeFrame]").first()
      await frame.getByPlaceholder(/card number/i).fill("4242 4242 4242 4242")
      await frame.getByPlaceholder(/MM ?\/ ?YY/i).fill("12 / 34")
      await frame.getByPlaceholder(/CVC/i).fill("123")
      await page.getByRole("button", { name: /^Pay/ }).click()
      await expect(page.getByTestId("pay-return")).toHaveAttribute("data-state", "paid", { timeout: 60_000 })
      await shotsBothLocales(page, "09-stripe-paid")
      await ap.goto(`${ADMIN}${href}`)
      await expect(ap.getByTestId("invoice-status")).toContainText(/PAID/i, { timeout: 60_000 })
      expect(crawl.leaks()).toEqual([])
    } finally {
      await owner.api.put(FLAG, { enabled: false })
    }
  })
})
