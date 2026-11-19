import { expect, test } from "@playwright/test"

import { ADMIN, DEV, STAFF, staffPage } from "./helpers"

// ADR-0037 in the consoles, read-only against the running stack: the capture list and form render for staff with catalog.capture, and the
// Developer Panel shows the gate closed with no credential value. Nothing is saved, retired or refreshed here (the API e2e covers writes).

test.describe.configure({ mode: "serial" })

test("Admin Panel: the captured options list and the capture form render", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.goto(`${ADMIN}/catalog/flight-builder`)
  await expect(page.getByTestId("fb-page")).toBeVisible()
  await expect(page.getByTestId("fb-new")).toBeVisible()
  await page.goto(`${ADMIN}/catalog/flight-builder/new`)
  const form = page.getByTestId("fb-capture")
  await expect(form).toBeVisible()
  await expect(form.getByTestId("fb-fare").first()).toBeVisible()
  await expect(form.getByTestId("fb-submit")).toBeVisible()
  await page.goto(`${ADMIN}/catalog/flight-builder/usage`)
  await expect(page.getByTestId("fb-usage")).toBeVisible()
})

test("Developer Panel: the gate is closed without a written authorisation and no credential value is on the page", async ({ browser }) => {
  const page = await staffPage(browser, DEV, STAFF.developer)
  await page.goto(`${DEV}/providers/flight-builder`)
  await expect(page.getByTestId("fb-dev")).toBeVisible()
  await expect(page.getByTestId("fb-state-desc")).toBeVisible()
  await expect(page.getByTestId("fb-gate-closed")).toBeVisible()
  await expect(page.getByTestId("fb-gate-open")).toHaveCount(0)
  await expect(page.getByTestId("fb-auth-none")).toBeVisible()
  const html = await page.content()
  expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/)
  expect(html).not.toMatch(/"(username|password)"\s*:\s*"[^"]+"/)
})
