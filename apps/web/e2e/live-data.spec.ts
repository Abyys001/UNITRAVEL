import { expect, test } from "@playwright/test"

// ADR-0014: a deployed host with no live source enabled shows the honest "no sources" notice and "Ask our team",
// never FAKE or sandbox results. The API side (no searchable providers -> NO_SOURCES) is covered by the API unit test.
const params = { trip: "ONE_WAY", from: { kind: "CITY", code: "THR", label: "Tehran" }, to: { kind: "CITY", code: "LON", label: "London" }, date: "2026-12-10", adt: 1, chd: [], inf: 0, cabin: "ECONOMY", flex: false, st: true, ac: true, on: true, gw: true, stops: 2, lay: [120, 360] }
const q = Buffer.from(JSON.stringify(params)).toString("base64")
const searchId = "0190f2a0-0000-7000-8000-000000000013"
const state = {
  id: searchId, status: "COMPLETE", version: 1,
  query: { tripType: "ONE_WAY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date: "2026-12-10", flexDays: 0 }], passengers: [{ type: "ADT" }], cabin: "ECONOMY", preferences: {} },
  progress: { sourcesTotal: 0, sourcesDone: 0, removedByPolicy: 0, slowSources: [], wave: 1 },
  expiresAt: "2026-12-01T00:00:00Z", historical: false, ruleVersion: 1, engineVersion: "test", notices: ["NO_SOURCES"], results: [], nextCursor: null, total: 0,
}

for (const locale of ["en", "fa"] as const) {
  test(`no live sources: notice and ask-our-team, no test data (${locale})`, async ({ page }) => {
    await page.route("**/api/v1/flight-searches", (r) => r.fulfill({ status: 201, json: { id: searchId } }))
    await page.route(`**/api/v1/flight-searches/${searchId}/events`, (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }))
    await page.route(`**/api/v1/flight-searches/${searchId}?*`, (r) => r.fulfill({ json: state }))
    await page.goto(`/${locale}/search?q=${encodeURIComponent(q)}`)
    const noSources = locale === "en" ? "Our flight sources are unavailable right now." : "منابع پرواز ما اکنون در دسترس نیستند."
    await expect(page.getByText(noSources).first()).toBeVisible()
    await expect(page.getByRole("link", { name: locale === "en" ? "Ask our team to find options" : "از تیم ما بخواهید گزینه پیدا کند" }).first()).toBeVisible()
    await expect(page.getByText(locale === "en" ? "TEST DATA" : "دادهٔ آزمایشی")).toHaveCount(0)
  })
}
