import { createRequire } from "node:module"

import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test"

import { ADMIN, DEV } from "./helpers"

// pg and ioredis are the API's test dependencies; these specs reach past the browser only to make time pass.
const apiRequire = createRequire(new URL("../../api/package.json", import.meta.url))
const { Client } = apiRequire("pg") as typeof import("pg")
const { Redis } = apiRequire("ioredis") as typeof import("ioredis")

/** ADR-0022: the idle veil, silent resume, surviving drafts, sign-out and installability, in a real browser. */
test.describe.configure({ mode: "serial" })

/** The live session's id, or null while it has ended and not been resumed. */
async function currentSession(page: Page): Promise<string | null> {
  const r = await page.evaluate(async () => { const res = await fetch("/api/v1/me/sessions"); return res.ok ? (await res.json()) as { id: string; current: boolean }[] : null })
  return r?.find((x) => x.current)?.id ?? null
}

async function expire(sessionId: string) {
  const db = new Client({ connectionString: process.env.DATABASE_MIGRATE_URL ?? "postgres://unitravel:unitravel@localhost:5462/unitravel" })
  await db.connect()
  await db.query("UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE id = $1", [sessionId])
  await db.end()
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6390")
  await r.del(`sess:${sessionId}:meta`, `sess:${sessionId}:touch`)
  r.disconnect()
}

const signedInPage = async (browser: Browser, base = ADMIN) => {
  // A context of its own, because these tests sign out and end sessions. Test sign-in (ADR-0012): repeated sign-ins would hit the email-code cooldown.
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const email = base === DEV ? "dev@unitravel.example" : "sara@unitravel.example"
  const r = await context.request.post(`${base}/api/v1/auth/test-sign-in`, { data: { email, deviceId: `console-${crypto.randomUUID()}`, client: "CONSOLE" } })
  expect(r.status()).toBe(200)
  const page = await context.newPage()
  await page.goto(`${base}/`)
  await expect(page.getByTestId("user-menu")).toBeVisible()
  return { page, context }
}

test("an active person never notices the session ending: the next request resumes it", async ({ browser }) => {
  const { page } = await signedInPage(browser)
  await page.goto(`${ADMIN}/customers`)
  const search = page.getByPlaceholder(/search/i).first()
  await search.fill("draft text")
  const before = await currentSession(page)
  await expire(before!)
  await page.getByRole("link", { name: /invoices/i }).first().click()
  await expect(page).toHaveURL(/\/invoices/)
  await expect(page.getByTestId("session-veil")).toBeHidden()
  await expect(page).not.toHaveURL(/sign-in/)
  await expect.poll(() => currentSession(page)).not.toBeNull()
  expect(await currentSession(page)).not.toBe(before)
})

test("nobody there: the veil hides the page, a key wakes it, and the unsaved draft survives without that key", async ({ browser }) => {
  const { page } = await signedInPage(browser)
  await page.clock.install()
  await page.goto(`${ADMIN}/customers`)
  const search = page.getByPlaceholder(/search/i).first()
  await search.fill("draft text")
  const before = await currentSession(page)
  await expire(before!)
  await page.clock.runFor(125_000)
  const veil = page.getByTestId("session-veil")
  await expect(veil).toBeVisible()
  await page.keyboard.press("x")
  await expect(veil).toBeHidden()
  await expect(search).toHaveValue("draft text")
  await page.clock.resume()
  await expect.poll(() => currentSession(page)).not.toBeNull()
  expect(await currentSession(page)).not.toBe(before)
})

test("a new page in a remembered browser goes straight in, with no sign-in", async ({ browser }) => {
  const { page, context } = await signedInPage(browser)
  await expire((await currentSession(page))!)
  const next = await context.newPage()
  await next.goto(`${ADMIN}/`)
  await expect(next.getByTestId("user-menu")).toBeVisible()
  await expect(next).not.toHaveURL(/sign-in/)
})

test("the device cookie is invisible to page scripts; sign-out really signs out, even after the session lapsed", async ({ browser }) => {
  const { page, context } = await signedInPage(browser)
  expect(await page.evaluate(() => document.cookie)).not.toContain("ut_dt")
  const cookie = (await context.cookies()).find((c) => c.name === "ut_dt")!
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/v1/auth/device" })
  await expire((await currentSession(page))!)
  await page.getByTestId("user-menu").click()
  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/sign-in/)
  expect((await context.cookies()).find((c) => c.name === "ut_dt")).toBeUndefined()
  await page.goto(`${ADMIN}/`)
  await expect(page).toHaveURL(/sign-in/)
})

for (const [label, base, name] of [["admin", ADMIN, "Uni Travel Admin"], ["developer", DEV, "Uni Travel Developer"]] as const) {
  test(`the ${label} panel is installable and its worker stores no data`, async ({ browser }) => {
    const { page, context } = await signedInPage(browser, base)
    await page.goto(`${base}/`)
    const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json() as Promise<{ name: string; display: string; icons: unknown[] }>)
    expect(manifest).toMatchObject({ name, display: "standalone" })
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active)
    await page.reload()
    await expect(page.getByTestId("user-menu")).toBeVisible()
    const cdp = await context.newCDPSession(page)
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors")
    expect(installabilityErrors).toEqual([])
    const { errors } = await cdp.send("Page.getAppManifest")
    expect(errors).toEqual([])
    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname)
      return urls
    })
    expect(cached.length).toBeGreaterThan(0)
    expect(cached.filter((u) => !u.startsWith("/_next/static/") && !u.startsWith("/icons/") && u !== "/offline.html")).toEqual([])
  })
}

test("offline: an open panel says so, and a cold start gets the offline page rather than old data", async ({ browser }) => {
  const { page, context } = await signedInPage(browser)
  await page.goto(`${ADMIN}/`)
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active)
  await page.reload()
  await context.setOffline(true)
  await expect(page.getByTestId("offline-banner")).toBeVisible()
  await page.goto(`${ADMIN}/customers`).catch(() => undefined)
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible()
  await context.setOffline(false)
})
