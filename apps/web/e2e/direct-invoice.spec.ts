import { expect, test } from "@playwright/test"

import { ADMIN_HOST, API, DEV_HOST, randomPhone, Session, signIn, STAFF, staffSession } from "../../api/test/client"

// ADR-0028, FAKE provider: staff bill a customer directly; the customer sees the services in the portal and pays there.
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"

test("a direct invoice shows its services and note, and is paid from the portal, in en and fa", async ({ page, context }) => {
  const dev = await staffSession(STAFF.developer, DEV_HOST)
  const owner = await staffSession(STAFF.owner, DEV_HOST)
  const admin = await staffSession(STAFF.admin, ADMIN_HOST)
  const ownerAdmin = await staffSession(STAFF.owner, ADMIN_HOST)
  const compliance = await staffSession(STAFF.compliance, ADMIN_HOST)
  expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
  const policy = async (action: "ALLOW" | "BLOCK") => {
    const p = await compliance.post("/v1/admin/compliance/policies", { type: "ONLINE_PAYMENT", key: "product:SERVICE", action, reason: `e2e: local test database only (${action})` })
    expect(p.status).toBe(201)
    expect((await ownerAdmin.post(`/v1/admin/compliance/policies/${p.body.id}/approve`)).status).toBe(200)
  }
  const c = new Session("WEB")
  await signIn(c, randomPhone("+4477009"), { givenNamesLatin: "Portal", surnameLatin: "Payer" })
  const customerUserId = (await c.get("/v1/me")).body.id as string
  const draft = await admin.post("/v1/admin/invoices", { customerUserId, currency: "GBP", dueDays: 7, notes: "See you in Mashhad", lines: [
    { serviceType: "VISA", description: "Schengen visa support", quantity: 1, unitAmountMinor: 15000 },
    { serviceType: "TRAIN", description: "Tehran to Mashhad", quantity: 2, unitAmountMinor: 2500 },
  ] })
  expect(draft.status).toBe(201)
  const number = (await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)).body.number as string
  await context.addCookies([...c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))

  try {
    await page.goto("/en/billing")
    await expect(page.getByText(number).first()).toBeVisible()
    await page.goto(`/en/billing/${number}`)
    const detail = page.getByTestId("invoice-detail")
    await expect(detail).toContainText("Schengen visa support")
    await expect(detail).toContainText("Tehran to Mashhad")
    await expect(page.getByTestId("line-type").first()).toHaveText("Visa")
    await expect(page.getByTestId("invoice-notes")).toContainText("See you in Mashhad")
    await expect(page.getByTestId("pay-online")).toHaveCount(0)
    await page.goto(`/fa/billing/${number}`)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.getByTestId("line-type").first()).toHaveText("ویزا")

    await policy("ALLOW")
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
    await expect(async () => {
      await page.goto(`/en/billing/${number}`)
      await expect(page.getByTestId("pay-online")).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 25_000 })
    await page.getByTestId("pay-online").click()
    await expect(page.getByTestId("pay-amount")).toHaveText("£200")
    await page.getByTestId("pay-start").click()
    await page.getByTestId("fake-pay").click()
    await expect(page.getByTestId("pay-return")).toHaveAttribute("data-state", "paid", { timeout: 20_000 })
    expect((await c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("PAID")
  } finally {
    await policy("BLOCK")
    await owner.put(FLAG, { enabled: false })
  }
  expect(API).toBeTruthy()
})
