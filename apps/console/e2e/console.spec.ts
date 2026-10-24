import { expect, type Page, test } from "@playwright/test"

import { iso, receivedShipment } from "../../api/test/cargo-fixture"
import { dbQuery } from "../../api/test/client"
import { ADMIN, apiSessionFrom, DEV, ensureNewRequest, shot, STAFF, staffPage } from "./helpers"

test.describe.configure({ mode: "serial" })

let ref = ""
// New customers for the added tests: the demo customer's OTP resend cooldown is already spent by earlier tests.
const freshPhone = () => `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`

test.describe("Admin Panel", () => {
  test("admin signs in with phone OTP + TOTP and lands on the shift home", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.admin)
    await expect(page.getByTestId("shift-line")).toContainText("new")
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Sara/ })).toBeVisible()
    await shot(page, "admin-home")
  })

  test("queue lists requests with keyboard focus", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.admin)
    ref = await ensureNewRequest(page)
    await page.goto(`${ADMIN}/queues?tab=new`)
    const table = page.getByTestId("queue-table")
    await expect(table.locator("tbody tr").first()).toBeVisible()
    expect(await table.locator("tbody tr").count()).toBeGreaterThan(0)
    await page.keyboard.press("j")
    await expect(table.locator("tbody tr").nth(1)).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("k")
    await expect(table.locator("tbody tr").first()).toHaveAttribute("aria-selected", "true")
    await expect(page.getByTestId("queue-preview")).toContainText("Open case")
    await shot(page, "admin-queue")
    // Search by the customer's phone finds the request we will work on.
    await page.goto(`${ADMIN}/queues?tab=new&q=${encodeURIComponent("+447700900010")}`)
    await expect(table.locator(`tr[data-ref="${ref}"]`)).toBeVisible()
  })

  test("work a flight request: claim, note, build and send a quote", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.admin)
    await page.goto(`${ADMIN}/requests/${ref}`)
    await expect(page.getByTestId("ref")).toHaveText(ref)
    await expect(page.getByTestId("actions").locator('[data-command="claim"]')).toBeEnabled()
    // Server-computed actions: the disabled ones carry the guard's reason.
    await expect(page.getByTestId("actions").locator("[data-reason]").first()).toBeVisible()
    await shot(page, "admin-request-new")
    await page.keyboard.press("c")
    await expect(page.getByTestId("assignee")).toHaveText("Assigned to you")
    await expect(page.getByTestId("status")).toHaveText("IN REVIEW")

    await page.keyboard.press("n")
    const note = `Console e2e note ${Date.now()}`
    await page.getByTestId("note-composer").locator("textarea").fill(note)
    await page.getByTestId("note-composer").getByRole("button", { name: "Add note" }).click()
    await expect(page.getByTestId("notes")).toContainText(note)

    await page.getByTestId("open-quote-builder").click()
    await expect(page.getByRole("heading", { name: /quote/i })).toBeVisible()
    await page.getByRole("button", { name: "+ From snapshot" }).click()
    const option = page.getByTestId("option-0")
    await expect(option).toBeVisible()
    // Unknown supplier facts are flagged and block sending until staff confirm them from the fare rules.
    const flagged = option.locator("select[aria-invalid=true]")
    for (let guard = 0; guard < 20 && (await flagged.count()) > 0; guard++) {
      await flagged.first().selectOption({ index: 1 })
    }
    // A malformed amount is flagged and blocks sending rather than becoming £NaN.
    await option.getByLabel("Service fee").fill("0.0025.00")
    await expect(option.getByLabel("Service fee")).toHaveAttribute("aria-invalid", "true")
    await expect(option.getByTestId("option-total")).toHaveText("—")
    await expect(page.getByRole("button", { name: "Send quote" })).toBeDisabled()
    await option.getByLabel("Service fee").fill("25.00")
    // A manual option starts with every fact UNKNOWN: flagged, and sending is blocked until confirmed.
    await page.getByRole("button", { name: "+ Manual entry" }).click()
    await expect(page.getByTestId("option-1").getByTestId("unknown-count")).toBeVisible()
    await expect(page.getByRole("button", { name: "Send quote" })).toBeDisabled()
    await page.getByTestId("option-1").scrollIntoViewIfNeeded()
    await shot(page, "admin-quote-builder-unknowns")
    await page.getByTestId("option-1").getByRole("button", { name: "Remove option" }).click()
    await expect(page.getByTestId("option-1")).toHaveCount(0)
    await page.getByRole("button", { name: "Preview" }).click()
    await expect(page.getByTestId("quote-preview")).toBeVisible()
    await shot(page, "admin-quote-builder")
    await page.getByRole("button", { name: "Send quote" }).click()
    await expect(page).toHaveURL(new RegExp(`/requests/${ref}$`), { timeout: 20_000 })
    await expect(page.getByTestId("status")).toHaveText("QUOTED")
    await expect(page.getByTestId("quotes")).toContainText("SENT")
    await shot(page, "admin-request-quoted")
  })

  test("assign picks a colleague from the staff directory", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.admin)
    const fresh = await ensureNewRequest(page, freshPhone())
    await page.goto(`${ADMIN}/requests/${fresh}`)
    await page.getByTestId("actions").locator('[data-command="assign"]').click()
    const dlg = page.getByTestId("dlg-assign")
    const select = dlg.getByTestId("staff-select")
    await expect(select).toBeEnabled()
    // Names and roles only: the directory never carries phone numbers or email addresses.
    const labels = await select.locator("option:not([disabled])").allTextContents()
    expect(labels.length).toBeGreaterThanOrEqual(5)
    expect(labels.join(" ")).not.toMatch(/\+\d{6,}|@/)
    const owner = labels.find((l) => /Owner/.test(l))!
    await select.selectOption({ label: owner })
    await dlg.getByRole("button", { name: "Assign", exact: true }).click()
    await expect(page.getByTestId("assignee")).toHaveText(`Assigned to ${owner.split(" · ")[0]}`)
  })

  test("queue counts update over the event stream, without polling", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.admin)
    await page.goto(`${ADMIN}/queues?tab=new`)
    const count = page.locator('a[href="/queues?tab=new"]').first().getByTestId("nav-count")
    await expect(count).toHaveText(/^\d+$/)
    // From here on the summary endpoint is unreachable, so a changed count can only arrive over SSE.
    await page.route("**/api/v1/admin/queues/summary", (r) => r.abort())
    const before = Number(await count.textContent())
    await ensureNewRequest(page, freshPhone())
    await expect.poll(async () => Number(await count.textContent()), { timeout: 10_000 }).toBeGreaterThan(before)
    await page.unroute("**/api/v1/admin/queues/summary")
  })

  test("staff search shows staff fields and Add to quote", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.admin)
    await page.goto(`${ADMIN}/search?ref=${ref}`)
    const rows = page.getByTestId("search-results").locator("tbody tr")
    // A provider may be briefly disabled by other suites sharing the local stack; search again in that case.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("button", { name: "Search", exact: true }).click()
      await expect(page.getByTestId("search-status")).toContainText(/results|Searching/, { timeout: 30_000 })
      await expect(page.getByTestId("search-status")).not.toContainText("Searching", { timeout: 40_000 })
      if (await rows.count()) break
      await page.waitForTimeout(5_000)
    }
    await expect(rows.first()).toBeVisible()
    await expect(page.getByTestId("add-to-quote").first()).toBeVisible()
    await shot(page, "admin-staff-search")
  })

  test("compliance officer sees the case list and a case", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.compliance)
    await page.goto(`${ADMIN}/compliance?status=`)
    const rows = page.getByTestId("cases").locator("tbody tr")
    await expect(rows.first()).toBeVisible()
    await shot(page, "admin-compliance-cases")
    // Prefer an open case (with the decision form) for the detail view.
    await page.goto(`${ADMIN}/compliance?status=OPEN`)
    const open = page.getByTestId("cases").locator("tbody tr")
    if (!(await open.first().waitFor({ timeout: 6000 }).then(() => true, () => false))) await page.goto(`${ADMIN}/compliance?status=`)
    await page.getByTestId("cases").locator("tbody tr").first().getByRole("link").click()
    await expect(page.getByText("What triggered it")).toBeVisible()
    await shot(page, "admin-compliance-case")
    await page.goto(`${ADMIN}/compliance/lists`)
    await expect(page.getByRole("heading", { name: "Sanctions lists" })).toBeVisible()
    await page.goto(`${ADMIN}/compliance/policies`)
    await expect(page.getByTestId("policies")).toBeVisible()
    await shot(page, "admin-compliance-policies")
  })

  test("cargo admin opens a shipment with goods screening", async ({ browser }) => {
    const page = await staffPage(browser, ADMIN, STAFF.cargo)
    await page.goto(`${ADMIN}/queues?tab=cargo&ctab=open`)
    const first = page.getByTestId("queue-table").locator("tbody tr").first()
    await expect(first).toBeVisible()
    await first.getByRole("link").first().click()
    await expect(page.getByTestId("goods")).toBeVisible()
    await shot(page, "admin-cargo-detail")
  })

  test("cargo admin corrects a tracking event (appended, original kept) and sets the delivery estimate", async ({ browser }) => {
    // Seeded as the cargo admin already signed in on this page (no second OTP request for that phone).
    const page = await staffPage(browser, ADMIN, STAFF.cargo)
    const shipment = await receivedShipment("MOBILE", await apiSessionFrom(page, ADMIN))
    expect((await shipment.admin.post(`/v1/admin/cargo/requests/${shipment.ref}/tracking-events`, { eventCode: "DEPARTED", location: "LHR", occurredAt: iso(1) })).status).toBe(201)
    await page.goto(`${ADMIN}/cargo/${shipment.ref}`)
    const history = page.getByTestId("tracking-history")
    const departed = history.locator("li").filter({ hasText: "DEPARTED" })
    await departed.getByRole("button", { name: "Correct" }).click()
    const dlg = page.getByTestId("dlg-correct-tracking")
    await dlg.locator("select").selectOption("AT_CUSTOMS")
    await dlg.getByLabel("Location").fill("IST customs")
    await dlg.getByLabel(/Reason/).fill("Partner entered the wrong scan")
    await dlg.getByRole("button", { name: "Append correction" }).click()
    await expect(dlg).toBeHidden()
    await expect(history.locator("li[data-effective=false]").filter({ hasText: "DEPARTED" })).toContainText("superseded")
    await expect(history.locator("li[data-effective=true]").filter({ hasText: "AT_CUSTOMS" })).toContainText("Partner entered the wrong scan")
    await page.getByRole("button", { name: "Set" }).click()
    const eta = page.getByTestId("dlg-eta")
    await eta.getByLabel("Estimated delivery").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16))
    await eta.getByRole("button", { name: "Save estimate" }).click()
    await expect(eta).toBeHidden()
    await expect(page.getByTestId("eta")).not.toContainText("No estimate set")
    await shot(page, "admin-cargo-tracking-correction")
  })

  test("owner creates, issues and cancels an invoice on a shipment; the invoice list and history show it", async ({ browser }) => {
    const cargoPage = await staffPage(browser, ADMIN, STAFF.cargo)
    const shipment = await receivedShipment("MOBILE", await apiSessionFrom(cargoPage, ADMIN))
    // The cargo admin cannot create invoices (no commercial_document.issue) and sees the panel without amounts.
    await cargoPage.goto(`${ADMIN}/cargo/${shipment.ref}`)
    await expect(cargoPage.getByTestId("create-invoice")).toHaveCount(0)

    const page = await staffPage(browser, ADMIN, STAFF.owner)
    await page.goto(`${ADMIN}/cargo/${shipment.ref}`)
    await page.getByTestId("create-invoice").click()
    const item = page.getByTestId("invoice-item")
    await expect(item).toContainText("Draft")
    await expect(item).toContainText("£50")
    await item.getByRole("button", { name: "Issue" }).click()
    await expect(item).toContainText(/INV-\d{4}-\d{6}/)
    await expect(item.locator("span").filter({ hasText: /^ISSUED$/i }).first()).toBeVisible()
    await item.getByText("History").click()
    await expect(item.getByTestId("invoice-history")).toContainText("Create")
    await expect(item.getByTestId("invoice-history")).toContainText("Issue")
    await shot(page, "admin-invoice-issued")

    await item.getByRole("button", { name: "Cancel…" }).click()
    const dlg = page.getByTestId("dlg-cancel-invoice")
    await dlg.getByLabel("Internal note").fill("Wrong consignee name")
    await dlg.getByRole("button", { name: "Cancel invoice" }).click()
    await expect(item.locator("span").filter({ hasText: /^CANCELLED$/i }).first()).toBeVisible()
    await item.getByText("History").click()
    await expect(item.getByTestId("invoice-history")).toContainText("Wrong consignee name")

    await page.goto(`${ADMIN}/invoices`)
    await expect(page.getByTestId("invoice-table")).toContainText(shipment.ref)
    await shot(page, "admin-invoices")
  })

  test("owner sees the payment status of a card-paid invoice and requests a refund; the refund waits for the provider's confirmation", async ({ browser }) => {
    const cargoPage = await staffPage(browser, ADMIN, STAFF.cargo)
    const shipment = await receivedShipment("MOBILE", await apiSessionFrom(cargoPage, ADMIN))
    const page = await staffPage(browser, ADMIN, STAFF.owner)
    const owner = await apiSessionFrom(page, ADMIN)
    const draft = await owner.post(`/v1/admin/requests/${shipment.ref}/invoices`)
    expect((await owner.post(`/v1/admin/invoices/${draft.body.id}/issue`)).status).toBe(200)
    // A card payment as the verified webhook would have recorded it (the webhook path itself is covered by stage11.e2e.ts).
    const inv = (await dbQuery<{ id: string; request_type: string; request_id: string; currency: string; total_minor: string }>("select id, request_type, request_id, currency, total_minor from invoices where id = $1", [draft.body.id]))[0]!
    await dbQuery("insert into payment_records (id, request_type, request_id, amount_minor, currency, method, received_at, external_reference, payer_name, status, verified_at, invoice_id, provider, provider_ref) values (gen_random_uuid(), $1, $2, $3, $4, 'CARD_ONLINE', now(), $5, 'Console Tester', 'VERIFIED', now(), $6, 'FAKE', $5)", [inv.request_type, inv.request_id, inv.total_minor, inv.currency, `pi_fake_console${Date.now()}`, inv.id])
    await dbQuery("update invoices set status = 'PAID', paid_at = now() where id = $1", [inv.id])
    const dev = await apiSessionFrom(await staffPage(browser, DEV, STAFF.developer), DEV)
    expect((await dev.patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)

    await page.goto(`${ADMIN}/cargo/${shipment.ref}`)
    const item = page.getByTestId("invoice-item")
    const panel = item.getByTestId("payment-panel")
    await expect(panel).toContainText("Payment")
    await expect(panel.getByTestId("payment-item")).toContainText("Card online")
    await expect(panel.getByTestId("payment-item")).toContainText("£50")
    await shot(page, "admin-payment-panel")
    await item.getByRole("button", { name: "Request refund…" }).click()
    const dlg = page.getByTestId("dlg-refund")
    await expect(dlg).toContainText("a second person must approve it")
    await dlg.getByTestId("refund-amount").fill("10")
    await dlg.getByRole("button", { name: "Request refund" }).click()
    await expect(panel.getByTestId("refund-item")).toContainText("SUBMITTED", { ignoreCase: true })
    await expect(panel.getByTestId("refund-item")).toContainText("£10")
    // The invoice is still PAID until the provider confirms with a verified charge.refunded event.
    await expect(item.locator("span").filter({ hasText: /^PAID$/i }).first()).toBeVisible()
    await shot(page, "admin-refund-requested")
  })
})

test.describe("Developer Panel", () => {
  test("developer sees users, simulates engine rules and checks health", async ({ browser }) => {
    const page = await staffPage(browser, DEV, STAFF.developer)
    await expect(page.getByTestId("workshop-strip")).toBeVisible()
    await page.goto(`${DEV}/users`)
    await expect(page.getByTestId("users").locator("tbody tr").first()).toBeVisible()
    await shot(page, "dev-users")
    await page.getByLabel("Search").fill("Karimi")
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expect(page.getByTestId("users")).toContainText("Sara Karimi")
    await page.getByTestId("users").getByRole("link", { name: "Sara Karimi" }).first().click()
    await expect(page.getByTestId("role-editor")).toContainText("admin")
    await shot(page, "dev-user-detail")

    await page.goto(`${DEV}/roles`)
    await expect(page.getByTestId("permission-matrix")).toContainText("user.role.assign.privileged")
    await shot(page, "dev-roles")

    await page.goto(`${DEV}/config/engine`)
    await expect(page.getByTestId("validation")).toHaveText(/valid/)
    await expect(page.getByTestId("versions").locator("li").first()).toBeVisible()
    const weight = page.locator('input[name="weights.price"]')
    await weight.fill(String(Number(await weight.inputValue()) + 0.05))
    await page.getByRole("button", { name: "Simulate", exact: true }).click()
    await expect(page.getByTestId("simulation")).toContainText("new supplier calls", { timeout: 45_000 })
    await expect(page.getByTestId("simulation")).toContainText("Draft")
    await shot(page, "dev-engine-simulate")

    await page.goto(`${DEV}/`)
    await expect(page.getByTestId("health")).toContainText("database")
    await expect(page.getByTestId("queues")).toBeVisible()
    await shot(page, "dev-health")

    for (const [path, name] of [["/providers", "dev-providers"], ["/templates", "dev-templates"], ["/settings", "dev-settings"], ["/audit", "dev-audit"], ["/lanes", "dev-lanes"]] as const) {
      await page.goto(`${DEV}${path}`)
      await expect(page.locator("h1")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await shot(page, name)
    }
  })

  test("developer sees the online payment settings: live is blocked, keys are write-only, FAKE health is green", async ({ browser }) => {
    const page = await staffPage(browser, DEV, STAFF.developer)
    expect((await (await apiSessionFrom(page, DEV)).patch("/v1/dev/payments/config", { provider: "FAKE" })).status).toBe(200)
    await page.goto(`${DEV}/payments`)
    await expect(page.locator("h1")).toContainText("Online payments")
    await expect(page.getByTestId("live-blocked")).toContainText("Live mode is blocked")
    await expect(page.getByTestId("webhook-url")).toContainText("/v1/webhooks/stripe")
    await expect(page.getByTestId("payments-config")).not.toContainText(/sk_test_|whsec_/)
    await page.getByRole("button", { name: "Run health check" }).click()
    await expect(page.getByTestId("payments-health")).toContainText("Healthy")
    await shot(page, "dev-payments")
  })
})

test.describe("Host isolation", () => {
  const status = async (page: Page, url: string) => (await page.request.get(url, { maxRedirects: 0 })).status()
  test("admin host 404s Developer Panel routes and vice versa", async ({ page }) => {
    for (const p of ["/users", "/roles", "/providers", "/config/engine", "/audit", "/dev/users", "/dev", "/api/v1/dev/health"]) expect(await status(page, `${ADMIN}${p}`), `admin ${p}`).toBe(404)
    for (const p of ["/queues", "/requests/UT-F-AAAAAA", "/compliance", "/search", "/admin/queues", "/admin"]) expect(await status(page, `${DEV}${p}`), `dev ${p}`).toBe(404)
    expect(await status(page, `${ADMIN}/sign-in`)).toBe(200)
    expect(await status(page, `${DEV}/sign-in`)).toBe(200)
    expect(await status(page, "http://localhost:4200/sign-in")).toBe(404)
    const res = await page.request.get(`${ADMIN}/sign-in`)
    expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(res.headers()["content-security-policy"]).not.toContain("strict-dynamic")
  })
})

test.describe("Mobile admin mode @mobile", () => {
  // The admin signed in once in the desktop project, minutes earlier; the owner is used by the invoice test, so a second
  // owner sign-in here would fall inside that phone's resend cooldown.
  test("admin triages on a phone: queue cards and a case", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 })
    const page = await ctx.newPage()
    const { staffSignIn } = await import("./helpers")
    await staffSignIn(page, ADMIN, STAFF.admin)
    await page.goto(`${ADMIN}/queues?tab=new`)
    await expect(page.getByTestId("queue-cards").locator("li").first()).toBeVisible()
    await shot(page, "mobile-queue")
    await page.getByTestId("queue-cards").locator("a").first().click()
    await expect(page.getByTestId("actions")).toBeVisible()
    await expect(page.getByRole("link", { name: "Call" })).toBeVisible()
    await shot(page, "mobile-request")
    await ctx.close()
  })
})
