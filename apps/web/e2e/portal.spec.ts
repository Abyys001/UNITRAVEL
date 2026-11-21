import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

// Customer portal (ADR-0040). Every API call is answered from fixtures in the browser, so what is asserted is exactly what the
// pages do with the documented response shapes (packages/contracts/src/portal.ts), at the three widths the brief names.

const VIEWPORTS = [{ w: 360, h: 740 }, { w: 768, h: 1024 }, { w: 1280, h: 800 }]
const NOW = "2026-11-21T10:00:00.000Z"
const iso = (d: number) => new Date(Date.parse(NOW) + d * 86_400_000).toISOString()

const steps = (cur: number) => ["RECEIVED", "REVIEW", "QUOTE", "TICKET"].map((code, i) => ({ code, label: ["Received", "In review", "Quote ready", "Ticketed"][i], state: i < cur ? "DONE" : i === cur ? "CURRENT" : "UPCOMING" }))
const inboxItems = () => [
  { id: "00000000-0000-4000-8000-000000000001", eventType: "quote.sent", title: "Your quote is ready", body: "Open your request to review the quote.", data: { ref: "UT-F-ABC234" }, critical: true, readAt: null, createdAt: iso(-0.1) },
  { id: "00000000-0000-4000-8000-000000000002", eventType: "support.reply", title: "We replied to your message", body: "A member of the team answered.", data: {}, critical: false, readAt: null, createdAt: iso(-1) },
  { id: "00000000-0000-4000-8000-000000000003", eventType: "request.received", title: "Request received", body: "We received your request.", data: { ref: "UT-F-ABC234" }, critical: false, readAt: iso(-2), createdAt: iso(-3) },
]
const overview = {
  profile: { name: "Neda Rahimi", email: "neda@student.example", phone: null, memberSince: iso(-200), missing: ["PHONE"] },
  counts: { active: 1, previous: 1, pendingActions: 1, unreadInbox: 2, unreadSupport: 1, openSupport: 1 },
  active: [{ kind: "FLIGHT", ref: "UT-F-ABC234", title: "Tehran to London", status: "QUOTED", statusLabel: "Quote ready", active: true, steps: steps(2), nextStep: "Review and accept the quote before it expires.", updatedAt: iso(-1) }],
  previous: [{ kind: "FLIGHT", ref: "UT-F-OLD111", title: "London to Tehran", status: "COMPLETED", statusLabel: "Completed", active: false, steps: [], nextStep: null, updatedAt: iso(-90) }],
  pendingActions: [{ kind: "ACCEPT_QUOTE", ref: "UT-F-ABC234", label: "Accept your quote", dueAt: iso(2) }],
  purchases: [{ kind: "INVOICE_PAID", ref: "INV-2026-0007", title: "Cargo invoice", amount: { amountMinor: 12000, currency: "GBP" }, at: iso(-10) }],
  notifications: inboxItems().slice(0, 2),
  support: [{ ref: "UT-H-ABCD23", topic: "BOOKING", subject: "Change of date", status: "PENDING_CUSTOMER", requestRef: null, createdAt: iso(-3), updatedAt: iso(-1), lastMessageAt: iso(-1), unread: true }],
  club: { enabled: true, member: { tierNameEn: "Silver", tierNameFa: "نقره‌ای", status: "ACTIVE" }, creditBalance: [{ amountMinor: 5000, currency: "GBP" }], points: 120 },
  travelCard: { status: "COMING_SOON" },
}
const cargoDetail = (state: string) => ({
  kind: "CARGO", ref: "UT-C-7Q2K9M", title: "Tehran to London parcel", status: "IN_TRANSIT", statusLabel: "In transit", active: true, steps: steps(2), nextStep: "Customs clearance in London.",
  events: [
    { id: "e2", at: iso(-0.5), label: "Departed on flight", location: "IKA", description: null, source: "CARRIER", corrected: false },
    { id: "e1", at: iso(-2), label: "Received at our partner", location: "Tehran", description: null, source: "UNITRAVEL", corrected: false },
  ],
  documents: [{ kind: "CARGO_DOCUMENT", label: "Air waybill copy", href: "/billing" }],
  shipment: { awbNumber: "176-12345675", origin: "Tehran", destination: "London", service: "Parcel", pieces: 2, chargeableWeightKg: 14.5, estimatedDeliveryAt: iso(5), carrier: { state, provider: state === "ACTIVE" ? "TRACKINGMORE" : null, airline: null, lastSyncedAt: null } },
  detailHref: "/cargo/UT-C-7Q2K9M",
})

interface Opts { club?: object; carrier?: string }
async function mockApi(page: Page, o: Opts = {}) {
  let items = inboxItems()
  const reads: unknown[] = []
  const json = (route: import("@playwright/test").Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
  // The readable CSRF cookie is what makes the session query run; the API itself is mocked below.
  await page.context().addCookies([{ name: "ut_csrf", value: "t", url: process.env.WEB_URL ?? "http://localhost:4000" }])
  await page.route("**/api/v1/**", async (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname.replace(/^\/api/, "")
    const m = route.request().method()
    if (p === "/v1/me") return json(route, { id: "u1", displayName: "Neda", status: "ACTIVE", preferredLocale: "en", calendar: "GREGORIAN", timezone: "Europe/London", identities: [], roles: [], permissions: [], flags: {}, permVersion: 1 })
    if (p === "/v1/site") return json(route, { menu: { flights: true, track: true, support: true, cargo: true, club: true, hotels: false, stays: false, trains: false, buses: false, visa: false, tours: false, cip: false, insurance: false, card: true }, support: { phone: null, email: null, hours: null }, payments: { online: false } })
    if (p === "/v1/me/unread") return json(route, { inbox: items.filter((i) => !i.readAt).length, support: 1 })
    if (p === "/v1/me/overview") return json(route, overview)
    if (p === "/v1/notifications/read" && m === "POST") {
      const b = route.request().postDataJSON() as { ids?: string[]; all?: boolean }
      reads.push(b)
      items = items.map((i) => (b.all || b.ids?.includes(i.id) ? { ...i, readAt: i.readAt ?? NOW } : i))
      return json(route, { updated: 1 })
    }
    if (p === "/v1/notifications") {
      const f = u.searchParams.get("filter")
      const list = items.filter((i) => (f === "unread" ? !i.readAt : f === "important" ? i.critical : true))
      return json(route, { items: list, nextBefore: null, unread: items.filter((i) => !i.readAt).length })
    }
    if (p === "/v1/track") return json(route, [{ kind: "CARGO", ref: "UT-C-7Q2K9M", title: "Tehran to London parcel", status: "IN_TRANSIT", statusLabel: "In transit", updatedAt: iso(-1) }])
    if (p === "/v1/track/search") return json(route, { ref: /7Q2K9M|176-12345675/i.test(u.searchParams.get("q") ?? "") ? "UT-C-7Q2K9M" : null })
    if (p === "/v1/track/UT-C-7Q2K9M") return json(route, cargoDetail(o.carrier ?? "NOT_CONFIGURED"))
    if (p === "/v1/me/club") return json(route, o.club ?? { enabled: true, member: { tier: { code: "SILVER", nameEn: "Silver", nameFa: "نقره‌ای" }, status: "ACTIVE", joinedAt: iso(-100) }, benefits: [], creditBalance: [{ amountMinor: 5000, currency: "GBP" }], points: { balance: 120, history: [{ id: "p1", kind: "GRANTED", delta: 150, note: "Welcome bonus", createdAt: iso(-30) }, { id: "p2", kind: "DEDUCTED", delta: -30, note: null, createdAt: iso(-5) }] } })
    if (p === "/v1/support/tickets") return json(route, overview.support)
    return json(route, { status: 404, code: "NOT_FOUND", title: "Not found" }, 404)
  })
  return { reads }
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([])
}

for (const { w, h } of VIEWPORTS) {
  test.describe(`portal at ${w}px`, () => {
    test.use({ viewport: { width: w, height: h } })

    test("dashboard leads with what needs the customer, Travel Card is coming soon", async ({ page }) => {
      await mockApi(page)
      await page.goto("/en/dashboard")
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello, Neda Rahimi")
      const pending = page.getByRole("region", { name: "Needs you now" })
      await expect(pending).toContainText("Accept your quote")
      await expect(pending).toContainText("Due")
      // Pending actions come before active requests in the page order.
      const order = await page.locator("main section h2").allTextContents()
      expect(order.indexOf("Needs you now")).toBeLessThan(order.indexOf("In progress"))
      await expect(page.getByText("Step 3 of 4")).toBeVisible()
      await expect(page.getByText("Review and accept the quote")).toBeVisible()
      const card = page.getByTestId("travel-card-tile")
      await expect(card).toContainText("Coming soon")
      await expect(card.locator("a, button")).toHaveCount(0)
      await expect(page.getByRole("link", { name: "Open a support request" })).toBeVisible()
      await expect(page.getByText("New reply").first()).toBeVisible()
      await axe(page)
    })

    test("inbox: unread is text, filter, detail, mark read", async ({ page }) => {
      const { reads } = await mockApi(page)
      await page.goto("/en/inbox")
      const list = page.getByTestId("inbox-list")
      await expect(list.locator('[data-unread="true"]')).toHaveCount(2)
      await expect(list.getByText("Unread", { exact: true })).toHaveCount(2)
      await expect(list.getByText("Important", { exact: true })).toHaveCount(1)
      await axe(page)
      await page.getByRole("button", { name: /^Unread/ }).click()
      await expect(list.locator("li")).toHaveCount(2)
      await page.getByRole("button", { name: "Important" }).click()
      await expect(list.locator("li")).toHaveCount(1)
      await page.getByRole("button", { name: "All", exact: true }).click()
      await list.getByRole("link", { name: /Your quote is ready/ }).click()
      await expect(page).toHaveURL(/inbox\?m=0{8}-0000-4000-8000-000000000001/)
      const detail = page.getByTestId("inbox-detail")
      await expect(detail).toContainText("Open your request to review the quote.")
      await expect(detail.getByRole("link", { name: "Open the related request" })).toHaveAttribute("href", "/en/requests/UT-F-ABC234")
      await expect.poll(() => reads.length).toBeGreaterThan(0)
      expect(reads[0]).toEqual({ ids: ["00000000-0000-4000-8000-000000000001"] })
      // On phones the list gives way to the message; from 1024 px both show.
      if (w < 1024) { await expect(list).toBeHidden(); await page.getByRole("link", { name: "Back to messages" }).click(); await expect(list).toBeVisible() } else await expect(list).toBeVisible()
      await axe(page)
    })

    test("track: search, cargo detail, carrier not connected", async ({ page }) => {
      await mockApi(page)
      await page.goto("/en/track")
      await page.getByLabel("Reference or air waybill number").fill("176-12345675")
      await page.getByRole("button", { name: "Find" }).click()
      await expect(page).toHaveURL(/track\?ref=UT-C-7Q2K9M/)
      const banner = page.getByTestId("carrier-banner")
      await expect(banner).toContainText("Live airline tracking is not connected")
      await expect(banner).toContainText("UniTravel cargo team")
      await expect(page.getByTestId("eta")).toContainText("estimate")
      await expect(page.getByText("176-12345675")).toBeVisible()
      const events = page.getByTestId("track-events").locator("li")
      await expect(events.first()).toContainText("Departed on flight")
      await expect(events.first()).toContainText("Airline via TrackingMore")
      await expect(events.last()).toContainText("UniTravel")
      await expect(page.getByText("Air waybill copy")).toBeVisible()
      await axe(page)
    })

    test("track: a reference that is not theirs says so plainly", async ({ page }) => {
      await mockApi(page)
      await page.goto("/en/track")
      await page.getByLabel("Reference or air waybill number").fill("UT-F-ZZZZZZ")
      await page.getByRole("button", { name: "Find" }).click()
      await expect(page.getByTestId("track-search-msg")).toContainText("no purchase of yours")
    })

    test("club: member with points and history", async ({ page }) => {
      await mockApi(page)
      await page.goto("/en/club")
      await expect(page.getByTestId("club-member")).toContainText("Silver")
      await expect(page.getByTestId("club-points")).toHaveText("120")
      const hist = page.getByTestId("club-points-history")
      await expect(hist).toContainText("Points added")
      await expect(hist).toContainText("Welcome bonus")
      await expect(hist).toContainText("Points deducted")
      await axe(page)
    })

    test("club: member without a points field shows no points", async ({ page }) => {
      await mockApi(page, { club: { enabled: true, member: { tier: { code: "S", nameEn: "Silver", nameFa: "x" }, status: "ACTIVE", joinedAt: iso(-100) }, benefits: [], creditBalance: [] } })
      await page.goto("/en/club")
      await expect(page.getByTestId("club-member")).toBeVisible()
      await expect(page.getByTestId("club-points")).toHaveCount(0)
    })

    test("club: non-member sees an explanation and no way to join", async ({ page }) => {
      await mockApi(page, { club: { enabled: true, member: null, benefits: [], creditBalance: [] } })
      await page.goto("/en/club")
      const nm = page.getByTestId("club-non-member")
      await expect(nm).toContainText("by invitation")
      await expect(page.getByRole("button", { name: /join|enrol|sign up/i })).toHaveCount(0)
      await axe(page)
    })

    test("support: list shows status and unread", async ({ page }) => {
      await mockApi(page)
      await page.goto("/en/support")
      const list = page.getByTestId("support-tickets")
      await expect(list).toContainText("Change of date")
      await expect(list).toContainText("New reply")
      await expect(list).toContainText("Waiting for you")
      await axe(page)
    })
  })
}

test("Persian dashboard is right-to-left with the greeting in Persian @mobile", async ({ page }) => {
  await mockApi(page)
  await page.goto("/fa/dashboard")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("سلام")
  await expect(page.getByTestId("travel-card-tile")).toContainText("به‌زودی")
})
