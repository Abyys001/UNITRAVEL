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
