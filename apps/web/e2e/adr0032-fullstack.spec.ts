import { expect, type Page, test } from "@playwright/test"

import { API, DEV_HOST, dbQuery, randomPhone, Session, signIn, STAFF, staffSession } from "../../api/test/client"
import { type ApifyMock, stackControl, startApifyMock } from "../../api/test/fixtures/apify/mock-server"

/**
 * ADR-0032 end to end on the local stack, with the Apify API replaced by a local mock (ADR-0029 A9). Nothing reaches Apify.
 * Opt-in, because the API and worker must be started against the mock:
 *   APIFY_TOKEN= APIFY_BASE_URL=http://127.0.0.1:4191/v2 scripts/svc.sh restart api worker
 *   APIFY_MOCK_PORT=4191 npx playwright test e2e/adr0032-fullstack.spec.ts
 * The spec stores a placeholder credential the mock accepts (not an Apify token), turns Apify on and FAKE off for the run, and
 * restores all of it afterwards, including the budget ledger, so no SYNTHETIC listing stays on the shared stack (rule 2).
 */
const PORT = Number(process.env.APIFY_MOCK_PORT ?? 0)
const MOCK_CREDENTIAL = "local-mock-placeholder-not-an-apify-token"
const APIFY = "apify-google-flights"
const ADMIN = process.env.CONSOLE_ADMIN_URL ?? "http://admin.localhost:4200"
const STAFF_EMAIL = "sara@unitravel.example"

test.describe.configure({ mode: "serial" })
test.skip(!PORT, "set APIFY_MOCK_PORT and start the API and worker with APIFY_BASE_URL pointing at it")

let mock: ApifyMock
let stack: Awaited<ReturnType<typeof stackControl>>
let restore: (() => Promise<void>) | undefined

test.beforeAll(async () => {
  test.setTimeout(240_000)
  mock = await startApifyMock(PORT, MOCK_CREDENTIAL)
  stack = await stackControl("IST-LHR")
  await stack.snapshot()
  const dev = await staffSession(STAFF.developer, DEV_HOST)
  const settings = (await dev.get("/v1/dev/settings")).body
  const before = Object.fromEntries(await Promise.all(["fake", APIFY].map(async (id) => [id, (await dev.get(`/v1/dev/providers/${id}`)).body.enabled as boolean])))
  const hadCredential = (await dbQuery("select 1 from provider_credentials where provider_id = $1", [APIFY])).length > 0
  expect(hadCredential, "a stored Apify credential would be overwritten; run this on a stack without one").toBe(false)
  restore = async () => {
    const d = await staffSession(STAFF.developer, DEV_HOST)
    await d.patch(`/v1/dev/providers/${APIFY}`, { enabled: before[APIFY] })
    await d.patch("/v1/dev/providers/fake", { enabled: before.fake })
    await dbQuery("delete from provider_credentials where provider_id = $1", [APIFY])
    // The mock's runs are not real spend; keep them out of the Developer Panel run log.
    await dbQuery("delete from provider_runs where external_run_id like 'runMOCK%'")
    await d.put("/v1/dev/settings", settings)
  }

  expect((await dev.put(`/v1/dev/providers/${APIFY}/credentials`, { values: { token: MOCK_CREDENTIAL } })).status).toBe(200)
  // The free limits call proves the API talks to the mock before anything is spent: the mock answers $0.42.
  const probe = await dev.post(`/v1/dev/providers/${APIFY}/test`)
  expect(probe.status, JSON.stringify(probe.body)).toBe(200)
  expect(probe.body.monthlyUsageUsd).toBe(0.42)
  expect(mock.calls.some((c) => c.path === "/users/me/limits")).toBe(true)
  expect((await dev.patch(`/v1/dev/providers/${APIFY}`, { enabled: true })).status).toBe(200)
  expect((await dev.patch("/v1/dev/providers/fake", { enabled: false })).status).toBe(200)
  expect((await dev.put("/v1/dev/settings", { ...settings, listings: { flightRoutes: [{ from: "IST", to: "LHR" }] } })).status).toBe(200)

  // The worker sees the new route list after its settings reload; warm again until the batched run has been collected.
  await expect.poll(async () => { await stack.warm(); await new Promise((r) => setTimeout(r, 5000)); return stack.redis.get("listings:flights:IST-LHR") }, { timeout: 150_000, intervals: [0] }).toBeTruthy()
})

test.afterAll(async () => {
  await restore?.()
  await stack?.restore()
  await mock?.close()
})

/** LOCAL-DEV "Test sign-in" box (ADR-0012, TEST_SIGN_IN=on locally): no code, staff skip the authenticator; audited as user.test_signed_in. */
async function staffSignIn(page: Page) {
  await page.goto(`${ADMIN}/sign-in`)
  const box = page.locator("section, div").filter({ has: page.getByRole("button", { name: "Sign in without a code" }) }).last()
  await box.locator("input[type=email], input[name=email]").first().fill(STAFF_EMAIL)
  await box.getByRole("button", { name: "Sign in without a code" }).click()
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 20_000 })
}

test("/flights popular route → Request this flight → sign in → submit → console list, detail, source badge, staff price, Revalidate DONE", async ({ page, browser }) => {
  test.setTimeout(240_000)
  const fare = /priceLevel|bookingToken|googleFlightsUrl|google\.com\/travel|"price"|"amount"/
  const listing = await (await page.request.get(`${API}/v1/listings/flights`)).text()
  expect(listing).toContain('"CACHED_OFFER"')
  expect(listing).not.toMatch(fare)

  await page.goto("/en/flights")
  const card = page.getByTestId("popular-flight").filter({ hasText: "TK 1900" }).first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card).toContainText("Google Flights data, updated")
  expect(await page.content()).not.toMatch(/SYNTHETIC-TOKEN|google\.com\/travel|"price"|"amount"/)
  await card.getByRole("button", { name: "Request this flight" }).click()
  await expect(page).toHaveURL(/\/en\/sign-in\?next=/)
  const next = new URL(page.url()).searchParams.get("next")!
  expect(next).toMatch(/^\/en\/request\/new\?s=[0-9a-f-]{36}&i=/)
  // Sign-in itself: a fresh customer with a verified phone (OTP through the local SMS sink), so the request has a verified contact.
  // The shared seeded customer's contact state changes between runs; the browser takes over the API session's cookies.
  const customer = new Session("WEB")
  await signIn(customer, randomPhone("+4477009"), { givenNamesLatin: "Fullstack", surnameLatin: "Apify" })
  await page.context().addCookies([...customer.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))
  await page.goto(next)
  await expect(page).toHaveURL(/\/en\/request\/new\?s=/, { timeout: 20_000 })

  const travellers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Who is travelling" }) }).locator("li input[type=checkbox]")
  await page.waitForLoadState("networkidle")
  if ((await travellers.count()) === 0) {
    await page.getByRole("button", { name: "Add a traveller" }).click()
    const form = page.locator("form").filter({ has: page.getByLabel(/Surname/) })
    await form.getByLabel(/Given names/).fill("Neda")
    await form.getByLabel(/Surname/).fill("Fullstack")
    await form.getByLabel(/Date of birth/).fill("1999-03-21")
    await form.locator("button[type=submit]").click()
  } else if (!(await travellers.first().isChecked())) await travellers.first().check()
  for (const box of await page.locator("section[data-ack] input[type=checkbox]").all()) await box.check()
  await page.getByRole("button", { name: "Send request" }).click()
  const refEl = page.locator("p.font-mono")
  await expect(refEl).toHaveText(/^UT-F-[0-9A-Z]{6}$/, { timeout: 20_000 })
  const ref = (await refEl.textContent())!

  const staffCtx = await browser.newContext()
  const staff = await staffCtx.newPage()
  try {
    await staffSignIn(staff)
    await staff.goto(`${ADMIN}/queues?tab=all&q=${ref}`)
    await expect(staff.getByText(ref).first()).toBeVisible({ timeout: 20_000 })
    await staff.goto(`${ADMIN}/requests/${ref}`)
    const badge = staff.getByTestId("source-badge")
    await expect(badge).toContainText("Source: Apify / Google Flights, fetched")
    // The mock's synthetic fare is £231 (DIRECT fixture); staff with pricing.read.internal see it with the level and link.
    await expect(badge.getByTestId("source-price")).toContainText("231")
    await expect(badge.getByTestId("source-level")).toContainText("low")
    await expect(badge.getByTestId("source-link")).toHaveAttribute("href", /google\.com\/travel\/flights\?synthetic=/)
    await staff.getByTestId("revalidate-now").click()
    await expect(staff.getByTestId("revalidate-result")).toContainText("Still listed", { timeout: 60_000 })
  } finally {
    await staffCtx.close()
  }
  expect(mock.calls.filter((c) => c.method === "POST" && c.path.includes("/runs")).length).toBeGreaterThanOrEqual(2)
})
