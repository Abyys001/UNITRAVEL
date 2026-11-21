import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, request, test } from "@playwright/test"

import { API } from "./helpers"

// ADR-0041: the guided service flows (cargo, visa, CIP wizards; ground route card; form kit keyboard model) and their axe pass.
// Visa and CIP are behind service flags that are off by default locally; they are switched on for this file and put back after.

const DEV_ORIGIN = "http://dev.localhost:4200"
const FLAGS = { "services.visa.enabled": "visa", "services.cip.enabled": "cip" } as const
type FlagKey = keyof typeof FLAGS
const initial: Partial<Record<FlagKey, boolean>> = {}

async function devApi() {
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { origin: DEV_ORIGIN, "x-forwarded-host": "dev.localhost:4200" } })
  // ADR-0012 test sign-in (TEST_SIGN_IN=on locally): the seeded developer, no second factor.
  const r = await ctx.post("/v1/auth/test-sign-in", { data: { email: "dev@unitravel.example", deviceId: "e2e-service-flows-dev", client: "CONSOLE" } })
  expect(r.status()).toBe(200)
  // Cookie sessions send the double-submit CSRF token on mutations.
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === "ut_csrf")?.value ?? ""
  return { ctx, csrf }
}

async function menu(): Promise<Record<string, boolean>> {
  const ctx = await request.newContext({ baseURL: API })
  const m = (await (await ctx.get("/v1/site")).json()).menu
  await ctx.dispose()
  return m
}

async function setFlags(want: (k: FlagKey) => boolean) {
  const { ctx, csrf } = await devApi()
  for (const k of Object.keys(FLAGS) as FlagKey[]) {
    const r = await ctx.put(`/v1/dev/feature-flags/${k}`, { data: { enabled: want(k) }, headers: { "x-csrf-token": csrf } })
    expect(r.status(), await r.text()).toBe(200)
  }
  await ctx.dispose()
  await expect.poll(async () => { const m = await menu(); return (Object.keys(FLAGS) as FlagKey[]).every((k) => m[FLAGS[k]] === want(k)) }, { timeout: 20_000 }).toBe(true)
}

test.beforeAll(async () => {
  const m = await menu()
  for (const k of Object.keys(FLAGS) as FlagKey[]) initial[k] ??= m[FLAGS[k]] === true
  await setFlags(() => true)
})
test.afterAll(async () => {
  await setFlags((k) => initial[k] ?? false)
})

/** Seeded demo customer with a verified phone (docs/LOCAL-DEV.md), through the documented test sign-in. */
async function signInCustomer(page: Page) {
  const r = await page.request.post(`${API}/v1/auth/test-sign-in`, {
    data: { email: "neda@student.example", deviceId: "e2e-service-flows-web", client: "WEB" }, headers: { origin: "http://localhost:4000" },
  })
  expect(r.status()).toBe(200)
}

const next = (page: Page) => page.getByRole("button", { name: /^Continue/ }).click()
const stepHeading = (page: Page) => page.locator("#wizard-step-title")
const pickRadio = (page: Page, name: string, value: string) => page.locator("label", { has: page.locator(`input[name="${name}"][value="${value}"]`) }).click()
const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`)

test.describe("cargo wizard", () => {
  test("blocks empty step 1, keeps values on Back, restores a draft, shows Edit on review and submits", async ({ page }) => {
    test.setTimeout(120_000)
    const lanes = (await (await page.request.get(`${API}/v1/cargo/lanes`)).json()) as { id: string; enabled: boolean; services: string[] }[]
    const lane = lanes.find((l) => l.enabled && l.services.includes("PARCEL"))
    test.skip(!lane, "no open lane with PARCEL")
    await signInCustomer(page)
    await page.goto("/en/cargo")
    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    await expect(stepHeading(page)).toHaveText("Route")

    await next(page)
    await expect(page.getByRole("alert").filter({ hasText: "Please check the highlighted fields." })).toBeVisible()
    await expect(page.locator("#laneId-error")).toHaveText("Required")
    await expect(stepHeading(page)).toHaveText("Route")

    await pickRadio(page, "cargo-lane", lane!.id)
    await next(page)
    await expect(stepHeading(page)).toHaveText("Service")
    await expect(stepHeading(page)).toBeFocused()
    await pickRadio(page, "cargo-service", "PARCEL")
    await next(page)
    await expect(stepHeading(page)).toHaveText("Shipment details")

    await page.getByRole("button", { name: "Back" }).click()
    await expect(page.locator('input[name="cargo-service"][value="PARCEL"]')).toBeChecked()
    await page.getByRole("button", { name: "Back" }).click()
    await expect(page.locator(`input[name="cargo-lane"][value="${lane!.id}"]`)).toBeChecked()

    // The draft is saved 400 ms after the last change.
    await page.waitForTimeout(800)
    await page.reload()
    await expect(page.getByText("We restored the details you entered earlier.")).toBeVisible()
    await expect(page.locator(`input[name="cargo-lane"][value="${lane!.id}"]`)).toBeChecked()

    await next(page)
    await next(page)
    await byId(page, "items.0.description").fill("Cotton shirts")
    await next(page)
    await expect(stepHeading(page)).toHaveText("Contact and documents")
    for (const role of ["shipper", "consignee"]) {
      await byId(page, `${role}.name`).fill("Neda Test")
      await byId(page, `${role}.address.line1`).fill("1 Test Street")
      await byId(page, `${role}.address.city`).fill(role === "shipper" ? "London" : "Istanbul")
    }
    await next(page)
    await expect(stepHeading(page)).toHaveText("Review")
    for (const s of ["Route", "Service", "Shipment details", "Contact and documents"]) await expect(page.getByRole("button", { name: `Edit ${s}` })).toBeVisible()

    await page.getByRole("button", { name: "Edit Service" }).click()
    await expect(stepHeading(page)).toHaveText("Service")
    await expect(page.locator('input[name="cargo-service"][value="PARCEL"]')).toBeChecked()
    await page.getByRole("button", { name: /Review/ }).click()
    await expect(stepHeading(page)).toHaveText("Review")

    for (const box of await page.locator('input[id^="consents."]').all()) await box.check()
    await page.locator("form button[type=submit]").click()
    await expect(page.getByText(/UT-C-/).first()).toBeVisible({ timeout: 20_000 })
  })
})

test.describe("visa wizard", () => {
  test("steps advance and the review shows the non-guarantee", async ({ page }) => {
    await page.goto("/en/visa")
    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    await page.getByTestId("visa-request-start").click()
    await expect(stepHeading(page)).toHaveText(/destination/i)
    await next(page)
    await expect(byId(page, "v-dest-control")).toHaveAttribute("aria-invalid", "true")
    await byId(page, "v-dest-control").click()
    // The checker above has its own selects (also comboboxes); the open picker's search box is the focused one.
    const search = page.locator('input[role="combobox"]:focus')
    await search.fill("Turkey")
    await search.press("Enter")
    await expect(byId(page, "v-dest-value")).toHaveText(/T(ü|u)rk/)
    await next(page)
    await pickRadio(page, "v-purpose", "TOURISM")
    await next(page)
    await expect(page.getByTestId("visa-applicants-signed-out")).toBeVisible()
    await next(page)
    await expect(page.getByTestId("visa-docs-signed-out")).toBeVisible()
    await next(page)
    await expect(stepHeading(page)).toHaveText("Review")
    await expect(page.getByTestId("visa-non-guarantee")).toContainText("Only the issuing authority decides")
    await expect(page.locator("form button[type=submit]")).toHaveText("Sign in to send request")
  })
})

test.describe("CIP wizard", () => {
  test("ARRIVAL disables departure-only options; a signed-in request reaches the confirmation", async ({ page }) => {
    await signInCustomer(page)
    await page.goto("/en/cip")
    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    await page.getByTestId("cip-request-start").click()
    await next(page)
    await byId(page, "c-flight").fill("TK 878")
    await next(page)
    // Choose a departure-only option, then switch to an arrival: it is cleared and disabled.
    await page.getByTestId("cip-option-BUSINESS_LOUNGE").locator("input").check()
    await page.getByRole("button", { name: "Back" }).click()
    await pickRadio(page, "c-dir", "ARRIVAL")
    await next(page)
    await expect(page.getByTestId("cip-option-BUSINESS_LOUNGE").locator("input")).toBeDisabled()
    await expect(page.getByTestId("cip-option-BUSINESS_LOUNGE").locator("input")).not.toBeChecked()
    for (const id of ["BUSINESS_LOUNGE_FULL", "HOME_CHECK_IN"]) await expect(page.getByTestId(`cip-option-${id}`).locator("input")).toBeDisabled()
    await expect(page.getByTestId("cip-option-CIP_TERMINAL").locator("input")).toBeEnabled()
    await page.getByTestId("cip-option-CIP_TERMINAL").locator("input").check()
    await next(page)
    await next(page)
    await expect(stepHeading(page)).toHaveText("Review")
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(4)
    const contact = byId(page, "svc-contact-control")
    if ((await contact.textContent())?.includes("Choose")) { await contact.click(); await page.getByRole("option").first().click() }
    for (const box of await page.getByTestId("cip-request").locator("form input[type=checkbox]").all()) await box.check()
    await page.locator("form button[type=submit]").click()
    await expect(page.getByText(/UT-[A-Z]-/).first()).toBeVisible({ timeout: 20_000 })
  })
})

test.describe("ground route card", () => {
  test("fa: Persian search picks a city, the same city is refused, the date picker is Jalali", async ({ page }) => {
    await page.goto("/fa/trains")
    await byId(page, "g-from-control").click()
    await page.getByRole("combobox").fill("تبریز")
    await expect(page.getByRole("option")).toHaveCount(1)
    await page.getByRole("option").click()
    await expect(byId(page, "g-from-value")).toHaveText("تبریز")
    await byId(page, "g-to-control").click()
    // Arabic yeh (ي) folds to Persian yeh (ی).
    await page.getByRole("combobox").fill("تبريز")
    await page.getByRole("combobox").press("Enter")
    await expect(byId(page, "g-to-error")).toBeVisible()
    await expect(byId(page, "g-to-control")).toHaveAttribute("aria-invalid", "true")

    await byId(page, "g-date-control").click()
    const grid = page.getByRole("grid").first()
    await expect(grid).toBeVisible()
    await expect(grid).toHaveAttribute("aria-label", /فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند/)
    await expect(grid).toHaveAttribute("aria-label", /[۰-۹]{4}/)
  })
})

test.describe("keyboard only", () => {
  test("SelectField opens with Enter and ArrowDown and picks with Enter", async ({ page }) => {
    await page.goto("/en/cargo")
    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    const lanes = (await (await page.request.get(`${API}/v1/cargo/lanes`)).json()) as { id: string; enabled: boolean; services: string[] }[]
    const lane = lanes.find((l) => l.enabled && l.services.includes("PARCEL"))!
    await pickRadio(page, "cargo-lane", lane.id)
    await next(page)
    await pickRadio(page, "cargo-service", "PARCEL")
    await next(page)
    const trigger = byId(page, "handoverMode-control")
    await trigger.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("listbox")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("listbox")).toBeHidden()
    await trigger.focus()
    await page.keyboard.press("ArrowDown")
    await expect(page.getByRole("listbox")).toBeVisible()
    // PICKUP is selected; move to the other option and pick it.
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("listbox")).toBeHidden()
    await expect(trigger).toContainText("Drop")
    await expect(byId(page, "handoverMode")).toHaveValue("DROP_OFF")
  })

  test("ComboField filters as you type and picks with Enter", async ({ page }) => {
    await page.goto("/en/trains")
    await byId(page, "g-from-control").focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("combobox")).toBeFocused()
    await page.keyboard.type("mash")
    await page.keyboard.press("Enter")
    await expect(byId(page, "g-from-value")).toHaveText("Mashhad")
    await expect(byId(page, "g-from-control")).toBeFocused()
  })
})

// Axe: the same WCAG 2.2 AA tags as a11y.spec.ts; the wizards are opened so their first step is scanned too.
const AXE_PAGES = ["cargo", "visa", "cip", "trains", "buses", "stays", "hotels", "insurance", "tours"]
for (const locale of ["en", "fa"]) {
  for (const p of AXE_PAGES) {
    test(`axe: no serious violations on /${locale}/${p}`, async ({ page }) => {
      await page.goto(`/${locale}/${p}`)
      await page.waitForLoadState("networkidle")
      const start = page.getByTestId(`${p}-request-start`)
      if (await start.count()) { await start.click(); await page.waitForTimeout(400) }
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
      const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
    })
  }
}
