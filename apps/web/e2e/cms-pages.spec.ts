import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

// ADR-0017: blog, guides and glossary read published CMS content only. Mock-free: when the API has nothing published (or is
// down) the tests check the honest empty state and skip the content assertions instead of faking a seed.
async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

for (const locale of ["en", "fa"] as const) {
  test(`blog list (${locale}): cards or an honest empty state, axe clean`, async ({ page }) => {
    await page.goto(`/${locale}/blog`)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "fa" ? "rtl" : "ltr")
    const cards = page.getByTestId("entry-card")
    if (await cards.count()) await expect(cards.first().getByRole("heading", { level: 2 })).toBeVisible()
    else await expect(page.getByTestId("cms-empty").or(page.getByTestId("cms-unavailable"))).toBeVisible()
    await axeClean(page)
  })

  test(`blog article (${locale}): outline, breadcrumbs, JSON-LD, no raw HTML; unknown slug is 404`, async ({ page }) => {
    await page.goto(`/${locale}/blog`)
    const first = page.getByTestId("entry-card").first()
    test.skip(!(await first.count()), "no published article in this environment")
    await first.click()
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
    await expect(page.getByRole("navigation", { name: /breadcrumb|مسیر صفحه/i })).toBeVisible()
    await expect(page.getByTestId("general-notice")).toBeVisible()
    const ld = await page.locator('script[type="application/ld+json"]').first().evaluate((el) => el.textContent)
    expect(ld).toContain('"@type":"Article"')
    expect(ld).toContain('"@type":"BreadcrumbList"')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/blog\//)
    expect(await page.locator("[data-testid=entry-body] script").count()).toBe(0)
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0)
    await axeClean(page)
    expect((await page.goto(`/${locale}/blog/no-such-article-xyz`))?.status()).toBe(404)
  })

  test(`glossary (${locale}): search and category filter, anchors`, async ({ page }) => {
    await page.goto(`/${locale}/glossary`)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const terms = page.getByTestId("glossary-term")
    if (!(await terms.count())) { await expect(page.getByTestId("cms-empty").or(page.getByTestId("cms-unavailable"))).toBeVisible(); return }
    const n = await terms.count()
    await page.getByTestId("glossary-search").fill("zzzz-no-such-term")
    await expect(terms).toHaveCount(0)
    await page.getByTestId("glossary-search").fill("")
    await expect(terms).toHaveCount(n)
    const id = await terms.first().getAttribute("id")
    expect(id).toBeTruthy()
    await page.goto(`/${locale}/glossary#${id}`)
    await expect(page.locator(`#${id}`)).toBeInViewport()
    await axeClean(page)
  })
}

test("robots and sitemap: private areas disallowed, sitemap lists the blog", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text()
  for (const p of ["/en/account", "/en/inbox", "/en/billing", "/en/requests", "/en/sign-in"]) expect(robots).toContain(`Disallow: ${p}`)
  expect(robots).toContain("Sitemap:")
  const xml = await (await request.get("/sitemap.xml")).text()
  expect(xml).toContain("/en/blog")
  expect(xml).not.toContain("/en/account")
})

test("footer links to the blog and the glossary", async ({ page }) => {
  await page.goto("/en/faq")
  const footer = page.locator("footer")
  await expect(footer.getByRole("link", { name: "Articles" })).toHaveAttribute("href", "/en/blog")
  await expect(footer.getByRole("link", { name: "Glossary" })).toHaveAttribute("href", "/en/glossary")
})
