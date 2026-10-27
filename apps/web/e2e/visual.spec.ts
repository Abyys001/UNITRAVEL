import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { type Cassette, replay, type ReplayOptions } from "./support/cassette"

// Phase F done-criterion: a snapshot and an axe pass for every major customer screen, en and fa, desktop and mobile.
// Data comes from visual/cassette.json (recorded once by visual-capture.spec.ts), time is frozen at capture time, motion
// is reduced, so the pixels only change when the UI does. Update on purpose:  npx playwright test visual --update-snapshots
const cassette = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "visual/cassette.json"), "utf8")) as Cassette
const m = cassette.meta
const inv = m.invoiceNumber!
const payment = `/v1/billing/invoices/${inv}/payment`

type Override = NonNullable<ReplayOptions["override"]>
interface Screen { name: string; path: string; signedIn?: boolean; override?: Override; settle?: string }
const SCREENS: Screen[] = [
  { name: "home", path: "", signedIn: false },
  { name: "sign-in", path: "/sign-in", signedIn: false },
  { name: "search-results", path: `/search?q=${m.searchQ}`, settle: "main ul li a" },
  { name: "itinerary", path: m.itineraryPath! },
  { name: "request-new", path: m.requestNewPath! },
  { name: "requests", path: "/requests" },
  { name: "request-detail", path: `/requests/${m.flightRef}`, settle: "[data-testid=stepper]" },
  { name: "cargo-form", path: "/cargo" },
  { name: "cargo-detail", path: `/cargo/${m.cargoRef}` },
  { name: "account", path: "/account" },
  { name: "account-details", path: "/account/details" },
  { name: "shipments", path: "/shipments", settle: "[data-testid=tracking-timeline]" },
  { name: "billing", path: "/billing" },
  { name: "invoice", path: `/billing/${inv}`, settle: "[data-testid=invoice-detail]" },
  { name: "pay-ready", path: `/billing/${inv}/pay`, override: { [payment]: (b) => ({ ...(b as object), offered: true, reasons: [] }) }, settle: "[data-testid=pay-page]" },
  { name: "pay-unavailable", path: `/billing/${inv}/pay`, settle: "[data-testid=pay-state]" },
  { name: "pay-paid", path: `/billing/${inv}/pay`, override: { [payment]: (b) => ({ ...(b as object), invoiceStatus: "PAID", paidAt: cassette.capturedAt }) }, settle: "[data-testid=pay-state]" },
  { name: "pay-return-failed", path: `/billing/${inv}/pay/return`, override: { [payment]: (b) => ({ ...(b as object), session: { status: "FAILED" } }) }, settle: "[data-state=failed]" },
  { name: "inbox", path: "/inbox" },
  { name: "faq", path: "/faq", signedIn: false },
  { name: "travel-rules", path: "/travel-rules", signedIn: false },
  { name: "flight-guide", path: "/flights/guide", signedIn: false },
]

test.use({ locale: "en-GB", timezoneId: "UTC", reducedMotion: "reduce", colorScheme: "light" })

for (const lang of ["en", "fa"] as const) {
  for (const s of SCREENS) {
    test(`${s.name} ${lang} @mobile`, async ({ page }) => {
      const misses = await replay(page, cassette, { lang, signedIn: s.signedIn, override: s.override })
      await page.goto(`/${lang}${s.path}`)
      await page.waitForLoadState("networkidle")
      if (s.settle) await expect(page.locator(s.settle).first()).toBeVisible()
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "fa" ? "rtl" : "ltr")
      await page.evaluate(() => document.fonts.ready)
      await expect(page).toHaveScreenshot(`${s.name}-${lang}.png`, { fullPage: true, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.003, mask: [page.locator("video")] })
      const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
      expect(misses, "API calls with no recorded response").toEqual([])
    })
  }
}
