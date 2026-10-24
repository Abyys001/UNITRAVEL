import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { receivedShipment } from "../../api/test/cargo-fixture"
import { ADMIN_HOST, DEV_HOST, STAFF, staffSession } from "../../api/test/client"

// Phase D (ADR-0007), FAKE provider: the pay page, the return page and the flag. Shipments and invoices come from the real API
// and staff commands, as in billing.spec; the same staff phones are used (one sign-in each per run, cached by the helper).
const FLAG = "/v1/dev/feature-flags/payments.online.enabled"

test.describe.configure({ mode: "serial" })

test("online payment: flag off hides it; on, a FAKE payment settles the invoice only through the webhook, in en and fa", async ({ page, context }) => {
  const dev = await staffSession(STAFF.developer, DEV_HOST)
  const owner = await staffSession(STAFF.owner, DEV_HOST)
  const admin = await staffSession(STAFF.admin, ADMIN_HOST)
  expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
  expect((await owner.put(FLAG, { enabled: false })).status).toBe(200)

  const issue = async (c: Awaited<ReturnType<typeof receivedShipment>>) => {
    const draft = await admin.post(`/v1/admin/requests/${c.ref}/invoices`)
    expect(draft.status).toBe(201)
    const issued = await admin.post(`/v1/admin/invoices/${draft.body.id}/issue`)
    expect(issued.status).toBe(200)
    return issued.body.number as string
  }
  const ship = await receivedShipment("WEB", STAFF.owner)
  const number = await issue(ship)
  await context.addCookies([...ship.c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))

  try {
    // Flag off (the default): no pay button, and the pay page says it is not available. Offline payment text stays.
    await page.goto(`/en/billing/${number}`)
    await expect(page.getByTestId("invoice-detail")).toContainText("Your Uni Travel contact tells you how to pay.")
    await expect(page.getByTestId("pay-online")).toHaveCount(0)
    const payResponse = await page.goto(`/en/billing/${number}/pay`)
    await expect(page.getByTestId("pay-state")).toContainText("Online card payment is not available for this invoice")
    // The CSP opens Stripe's origins on the pay page only (ADR-0007 P17); the rest of the site keeps no third-party origin.
    const csp = payResponse!.headers()["content-security-policy"]!
    expect(csp).toMatch(/script-src [^;]*https:\/\/js\.stripe\.com/)
    expect(csp).toMatch(/frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com/)
    expect(csp).toMatch(/connect-src [^;]*https:\/\/api\.stripe\.com/)
    expect(csp).not.toMatch(/https:\/\/(?!(js|hooks|api|checkout)\.stripe\.com|\*\.stripe\.com)/)
    expect((await page.goto(`/en/billing/${number}`))!.headers()["content-security-policy"]).not.toContain("stripe")
    await page.goto(`/en/billing/${number}/pay`)
    await expect(page.getByTestId("pay-start")).toHaveCount(0)

    // Flag on (an owner switches it on): the button appears and the pay page opens a session.
    expect((await dev.put(FLAG, { enabled: true })).status).toBe(403)
    expect((await owner.put(FLAG, { enabled: true })).status).toBe(200)
    await expect(async () => {
      await page.goto(`/en/billing/${number}`)
      await expect(page.getByTestId("pay-online")).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 20_000 })
    await page.getByTestId("pay-online").click()
    await expect(page).toHaveURL(new RegExp(`/en/billing/${number}/pay$`))
    await expect(page.getByTestId("pay-amount")).toHaveText("£50")
    await expect(page.getByTestId("pay-test-mode")).toContainText("no real money")
    await page.getByTestId("pay-start").click()
    await expect(page.getByTestId("fake-checkout")).toBeVisible()
    const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    expect(serious.map((v) => v.id)).toEqual([])
    await page.screenshot({ path: "../../docs/screens/web/pay-en.png", fullPage: true })

    // The redirect is not proof: opening the return page without paying shows "confirming", the invoice stays unpaid.
    await page.goto(`/en/billing/${number}/pay/return?session_id=cs_test_forged`)
    await expect(page.getByTestId("pay-return")).toHaveAttribute("data-state", "confirming")
    expect((await ship.c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("ISSUED")

    // Pay (simulated): the signed event goes to the real webhook handler, then the return page reads our database.
    await page.goto(`/en/billing/${number}/pay`)
    await page.getByTestId("pay-start").click()
    await page.getByTestId("fake-pay").click()
    await expect(page).toHaveURL(new RegExp(`/en/billing/${number}/pay/return`))
    await expect(page.getByTestId("pay-return")).toHaveAttribute("data-state", "paid", { timeout: 20_000 })
    await expect(page.getByTestId("pay-return")).toContainText("Payment received")
    expect((await ship.c.get(`/v1/billing/invoices/${number}`)).body.status).toBe("PAID")

    await page.goto(`/en/billing/${number}`)
    await expect(page.getByTestId("invoice-status")).toHaveText("Paid")
    await expect(page.getByTestId("pay-online")).toHaveCount(0)

    // Persian, right to left.
    await page.goto(`/fa/billing/${number}/pay`)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.getByTestId("pay-state")).toContainText("این فاکتور پرداخت شده است")
    await page.screenshot({ path: "../../docs/screens/web/pay-fa.png", fullPage: true })

    // A failed payment leaves the invoice payable and offers another try.
    const ship2 = await receivedShipment("WEB", STAFF.owner)
    const number2 = await issue(ship2)
    await context.clearCookies()
    await context.addCookies([...ship2.c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))
    await page.goto(`/fa/billing/${number2}/pay`)
    await page.getByTestId("pay-start").click()
    await page.getByTestId("fake-fail").click()
    await expect(page.getByTestId("pay-return")).toHaveAttribute("data-state", "failed", { timeout: 20_000 })
    await expect(page.getByTestId("pay-return")).toContainText("پرداخت انجام نشد")
    expect((await ship2.c.get(`/v1/billing/invoices/${number2}`)).body.status).toBe("ISSUED")
  } finally {
    await owner.put(FLAG, { enabled: false })
  }
})
