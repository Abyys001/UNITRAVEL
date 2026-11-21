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

test("visa: the request fills without an account; sending asks to sign in and keeps the draft", async ({ page }) => {
  await page.goto("/en/visa")
  // ADR-0041: the request is a guided wizard under the checker.
  await page.getByTestId("visa-request-start").click()
  await page.locator("#v-dest-control").click()
  await page.locator("#v-dest-opt-TR").click()
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByTestId("visa-docs-signed-out")).toBeVisible()
  await page.locator("#v-note").fill("keep me")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByTestId("visa-non-guarantee")).toBeVisible()
  await page.getByRole("checkbox", { name: /does not book or buy anything/ }).check()
  await page.getByRole("checkbox", { name: /privacy notice/ }).check()
  await page.getByRole("button", { name: "Sign in to send request" }).click()
  await expect(page).toHaveURL(/sign-in\?next=%2Fen%2Fvisa/)
  await expect(page.getByTestId("remember-note")).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem("ut_draft:svc:VISA"))).toContain("keep me")
})

for (const [path, testCity, draftKey] of [["/en/trains", "Mashhad", "TRAIN"], ["/en/buses", "Shiraz", "BUS"]] as const) {
  test(`${path}: hero with From and To city pickers, no listing section, route survives sign-in`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByTestId("ground-hero").getByRole("heading", { level: 1 })).toBeVisible()
    await expect(page.getByPlaceholder("Filter by destination")).toHaveCount(0)
    await expect(page.getByTestId("listing-grid")).toHaveCount(0)

    const from = page.getByRole("button", { name: /^From/ })
    const to = page.getByRole("button", { name: /^To/ })
    const pick = async (trigger: typeof from, city: string) => {
      await trigger.click()
      await page.getByRole("combobox").fill(city)
      await page.getByRole("option", { name: city, exact: true }).click()
    }

    await from.click()
    const groups = page.getByRole("listbox").getByRole("group")
    expect(await groups.first().getByRole("option").count()).toBe(10)
    const ids = await page.getByRole("option").evaluateAll((els) => els.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
    await page.keyboard.press("Escape")

    await pick(from, "Tehran")
    await pick(to, "Tehran")
    await expect(page.locator("#g-to-error").filter({ hasText: "must be different" })).toBeVisible()
    await pick(to, testCity)

    await page.getByRole("checkbox").nth(0).check()
    await page.getByRole("checkbox").nth(1).check()
    await page.getByRole("button", { name: "Sign in to send request" }).click()
    await expect(page).toHaveURL(/sign-in\?next=/)
    const draft = await page.evaluate((k) => sessionStorage.getItem(`ut_draft:svc:${k}`), draftKey)
    expect(draft).toContain(testCity.toLowerCase())

    await page.goto(path)
    await expect(page.locator("#g-from")).toHaveValue("tehran")
    await expect(page.locator("#g-to")).toHaveValue(testCity.toLowerCase())
  })
}
