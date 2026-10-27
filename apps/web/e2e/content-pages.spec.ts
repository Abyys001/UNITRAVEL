import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

// Phase H: FAQ, travel rules and buying guide are static pages (no API); en and fa, axe, JSON-LD and RTL.
const COPY = {
  en: {
    faq: { path: "/en/faq", h1: "Frequently asked questions", first: "How do I buy a flight ticket with Uni Travel?", answer: "Domestic flights within Iran are not offered at present." },
    rules: { path: "/en/travel-rules", h1: "Important rules and tips for international flights", sections: 6, first: "1. Arriving at the airport and check-in" },
    guide: { path: "/en/flights/guide", h1: "Buying a flight with Uni Travel", first: "Complete guide to buying a ticket with Uni Travel", anchor: "Pay only when your ticket is issued" },
    notice: "This is general guidance; the airline's, airport's and destination country's rules always apply.",
  },
  fa: {
    faq: { path: "/fa/faq", h1: "سوالات متداول", first: "چگونه در یونی‌تراول بلیت هواپیما بخریم؟", answer: "پروازهای داخلی ایران در حال حاضر ارائه نمی‌شوند." },
    rules: { path: "/fa/travel-rules", h1: "قوانین و نکات مهم پروازهای خارجی", sections: 6, first: "۱. حضور در فرودگاه و پذیرش مسافر" },
    guide: { path: "/fa/flights/guide", h1: "خرید بلیت هواپیما در یونی‌تراول", first: "راهنمای کامل خرید بلیت هواپیما از یونی‌تراول", anchor: "پرداخت فقط هنگام صدور بلیت" },
    notice: "این راهنما عمومی است؛ قوانین ایرلاین، فرودگاه و کشور مقصد ملاک نهایی است.",
  },
} as const

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

for (const lang of ["en", "fa"] as const) {
  const c = COPY[lang]
  const dir = lang === "fa" ? "rtl" : "ltr"

  test(`faq ${lang}: accordion toggles, FAQPage JSON-LD, notice, dir @mobile`, async ({ page }) => {
    await page.goto(c.faq.path)
    await expect(page.locator("html")).toHaveAttribute("dir", dir)
    await expect(page.getByRole("heading", { level: 1, name: c.faq.h1 })).toBeVisible()
    const items = page.getByTestId("faq-item")
    await expect(items).toHaveCount(5)
    const first = items.first()
    await expect(first).not.toHaveAttribute("open", "")
    await expect(page.getByText(c.faq.answer)).toBeHidden()
    await first.locator("summary").click()
    await expect(first).toHaveAttribute("open", "")
    await expect(page.getByText(c.faq.answer)).toBeVisible()
    await first.locator("summary").click()
    await expect(first).not.toHaveAttribute("open", "")
    // Keyboard: Enter on the focused summary opens it too.
    await items.nth(1).locator("summary").focus()
    await page.keyboard.press("Enter")
    await expect(items.nth(1)).toHaveAttribute("open", "")

    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "") as { "@type": string; mainEntity: { "@type": string; name: string; acceptedAnswer: { text: string } }[] }
    expect(ld["@type"]).toBe("FAQPage")
    expect(ld.mainEntity).toHaveLength(5)
    expect(ld.mainEntity[0]!.name).toBe(c.faq.first)
    for (const q of ld.mainEntity) expect(q.acceptedAnswer.text.length).toBeGreaterThan(20)

    await expect(page.getByTestId("general-notice")).toHaveText(c.notice)
    await axeClean(page)
  })

  test(`travel rules ${lang}: six sections, notice, dir @mobile`, async ({ page }) => {
    await page.goto(c.rules.path)
    await expect(page.locator("html")).toHaveAttribute("dir", dir)
    await expect(page.getByRole("heading", { level: 1, name: c.rules.h1 })).toBeVisible()
    await expect(page.locator("main section")).toHaveCount(c.rules.sections)
    await expect(page.getByRole("heading", { level: 2, name: c.rules.first })).toBeVisible()
    await expect(page.locator("main section").first().locator("li")).toHaveCount(3)
    await expect(page.getByTestId("general-notice")).toHaveText(c.notice)
    await axeClean(page)
  })

  test(`flight guide ${lang}: contents anchors, hidden flagged sections, notice, dir @mobile`, async ({ page }) => {
    await page.goto(c.guide.path)
    await expect(page.locator("html")).toHaveAttribute("dir", dir)
    await expect(page.getByRole("heading", { level: 1, name: c.guide.h1 })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: c.guide.first })).toBeVisible()
    // Visa (7) and insurance (9) are off until their flags exist: 12 headings minus 2.
    await expect(page.locator("main section")).toHaveCount(10)
    await expect(page.locator('main section[id="visa"], main section[id="insurance"]')).toHaveCount(0)
    const contents = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: c.guide.anchor }) })
    await expect(contents.getByRole("link")).toHaveCount(10)
    await contents.getByRole("link", { name: c.guide.anchor }).click()
    await expect(page).toHaveURL(/#pay-at-ticketing$/)
    await expect(page.getByRole("heading", { level: 2, name: c.guide.anchor })).toBeInViewport()
    await expect(page.getByTestId("general-notice")).toHaveText(c.notice)
    await axeClean(page)
  })

  test(`home ${lang}: FAQ band lists five questions and links to /faq`, async ({ page }) => {
    await page.goto(`/${lang}`)
    const band = page.getByRole("region", { name: lang === "fa" ? "سوالات متداول" : "Frequently asked questions" })
    await expect(band.getByTestId("faq-item")).toHaveCount(5)
    await band.getByRole("link").click()
    await expect(page).toHaveURL(new RegExp(`/${lang}/faq$`))
  })

  test(`footer ${lang}: help column links to the three pages`, async ({ page }) => {
    await page.goto(`/${lang}/terms`)
    const footer = page.getByRole("contentinfo")
    for (const p of ["/faq", "/travel-rules", "/flights/guide"]) await expect(footer.locator(`a[href="/${lang}${p}"]`)).toHaveCount(1)
  })
}
