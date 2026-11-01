import { expect, test } from "@playwright/test"

// Browsing is open: a signed-out visitor reads every service page and fills its form; sign-in is asked only when a
// request is sent, and the typed values are kept across it (form-draft).
const PAGES = ["/visa", "/hotels", "/trains", "/buses", "/stays", "/tours", "/cip", "/insurance", "/cargo", "/club", "/track", "/support"]

for (const p of PAGES) {
  test(`signed-out visitor can open ${p} without being sent to sign-in`, async ({ page }) => {
    await page.goto(`/en${p}`)
    await page.waitForTimeout(1500)
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
  })
}

test("visa: the form fills without an account; sending asks to sign in and keeps the draft", async ({ page }) => {
  await page.goto("/en/visa")
  await page.locator("#v-note").fill("keep me")
  await page.getByRole("checkbox").nth(0).check()
  await page.getByRole("checkbox").nth(1).check()
  await page.getByRole("button", { name: "Sign in to send request" }).click()
  await expect(page).toHaveURL(/sign-in\?next=%2Fen%2Fvisa/)
  await expect(page.getByTestId("remember-note")).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem("ut_draft:svc:VISA"))).toContain("keep me")
})

for (const [path, testCity, draftKey] of [["/en/trains", "Mashhad", "TRAIN"], ["/en/buses", "Shiraz", "BUS"]] as const) {
  test(`${path}: hero with From and To dropdowns, no listing section, route survives sign-in`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByTestId("ground-hero").getByRole("heading", { level: 1 })).toBeVisible()
    await expect(page.getByPlaceholder("Filter by destination")).toHaveCount(0)
    await expect(page.getByTestId("listing-grid")).toHaveCount(0)

    const from = page.getByLabel("From", { exact: true })
    const to = page.getByLabel("To", { exact: true })
    const ids = await from.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean))
    expect(new Set(ids).size).toBe(ids.length)
    expect(await from.locator("optgroup").first().locator("option").count()).toBe(10)

    await from.selectOption({ label: "Tehran" })
    await to.selectOption({ label: "Tehran" })
    await expect(page.getByRole("alert").filter({ hasText: "must be different" })).toBeVisible()
    await to.selectOption({ label: testCity })

    await page.getByRole("checkbox").nth(0).check()
    await page.getByRole("checkbox").nth(1).check()
    await page.getByRole("button", { name: "Sign in to send request" }).click()
    await expect(page).toHaveURL(/sign-in\?next=/)
    const draft = await page.evaluate((k) => sessionStorage.getItem(`ut_draft:svc:${k}`), draftKey)
    expect(draft).toContain(testCity.toLowerCase())

    await page.goto(path)
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("tehran")
    await expect(page.getByLabel("To", { exact: true })).toHaveValue(testCity.toLowerCase())
  })
}
