import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { API, DEV_HOST, randomPhone, Session, solvePow, STAFF, staffSession } from "../../api/test/client"
import { signIn } from "./helpers"

// Phase I (spec §4.1–4.6, ADR-0015/0016): the menu follows GET /v1/site, switched-off services are never advertised,
// a visa request goes from form to detail page to My requests and Track, support never shows placeholder contacts.
const FLAGS = ["services.visa.enabled", "hotels.enabled", "loyalty.enabled"] as const
let dev: Session
const initial: Record<string, boolean> = {}
const anon = new Session("WEB")
const MENU: Record<(typeof FLAGS)[number], string> = { "services.visa.enabled": "visa", "hotels.enabled": "hotels", "loyalty.enabled": "club" }

async function setFlag(key: (typeof FLAGS)[number], enabled: boolean) {
  expect((await dev.put(`/v1/dev/feature-flags/${key}`, { enabled })).status).toBe(200)
  for (let i = 0; i < 60; i++) {
    if ((await anon.get("/v1/site")).body.menu[MENU[key]] === enabled) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`flag ${key} did not reach /v1/site`)
}

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

/** The OTP resend cooldown also applies to demo staff: wait it out once instead of failing the whole file. */
async function devSession(): Promise<Session> {
  try { return await staffSession(STAFF.developer, DEV_HOST) } catch (e) {
    const wait = Number(/"retryAfter":(\d+)/.exec(String(e))?.[1] ?? 0)
    if (!wait) throw e
    await new Promise((r) => setTimeout(r, (wait + 2) * 1000))
    return staffSession(STAFF.developer, DEV_HOST)
  }
}

test.beforeAll(async () => {
  test.setTimeout(150_000)
  dev = await devSession()
  const menu = (await anon.get("/v1/site")).body.menu
  for (const k of FLAGS) initial[k] = menu[MENU[k]]
  for (const k of FLAGS) await setFlag(k, false)
})
test.afterAll(async () => {
  if (!dev) return
  for (const k of FLAGS) await dev.put(`/v1/dev/feature-flags/${k}`, { enabled: initial[k] ?? false })
})

test("menu: switched-off services are absent; turning visa on adds it to the Services menu", async ({ page, browser }) => {
  await page.goto("/en")
  const main = page.getByRole("navigation", { name: "Main" })
  await expect(main.getByRole("link", { name: "Flights" })).toBeVisible()
  await expect(main.getByRole("link", { name: "Track a purchase" })).toBeVisible()
  await expect(main.getByRole("link", { name: "Hotels" })).toHaveCount(0)
  await main.getByRole("button", { name: "Services" }).click()
  await expect(page.getByRole("link", { name: "Visa" })).toHaveCount(0)
  await expect(page.locator("#services-menu").getByRole("link", { name: "Send cargo" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator("#services-menu")).toHaveCount(0)

  await setFlag("services.visa.enabled", true)
  await setFlag("hotels.enabled", true)
  // /v1/site is cacheable for 60 s (spec §4.1), so a new visitor (fresh context) sees the change.
  const fresh = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await fresh.goto("/fa")
  const mainFa = fresh.getByRole("navigation", { name: "Main" })
  await expect(mainFa.getByRole("link", { name: "هتل" })).toBeVisible()
  await mainFa.getByRole("button", { name: "خدمات" }).click()
  await expect(fresh.locator("#services-menu").getByRole("link", { name: "ویزا" })).toBeVisible()
  await fresh.context().close()
  await setFlag("hotels.enabled", false)
})

test("a switched-off service page says it is not available and points to support", async ({ page }) => {
  await setFlag("services.visa.enabled", false)
  for (const p of ["/en/visa", "/en/trains"]) {
    await page.goto(p)
    await expect(page.getByTestId("service-unavailable")).toBeVisible()
    await expect(page.getByText("This service is not available yet")).toBeVisible()
  }
  await axeClean(page)
})

test("hotels page: the guide always shows; the promise, steps and request form only with hotels.enabled (ADR-0017)", async ({ page, browser }) => {
  await setFlag("hotels.enabled", false)
  await page.goto("/en/hotels")
  await expect(page.getByText("Hotel booking is not open yet", { exact: false })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Types of hotels and accommodation" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Meal plans and levels of service" })).toBeVisible()
  await expect(page.getByTestId("hotel-steps")).toHaveCount(0)
  await expect(page.locator("#request")).toHaveCount(0)
  await axeClean(page)

  await setFlag("hotels.enabled", true)
  const fresh = await (await browser.newContext()).newPage()
  await fresh.goto("/fa/hotels")
  await expect(fresh.getByTestId("hotel-steps").getByRole("listitem")).toHaveCount(5)
  await expect(fresh.getByTestId("service-sign-in")).toBeVisible()
  await axeClean(fresh)
  await fresh.context().close()
  await setFlag("hotels.enabled", false)
})

test("visa request: form, detail page with the sent notice, listed in My requests and Track", async ({ page }) => {
  await setFlag("services.visa.enabled", true)
  const email = `visa-${Date.now()}@example.test`
  await signIn(page, email)
  // A phone and a traveller are needed; add them through the API with the page's own session cookies.
  const cookies = await page.context().cookies()
  const csrf = cookies.find((c) => c.name === "ut_csrf")?.value ?? ""
  const headers = { "x-csrf-token": csrf, "content-type": "application/json" }
  const t = await page.request.post("/api/v1/me/travellers", { headers, data: { title: "MS", givenNames: "Visa", surname: "Applicant", dateOfBirth: "1992-02-02", genderOnDocument: "F", nationality: "IR", relationship: "SELF" } })
  expect(t.status()).toBe(201)
  // An email-only account adds and verifies a phone first (the contact we call), with the code from the local SMS sink.
  const deviceId = (await page.evaluate(() => localStorage.getItem("ut_device"))) ?? "web-e2e-device-000001"
  const phoneBody = { type: "PHONE", value: randomPhone("+4477009"), deviceId }
  let add = await page.request.post("/api/v1/me/identities", { headers, data: phoneBody })
  // After many codes from one IP the API asks for the proof-of-work check, exactly as the sign-in screen solves it.
  if (add.status() === 428) add = await page.request.post("/api/v1/me/identities", { headers, data: { ...phoneBody, challenge: solvePow((await add.json()).challenge) } })
  expect(add.status()).toBe(202)
  const { challengeId, normalised } = await add.json()
  let code = ""
  for (let i = 0; i < 40 && !code; i++) {
    const sms = (await (await page.request.get(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string }[]
    code = sms.filter((m) => m.to === normalised).map((m) => /(\d{6})/.exec(m.body)?.[1] ?? "").filter(Boolean).pop() ?? ""
    if (!code) await page.waitForTimeout(250)
  }
  expect((await page.request.post("/api/v1/auth/otp/verify", { headers, data: { challengeId, code, deviceId, client: "WEB" } })).status()).toBe(200)

  await page.goto("/en/visa")
  await expect(page.getByRole("heading", { name: "Visa services" })).toBeVisible()
  await page.getByLabel("Destination country").selectOption("TR")
  await page.getByRole("checkbox", { name: /visa applicant/i }).check()
  await page.getByRole("checkbox", { name: /does not book or buy anything/ }).check()
  await page.getByRole("checkbox", { name: /privacy notice/ }).check()
  await axeClean(page)
  await page.getByRole("button", { name: "Send request" }).click()
  await expect(page).toHaveURL(/\/en\/services\/UT-S-/)
  await expect(page.getByTestId("request-sent")).toBeVisible()
  await expect(page.getByTestId("service-status")).toHaveText("Received")
  const ref = page.url().split("/").pop()!
  await page.goto("/en/requests")
  await expect(page.getByTestId("service-requests").getByText(ref)).toBeVisible()
  await page.goto("/en/track")
  await expect(page.getByTestId("track-list").getByText(ref)).toBeVisible()
})

test("support never shows placeholder contacts; club page follows its flag", async ({ page }) => {
  await page.goto("/en/support")
  await expect(page.getByTestId("support-contacts")).toContainText("Our contact details will appear here soon.")
  await expect(page.getByText("help@unitravel.example")).toHaveCount(0)
  await expect(page.getByText(/24.hour/i)).toHaveCount(0)
  await axeClean(page)

  await signIn(page, `club-${Date.now()}@example.test`)
  await page.goto("/en/club")
  await expect(page.getByText("The customer club is not available yet.")).toBeVisible()
  await setFlag("loyalty.enabled", true)
  await page.reload()
  await expect(page.getByText(/You are not a club member yet/)).toBeVisible()
  await axeClean(page)
})

test("track: signed-out lookup never says whether the reference matched", async ({ page }) => {
  await page.goto("/fa/track")
  await expect(page.getByRole("heading", { name: "پیگیری خرید" })).toBeVisible()
  await page.getByLabel("شمارهٔ پیگیری", { exact: true }).fill("UT-S-NOPE00")
  await page.getByLabel("شماره تلفن ثبت‌شده در درخواست").fill(randomPhone("+4477009"))
  await page.getByRole("button", { name: "ارسال کد" }).click()
  await expect(page.getByRole("status").filter({ hasText: "اگر شمارهٔ پیگیری و شماره تلفن با هم بخوانند" })).toBeVisible()
  await axeClean(page)
})
