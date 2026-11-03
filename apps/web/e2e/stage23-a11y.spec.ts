import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { dbQuery, randomPhone, STAFF, staffSession } from "../../api/test/client"
import { signIn } from "./helpers"

/**
 * STAGE-23 accessibility pass (axe, WCAG 2.0 A and AA) on the new customer screens, in English and Persian:
 * search results, itinerary (compliance review note), request form ("Also interested in"), billing list and invoice.
 * Runs against the isolated STAGE-23 stack: WEB_URL, API_URL, CONSOLE_ADMIN_URL, DATABASE_MIGRATE_URL.
 */
const ADMIN_HOST = new URL(process.env.CONSOLE_ADMIN_URL ?? "http://admin.localhost:4200").host
const LOCALES = ["en", "fa"] as const

/**
 * Pre-existing violations in shared components this stage did not touch. Each entry is excluded by selector and listed in the
 * STAGE-23 verification report (rule id, element, count); none of them is in service-interests.tsx, compliance-review-note.tsx
 * or the billing invoice page.
 */
const PRE_EXISTING: { selector: string; rule: string; note: string }[] = []

async function scan(page: Page, label: string) {
  await page.waitForLoadState("networkidle")
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
  for (const p of PRE_EXISTING) axe = axe.exclude(p.selector)
  const r = await axe.analyze()
  expect(r.passes.length, `axe ran on ${label}`).toBeGreaterThan(10)
  const found = r.violations.map((v) => `${label} :: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
  expect(found).toEqual([])
}

const query = (from: string, to: string) => ({
  trip: "ONE_WAY", from: { kind: "AIRPORT", code: from, label: from }, to: { kind: "AIRPORT", code: to, label: to },
  date: new Date(Date.now() + 23 * 86400_000).toISOString().slice(0, 10), adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: false, on: true, gw: true, stops: 2, lay: [240, 360],
})
async function openFirstItinerary(page: Page, locale: string, q: ReturnType<typeof query>) {
  await page.goto(`/${locale}/search?q=${encodeURIComponent(Buffer.from(JSON.stringify(q)).toString("base64"))}`)
  const cards = page.locator("main ol li a, main ul li a").filter({ has: page.locator("*") }).first()
  await expect(cards).toBeVisible({ timeout: 30_000 })
}

test.describe.configure({ mode: "serial" })
test.setTimeout(240_000)

test("search results and itinerary", async ({ page }) => {
  await page.goto("/en")
  let itinerary = ""
  for (const locale of LOCALES) {
    await openFirstItinerary(page, locale, query("VAN", "IST"))
    await scan(page, `results ${locale}`)
    await page.locator("main ol li a, main ul li a").first().click()
    await expect(page).toHaveURL(new RegExp(`/${locale}/itinerary/`))
    await expect(page.locator("main h1").first()).toBeVisible()
    await scan(page, `itinerary ${locale}`)
    if (locale === "en") itinerary = page.url()
  }
  expect(itinerary).toContain("/en/itinerary/")
})

/**
 * The note renders only when the itinerary matches a REVIEW lane, and lane policies are data set by authorised staff with counsel
 * approval (never seeded or changed by a test). So the itinerary response is flagged in the browser, which exercises the real component.
 */
async function flagComplianceReview(page: Page) {
  await page.route(/\/v1\/itineraries\/[^/?]+$/, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    body.itinerary.complianceReview = true
    await route.fulfill({ response: res, json: body })
  })
}

test("itinerary and request form with the compliance review note", async ({ page }) => {
  await flagComplianceReview(page)
  await openFirstItinerary(page, "en", query("VAN", "IST"))
  await page.locator("main ol li a, main ul li a").first().click()
  await expect(page.getByTestId("compliance-review-note")).toBeVisible()
  const itineraryId = /\/itinerary\/([^/?]+)/.exec(page.url())![1]!
  for (const locale of LOCALES) {
    await page.goto(page.url().replace(/\/(en|fa)\/itinerary/, `/${locale}/itinerary`))
    await expect(page.getByTestId("compliance-review-note")).toBeVisible()
    await scan(page, `itinerary with review note ${locale} (${itineraryId.slice(0, 6)})`)
  }
})

test("request form, billing list and invoice (signed in)", async ({ page }) => {
  const email = `s23-a11y-${Date.now().toString(36)}@student.example`
  await openFirstItinerary(page, "en", query("VAN", "IST"))
  await page.locator("main ol li a, main ul li a").first().click()
  await expect(page).toHaveURL(/\/en\/itinerary\//)
  const itinerary = page.url()
  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/sign-in/)
  await signIn(page, email)
  // Requests need a verified phone contact; added in the test database as in stage23-flow.spec.ts.
  const [u] = await dbQuery<{ user_id: string }>("select user_id from user_identities where type = 'EMAIL' and value_normalised = $1", [email])
  expect(u).toBeTruthy()
  for (let i = 0; i < 40; i++) {
    const added = await dbQuery("insert into user_identities (id, user_id, type, value_normalised, verified_at) values (gen_random_uuid(), $1, 'PHONE', $2, now()) on conflict do nothing returning id", [u!.user_id, randomPhone("+4477009")])
    if (added.length) break
  }
  await page.goto(itinerary)
  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/\/en\/request\/new/)
  const formUrl = page.url()
  for (const locale of LOCALES) {
    await page.goto(formUrl.replace("/en/", `/${locale}/`))
    await expect(page.getByTestId("service-interests")).toBeVisible()
    await scan(page, `request form ${locale}`)
  }
  await flagComplianceReview(page)
  for (const locale of LOCALES) {
    await page.goto(formUrl.replace("/en/", `/${locale}/`))
    await expect(page.getByTestId("compliance-review-note")).toBeVisible()
    await scan(page, `request form with review note ${locale}`)
  }

  // An issued invoice for this customer, created through the staff API (the console flow is covered by stage23-flow.spec.ts).
  const admin = await staffSession(STAFF.admin, ADMIN_HOST)
  const d = await admin.post("/v1/admin/invoices", { customerUserId: u!.user_id, currency: "GBP", dueDays: 7, lines: [{ serviceType: "OTHER", description: "Consultation", quantity: 1, unitAmountMinor: 5000 }] })
  expect(d.status, JSON.stringify(d.body)).toBe(201)
  const issued = await admin.post(`/v1/admin/invoices/${d.body.id}/issue`)
  expect(issued.status).toBe(200)
  const number = issued.body.number as string
  for (const locale of LOCALES) {
    await page.goto(`/${locale}/billing`)
    await expect(page.getByTestId("invoice-row").filter({ hasText: number })).toBeVisible()
    await scan(page, `billing list ${locale}`)
    await page.goto(`/${locale}/billing/${number}`)
    await expect(page.getByTestId("invoice-detail")).toBeVisible()
    await scan(page, `invoice ${locale}`)
  }
})
