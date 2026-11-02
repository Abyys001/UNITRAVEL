import { expect, test, type Page } from "@playwright/test"

import { receivedShipment } from "../../api/test/cargo-fixture"
import { ADMIN_HOST, STAFF, staffSession } from "../../api/test/client"
// Same list the API serialiser tests use (ADR-0004, ADR-0029 A9); a key added there is checked here too.
import { FORBIDDEN_CUSTOMER_KEYS } from "../../api/src/testing/leak"
import { signIn } from "./helpers"

// STAGE-23 stream B, MASTER_PLAN section 5 item 5. Crawls the customer pages logged out and logged in and looks for staff-only
// keys and Google Travel/Flights references in everything the browser receives: HTML, RSC/flight payloads, __NEXT_DATA__,
// same-origin JS chunks, API/network JSON and console output. Zero hits expected.

const FORBIDDEN_TEXT = ["google.com/travel", "google.com/flights", "booking_token"] as const

export type LeakHit = { needle: string; at: string }

/** Pure. A key counts only as a JSON key (`"key":`), also when escaped inside an RSC string (`\"key\":`). */
export function scanForLeaks(text: string, keys: readonly string[] = FORBIDDEN_CUSTOMER_KEYS): LeakHit[] {
  const hits: LeakHit[] = []
  const snippet = (i: number) => text.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, " ")
  for (const k of keys) {
    const m = new RegExp(`\\\\*"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\\*"\\s*:`, "i").exec(text)
    if (m) hits.push({ needle: `"${k}":`, at: snippet(m.index) })
  }
  const lower = text.toLowerCase()
  for (const n of FORBIDDEN_TEXT) {
    const i = lower.indexOf(n)
    if (i >= 0) hits.push({ needle: n, at: snippet(i) })
  }
  return hits
}

test.describe("scanForLeaks (pure)", () => {
  test("finds plain and escaped JSON keys, ignores values and similar words", () => {
    expect(scanForLeaks('{"priceLevel": 2}').map((h) => h.needle)).toEqual(['"priceLevel":'])
    expect(scanForLeaks('self.__next_f.push([1,"{\\"bookingToken\\":\\"x\\"}"])').map((h) => h.needle)).toEqual(['"bookingToken":'])
    expect(scanForLeaks('{"SCORE" : 1}')).toHaveLength(1)
    expect(scanForLeaks('{"label":"priceLevel","scorecard":1,"internalNotesHint":2}')).toEqual([])
    expect(scanForLeaks("const score = 1; explain()")).toEqual([])
  })
  test("finds Google Travel/Flights links and booking_token anywhere", () => {
    const needles = scanForLeaks('<a href="https://www.google.com/travel/flights?x=1">a</a> https://GOOGLE.com/flights?booking_token=abc').map((h) => h.needle)
    expect(needles).toEqual(["google.com/travel", "google.com/flights", "booking_token"])
  })
  test("clean text has no hits and the key list is non-empty", () => {
    expect(FORBIDDEN_CUSTOMER_KEYS.length).toBeGreaterThan(20)
    expect(scanForLeaks('{"code":"TK","name":"Turkish Airlines"}')).toEqual([])
  })
})

// Same defaults as playwright.config.ts and helpers.ts.
const WEB_ORIGIN = new URL(process.env.WEB_URL ?? "http://localhost:4000").origin
const API_ORIGIN = new URL(process.env.API_URL ?? "http://localhost:4100").origin

const TEXTUAL = /json|javascript|ecmascript|x-component|html|text\/plain/i

/** Collects what the browser receives for one test; `snap` records the rendered HTML of the current page. */
function crawler(page: Page, apiOrigin: string, webOrigin = WEB_ORIGIN) {
  const bodies = new Map<string, string>()
  const consoleText: string[] = []
  const pending: Promise<void>[] = []
  const seenScripts = new Set<string>()
  page.on("console", (m) => { consoleText.push(`${m.type()}: ${m.text()}`) })
  page.on("pageerror", (e) => { consoleText.push(`pageerror: ${e.message}`) })
  page.on("response", (r) => {
    const u = new URL(r.url())
    if (!(u.origin === webOrigin || u.origin === apiOrigin)) return
    if (!TEXTUAL.test(r.headers()["content-type"] ?? "")) return
    if (/javascript|ecmascript/i.test(r.headers()["content-type"] ?? "")) seenScripts.add(u.pathname + u.search)
    pending.push(r.text().then((t) => { bodies.set(`${r.request().method()} ${u.pathname}${u.search} #${bodies.size}`, t) }, () => { /* body gone after a redirect or navigation */ }))
  })
  return {
    async snap(label: string) {
      await page.waitForLoadState("networkidle")
      bodies.set(`HTML ${label} ${page.url()}`, await page.content())
      // Chunks the browser served from cache never fire a response event, so fetch the ones the page references.
      const srcs = await page.locator("script[src]").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src))
      for (const src of srcs) {
        const u = new URL(src)
        if (u.origin !== webOrigin || seenScripts.has(u.pathname + u.search)) continue
        seenScripts.add(u.pathname + u.search)
        const r = await page.request.get(src)
        bodies.set(`JS ${u.pathname}`, await r.text())
      }
      await Promise.all(pending.splice(0))
    },
    leaks(): string[] {
      const all: [string, string][] = [...bodies, ...consoleText.map((c, i): [string, string] => [`console #${i}`, c])]
      return all.flatMap(([src, text]) => scanForLeaks(text).map((h) => `${src}: ${h.needle} near "${h.at}"`))
    },
    stats: () => ({ html: [...bodies.keys()].filter((k) => k.startsWith("HTML")).length, js: [...bodies.keys()].filter((k) => k.startsWith("JS ") || /\.js/.test(k)).length, json: [...bodies.keys()].filter((k) => k.startsWith("GET /api")).length }),
  }
}


/** Home, search with the FAKE provider's default query, results and one itinerary detail, then the request form link. */
async function browseFlights(page: Page, crawl: ReturnType<typeof crawler>) {
  await page.goto("/en")
  await crawl.snap("home")
  await page.goto("/fa")
  await crawl.snap("home-fa")
  await page.goto("/en")
  await page.getByRole("button", { name: "Search flights" }).click()
  await expect(page).toHaveURL(/\/en\/search/)
  const cards = page.locator("main ol li a, main ul li a").filter({ hasText: "Price confirmed in your quote" })
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  await crawl.snap("results")
  await cards.first().click()
  await expect(page).toHaveURL(/\/en\/itinerary\//)
  await expect(page.getByRole("heading", { name: "Itinerary" })).toBeVisible()
  await crawl.snap("itinerary")
}

test("customer pages leak nothing, logged out", async ({ page }) => {
  const crawl = crawler(page, API_ORIGIN)
  await browseFlights(page, crawl)
  // Logged out the request form sends the visitor to sign-in; the redirect target is still a customer page.
  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/sign-in/)
  await crawl.snap("request-new-signed-out")
  expect(crawl.stats().html).toBeGreaterThanOrEqual(5)
  expect(crawl.stats().js).toBeGreaterThan(0)
  expect(crawl.stats().json).toBeGreaterThan(0)
  expect(crawl.leaks()).toEqual([])
})

test("customer pages leak nothing, signed in (request form, requests, request detail)", async ({ page }) => {
  await signIn(page, "neda@student.example")
  const crawl = crawler(page, API_ORIGIN)
  await browseFlights(page, crawl)
  await page.getByRole("button", { name: /Request this itinerary/ }).click()
  await expect(page).toHaveURL(/\/en\/request\/new/)
  await page.waitForLoadState("networkidle")
  const travellers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Who is travelling" }) }).locator("li input[type=checkbox]")
  if ((await travellers.count()) === 0) {
    await page.getByRole("button", { name: "Add a traveller" }).click()
    const form = page.locator("form").filter({ has: page.getByLabel(/Surname/) })
    await form.getByLabel(/Given names/).fill("Daniel")
    await form.getByLabel(/Surname/).fill("Hart")
    await form.getByLabel(/Date of birth/).fill("1988-04-12")
    await form.locator("button[type=submit]").click()
  } else await travellers.first().check()
  await crawl.snap("request-new")
  for (const box of await page.locator("section[data-ack] input[type=checkbox]").all()) await box.check()
  await page.getByRole("button", { name: "Send request" }).click()
  const ref = page.locator("p.font-mono")
  await expect(ref).toHaveText(/^UT-F-[0-9A-Z]{6}$/, { timeout: 20_000 })
  const reference = (await ref.textContent())!
  await page.goto("/en/requests")
  await expect(page.getByText(reference).first()).toBeVisible()
  await crawl.snap("requests")
  await page.goto(`/en/requests/${reference}`)
  await expect(page.getByText(reference).first()).toBeVisible()
  await crawl.snap("request-detail")
  await page.goto("/fa/requests")
  await crawl.snap("requests-fa")
  expect(crawl.leaks()).toEqual([])
})

test("billing pages leak nothing, signed in (list and an issued invoice)", async ({ page, context }) => {
  const { c, ref } = await receivedShipment("WEB", STAFF.owner)
  const staff = await staffSession(STAFF.admin, ADMIN_HOST)
  const draft = await staff.post(`/v1/admin/requests/${ref}/invoices`)
  expect(draft.status).toBe(201)
  const issued = await staff.post(`/v1/admin/invoices/${draft.body.id}/issue`)
  expect(issued.status).toBe(200)
  const number: string = issued.body.number
  await context.addCookies([...c.cookies].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })))
  const crawl = crawler(page, API_ORIGIN)
  await page.goto("/en/billing")
  await expect(page.getByTestId("invoice-row").filter({ hasText: number })).toBeVisible()
  await crawl.snap("billing")
  await page.goto(`/en/billing/${number}`)
  await expect(page.getByTestId("invoice-detail")).toBeVisible()
  await crawl.snap("billing-detail")
  await page.goto(`/fa/billing/${number}`)
  await expect(page.getByTestId("invoice-detail")).toBeVisible()
  await crawl.snap("billing-detail-fa")
  expect(crawl.leaks()).toEqual([])
})
