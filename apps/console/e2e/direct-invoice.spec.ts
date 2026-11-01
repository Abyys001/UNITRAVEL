import { expect, test } from "@playwright/test"

import { randomPhone, Session, signIn } from "../../api/test/client"
import { ADMIN, STAFF, staffPage } from "./helpers"

// ADR-0028: staff create a direct invoice for a chosen customer, issue it, and the customer sees it in billing.
test.describe.configure({ mode: "serial" })

const surname = `Invoice${Date.now().toString(36)}`
let customer: Session
let invoiceUrl = ""

test.beforeAll(async () => {
  customer = new Session("MOBILE")
  await signIn(customer, randomPhone("+98912"), { givenNamesLatin: "Direct", surnameLatin: surname })
})

test("create a direct invoice for a searched customer, with a discount line, and issue it", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.owner)
  await page.goto(`${ADMIN}/invoices`)
  await page.getByTestId("new-invoice").click()
  const dlg = page.getByTestId("dlg-direct-invoice")
  await expect(dlg).toContainText(/Flights and cargo are invoiced from their request/)

  await dlg.getByTestId("customer-search").fill(surname)
  await dlg.getByTestId("customer-results").getByRole("button").first().click()
  await expect(dlg.getByTestId("invoice-customer")).toContainText(surname)

  await dlg.getByTestId("line-type").first().selectOption("HOTEL")
  await dlg.getByTestId("line-description").first().fill("Two nights in Istanbul")
  await dlg.getByTestId("line-qty").first().fill("2")
  await dlg.getByTestId("line-price").first().fill("100")
  await dlg.getByTestId("add-line").click()
  await dlg.getByTestId("line-type").nth(1).selectOption("DISCOUNT")
  await dlg.getByTestId("line-description").nth(1).fill("Loyalty discount")
  await dlg.getByTestId("line-price").nth(1).fill("20")
  await expect(dlg.getByTestId("invoice-total")).toContainText("180.00")
  await dlg.getByTestId("invoice-notes").fill("Thank you for booking with us")

  await dlg.getByTestId("issue-send").click()
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 20_000 })
  invoiceUrl = page.url()
  await expect(page.getByTestId("invoice-status")).toContainText(/ISSUED/i)
  await expect(page.getByTestId("invoice-number")).toHaveText(/^INV-/)
  await expect(page.getByTestId("invoice-lines-table")).toContainText("Loyalty discount")
  await expect(page.getByTestId("invoice-notes-shown")).toContainText("Thank you for booking")
  // The customer signed in by phone only, so no email can be sent and staff are told.
  await expect(page.getByTestId("no-email-warning")).toBeVisible()
  await expect(page.getByTestId("invoice-detail-total")).toContainText("180.00")
})

test("the invoice is in the list with its customer and the customer sees it to pay", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.owner)
  await page.goto(`${ADMIN}/invoices`)
  await page.getByRole("searchbox").fill(surname)
  const row = page.getByTestId("invoice-table").locator("tr", { hasText: surname })
  await expect(row).toBeVisible()
  await expect(row.getByTestId("invoice-link")).toHaveAttribute("href", new RegExp(`${new URL(invoiceUrl).pathname}$`))
  await expect(row.getByText(/^UT-D-/)).not.toHaveAttribute("href", /.+/)

  const docs = await customer.get("/v1/billing/documents")
  expect(docs.status).toBe(200)
  const inv = docs.body.invoices.find((i: { requestRef: string }) => i.requestRef.startsWith("UT-D-"))
  expect(inv.status).toBe("ISSUED")
  expect(inv.total.amountMinor).toBe(18000)
  expect(inv.lines.map((l: { serviceType: string }) => l.serviceType)).toEqual(["HOTEL", "DISCOUNT"])
})

test("offline payment from the invoice page settles it, and Persian descriptions show in their own direction", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.owner)
  await page.goto(`${ADMIN}/invoices`)
  await page.getByTestId("new-invoice").click()
  const dlg = page.getByTestId("dlg-direct-invoice")
  await dlg.getByTestId("customer-search").fill(surname)
  await dlg.getByTestId("customer-results").getByRole("button").first().click()
  await dlg.getByTestId("line-type").first().selectOption("BUS")
  await dlg.getByTestId("line-description").first().fill("اتوبوس تهران به مشهد")
  await dlg.getByTestId("line-price").first().fill("25")
  await dlg.getByTestId("issue-send").click()
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 20_000 })
  await expect(page.getByTestId("invoice-lines-table")).toContainText("اتوبوس تهران به مشهد")
  await page.getByRole("button", { name: "Record payment" }).click()
  const pay = page.getByTestId("dlg-invoice-payment")
  await pay.getByTestId("pay-amount").fill("25")
  await pay.getByTestId("pay-ref").fill(`E2E-${Date.now()}`)
  await pay.getByTestId("pay-payer").fill("Offline Payer")
  await pay.locator("button[type=submit]").click()
  await expect(page.getByTestId("invoice-status")).toContainText(/PAID/i, { timeout: 20_000 })
})
