import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { seedVisualWorld } from "../../api/test/visual-seed"
import { type Cassette, record } from "./support/cassette"

// Opt-in: records the cassette the visual specs replay.   CAPTURE=1 npx playwright test visual-capture --project=desktop
// Seeds one customer (shipment, invoice, flight request with a quote) through the real API, then walks every major
// screen in en and fa so each GET response is stored. Re-run only when screens or API shapes change on purpose.
test.skip(process.env.CAPTURE !== "1", "set CAPTURE=1 to re-record the visual cassette")

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "visual/cassette.json")

test("record the customer cassette", async ({ page, context }) => {
  test.setTimeout(600_000)
  const { c, cargoRef, flightRef, invoiceNumber } = await seedVisualWorld()
  await context.addCookies([...c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))
  const cassette: Cassette = { capturedAt: new Date().toISOString(), meta: { cargoRef, flightRef, invoiceNumber }, entries: {} }
  record(page, cassette)

  const date = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
  const params = { trip: "ONE_WAY", from: { kind: "CITY", code: "THR", label: "Tehran" }, to: { kind: "CITY", code: "LON", label: "London" }, date, adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360] }
  const q = encodeURIComponent(Buffer.from(JSON.stringify(params)).toString("base64"))
  cassette.meta.searchQ = q

  for (const lang of ["en", "fa"] as const) {
    const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(400) }
    const visit = async (path: string) => { await page.goto(`/${lang}${path}`); await settle() }
    await visit("")
    await visit("/cargo")
    await visit(`/search?q=${q}`)
    const card = page.locator("main ul li a").first()
    await expect(card).toBeVisible({ timeout: 40_000 })
    await settle()
    const itineraryHref = (await card.getAttribute("href"))!
    cassette.meta.itineraryPath = itineraryHref.replace(/^\/(en|fa)/, "")
    await visit(cassette.meta.itineraryPath)
    await page.getByRole("button", { name: /Request this itinerary|درخواست/ }).first().click().catch(() => undefined)
    await settle()
    cassette.meta.requestNewPath = new URL(page.url()).pathname.replace(/^\/(en|fa)/, "") + new URL(page.url()).search
    for (const p of ["/requests", `/requests/${flightRef}`, `/cargo/${cargoRef}`, "/account", "/account/details", "/shipments", "/billing", `/billing/${invoiceNumber}`, `/billing/${invoiceNumber}/pay`, `/billing/${invoiceNumber}/pay/return`, "/inbox"]) await visit(p)
  }
  writeFileSync(OUT, JSON.stringify(cassette, null, 1))
  expect(Object.keys(cassette.entries).length).toBeGreaterThan(30)
})
