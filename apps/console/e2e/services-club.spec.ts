import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { randomPhone, Session, signIn } from "../../api/test/client"
import { ADMIN, apiSessionFrom, DEV, STAFF, staffPage } from "./helpers"

// Phase I console screens (ADR-0015 service requests, ADR-0016 customer club): queue → detail → claim → quote with a
// club discount line; club members, member page and four-eyes approval on the benefits tab.
test.describe.configure({ mode: "serial" })

const FLAGS = ["services.visa.enabled", "loyalty.enabled"] as const
const initial: Record<string, boolean> = {}
let ref = ""
let customer = { userId: "", name: "" }
let pendingBenefit = ""
const welcome = `20% welcome ${Date.now().toString(36)}`

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  const dev = await apiSessionFrom(await staffPage(browser, DEV, STAFF.developer), DEV)
  const site = (await new Session("WEB").get("/v1/site")).body.menu
  initial["services.visa.enabled"] = site.visa
  initial["loyalty.enabled"] = site.club
  for (const k of FLAGS) expect((await dev.put(`/v1/dev/feature-flags/${k}`, { enabled: true })).status).toBe(200)

  // A customer with a visa request, enrolled in a new tier with one active and one pending benefit (made through the API).
  const c = new Session("MOBILE")
  await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Shirin", surnameLatin: "Club" })
  const me = (await c.get("/v1/me")).body
  customer = { userId: me.id, name: me.displayName }
  const t = await c.post("/v1/me/travellers", { title: "MS", givenNames: "Shirin", surname: "Club", dateOfBirth: "1990-01-01", genderOnDocument: "F", nationality: "IR", relationship: "SELF" })
  for (let i = 0; i < 40; i++) {
    const r = await c.post("/v1/service-requests", { type: "VISA", contactIdentityId: me.identities[0].id, acknowledgements: { notABooking: true, privacy: true }, details: { destinationCountry: "TR", purpose: "TOURISM", travellerIds: [t.body.id], intendedTravelDate: "2027-04-01" } })
    if (r.status === 201) { ref = r.body.ref; break }
    await new Promise((x) => setTimeout(x, 250)) // the flag reaches the API within a moment
  }
  expect(ref).toMatch(/^UT-S-/)
  const admin = await apiSessionFrom(await staffPage(browser, ADMIN, STAFF.admin), ADMIN)
  const tier = await admin.post("/v1/admin/club/tiers", { code: `SILVER_${Date.now().toString(36).toUpperCase()}`, nameEn: "Silver", nameFa: "نقره‌ای" })
  expect((await admin.post("/v1/admin/club/members", { userId: customer.userId, tierId: tier.body.id })).status).toBe(201)
  const window = { validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: new Date(Date.now() + 30 * 86400_000).toISOString() }
  expect((await admin.post("/v1/admin/club/benefits", { kind: "DISCOUNT_FIXED", value: 1500, currency: "GBP", appliesTo: "SERVICE", userId: customer.userId, description: { en: "£15 off services", fa: "۱۵ پوند تخفیف خدمات" }, ...window })).body.status).toBe("ACTIVE")
  const pending = await admin.post("/v1/admin/club/benefits", { kind: "DISCOUNT_PERCENT", value: 20, appliesTo: "ANY", userId: customer.userId, description: { en: welcome, fa: "۲۰٪ خوش‌آمد" }, ...window })
  expect(pending.body.status).toBe("PENDING_APPROVAL")
  pendingBenefit = pending.body.id
})

test.afterAll(async ({ browser }) => {
  const dev = await apiSessionFrom(await staffPage(browser, DEV, STAFF.developer), DEV)
  for (const k of FLAGS) await dev.put(`/v1/dev/feature-flags/${k}`, { enabled: initial[k] ?? false })
})

test("services queue lists the request and the detail page shows customer and details", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.goto(`${ADMIN}/services`)
  await expect(page.getByTestId("services").getByText(ref)).toBeVisible()
  await axeClean(page)
  await page.goto(`${ADMIN}/services/${ref}`)
  await expect(page.getByTestId("ref")).toHaveText(ref)
  await expect(page.getByTestId("service-details")).toContainText(/Tourism/)
  await axeClean(page)
})

test("claim, then send a quote with a club discount line; the total subtracts it", async ({ browser }) => {
  const page = await staffPage(browser, ADMIN, STAFF.admin)
  await page.goto(`${ADMIN}/services/${ref}`)
  await page.getByTestId("actions").getByRole("button", { name: /^Claim/ }).click()
  await expect(page.getByTestId("assignee")).toContainText(/you/i)
  await page.getByTestId("actions").getByRole("button", { name: /Send quote/ }).click()
  const dlg = page.getByTestId("dlg-send_quote")
  await expect(dlg).toBeVisible()
  const lines = dlg.getByTestId("quote-line")
  await lines.nth(0).getByTestId("quote-line-label").fill("Visa service fee")
  await lines.nth(0).getByRole("textbox", { name: /Amount/ }).fill("60")
  await dlg.getByRole("button", { name: "Add line" }).click()
  await lines.nth(1).getByTestId("quote-line-kind").selectOption("CLUB_DISCOUNT")
  const benefit = lines.nth(1).getByTestId("quote-line-benefit")
  await expect(benefit.locator("option", { hasText: "£15 off services" })).toHaveCount(1)
  await benefit.selectOption((await benefit.locator("option", { hasText: "£15 off services" }).getAttribute("value"))!)
  await expect(dlg.getByTestId("quote-total")).toContainText("45")
  await axeClean(page)
  await dlg.getByRole("button", { name: "Send quote" }).click()
  await expect(page.getByTestId("status")).toContainText(/Quoted/i)
  await expect(page.getByTestId("service-quotes")).toContainText("45")
})

test("club: member list, member page with benefits, and four-eyes approval by the owner", async ({ browser }) => {
  const admin = await staffPage(browser, ADMIN, STAFF.admin)
  await admin.goto(`${ADMIN}/club`)
  await expect(admin.getByTestId("members").locator(`a[href="/club/${customer.userId}"]`).first()).toBeVisible()
  await axeClean(admin)
  await admin.goto(`${ADMIN}/club/${customer.userId}`)
  await expect(admin.getByRole("cell", { name: "£15 off services" })).toBeVisible()
  await axeClean(admin)

  // The author cannot approve; the owner can.
  const owner = await staffPage(browser, ADMIN, STAFF.owner)
  await owner.goto(`${ADMIN}/club/benefits?userId=${customer.userId}`)
  const row = owner.locator("tr", { hasText: welcome })
  await row.getByRole("button", { name: "Approve" }).click()
  await expect(owner.locator("tr", { hasText: welcome }).getByRole("button", { name: "Approve" })).toHaveCount(0)
  const s = await apiSessionFrom(owner, ADMIN)
  expect((await s.get(`/v1/admin/club/benefits?userId=${customer.userId}&status=ACTIVE`)).body.map((b: { id: string }) => b.id)).toContain(pendingBenefit)
})
