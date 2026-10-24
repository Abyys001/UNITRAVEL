import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { iso, receivedShipment } from "../../api/test/cargo-fixture"

// The shipment is created through the real API and staff commands, then the browser is signed in with that
// customer's session cookies; this avoids a second OTP for the same phone (resend cooldown) and keeps the
// shared +447700900010 / +447700900077 numbers out of it.
test("shipments page renders the corrected timeline, translated, with the estimate labelled, in en and fa", async ({ page, context }) => {
  const { c, admin, ref } = await receivedShipment("WEB")
  expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-events`, { eventCode: "DEPARTED", location: "LHR", occurredAt: iso(1) })).status).toBe(201)
  const detail = await admin.get(`/v1/admin/cargo/requests/${ref}`)
  const departed = detail.body.tracking.find((t: { eventCode: string }) => t.eventCode === "DEPARTED")
  expect((await admin.post(`/v1/admin/cargo/requests/${ref}/tracking-corrections`, { correctsEventId: departed.id, eventCode: "AT_CUSTOMS", location: "IST customs", occurredAt: iso(3), reason: "Wrong scan" })).status).toBe(201)
  expect((await admin.put(`/v1/admin/cargo/requests/${ref}/estimated-delivery`, { estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })).status).toBe(200)

  await context.addCookies([...c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))

  await page.goto("/en/shipments")
  await expect(page.getByRole("link", { name: "Shipments" }).first()).toBeVisible()
  const card = page.getByTestId("shipment-card").filter({ hasText: ref })
  await expect(card).toBeVisible()
  const timeline = card.getByTestId("tracking-timeline")
  await expect(timeline).toContainText("At customs")
  await expect(timeline).toContainText("Received at our partner")
  await expect(timeline).toContainText("IST customs")
  await expect(card).not.toContainText("DEPARTED")
  await expect(card).not.toContainText("Departed")
  await expect(card.getByText("Estimated delivery")).toBeVisible()
  await expect(card.getByText("An estimate, not a promise. It can change.")).toBeVisible()
  await expect(page.getByTestId("shipments-summary")).toBeVisible()
  const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => v.id)).toEqual([])

  await page.goto("/fa/shipments")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  const fa = page.getByTestId("shipment-card").filter({ hasText: ref })
  await expect(fa.getByTestId("tracking-timeline")).toContainText("در گمرک")
  await expect(fa.getByTestId("tracking-timeline")).toContainText("نزد شریک ما دریافت شد")
  await expect(fa.getByText("زمان تخمینی تحویل")).toBeVisible()
  await expect(fa).not.toContainText("AT_CUSTOMS")
  await page.screenshot({ path: "../../docs/screens/web/shipments-fa.png", fullPage: true })
})
