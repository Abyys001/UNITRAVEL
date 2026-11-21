import { mkdirSync } from "node:fs"

import { expect, test } from "@playwright/test"

import { API } from "./helpers"

// ADR-0040 stage 31: one signed-in pass over the redesigned customer portal against the real API, with screenshots at
// 360 and 1280 px in en and fa. Pages shown carry the demo customer's own data only; no token or cookie value is ever printed.
const OUT = "../../docs/stages/STAGE-31"
const SIZES = [{ w: 360, h: 800 }, { w: 1280, h: 900 }]

test("portal smoke as the demo customer (real API)", async ({ page }) => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  // Test sign-in (ADR-0012): email alone, no code; the session cookies land in this browser context.
  const r = await page.request.post(`${API}/v1/auth/test-sign-in`, { data: { email: "neda@student.example", deviceId: "stage31-smoke-device", client: "WEB" } })
  expect(r.status()).toBeLessThan(300)
  const base = process.env.WEB_URL ?? "http://localhost:4000"
  const jar = await page.context().cookies(API)
  await page.context().addCookies(jar.map((c) => ({ name: c.name, value: c.value, url: base, httpOnly: c.httpOnly, secure: false, sameSite: "Lax" as const })))
  const shot = async (name: string, lang: string, w: number) => page.screenshot({ path: `${OUT}/${name}-${lang}-${w}.png`, fullPage: true })

  // Real references for the track search: one of her own, one that cannot be hers.
  await page.goto("/en")
  const own = await page.evaluate(async () => (await (await fetch("/api/v1/track")).json()) as { ref: string }[])
  const subject = `Smoke ${Date.now()}`

  for (const lang of ["en", "fa"] as const) {
    for (const { w, h } of SIZES) {
      await page.setViewportSize({ width: w, height: h })

      await page.goto(`/${lang}/dashboard`)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(page.getByTestId("travel-card-tile")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await shot("dashboard", lang, w)

      await page.goto(`/${lang}/inbox`)
      await page.waitForLoadState("networkidle")
      const items = page.getByTestId("inbox-list").locator("li a")
      if (await items.count()) {
        await items.first().click()
        await expect(page).toHaveURL(/inbox\?m=/)
        await expect(page.getByTestId("inbox-detail").locator("article")).toBeVisible()
        await page.waitForLoadState("networkidle")
        await expect(page.locator('[data-testid=inbox-list] [aria-current=true][data-unread=true]')).toHaveCount(0, { timeout: 10_000 })
      }
      await shot("inbox", lang, w)

      await page.goto(`/${lang}/track`)
      await page.waitForLoadState("networkidle")
      // The search endpoint is rate limited, so it is exercised once per language at desktop width; phones open the detail by URL.
      if (w === 1280) {
        const form = page.locator("#search-h").locator("xpath=..")
        await form.locator("input").fill("UT-F-ZZZZZZ")
        await form.locator("button[type=submit]").click()
        await expect(page.getByTestId("track-search-msg")).not.toHaveText("")
        await shot("track-search-miss", lang, w)
        if (own.length) {
          await form.locator("input").fill(own[0].ref)
          await form.locator("button[type=submit]").click()
          await expect(page).toHaveURL(/track\?ref=/)
        }
      } else await shot("track", lang, w)
      if (own.length) {
        await page.goto(`/${lang}/track?ref=${own[0].ref}`)
        await expect(page.getByTestId("track-detail")).toBeVisible()
        await page.waitForLoadState("networkidle")
        await shot("track-detail", lang, w)
      }

      await page.goto(`/${lang}/club`)
      await page.waitForLoadState("networkidle")
      await shot("club", lang, w)
    }
  }

  // Support: create a ticket from the form, then open it from the list (en only; the form itself is unchanged).
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/en/support")
  await page.locator("#sp-name").fill("Neda")
  await page.locator("#sp-email").fill("neda@student.example")
  await page.locator("#sp-msg").fill(`${subject}: checking the new portal.`)
  await page.getByRole("button", { name: "Send message" }).click()
  await expect(page.getByText("Message received")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("support-tickets").getByRole("link").first().click()
  await expect(page).toHaveURL(/support\/TK-/)
  await expect(page.getByTestId("ticket-thread")).toContainText("checking the new portal")
  await page.waitForLoadState("networkidle")
  await shot("support-ticket", "en", 1280)
  for (const lang of ["en", "fa"] as const) for (const { w, h } of SIZES) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(`/${lang}/support`)
    await page.waitForLoadState("networkidle")
    await shot("support", lang, w)
  }
})
