import { expect, type Page, test } from "@playwright/test"

import { ADMIN, DEV } from "./helpers"

// Browsers log every failed resource as a console error, so a signed-out sign-in page must not make a request that fails.
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${m.text()} @ ${m.location().url}`) })
  page.on("pageerror", (e) => errors.push(e.message))
  return errors
}

for (const [name, base] of [["admin", ADMIN], ["dev", DEV]] as const) {
  test(`${name}: a signed-out visitor reaches sign-in with no console errors`, async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(`${base}/`, { waitUntil: "load" })
    await expect(page).toHaveURL(/\/sign-in/)
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })

  test(`${name}: session cookies the API refuses cause one failed check, then none`, async ({ page, context }) => {
    await context.addCookies(["ut_at", "ut_rt", "ut_csrf"].map((c) => ({ name: c, value: "refused", url: base })))
    await page.goto(`${base}/`, { waitUntil: "load" })
    await expect.poll(async () => (await context.cookies(base)).some((c) => c.name === "ut_csrf")).toBe(false)
    const errors = watchErrors(page)
    await page.goto(`${base}/sign-in`, { waitUntil: "load" })
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })

  test(`${name}: the browser's own favicon request succeeds`, async ({ request }) => {
    expect((await request.get(`${base}/favicon.ico`)).status()).toBe(200)
  })
}
