import { expect, type Page } from "@playwright/test"

export const API = process.env.API_URL ?? "http://localhost:4100"

/** Reads the newest code sent to `email` (lower-case) from the local email sink (dev only). */
export async function latestOtp(page: Page, email: string, after: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const msgs = (await (await page.request.get(`${API}/v1/dev-sink/email`)).json()) as { to: string; body: string; at: string }[]
    const m = msgs.find((x) => x.to === email.toLowerCase() && Date.parse(x.at) >= after)
    const code = m?.body.match(/(\d{6})/)?.[1]
    if (code) return code
    await page.waitForTimeout(500)
  }
  throw new Error(`no OTP for ${email}`)
}

export async function signIn(page: Page, email: string, locale = "en") {
  await page.goto(`/${locale}/sign-in`)
  const started = Date.now() - 1000
  await page.locator("input[type=email]").fill(email)
  await page.locator("form button[type=submit]").first().click()
  const code = await latestOtp(page, email, started)
  await page.locator("input[autocomplete=one-time-code]").fill(code)
  await page.locator("form button[type=submit]").click()
  // A first sign-in asks for the passport name before leaving the sign-in page.
  const given = page.getByRole("textbox", { name: /Given names/ })
  if (await given.waitFor({ timeout: 3_000 }).then(() => true, () => false)) {
    await given.fill("Test")
    await page.getByRole("textbox", { name: /^Surname/ }).fill("Customer")
    await page.getByRole("button", { name: "Save" }).click()
  }
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 15_000 })
}
