import { expect, type Page, test } from "@playwright/test"

// Browsers log every failed resource as a console error, so normal signed-out browsing must not make a request that fails.
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${m.text()} @ ${m.location().url}`) })
  page.on("pageerror", (e) => errors.push(e.message))
  return errors
}

for (const p of ["/en", "/fa", "/en/flights", "/en/hotels", "/en/sign-in"]) {
  test(`a signed-out visitor sees no console errors on ${p}`, async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(p, { waitUntil: "load" })
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })
}

test("session cookies the API refuses cause one failed check, then none", async ({ page, context, baseURL }) => {
  await context.addCookies(["ut_at", "ut_rt", "ut_csrf"].map((name) => ({ name, value: "refused", url: baseURL! })))
  await page.goto("/en", { waitUntil: "load" })
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === "ut_csrf")).toBe(false)
  const errors = watchErrors(page)
  await page.goto("/en/flights", { waitUntil: "load" })
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
})

test("the browser's own favicon request succeeds", async ({ request }) => {
  expect((await request.get("/favicon.ico")).status()).toBe(200)
})
