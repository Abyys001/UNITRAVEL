import { expect, test } from "@playwright/test"

import { API_ORIGIN, scanForLeaks } from "./support/leak"

// ADR-0037: the catalog detail page of a staff-captured option shows the class picker (booking class, seats, baggage, change/refund, deadline,
// age), never a price, and its request link carries `catalog` and `fare`. Uses the local fixture result (TK1999 IST→LHR); skipped when absent.

const FIXTURE = process.env.FB_FIXTURE_RESULT ?? "01a1f4bb-88be-70fa-8723-9b9908b6e763"
const MONEY = /[€$£]|\b(EUR|USD|GBP|TRY|IRR|AED)\b|\d[\d,.]*\s?(EUR|USD|GBP|TRY)\b|\bprice\b/i

type Fare = { id: string; cabin: string; bookingClasses: string[] }

test.describe("Flight Builder fare picker", () => {
  let fares: Fare[] = []
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API_ORIGIN}/v1/flights/results/${FIXTURE}`)
    if (res.ok()) fares = ((await res.json()) as { fares?: Fare[] }).fares ?? []
  })

  for (const locale of ["en", "fa"] as const) {
    test(`picker lists the classes, select enables a request link with catalog and fare, no price renders (${locale})`, async ({ page }) => {
      test.skip(fares.length === 0, "fixture result with captured fares is not in this database")
      const apiBodies: string[] = []
      page.on("response", async (r) => { if (r.url().includes("/v1/flights/results/")) apiBodies.push(await r.text().catch(() => "")) })
      await page.goto(`/${locale}/flights/results/${FIXTURE}`)
      const picker = page.getByTestId("fare-picker")
      await expect(picker).toBeVisible()
      await expect(picker.getByTestId("fare-option")).toHaveCount(fares.length)
      await expect(picker.getByTestId("fare-facts").first()).toBeVisible()
      if (locale === "fa") await expect(page.locator("html")).toHaveAttribute("dir", "rtl")

      const cta = page.getByTestId("request-fare")
      const target = fares[fares.length - 1]!
      if (fares.length > 1) await expect(cta).toBeDisabled()
      await picker.getByTestId("fare-option").nth(fares.length - 1).locator("input[type=radio]").check()
      await expect(cta).toBeEnabled()
      const href = decodeURIComponent((await cta.getAttribute("href")) ?? "")
      expect(href).toContain(`catalog=${FIXTURE}`)
      expect(href).toContain(`fare=${target.id}`)
      expect(href).toContain(`/${locale}/`)

      expect(await page.locator("main").innerText()).not.toMatch(MONEY)
      expect(await picker.innerText()).not.toMatch(/\d{3,}/) // no amount; seat counts and baggage kg are shorter
      expect(scanForLeaks(await page.content())).toEqual([])
      for (const body of apiBodies) expect(scanForLeaks(body)).toEqual([])
    })
  }
})
