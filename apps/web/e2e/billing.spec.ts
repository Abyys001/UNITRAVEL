import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { receivedShipment } from "../../api/test/cargo-fixture"
import { ADMIN_HOST, API, STAFF, staffSession } from "../../api/test/client"

// Phase C. The shipment, the invoice and its issue go through the real API and staff commands; the browser is then
// signed in with the customer's session cookies (no second OTP for the same phone). The customer has a random
// +98912 number, so the shared +447700900010 / +447700900077 numbers stay untouched. Staff phones: the owner seeds the shipment and the admin issues the
// invoice, neither is used by another web spec (shipments.spec signs the cargo admin in), so no phone gets a second OTP request.
test("Documents & billing: issued invoice in en and fa, the short link needs a sign-in, a cancelled invoice says not to pay it", async ({ page, browser, context }) => {
  const { c, ref } = await receivedShipment("WEB", STAFF.owner)
  const staff = await staffSession(STAFF.admin, ADMIN_HOST)
  const draft = await staff.post(`/v1/admin/requests/${ref}/invoices`)
  expect(draft.status).toBe(201)
  const since = Date.now() - 2000
  const issued = await staff.post(`/v1/admin/invoices/${draft.body.id}/issue`)
  expect(issued.status).toBe(200)
  const number: string = issued.body.number

  // The customer has no verified email, so the notice came by SMS (decision 6); its short link goes through the sign-in.
  let link = ""
  for (let i = 0; i < 40 && !link; i++) {
    const sink = (await (await fetch(`${API}/v1/dev-sink/sms`)).json()) as { body: string; at: string }[]
    link = sink.find((m) => m.body.includes(number) && Date.parse(m.at) >= since)?.body.match(/https?:\/\/\S+\/s\/\w+/)?.[0] ?? ""
    if (!link) await new Promise((r) => setTimeout(r, 250))
  }
  expect(link).toMatch(/\/s\/\w+/)
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(new URL(new URL(link).pathname, process.env.WEB_URL ?? "http://localhost:4000").toString())
  await expect(anonPage).toHaveURL(/\/sign-in\?next=/)
  expect(decodeURIComponent(anonPage.url())).toContain(`/billing/${number}`)
  await anon.close()

  await context.addCookies([...c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))

  await page.goto("/en/billing")
  await expect(page.getByRole("heading", { name: "Documents & billing" })).toBeVisible()
  const row = page.getByTestId("invoice-row").filter({ hasText: number })
  await expect(row).toBeVisible()
  await expect(row.getByTestId("invoice-total")).toHaveText("£50")
  await expect(row.getByTestId("invoice-status")).toHaveText("Awaiting payment")
  await expect(page.getByTestId("quotation-row").filter({ hasText: ref })).toContainText(/QT-\d{4}-\d{6}/)
  await expect(page.getByRole("link", { name: "Documents & billing" }).first()).toBeVisible()
  await page.screenshot({ path: "../../docs/screens/web/billing-en.png", fullPage: true })

  // The short link, signed in: lands on the invoice itself.
  await page.goto(new URL(new URL(link).pathname, process.env.WEB_URL ?? "http://localhost:4000").toString())
  await expect(page).toHaveURL(new RegExp(`/en/billing/${number}$`))
  const detail = page.getByTestId("invoice-detail")
  await expect(detail).toContainText(number)
  await expect(detail.getByTestId("invoice-total")).toHaveText("£50")
  await expect(detail.getByRole("button", { name: "Download PDF" })).toBeVisible()
  await expect(detail).toContainText("If it is still unpaid, this invoice expires on")
  const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => v.id)).toEqual([])

  await page.goto("/fa/billing")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.getByRole("heading", { name: "اسناد و صورتحساب" })).toBeVisible()
  const faRow = page.getByTestId("invoice-row").filter({ hasText: number })
  await expect(faRow.getByTestId("invoice-status")).toHaveText("در انتظار پرداخت")
  await expect(faRow).not.toContainText("ISSUED")
  await page.screenshot({ path: "../../docs/screens/web/billing-fa.png", fullPage: true })
  await page.goto(`/fa/billing/${number}`)
  await expect(page.getByTestId("invoice-detail")).toContainText("اگر پرداخت نشود")

  // Cancelled: the customer is told not to pay it, in both languages, and the internal note stays internal.
  const cancelled = await staff.post(`/v1/admin/invoices/${draft.body.id}/cancel`, { reasonCode: "CORRECTION", note: "internal wording fix" })
  expect(cancelled.status).toBe(200)
  await page.reload()
  await expect(page.getByTestId("invoice-detail")).toContainText("آن را پرداخت نکنید")
  await expect(page.getByTestId("invoice-detail")).not.toContainText("internal wording fix")
  await page.goto(`/en/billing/${number}`)
  await expect(page.getByTestId("invoice-detail")).toContainText("Do not pay it")
  await expect(page.getByTestId("invoice-status")).toHaveText("Cancelled")
})
