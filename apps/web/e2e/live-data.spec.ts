import { expect, test } from "@playwright/test"

// ADR-0034: /search is a server component reading the stored catalog (GET /v1/flights/search); nothing in the browser can start a provider call.
// These run against the real API and read only. KUL-OSL is not on the watchlist, so its state does not depend on what the pacer has stored.
const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
const FORBIDDEN = /priceLevel|bookingToken|googleFlightsUrl|google\.com\/travel|"price"|"amount"/

for (const locale of ["en", "fa"] as const) {
  test(`untracked route: not-tracked state and ask-our-team, no test data, no browser flight-search call (${locale})`, async ({ page }) => {
    const calls: string[] = []
    page.on("request", (r) => { if (r.url().includes("/flight-searches")) calls.push(r.url()) })
    await page.goto(`/${locale}/search?from=KUL&to=OSL&date=${day}`)
    const state = page.getByTestId("catalog-not_tracked")
    await expect(state).toBeVisible()
    await expect(state).toContainText(locale === "en" ? "We don't track this route automatically yet" : "این مسیر را هنوز خودکار دنبال نمی‌کنیم")
    const ask = state.getByRole("link", { name: locale === "en" ? "Ask our team to find options" : "از تیم ما بخواهید گزینه پیدا کند" })
    await expect(ask).toBeVisible()
    await expect(ask).toHaveAttribute("href", new RegExp(`/${locale}/(request/new\\?manual=|sign-in\\?next=)`))
    await expect(page.getByText(locale === "en" ? "TEST DATA" : "دادهٔ آزمایشی")).toHaveCount(0)
    expect(calls).toEqual([])
    expect(await page.content()).not.toMatch(FORBIDDEN)
  })
}

test("watchlist route: renders one catalog state (results, stale or empty) without any amount", async ({ page }) => {
  await page.goto(`/en/search?from=IKA&to=IST&date=${day}`)
  const states = ["catalog-result", "catalog-date-group", "catalog-empty", "catalog-unavailable"].map((id) => page.getByTestId(id).first())
  await expect.poll(async () => (await Promise.all(states.map((s) => s.isVisible()))).some(Boolean)).toBe(true)
  await expect(page.getByTestId("catalog-not_tracked")).toHaveCount(0)
  const body = await page.locator("main").innerText()
  expect(body).not.toMatch(/[£$€]\s?\d|\d\s?(GBP|USD|EUR)/)
  expect(await page.content()).not.toMatch(FORBIDDEN)
})
