import { expect, type Page, type Route, test } from "@playwright/test"

import { ADMIN, DEV } from "./helpers"

// ADR-0032 B2/B7 in the console, against a fully mocked API (page.route): no stack, no Apify, no token anywhere.
const REF = "UT-F-ADR32"
const ITIN = "itin-apify-1"
const JOB = "6f1d8c2e-5b0a-4c7e-9a51-3f2b6d4e8a10"
const FETCHED = "2026-11-03T09:15:00Z"
const GBP = (amountMinor: number) => ({ amountMinor, currency: "GBP" })

const FULL = ["flight_request.read.any", "flight_request.transition", "pricing.read.internal", "quote.create", "catalog.read", "provider.config.read", "provider.config.write", "audit.read"]
const BASIC = ["flight_request.read.any", "flight_request.transition"]

const me = (permissions: string[]) => ({
  id: "0b7e2f0e-1c1d-4d38-9a43-2f1a5b6c7d8e", displayName: "Sara Admin", status: "ACTIVE", preferredLocale: "en", calendar: "GREGORIAN", timezone: "Europe/London",
  identities: [], roles: ["ADMIN"], permissions, flags: {}, permVersion: 1, profile: null, notificationPrefs: {},
  mfa: { level: 1, enrolled: ["TOTP"], stepUpValidUntil: null }, onDuty: true, surfaces: { customer: false, admin: true, developer: true },
})

const segment = { marketing: { carrier: "TK", flightNumber: "1980" }, operating: { carrier: "TK" }, origin: { iata: "LHR" }, destination: { iata: "IST" }, departure: { local: "2026-12-01T10:00", utc: "2026-12-01T10:00:00Z", tz: "Europe/London" }, arrival: { local: "2026-12-01T16:00", utc: "2026-12-01T13:00:00Z", tz: "Europe/Istanbul" }, cabin: "ECONOMY", technicalStops: [] }
const unknownBaggage = [{ segmentIndex: 0, passengerType: "ADT", checked: { status: "UNKNOWN" }, cabin: { status: "UNKNOWN" } }]
const itinerary = {
  id: ITIN, construction: "DIRECT", ticketing: "SINGLE_TICKET", tabs: [], price: { total: GBP(21000), isSumOfTickets: false }, durationMin: 240,
  components: [{ source: { provider: "apify-google-flights", providerOfferId: "gf-1", rung: "SCHEDULE", fetchedAt: FETCHED, fake: false, confidence: "INDICATIVE" }, slices: [{ origin: "LHR", destination: "IST", segments: [segment], durationMin: 240 }], price: { total: GBP(21000) }, ticketing: "SINGLE_TICKET", brand: { status: "UNKNOWN" }, baggage: unknownBaggage, conditions: { change: { status: "UNKNOWN" }, refund: { status: "UNKNOWN" } }, seatSelection: { status: "UNKNOWN" }, seatMapAvailable: false, restrictions: [] }],
  connections: [], truth: [], baggage: unknownBaggage, riskFlags: [], score: 0, explain: {}, stops: 0, firstDeparture: "2026-12-01T10:00:00Z", lastArrival: "2026-12-01T13:00:00Z", carriers: ["TK"], complianceReview: false,
}

/** What the API serialises: price, price level and the Google link only for `pricing.read.internal` (ADR-0029 A5). */
const detail = (internal: boolean) => ({
  ref: REF, id: "fr-1", kind: "FROM_RESULT", status: "IN_REVIEW", paymentStatus: "UNPAID", version: 3, tripType: "ONE_WAY",
  query: { tripType: "ONE_WAY", slices: [{ from: { airport: "LHR" }, to: { airport: "IST" }, date: "2026-12-01", flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", preferences: { allowSelfTransfer: false, allowOvernight: false, maxStops: 1 } },
  manual: null, preferences: {}, customerNote: null, urgent: false, firstTravelDate: "2026-12-01", submittedAt: "2026-11-03T09:20:00Z", submittedVia: "WEB", submittedLocale: "en",
  routeLabel: "LHR → IST", statusLabel: "In review", places: { LHR: "London Heathrow", IST: "Istanbul" },
  sla: { dueAt: null, firstContactAt: null, assignedAt: null }, assignee: null,
  customer: { id: "c-1", displayName: "Test Customer", nameLatin: null, nameFa: null, contactTimePref: null, phone: "+447700900123", phoneVerified: true, phoneVerifiedAt: null, alternativeContact: null, history: [] },
  travellers: [],
  snapshot: {
    id: "snap-1", itinerary, ruleVersion: 1, engineVersion: "engine-1", contentHash: "abcdef0123456789", createdAt: "2026-11-03T09:20:00Z",
    ...(internal ? { priceAtSubmit: GBP(21000), priceRevalidated: null, revalidatedAt: null } : {}),
    sources: [{ provider: "apify-google-flights", fetchedAt: FETCHED, confidence: "INDICATIVE", ...(internal ? { price: GBP(21000), priceLevel: "low", googleFlightsUrl: "https://www.google.com/travel/flights?tfs=abc" } : {}) }],
  },
  timeline: [], messages: [], notes: [], contacts: [], quotes: [], reservations: [], tickets: [], payments: [], documents: [], afterSales: [], creditOverrides: [], compliance: [], actions: [],
  paymentRecording: { allowed: false, suggestedAmount: null }, amendment: { allowed: false, needsAcknowledge: false }, atolMode: "OFF",
})

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
const missing = (r: Route) => json(r, { status: 404, code: "NOT_FOUND", title: "Not found" }, 404)

/** Signed-in look without a session: a readable CSRF cookie lets the console ask /v1/me, which the mock answers. */
async function mockApi(page: Page, base: string, permissions: string[], locale: "en" | "fa" = "en") {
  await page.context().addCookies([{ name: "ut_csrf", value: "mock", url: base }])
  await page.addInitScript((l) => { try { localStorage.setItem("ut-locale", l) } catch { /* private mode */ } }, locale)
  await page.route("**/api/**", missing)
  await page.route("**/api/v1/admin/events**", (r) => r.abort())
  await page.route("**/api/v1/auth/activity", (r) => json(r, {}))
  await page.route("**/api/v1/me", (r) => json(r, me(permissions)))
}

test.describe("ADR-0032 console (mocked API)", () => {
  test("source badge with price for pricing.read.internal; Revalidate PENDING → DONE; UNKNOWN banner", async ({ page }) => {
    await mockApi(page, ADMIN, FULL)
    await page.route(`**/api/v1/admin/flight-requests/${REF}`, (r) => json(r, detail(true)))
    let polls = 0
    await page.route(`**/api/v1/admin/itineraries/${ITIN}/recheck`, (r) => json(r, { jobId: JOB, status: "PENDING" }))
    await page.route(`**/api/v1/admin/itineraries/${ITIN}/recheck/${JOB}`, (r) => {
      polls += 1
      return json(r, polls < 2 ? { jobId: JOB, status: "PENDING" } : { jobId: JOB, status: "DONE", result: { stillListed: true, priceChanged: true, old: GBP(21000), new: GBP(23450), fetchedAt: "2026-11-03T10:05:00Z", components: [] } })
    })
    await page.goto(`${ADMIN}/requests/${REF}`)

    const badge = page.getByTestId("source-badge")
    await expect(badge).toContainText("Source: Apify / Google Flights, fetched")
    await expect(badge.getByTestId("source-price")).toContainText("210")
    await expect(badge.getByTestId("source-level")).toContainText("low")
    const link = badge.getByTestId("source-link")
    await expect(link).toHaveAttribute("href", "https://www.google.com/travel/flights?tfs=abc")
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", "noopener noreferrer")

    const banner = page.getByTestId("unknown-banner")
    await expect(banner).toContainText("Baggage and fare conditions are unknown from this source. Record them from the booking panel before sending a quote.")
    await expect(banner.getByTestId("unknown-quote-link")).toHaveAttribute("href", `/requests/${REF}/quote`)

    await page.getByTestId("revalidate-now").click()
    await expect(page.getByTestId("revalidate-pending")).toBeVisible()
    const result = page.getByTestId("revalidate-result")
    await expect(result).toContainText("Still listed", { timeout: 15_000 })
    await expect(result).toContainText("210")
    await expect(result).toContainText("234.50")
    expect(polls).toBeGreaterThanOrEqual(2)
  })

  test("without pricing.read.internal: badge only, no price, link or Revalidate", async ({ page }) => {
    await mockApi(page, ADMIN, BASIC)
    await page.route(`**/api/v1/admin/flight-requests/${REF}`, (r) => json(r, detail(false)))
    await page.goto(`${ADMIN}/requests/${REF}`)
    const badge = page.getByTestId("source-badge")
    await expect(badge).toContainText("Source: Apify / Google Flights, fetched")
    await expect(badge.getByTestId("source-price")).toHaveCount(0)
    await expect(badge.getByTestId("source-level")).toHaveCount(0)
    await expect(badge.getByTestId("source-link")).toHaveCount(0)
    await expect(page.getByTestId("revalidate-now")).toHaveCount(0)
    await expect(page.getByTestId("unknown-banner")).toBeVisible()
  })

  test("Revalidate shows readable text for a used-up staff budget", async ({ page }) => {
    await mockApi(page, ADMIN, FULL)
    await page.route(`**/api/v1/admin/flight-requests/${REF}`, (r) => json(r, detail(true)))
    await page.route(`**/api/v1/admin/itineraries/${ITIN}/recheck`, (r) => json(r, { status: 429, code: "RATE_LIMITED", title: "Too many requests", detail: "The staff budget for this month is used up" }, 429))
    await page.goto(`${ADMIN}/requests/${REF}`)
    await page.getByTestId("revalidate-now").click()
    await expect(page.getByTestId("revalidate-error")).toContainText("staff revalidation budget for this month is used up")
  })

  test("dev dashboard shows the Apify usage card", async ({ page }) => {
    await mockApi(page, DEV, FULL)
    await page.route("**/api/v1/dev/health", (r) => json(r, { version: "1.0.0", commit: "local", env: "local", uptimeSeconds: 3600, database: { ok: true, latencyMs: 1, migrations: { applied: 1, latest: "0001" } }, redis: { ok: true, latencyMs: 1 }, queues: [], workers: [], configVersions: {}, flags: {}, dependencies: [], outbox: { pending: 0, oldestSeconds: null } }))
    await page.route("**/api/v1/admin/catalog/usage", (r) => json(r, usage()))
    const run = (createdAt: string) => ({ id: crypto.randomUUID(), provider: "apify-google-flights", externalRunId: null, pool: "CUSTOMER", purpose: "SEARCH", searchId: null, routes: [], status: "SUCCEEDED", rows: 10, estimatedUsd: 0.01, notices: [], errors: [], startedAt: null, finishedAt: null, createdAt })
    const now = new Date().toISOString()
    await page.route("**/api/v1/dev/providers/apify-google-flights/runs**", (r) => json(r, [run(now), run(now), run(now), run("2020-01-15T00:00:00Z")]))
    await page.route("**/api/v1/dev/providers/apify-google-flights", (r) => json(r, provider()))
    await page.goto(`${DEV}/`)
    const card = page.getByTestId("apify-usage")
    await expect(card).toContainText("Apify usage")
    await expect(card.getByTestId("catalog-over")).toContainText("Projected spend is over the budget")
    await expect(card).toContainText("Spent this cycle")
    await expect(card).toContainText("$4.80")
    await expect(card).toContainText("Projected at cycle end")
    await expect(card).toContainText("Refreshing on schedule")
    await expect(card).toContainText("Runs this month")
    await expect(card).toContainText("3")
    await expect(card).toContainText("Last connection test")
  })

  test("admin dashboard shows the Apify usage card from the admin route, without any /v1/dev call", async ({ page }) => {
    await mockApi(page, ADMIN, FULL)
    const devCalls: string[] = []
    page.on("request", (req) => { if (req.url().includes("/api/v1/dev/")) devCalls.push(req.url()) })
    await page.route("**/api/v1/admin/catalog/usage", (r) => json(r, usage()))
    await page.goto(`${ADMIN}/`)
    const card = page.getByTestId("apify-usage")
    await expect(card).toContainText("Apify usage")
    await expect(card.getByTestId("catalog-over")).toContainText("Projected spend is over the budget")
    await expect(card).toContainText("Spent this cycle")
    await expect(card).toContainText("$4.80")
    await expect(card).toContainText("Projected at cycle end")
    await expect(card).toContainText("Refreshing on schedule")
    // Run count, connection test and the provider link need the Developer Panel routes, which the admin host refuses.
    await expect(card).not.toContainText("Runs this month")
    await expect(card).not.toContainText("Last connection test")
    await expect(card.getByRole("link")).toHaveCount(0)
    expect(devCalls).toEqual([])
  })

  test("admin dashboard has no Apify usage card without catalog.read", async ({ page }) => {
    await mockApi(page, ADMIN, BASIC)
    let asked = false
    await page.route("**/api/v1/admin/catalog/usage", (r) => { asked = true; return json(r, usage()) })
    await page.goto(`${ADMIN}/`)
    await expect(page.getByTestId("tile-now")).toBeVisible()
    await expect(page.getByTestId("apify-usage")).toHaveCount(0)
    expect(asked).toBe(false)
  })

  for (const locale of ["en", "fa"] as const) {
    test(`Apify Developer Panel page: key last4, test connection, help box (${locale})`, async ({ page }) => {
      await mockApi(page, DEV, FULL, locale)
      await page.route("**/api/v1/dev/providers/apify-google-flights", (r) => json(r, provider()))
      await page.route("**/api/v1/dev/providers/apify-google-flights/test", (r) => json(r, { plan: null, monthlyUsageUsd: 1.2, monthlyLimitUsd: 5, cycleStart: "2026-11-01T00:00:00Z", cycleEnd: "2026-11-30T23:59:59Z", testedAt: "2026-11-03T10:00:00Z" }))
      await page.route("**/api/v1/dev/audit-log**", (r) => json(r, { items: [{ id: "1", occurredAt: "2026-11-02T08:00:00Z", actor: "dev@unitravel.example", actorKind: "STAFF", action: "provider.credentials_rotated", entityType: "provider", entityId: "apify-google-flights", contextRef: null, before: null, after: null, ip: null, requestId: null, hash: "h" }], nextCursor: null }))
      await page.goto(`${DEV}/providers/apify-google-flights`)

      const key = page.getByTestId("apify-key")
      await expect(key).toContainText("•••• wxyz")
      await expect(key).toContainText("dev@unitravel.example")
      await page.getByTestId("apify-test").click()
      const res = page.getByTestId("apify-test-result")
      await expect(res).toContainText("$1.20")
      await expect(res).toContainText("$5.00")
      await expect(page.getByTestId("apify-audit")).toContainText("provider.credentials_rotated")

      const help = page.getByTestId("apify-help")
      if (locale === "en") {
        await expect(help).toContainText("We never show the full key again. To see it, open console.apify.com → Settings → API & Integrations → Personal API tokens, and copy it there.")
        await expect(help).toContainText("To update it: paste the new token here → Test connection → Save. Takes effect immediately, no restart.")
        await expect(help).toContainText("To rotate a leaked key: create a new token in Apify, save it here, then delete the old token in Apify.")
        await expect(help).toContainText("Spending cap: console.apify.com → Billing → Limits. Keep the monthly limit at $5 for the free plan.")
      } else {
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
        await expect(help).toContainText("مدیریت کلید Apify")
        await expect(help).toContainText("ما هرگز کلید کامل را دوباره نشان نمی‌دهیم")
        await expect(help).toContainText("سقف هزینه")
      }
      await expect(help.locator("li")).toHaveCount(4)
      await expect(help.locator('a[href="https://console.apify.com/settings/integrations"]').first()).toHaveAttribute("rel", "noopener noreferrer")
      await expect(help.locator('a[href="https://console.apify.com/billing/limits"]')).toHaveCount(1)
    })
  }
})

/** `GET /v1/admin/catalog/usage` (CatalogUsage, ADR-0034): the pacer's spend, projection and pause state. */
function usage() {
  return {
    cycleStart: "2026-11-01T00:00:00Z", cycleEnd: "2026-11-30T23:59:59Z", spentUsd: 4.8, spentSource: "apify", ledgerUsd: 4.6, projectedUsd: 5.6, budgetUsd: 5,
    availableUsd: 0.2, reserveLeftUsd: 0.5, reserveReleased: false, rowsPerDay: 120, runsPerDay: 3.5, costCorrection: 1.04, paused: false, pauseReason: null,
    accountCapUsd: null, lastTick: { at: "2026-11-04T08:00:00Z", outcome: "STARTED", tickBudgetUsd: 0.05, slots: 4 }, nextTickAt: "2026-11-04T12:00:00Z", schemaAlert: null, overBudget: true,
  }
}

function provider() {
  return {
    id: "apify-google-flights", name: "Apify / Google Flights", environment: "live", enabled: true, priority: 5,
    capabilities: { search: true, price: false, seatMap: false, order: false },
    limits: { timeoutMs: 60000, maxConcurrent: 1, rps: 1, dailyBudget: 0, lookToBookAlert: 0 },
    markets: { pointOfSale: "GB", currency: "GBP", originRegions: [], destinationRegions: [] }, shadowMode: false,
    credentials: { set: true, last4: "wxyz", rotatedAt: "2026-11-02T08:00:00Z", rotatedBy: "dev@unitravel.example", invalidAt: null, testedAt: "2026-11-03T08:00:00Z" },
    metering: null, health: { circuit: "CLOSED", successRate: null, p50: null, p95: null, lastError: null, callsToday: 0 }, version: 1,
  }
}
