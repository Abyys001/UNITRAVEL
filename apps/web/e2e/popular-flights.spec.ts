import { expect, type Page, test } from "@playwright/test"

// ADR-0032 B4/B5: /flights lists popular routes from GET /v1/listings/flights (mocked here, so CI never calls Apify), never a price.

const FORBIDDEN = /price|amount|priceLevel|bookingToken|googleFlightsUrl|google\.com\/travel/i
const day = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const seg = (carrier: string, no: string, from: string, to: string, dep: string, arr: string, extra: Record<string, unknown> = {}) => ({
  marketing: { carrier, flightNumber: no }, operating: { carrier }, origin: { iata: from }, destination: { iata: to },
  departure: { local: `${day}T${dep}`, utc: `${day}T${dep}:00.000Z`, tz: "UTC" }, arrival: { local: `${day}T${arr}`, utc: `${day}T${arr}:00.000Z`, tz: "UTC" },
  cabin: "ECONOMY", aircraft: "Airbus A321neo", ...extra,
})

const ITEMS = [
  {
    label: "CACHED_OFFER", fetchedAt: hoursAgo(2), origin: "IST", destination: "LHR", departureDate: day, carriers: ["TK"], stops: 0, durationMin: 240,
    departureLocal: `${day}T08:00`, arrivalLocal: `${day}T12:00`, segments: [seg("TK", "1979", "IST", "LHR", "08:00", "12:00", { carrierName: "Turkish Airlines" })],
    offerRef: { searchId: "00000000-0000-4000-8000-000000000001", itineraryId: "itn-ist-lhr-1" }, complianceReview: false,
  },
  {
    // Six-hour wait at IST: the long-layover highlight. Iran-touching, so the ADR-0031 I5 note shows.
    label: "CACHED_OFFER", fetchedAt: hoursAgo(5), origin: "IKA", destination: "LHR", departureDate: day, carriers: ["TK"], stops: 1, durationMin: 720,
    departureLocal: `${day}T02:00`, arrivalLocal: `${day}T14:00`,
    segments: [seg("TK", "879", "IKA", "IST", "02:00", "05:00", { carrierName: "Turkish Airlines", operating: { carrier: "AJ" } }), seg("TK", "1971", "IST", "LHR", "11:00", "14:00", { carrierName: "Turkish Airlines" })],
    complianceReview: true,
  },
]

async function mockListings(page: Page, body: unknown) {
  await page.route("**/api/v1/listings/flights*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }))
}

for (const locale of ["en", "fa"] as const) {
  test(`popular routes render grouped by route with layovers, source and Iran note (${locale})`, async ({ page }) => {
    await mockListings(page, { items: ITEMS, notice: null })
    await page.goto(`/${locale}/flights`)
    const section = page.getByTestId("popular-routes")
    await expect(section.getByTestId("popular-route")).toHaveCount(2)
    await expect(section.getByTestId("popular-flight")).toHaveCount(2)
    await expect(section.getByTestId("long-layover")).toHaveCount(1)
    await expect(section.getByTestId("iran-review-note")).toHaveCount(1)
    await expect(section.getByTestId("popular-disclosure")).toBeVisible()
    if (locale === "en") {
      await expect(section.getByRole("heading", { name: "Popular routes" })).toBeVisible()
      await expect(section.getByText("Turkish Airlines").first()).toBeVisible()
      await expect(section.getByText("TK 879 · TK 1971")).toBeVisible()
      await expect(section.getByText("Operated by AJ")).toBeVisible()
      await expect(section.getByText("Airbus A321neo").first()).toBeVisible()
      await expect(section.getByText("Google Flights data, updated 2 hours ago")).toBeVisible()
      await expect(section.getByTestId("iran-review-note")).toHaveText("Our team reviews trips to or from Iran before confirming anything.")
      await expect(section.getByRole("button", { name: "Request this flight" })).toHaveCount(2)
    } else {
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
      await expect(section.getByRole("heading", { name: "مسیرهای پرطرفدار" })).toBeVisible()
      await expect(section.getByTestId("iran-review-note")).toHaveText("تیم ما پیش از تأیید هر چیزی، سفرهای به مقصد یا از مبدأ ایران را بررسی می‌کند.")
      await expect(section.getByRole("button", { name: "درخواست این پرواز" })).toHaveCount(2)
    }
  })
}

test("Request this flight enters the existing request flow (sign-in first when signed out)", async ({ page }) => {
  await mockListings(page, { items: ITEMS, notice: null })
  await page.goto("/en/flights")
  const cards = page.getByTestId("popular-flight")
  await cards.nth(0).getByRole("button", { name: "Request this flight" }).click()
  await expect(page).toHaveURL(/\/en\/sign-in\?next=/)
  const next = decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")
  expect(next).toBe("/en/request/new?s=00000000-0000-4000-8000-000000000001&i=itn-ist-lhr-1")

  // An item without an offer reference falls back to the manual request for that route and day.
  await page.goto("/en/flights")
  await cards.nth(1).getByRole("button", { name: "Request this flight" }).click()
  await expect(page).toHaveURL(/\/en\/sign-in\?next=/)
  const manual = new URL(`http://x${new URL(page.url()).searchParams.get("next")}`).searchParams.get("manual")!
  const shape = JSON.parse(decodeURIComponent(escape(atob(manual)))) as { from: { code: string }; to: { code: string }; date: string }
  expect([shape.from.code, shape.to.code, shape.date]).toEqual(["IKA", "LHR", day])
})

for (const notice of ["NO_SOURCES", null] as const) {
  test(`empty listings show the ask-our-team state and lead to the request form (notice ${notice})`, async ({ page }) => {
    await mockListings(page, { items: [], notice })
    await page.goto("/en/flights")
    const empty = page.getByTestId("popular-empty")
    await expect(empty).toContainText("No flights listed right now — tell us your route and dates and our team will find options")
    await empty.getByRole("button", { name: "Tell us your route and dates" }).click()
    await expect(page.locator("#flight-request :focus")).toHaveCount(1)
  })
}

test("no price data in the page or in any JSON the page receives", async ({ page }) => {
  const bodies: string[] = []
  page.on("response", async (r) => {
    if ((r.headers()["content-type"] ?? "").includes("json")) bodies.push(await r.text().catch(() => ""))
  })
  await mockListings(page, { items: ITEMS, notice: null })
  await page.goto("/en/flights")
  await expect(page.getByTestId("popular-flight")).toHaveCount(2)
  await page.waitForLoadState("networkidle")
  expect(bodies.length).toBeGreaterThan(0)
  for (const b of bodies) expect(b).not.toMatch(FORBIDDEN)
  const html = await page.content()
  // The A11 disclosure says "price is confirmed by our team", so the page copy is checked for fields and amounts, not the word.
  expect(html).not.toMatch(/priceLevel|bookingToken|googleFlightsUrl|google\.com\/travel|"price"|"amount/i)
  const cards = await page.getByTestId("popular-flight").allInnerTexts()
  for (const c of cards) expect(c).not.toMatch(/price|amount|[£$€]\s?\d|\d\s?(GBP|EUR|USD|TRY|IRR)\b/i)
})

test("fields the API must never send are not rendered even if present", async ({ page }) => {
  const poisoned = ITEMS.map((i) => ({ ...i, price: { amountMinor: 123456, currency: "GBP" }, priceLevel: "LOW-LEAK", bookingToken: "TOKEN-LEAK", googleFlightsUrl: "https://www.google.com/travel/flights/LEAK" }))
  await mockListings(page, { items: poisoned, notice: null })
  await page.goto("/en/flights")
  await expect(page.getByTestId("popular-flight")).toHaveCount(2)
  const html = await page.content()
  expect(html).not.toMatch(/LEAK|1,?234\.56|123456|google\.com\/travel/)
})

// ADR-0034: catalog-sourced rows carry no segments and `offerRef: null`; the card shows what it has and requests via the manual flow.
test("catalog-style card (no segments, no offerRef) shows carriers and times, no detail rows, and requests the manual flow", async ({ page }) => {
  const item = { label: "CACHED_OFFER", fetchedAt: hoursAgo(3), origin: "IKA", destination: "IST", departureDate: day, carriers: ["TK"], stops: 0, durationMin: 210, departureLocal: `${day}T07:30`, arrivalLocal: `${day}T11:00`, offerRef: null, complianceReview: false }
  await mockListings(page, { items: [item], notice: null })
  await page.goto("/en/flights")
  const card = page.getByTestId("popular-flight")
  await expect(card).toHaveCount(1)
  await expect(card).toContainText("TK")
  await expect(card.getByTestId("long-layover")).toHaveCount(0)
  await expect(card.locator("dl")).toHaveCount(0)
  await expect(card.getByRole("link")).toHaveCount(0)
  expect(await card.innerText()).not.toMatch(/[£$€]\s?\d/)
  await card.getByRole("button", { name: "Request this flight" }).click()
  await expect(page).toHaveURL(/\/en\/sign-in\?next=/)
  const manual = new URL(`http://x${new URL(page.url()).searchParams.get("next")}`).searchParams.get("manual")!
  const shape = JSON.parse(decodeURIComponent(escape(atob(manual)))) as { from: { code: string }; to: { code: string }; date: string }
  expect([shape.from.code, shape.to.code, shape.date]).toEqual(["IKA", "IST", day])
})
