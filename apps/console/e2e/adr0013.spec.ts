import { expect, test } from "@playwright/test"

import { ADMIN, ensureNewRequest, shot, STAFF, staffPage } from "./helpers"

/** ADR-0013 in the Admin Panel: amend the trip with a reason; extra services and a discount in the quote builder. */
test.describe.configure({ mode: "serial" })
const freshPhone = () => `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`

test("amend the trip, then price an option with an extra service and a discount", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  const ref = await ensureNewRequest(page, freshPhone())
  await page.goto(`${ADMIN}/requests/${ref}`)
  await expect(page.getByTestId("ref")).toHaveText(ref)
  await page.keyboard.press("c")
  await expect(page.getByTestId("status")).toHaveText("IN REVIEW")

  await page.getByTestId("amend-open").click()
  const dlg = page.getByTestId("amend-dialog")
  await expect(dlg).toBeVisible()
  const date = dlg.getByTestId("amend-slice-0").getByLabel("Date")
  const before = await date.inputValue()
  const next = new Date(Date.parse(`${before}T00:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10)
  await date.fill(next)
  await dlg.getByLabel(/Reason/).fill("Customer phoned: one week later")
  await shot(page, "admin-amend-dialog")
  await dlg.getByRole("button", { name: "Save amendment" }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByText(next).first()).toBeVisible()
  await expect(page.getByText(/Amended: trip/).first()).toBeVisible()
  await expect(page.getByTestId("status")).toHaveText("IN REVIEW") // not a status change

  await page.getByTestId("open-quote-builder").click()
  await page.getByRole("button", { name: "+ Manual entry" }).click()
  const option = page.getByTestId("option-0")
  await option.getByLabel("Fare").fill("350.00")
  await option.getByLabel("Taxes").fill("0")
  await option.getByLabel("Service fee").fill("10.00")
  await option.getByRole("button", { name: "Add extra service" }).click()
  await option.getByTestId("extra-0").getByLabel("Extra service 1").fill("Extra checked bag")
  await option.getByTestId("extra-0").getByLabel("Amount").fill("25.00")
  await option.getByLabel("Discount reason").fill("Returning customer")
  await option.getByLabel("Discount", { exact: true }).fill("15.00")
  await expect(option.getByTestId("option-total")).toHaveText(/370\.00/)
  // An extra with no amount is flagged and blocks sending.
  await option.getByTestId("extra-0").getByLabel("Amount").fill("")
  await expect(option.getByTestId("option-total")).toHaveText("—")
  await option.getByTestId("extra-0").getByLabel("Amount").fill("25.00")
  await option.scrollIntoViewIfNeeded()
  await shot(page, "admin-quote-builder-extras")
})
