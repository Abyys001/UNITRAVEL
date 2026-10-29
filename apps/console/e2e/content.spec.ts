import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { ADMIN, STAFF, staffPage } from "./helpers"

// ADR-0017 content screens: an admin drafts an entry with an open claim and cannot publish; the owner clears the claim
// and publishes; a glossary term can be created. Serial because each test builds on the entry made in the first.
test.describe.configure({ mode: "serial" })

const slug = `e2e-guide-${Date.now().toString(36)}`
const title = `E2E guide ${slug}`
let entryUrl = ""

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

test("admin creates a draft with an open claim; the preview renders Markdown without raw HTML", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.goto(`${ADMIN}/content/new`)
  await page.getByTestId("cms-title").fill(title)
  await page.getByTestId("cms-slug").fill(slug)
  await page.getByTestId("cms-kind").selectOption("GUIDE")
  await page.getByTestId("cms-body").fill("## Instalments\n\nPay later with **no fee** <script>window.__x = 1</script>\n\n- one\n- two")
  await expect(page.getByTestId("cms-preview").getByRole("heading", { name: "Instalments" })).toBeVisible()
  await expect(page.getByTestId("cms-preview").locator("script")).toHaveCount(0)
  await page.getByTestId("cms-claim-input").fill("Instalment payment is available")
  await page.getByTestId("cms-claim-add").click()
  await expect(page.getByTestId("cms-claims")).toContainText("Instalment payment is available")
  await axeClean(page)
  await page.getByTestId("cms-save").click()
  await page.waitForURL(/\/content\/[0-9a-f-]{36}$/)
  entryUrl = page.url()
  await expect(page.getByTestId("cms-status")).toContainText(/Draft/)
  await expect(page.getByTestId("cms-no-preview")).toBeVisible()
})

test("claims block publishing and an admin has no Publish permission; the list shows the claim badge", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.goto(entryUrl)
  await page.getByTestId("cms-to-IN_REVIEW").click()
  await expect(page.getByTestId("cms-status")).toContainText(/In review/)
  await expect(page.getByTestId("cms-to-PUBLISHED")).toBeDisabled()
  await expect(page.getByTestId("cms-why")).toContainText(/claim/i)
  await page.goto(`${ADMIN}/content`)
  await page.getByRole("searchbox").fill(slug)
  const row = page.locator("tr", { hasText: slug })
  await expect(row).toContainText(/1 to verify/)
  await axeClean(page)
})

test("owner clears the claim and publishes; the website link appears", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.owner)
  await page.goto(entryUrl)
  await expect(page.getByTestId("cms-to-PUBLISHED")).toBeDisabled()
  await page.getByTestId("cms-claim-remove").click()
  await expect(page.getByTestId("cms-claims-empty")).toBeVisible()
  await expect(page.getByTestId("cms-to-PUBLISHED")).toBeDisabled() // unsaved change
  await page.getByTestId("cms-save").click()
  await expect(page.getByText("Saved").first()).toBeVisible()
  await page.getByTestId("cms-to-PUBLISHED").click()
  await expect(page.getByTestId("cms-status")).toContainText(/Published/)
  await expect(page.getByTestId("cms-open-web")).toBeVisible()
  await expect(page.getByTestId("cms-revisions").locator("li").first()).toBeVisible()
  await axeClean(page)
})

test("glossary: create a term and see it in the table", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.goto(`${ADMIN}/content/glossary`)
  await page.getByTestId("gl-new").click()
  const dlg = page.getByTestId("dlg-term")
  const en = `Layover ${slug}`
  await dlg.getByLabel("Persian term").fill("توقف")
  await dlg.getByLabel("English term").fill(en)
  await dlg.getByLabel("Explanation (Persian)").fill("زمان انتظار میان دو پرواز.")
  await dlg.getByRole("button", { name: "Save" }).click()
  await expect(page.getByTestId("glossary").getByText(en)).toBeVisible()
  await axeClean(page)
})

test("mobile: the list shows cards and the editor switches between write and preview", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${ADMIN}/content`)
  await expect(page.getByTestId("cms-cards")).toBeVisible()
  await page.goto(entryUrl)
  await page.getByRole("radio", { name: "Preview" }).click()
  await expect(page.getByTestId("cms-preview")).toBeVisible()
  await expect(page.getByTestId("cms-body")).toBeHidden()
})
