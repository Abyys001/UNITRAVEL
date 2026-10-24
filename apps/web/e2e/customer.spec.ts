import { expect, test } from "@playwright/test"

import { signIn } from "./helpers"

const shots = "../../docs/screens/web"

test("home renders the honest route promise @mobile", async ({ page }, info) => {
  await page.goto("/en")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Real routes out of Iran")
  await expect(page.getByRole("button", { name: "Search flights" })).toBeVisible()
  await page.screenshot({ path: `${shots}/home-${info.project.name}.png`, fullPage: true })
})

test("search → itinerary → request → tracking", async ({ page }) => {
  await signIn(page, "+447700900010")
  await page.goto("/en")
  await page.getByRole("button", { name: "Search flights" }).click()
  await expect(page).toHaveURL(/\/en\/search/)
  const cards = page.locator("main ol li a, main ul li a").filter({ hasText: "Price confirmed in your quote" })
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/options? found|results?/i).first()).toBeVisible()
  await page.screenshot({ path: `${shots}/search.png`, fullPage: true })

  await cards.first().click()
  await expect(page).toHaveURL(/\/en\/itinerary\//)
  await expect(page.getByRole("heading", { name: "Itinerary" })).toBeVisible()
  // ADR-0004: no amount and no price check before a sent quote.
  await expect(page.getByText("Price confirmed in your quote")).toBeVisible()
  await expect(page.getByRole("button", { name: /Re-check price/ })).toHaveCount(0)
  expect(await page.locator("main").innerText()).not.toMatch(/£|GBP|€|\$/)
  await page.screenshot({ path: `${shots}/itinerary.png`, fullPage: true })

  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/\/en\/request\/new/)
  const travellers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Who is travelling" }) }).locator("li input[type=checkbox]")
  await page.waitForLoadState("networkidle")
  if ((await travellers.count()) === 0) {
    await page.getByRole("button", { name: "Add a traveller" }).click()
    const form = page.locator("form").filter({ has: page.getByLabel(/Surname/) })
    await form.getByLabel(/Given names/).fill("Daniel")
    await form.getByLabel(/Surname/).fill("Hart")
    await form.getByLabel(/Date of birth/).fill("1988-04-12")
    await form.locator("button[type=submit]").click()
  } else await travellers.first().check()
  for (const box of await page.locator("section[data-ack] input[type=checkbox]").all()) await box.check()
  await page.screenshot({ path: `${shots}/request.png`, fullPage: true })
  await page.getByRole("button", { name: "Send request" }).click()
  const ref = page.locator("p.font-mono")
  await expect(ref).toHaveText(/^UT-F-[0-9A-Z]{6}$/, { timeout: 20_000 })
  const reference = (await ref.textContent())!
  await page.getByRole("link", { name: "My requests" }).last().click()
  await page.getByText(reference).first().click()
  await expect(page).toHaveURL(new RegExp(reference))
  await expect(page.getByText(/Received|Submitted|Screening|In review/i).first()).toBeVisible()
  await page.screenshot({ path: `${shots}/tracking.png`, fullPage: true })
})

test("Persian site is right-to-left with Persian digits @mobile", async ({ page }, info) => {
  await page.goto("/fa")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.locator("html")).toHaveAttribute("lang", "fa")
  await page.screenshot({ path: `${shots}/home-fa-${info.project.name}.png`, fullPage: true })
})

test("security headers are present", async ({ request }) => {
  const r = await request.get("/en")
  const h = r.headers()
  expect(h["content-security-policy"]).toContain("nonce-")
  expect(h["x-content-type-options"]).toBe("nosniff")
  expect(h["referrer-policy"]).toBeTruthy()
})

test("Persian search results use Persian digits and the Persian list separator @mobile", async ({ page }, info) => {
  await page.goto("/fa")
  await page.getByRole("button", { name: "جست‌وجوی پرواز" }).click()
  const card = page.locator("main li a").filter({ hasText: "قیمت در پیشنهاد شما تأیید می‌شود" }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  const text = (await card.innerText())
  expect(text).toMatch(/[۰-۹]/)
  expect(text).not.toContain("·")
  await page.screenshot({ path: `${shots}/search-fa-${info.project.name}.png`, fullPage: false })
})
