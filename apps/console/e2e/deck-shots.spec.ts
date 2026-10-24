import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { ADMIN, apiSessionFrom, ensureNewRequest, STAFF, staffPage } from "./helpers"

// Opt-in: captures the Control deck review screenshots (light/dark x 1440/390). Not part of the regular suite.
//   DECK_SHOTS=1 npx playwright test deck-shots --project=desktop
test.skip(process.env.DECK_SHOTS !== "1", "set DECK_SHOTS=1 to capture the Control deck screenshots")

const here = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.DECK_SHOTS_DIR ?? resolve(here, "../../../docs/stages/ui-control-deck")
mkdirSync(OUT, { recursive: true })
const freshPhone = () => `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`

test("capture the case screens in both themes and sizes", async ({ browser }) => {
  test.setTimeout(600_000)
  const owner = await staffPage(browser, ADMIN, STAFF.owner)
  const state = await owner.context().storageState()

  // A request with a drafted quote whose supplier facts are partly UNKNOWN, so the truth tile has something to say.
  const ref = await ensureNewRequest(owner, freshPhone())
  const api = await apiSessionFrom(owner, ADMIN)
  const detail = await api.get(`/v1/admin/flight-requests/${ref}`)
  expect((await api.post(`/v1/admin/flight-requests/${ref}/commands/claim`, {}, { "if-match": String(detail.body.version) })).status).toBe(200)
  const option = await api.get(`/v1/admin/flight-requests/${ref}/quotes/from-snapshot`)
  expect(option.status).toBe(200)
  await api.post(`/v1/admin/flight-requests/${ref}/quotes`, { currency: "GBP", options: [option.body] })
  const verification = ((await api.get("/v1/admin/verifications")).body as { id: string }[])[0]?.id
  const cases = (await api.get("/v1/admin/compliance/cases")).body as { id: string }[]
  const caseId = cases[0]?.id

  const views = [
    { name: "1440", viewport: { width: 1440, height: 900 }, mobile: false },
    { name: "390", viewport: { width: 390, height: 844 }, mobile: true },
  ]
  for (const theme of ["light", "dark"] as const) {
    for (const v of views) {
      const ctx = await browser.newContext({ storageState: state, viewport: v.viewport, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: v.mobile ? 2 : 1 })
      await ctx.addInitScript((t) => { localStorage.setItem("ut-theme", t) }, theme)
      const page = await ctx.newPage()
      const snap = async (name: string) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}-${theme}-${v.name}.png` }) }

      await page.goto(`${ADMIN}/queues?tab=new`)
      await expect(page.getByTestId(v.mobile ? "queue-cards" : "queue-table").locator(v.mobile ? "li" : "tbody tr").first()).toBeVisible()
      await snap("queues")

      await page.goto(`${ADMIN}/requests/${ref}`)
      await expect(page.getByTestId("actions")).toBeVisible()
      await expect(page.getByTestId("truth-note")).toBeVisible()
      await snap("request")
      if (v.mobile) {
        await page.getByRole("tab", { name: "Customer" }).click()
        await snap("request-customer")
      }

      if (verification) {
        await page.goto(`${ADMIN}/verifications/${verification}`)
        await expect(page.getByTestId("case-summary")).toBeVisible()
        await snap("verification")
      }
      if (caseId) {
        await page.goto(`${ADMIN}/compliance/${caseId}`)
        await expect(page.getByTestId("case-summary")).toBeVisible()
        await snap("compliance")
      }
      await ctx.close()
    }
  }
})
