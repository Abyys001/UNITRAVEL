import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { type Cassette, replay } from "../../web/e2e/support/cassette"
import { ADMIN, DEV } from "./helpers"

// Phase F done-criterion for the consoles: a snapshot and an axe pass per major screen, en and fa, desktop and phone.
// Data is replayed from visual/cassette-*.json (recorded by visual-capture.spec.ts), time is frozen, motion reduced,
// so no staff sign-in (and no OTP cooldown) is needed. Update on purpose:  npx playwright test visual --update-snapshots
const here = dirname(fileURLToPath(import.meta.url))
const load = (n: string) => (existsSync(`${here}/visual/${n}.json`) ? (JSON.parse(readFileSync(`${here}/visual/${n}.json`, "utf8")) as Cassette) : null)
const admin = load("cassette-admin")
const dev = load("cassette-dev")

interface Screen { name: string; base: string; cassette: Cassette; path: string; settle: string }
const screens: Screen[] = []
if (admin) {
  const m = admin.meta
  const add = (name: string, path: string, settle = "main") => screens.push({ name, base: ADMIN, cassette: admin, path, settle })
  add("dashboard", "/")
  add("queues", "/queues?tab=new")
  add("request", `/requests/${m.flightRef}`, "[data-testid=actions]")
  add("quote", `/requests/${m.flightRef}/quote`)
  add("cargo", `/cargo/${m.cargoRef}`)
  add("invoices", "/invoices")
  add("verifications", "/verifications")
  if (m.verificationId) add("verification", `/verifications/${m.verificationId}`, "[data-testid=case-summary]")
  add("compliance", "/compliance")
  if (m.caseId) add("compliance-case", `/compliance/${m.caseId}`, "[data-testid=case-summary]")
  add("compliance-policies", "/compliance/policies")
  add("search", "/search")
  add("customer", `/customers/${m.customerId}`)
}
if (dev) {
  for (const [name, path] of [["dev-home", "/"], ["dev-payments", "/payments"], ["dev-health", "/health"], ["dev-users", "/users"], ["dev-audit", "/audit"]] as const) screens.push({ name, base: DEV, cassette: dev, path, settle: "main" })
}

test.use({ locale: "en-GB", timezoneId: "UTC", reducedMotion: "reduce", colorScheme: "light" })

for (const tag of ["", " @mobile"]) {
  for (const lang of ["en", "fa"] as const) {
    for (const s of screens) {
      test(`${s.name} ${lang}${tag}`, async ({ page }) => {
        await page.addInitScript((l) => { localStorage.setItem("ut-locale", l); localStorage.setItem("ut-theme", "light"); localStorage.setItem("ut-density", "comfortable") }, lang)
        const misses = await replay(page, s.cassette, { lang: "en" })
        await page.goto(`${s.base}${s.path}`)
        await expect(page.locator(s.settle).first()).toBeVisible()
        await expect(page.locator("html")).toHaveAttribute("dir", lang === "fa" ? "rtl" : "ltr")
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`${s.name}-${lang}.png`, { fullPage: true, animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.003 })
        const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
        expect(misses, "API calls with no recorded response").toEqual([])
      })
    }
  }
}
