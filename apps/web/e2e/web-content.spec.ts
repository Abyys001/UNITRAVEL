import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { ADMIN_HOST, DEV_HOST, Session, STAFF, staffSession } from "../../api/test/client"

// Phase J web (ADR-0017, brief §4, §6, §18): LEGAL and PAGE routes, destinations, travel card flag, homepage sections.
// Entries are created and published through the staff API as the owner, then archived at the end.
const tag = Math.random().toString(36).slice(2, 8)
const anon = new Session("WEB")
let owner: Session
let dev: Session
let cardInitial = false
const ids: string[] = []
const slugs = { legal: `legal-${tag}`, page: `page-${tag}`, dest: `dest-${tag}`, draft: `draft-${tag}` }

const entry = (kind: string, slug: string, extra: Record<string, unknown> = {}) => ({
  kind, locale: "en", slug, title: `E2E ${kind} ${tag}`, summary: "Summary text", bodyMd: "## Part one\n\nBody text.", tags: [], relatedServices: [], claimsToVerify: [], ...extra,
})

async function create(body: Record<string, unknown>, publish: boolean) {
  const c = await owner.post("/v1/admin/cms/entries", body)
  expect(c.status).toBe(201)
  ids.push(c.body.id)
  if (!publish) return
  const r = await owner.post(`/v1/admin/cms/entries/${c.body.id}/transition`, { to: "IN_REVIEW", version: c.body.version })
  expect(r.status).toBe(200)
  const p = await owner.post(`/v1/admin/cms/entries/${c.body.id}/transition`, { to: "PUBLISHED", version: r.body.version })
  expect(p.status).toBe(200)
}

async function setCard(enabled: boolean) {
  expect((await dev.put("/v1/dev/feature-flags/services.card.enabled", { enabled })).status).toBe(200)
  for (let i = 0; i < 60; i++) {
    if ((await anon.get("/v1/site")).body.menu.card === enabled) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error("card flag did not reach /v1/site")
}

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

test.beforeAll(async () => {
  test.setTimeout(150_000)
  owner = await staffSession(STAFF.owner, ADMIN_HOST)
  dev = await staffSession(STAFF.developer, DEV_HOST)
  cardInitial = (await anon.get("/v1/site")).body.menu.card === true
  await create(entry("LEGAL", slugs.legal), true)
  await create(entry("PAGE", slugs.page), true)
  await create(entry("GUIDE", slugs.dest, { category: "destination", relatedServices: ["flights"] }), true)
  await create(entry("LEGAL", slugs.draft), false)
})
test.afterAll(async () => {
  if (!owner) return
  for (const id of ids) {
    const e = await owner.get(`/v1/admin/cms/entries/${id}`)
    if (e.status === 200 && e.body.status !== "ARCHIVED") await owner.post(`/v1/admin/cms/entries/${id}/transition`, { to: "ARCHIVED", version: e.body.version })
  }
  if (dev) await dev.put("/v1/dev/feature-flags/services.card.enabled", { enabled: cardInitial })
})

test("legal and info pages render published entries, drafts are 404, no travel-guidance notice", async ({ page }) => {
  for (const [route, slug] of [["legal", slugs.legal], ["info", slugs.page]] as const) {
    await page.goto(`/en/${route}/${slug}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(tag)
    await expect(page.getByTestId("general-notice")).toHaveCount(0)
    await axeClean(page)
  }
  expect((await page.goto(`/en/legal/${slugs.draft}`))?.status()).toBe(404)
  expect((await page.goto(`/en/info/${slugs.legal}`))?.status()).toBe(404)
})

test("footer lists published legal and info entries only", async ({ page }) => {
  await page.goto("/en/faq")
  const footer = page.locator("footer")
  await expect(footer.locator(`a[href="/en/legal/${slugs.legal}"]`)).toBeVisible()
  await expect(footer.locator(`a[href="/en/info/${slugs.page}"]`)).toBeVisible()
  await expect(footer.locator(`a[href="/en/legal/${slugs.draft}"]`)).toHaveCount(0)
})

test("destinations: list, detail with service links, /guides redirects, home section appears", async ({ page }) => {
  // Server pages read the API through a 60 s fetch cache, so a new entry can take up to a minute to appear.
  const card = page.getByTestId("entry-card").filter({ hasText: tag })
  await expect(async () => { await page.goto("/en/destinations"); await expect(card).toBeVisible({ timeout: 1_000 }) }).toPass({ timeout: 75_000, intervals: [3_000] })
  await axeClean(page)
  await page.goto(`/en/destinations/${slugs.dest}`)
  await expect(page.getByRole("link", { name: /Open Flights/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Open Track/ })).toBeVisible()
  await page.goto(`/en/guides/${slugs.dest}`)
  await expect(page).toHaveURL(new RegExp(`/en/destinations/${slugs.dest}$`))
  await page.goto("/en")
  await expect(page.getByTestId("home-destinations").getByText(tag)).toBeVisible()
})

test("travel card: off is unavailable and unlisted; on is a coming-soon page with no financial claims", async ({ browser }) => {
  // /v1/site is cached for 60 s in the browser (as for every flag), so each state is read by a fresh visitor.
  await setCard(false)
  let page = await (await browser.newContext()).newPage()
  await page.goto("/en/card")
  await expect(page.getByTestId("service-unavailable")).toBeVisible()
  await page.goto("/en")
  await expect(page.locator("footer")).toBeVisible()
  await expect(page.locator("footer").getByRole("link", { name: "Travel card" })).toHaveCount(0)

  await setCard(true)
  page = await (await browser.newContext()).newPage()
  await page.goto("/en/card")
  const soon = page.getByTestId("card-soon")
  await expect(soon).toBeVisible()
  await expect(page.locator("main")).not.toContainText(/\b(fee|fees|rate|limit|apr|interest|cashback)\b/i)
  await expect(page.locator("footer").getByRole("link", { name: "Travel card" })).toBeVisible()
  await axeClean(page)
  await setCard(false)
})

test("home: every service is shown, none is a fake booking, unverified claims are absent", async ({ page }) => {
  for (const [locale, w] of [["en", 1280], ["fa", 390]] as const) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(`/${locale}`)
    const explorer = page.getByTestId("service-explorer")
    for (const k of ["flights", "hotels", "trains", "buses", "stays", "visa", "tours", "cip", "cargo", "insurance", "card", "club"]) await expect(explorer.getByTestId(`svc-${k}`)).toBeVisible()
    // The card never opens; every other service is open (request forms where no provider exists).
    await expect(explorer.getByTestId("svc-card")).toHaveAttribute("data-open", "false")
    await expect(explorer.getByTestId("svc-card").locator("a")).toHaveCount(0)
    await expect(explorer.getByTestId("svc-hotels")).toHaveAttribute("data-open", "true")
    await expect(explorer.getByTestId("svc-flights")).toHaveAttribute("data-open", "true")
    const text = (await page.getByTestId("benefits").innerText()) + (await page.getByTestId("home-support").innerText())
    expect(text).not.toMatch(/24\s?\/\s?7|24[- ]hour|instal|cheapest|instant|price alert|۲۴/i)
    await expect(page.getByTestId("home-support").locator(`a[href="/${locale}/support"]`)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await axeClean(page)
  }
})
