import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { seedVisualWorld } from "../../api/test/visual-seed"
import { type Cassette, record } from "../../web/e2e/support/cassette"
import { ADMIN, apiSessionFrom, DEV, STAFF, staffPage } from "./helpers"

// Opt-in: records the cassettes the console visual spec replays.   CAPTURE=1 npx playwright test visual-capture --project=desktop
test.skip(process.env.CAPTURE !== "1", "set CAPTURE=1 to re-record the visual cassettes")
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "visual")

test("record the admin and developer cassettes", async ({ browser }) => {
  test.setTimeout(900_000)
  const owner = await staffPage(browser, ADMIN, STAFF.owner)
  const api = await apiSessionFrom(owner, ADMIN)
  const w = await seedVisualWorld(api)
  const verification = ((await api.get("/v1/admin/verifications")).body as { id: string }[])[0]?.id
  const caseId = ((await api.get("/v1/admin/compliance/cases")).body as { id: string }[])[0]?.id

  const admin: Cassette = { capturedAt: new Date().toISOString(), meta: { flightRef: w.flightRef, cargoRef: w.cargoRef, customerId: w.customerId, invoiceNumber: w.invoiceNumber, verificationId: verification ?? "", caseId: caseId ?? "" }, entries: {} }
  record(owner, admin)
  const walk = async (page: typeof owner, base: string, paths: string[]) => {
    for (const p of paths) { await page.goto(`${base}${p}`); await page.waitForTimeout(2500) }
  }
  await walk(owner, ADMIN, [
    "/", "/queues?tab=new", `/requests/${w.flightRef}`, `/requests/${w.flightRef}/quote`, `/cargo/${w.cargoRef}`, "/invoices", "/verifications",
    ...(verification ? [`/verifications/${verification}`] : []), "/compliance", ...(caseId ? [`/compliance/${caseId}`] : []), "/compliance/policies", "/compliance/lists", "/search", `/customers/${w.customerId}`, "/account",
  ])
  writeFileSync(`${dir}/cassette-admin.json`, JSON.stringify(admin, null, 1))

  const devPage = await staffPage(browser, DEV, STAFF.developer)
  const dev: Cassette = { capturedAt: new Date().toISOString(), meta: {}, entries: {} }
  record(devPage, dev)
  await walk(devPage, DEV, ["/", "/payments", "/health", "/users", "/audit"])
  writeFileSync(`${dir}/cassette-dev.json`, JSON.stringify(dev, null, 1))
  expect(Object.keys(admin.entries).length).toBeGreaterThan(10)
})
