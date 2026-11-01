import { expect, test } from "@playwright/test"

// Villas and stays page: destinations prefill the request, the range calendar works in both calendars, the note box does
// not resize, and values survive the sign-in round trip. Needs stays.enabled on; otherwise the page is "unavailable".
test.describe("villas and stays", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/en/stays")
    await page.waitForLoadState("networkidle")
    test.skip(await page.getByTestId("service-unavailable").isVisible(), "stays flag is off")
  })

  test("choosing a destination fills in the request and the region filter narrows the list", async ({ page }) => {
    await page.getByTestId("city-isfahan").click()
    await expect(page.locator("#s-loc")).toHaveValue("Isfahan")
    await page.getByRole("button", { name: "Gulf islands" }).click()
    await expect(page.getByTestId("city-kish")).toBeVisible()
    await expect(page.getByTestId("city-isfahan")).toHaveCount(0)
  })

  test("the calendar picks a range and reports the nights", async ({ page }) => {
    await page.getByTestId("stay-dates").click()
    const cal = page.getByTestId("stay-calendar")
    await expect(cal).toBeVisible()
    await cal.getByRole("button", { name: "Next month" }).click()
    const days = cal.locator("[data-day]:not([disabled])")
    await days.nth(3).click()
    await days.nth(7).click()
    await expect(cal).toBeHidden()
    await expect(page.getByTestId("stay-dates")).toContainText("4 nights")
  })

  test("the note box has a fixed size", async ({ page }) => {
    const note = page.locator("#s-note")
    const before = await note.boundingBox()
    await note.fill(Array(40).fill("A long line of notes.").join("\n"))
    const after = await note.boundingBox()
    expect({ w: after?.width, h: after?.height }).toEqual({ w: before?.width, h: before?.height })
    await expect(note).toHaveCSS("resize", "none")
  })

  test("the Persian page opens a Solar Hijri calendar", async ({ page }) => {
    await page.goto("/fa/stays")
    await page.getByTestId("stay-dates").click()
    await expect(page.getByTestId("stay-calendar").getByRole("grid").first()).toHaveAttribute("aria-label", /^\S+ ۱۴۰[۰-۹]$/)
  })

  test("the phone layout does not scroll sideways @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ["/en/stays", "/fa/stays"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    }
  })

  test("typed values survive the sign-in draft", async ({ page }) => {
    await page.getByTestId("city-shiraz").click()
    await page.locator("#s-note").fill("keep me")
    const dates = await page.locator("#s-in").inputValue()
    await page.getByRole("checkbox").nth(0).check()
    await page.getByRole("checkbox").nth(1).check()
    await page.getByRole("button", { name: "Sign in to send request" }).click()
    await expect(page).toHaveURL(/sign-in/)
    const saved = await page.evaluate(() => sessionStorage.getItem("ut_draft:svc:STAY"))
    expect(saved).toContain("keep me")
    expect(saved).toContain("Shiraz")
    expect(saved).toContain(dates)
  })
})
