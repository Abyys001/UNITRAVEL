import { expect, test } from "@playwright/test"

// ADR-0041 D3: /search paginates (10 per page) and filters on the client over the stored-catalog response.
// /search is server-rendered, so the response cannot be mocked from the browser: this reads the real API like live-data.spec.ts.
// It needs a watchlist route with more than 10 stored flights on one day; set FLIGHT_RESULTS_PATH (for example
// `/en/search?from=IKA&to=IST&date=2026-12-01`) to point at one. Otherwise the tests skip rather than assert on data that is not there.
const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
const PATH = process.env.FLIGHT_RESULTS_PATH ?? `/en/search?from=IKA&to=IST&date=${day}`

test.describe("flight results pagination and filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PATH)
    const cards = page.getByTestId("catalog-result")
    await expect.poll(async () => (await cards.count()) + (await page.getByTestId("catalog-empty").count()) + (await page.getByTestId("catalog-unavailable").count())).toBeGreaterThan(0)
    test.skip((await page.getByTestId("flight-pagination").count()) === 0, "needs more than 10 stored flights for the route; set FLIGHT_RESULTS_PATH")
  })

  test("shows 10 per page, next page moves the list and keeps the URL in sync", async ({ page }) => {
    const cards = page.getByTestId("catalog-result")
    await expect(cards).toHaveCount(10)
    await expect(page.getByTestId("flight-count")).toContainText(/Showing 1–10 of \d+ flights/)
    const firstOnPage1 = await cards.first().innerText()
    await page.getByTestId("page-next").click()
    await expect(page).toHaveURL(/[?&]p=2\b/)
    await expect(page.getByTestId("flight-count")).toContainText(/Showing 11–/)
    await expect(page.getByRole("heading", { name: "Flights" })).toBeFocused()
    expect(await cards.first().innerText()).not.toBe(firstOnPage1)
    await expect(page.getByTestId("page-2")).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("navigation", { name: "Flight results pages" })).toBeVisible()
  })

  test("page in the URL is restored on load and an out-of-range page clamps", async ({ page }) => {
    await page.goto(`${PATH}&p=2`)
    await expect(page.getByTestId("page-2")).toHaveAttribute("aria-current", "page")
    await page.goto(`${PATH}&p=9999`)
    await expect(page.getByTestId("flight-count")).toBeVisible()
    await expect(page.locator("[data-testid^=page-][aria-current=page]")).toHaveCount(1)
  })

  test("a filter resets the page to 1 and is kept in the URL; clear removes it", async ({ page }) => {
    await page.getByTestId("page-next").click()
    await expect(page).toHaveURL(/[?&]p=2\b/)
    await page.getByRole("combobox", { name: "Stops" }).click()
    await page.getByRole("option", { name: "Direct only" }).click()
    await expect(page).toHaveURL(/[?&]stops=direct\b/)
    await expect(page).not.toHaveURL(/[?&]p=/)
    const clear = page.getByTestId("clear-filters")
    await expect(clear).toBeVisible()
    await clear.click()
    await expect(page).not.toHaveURL(/stops=/)
  })

  test("no horizontal scroll at 360, 768 and 1280", async ({ page }) => {
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
  })
})
