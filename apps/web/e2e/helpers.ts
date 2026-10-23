import { expect, type Page } from "@playwright/test"

export const API = process.env.API_URL ?? "http://localhost:4100"

/** Reads the newest code sent to `phone` from the local console SMS sink (dev only). */
export async function latestOtp(page: Page, phone: string, after: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const msgs = (await (await page.request.get(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string; at: string }[]
    const m = msgs.find((x) => x.to === phone && Date.parse(x.at) >= after)
    const code = m?.body.match(/(\d{6})/)?.[1]
    if (code) return code
    await page.waitForTimeout(500)
  }
  throw new Error(`no OTP for ${phone}`)
}

export async function signIn(page: Page, phone: string, locale = "en") {
  await page.goto(`/${locale}/sign-in`)
  const started = Date.now() - 1000
  await page.locator("input[inputmode=tel]").fill(phone)
  await page.locator("form button[type=submit]").click()
  const code = await latestOtp(page, phone, started)
  await page.locator("input[autocomplete=one-time-code]").fill(code)
  await page.locator("form button[type=submit]").click()
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 15_000 })
}
