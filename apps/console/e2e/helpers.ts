import { createHmac, createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { type BrowserContext, expect, type Page } from "@playwright/test"

import { Session } from "../../api/test/client"

export const API = process.env.API_URL ?? "http://localhost:4100"
export const ADMIN = process.env.CONSOLE_ADMIN_URL ?? "http://admin.localhost:4200"
export const DEV = process.env.CONSOLE_DEV_URL ?? "http://dev.localhost:4200"
export const STAFF = { owner: "+447700900001", admin: "+447700900002", cargo: "+447700900003", compliance: "+447700900004", developer: "+447700900005" }
/** Seeded staff sign in by email (DEMO_USERS in packages/db/src/seed); callers keep passing the STAFF phone. */
const STAFF_EMAIL: Record<string, string> = {
  [STAFF.owner]: "owner@unitravel.example", [STAFF.admin]: "sara@unitravel.example", [STAFF.cargo]: "cargo@unitravel.example",
  [STAFF.compliance]: "compliance@unitravel.example", [STAFF.developer]: "dev@unitravel.example",
}
/** Local demo staff share this TOTP secret (docs/LOCAL-DEV.md); seeded only when APP_ENV=local. */
export const DEMO_TOTP = "KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY"

const here = dirname(fileURLToPath(import.meta.url))
/** Tracked reference screenshots. Only rewritten on purpose (UPDATE_SCREENS=1); ordinary runs write to test-results/shots. */
export const SCREENS = resolve(here, "../../../docs/screens/console")
const SHOT_DIR = process.env.UPDATE_SCREENS === "1" ? SCREENS : resolve(here, "../test-results/shots")
mkdirSync(SHOT_DIR, { recursive: true })
export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false })

function base32Decode(str: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of str) { value = (value << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  return Buffer.from(out)
}
export function totp(secretB32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)))
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, "0")
}

/** Reads the newest code sent to `phone` from the local SMS sink (dev only). */
export async function latestOtp(page: Page, phone: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const msgs = (await (await page.request.get(`${API}/v1/dev-sink/sms`)).json()) as { to: string; body: string; at: string }[]
    const m = msgs.find((x) => x.to === phone && /\d{6}/.test(x.body) && Date.parse(x.at) >= after)
    const code = m?.body.match(/(\d{6})/)?.[1]
    if (code) return code
    await page.waitForTimeout(400)
  }
  throw new Error(`no OTP for ${phone}`)
}

/** Reads the newest code sent to `email` (lower-case) from the local email sink (dev only). */
export async function latestEmailOtp(page: Page, email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const msgs = (await (await page.request.get(`${API}/v1/dev-sink/email`)).json()) as { to: string; body: string; at: string }[]
    const code = msgs.find((x) => x.to === email.toLowerCase() && /\d{6}/.test(x.body) && Date.parse(x.at) >= after)?.body.match(/(\d{6})/)?.[1]
    if (code) return code
    await page.waitForTimeout(400)
  }
  throw new Error(`no email OTP for ${email}`)
}

// The API refuses a TOTP code that was already used in the same 30 s step; wait for a fresh step when needed.
let lastCode = ""
async function freshTotp(page: Page) {
  let code = totp(DEMO_TOTP)
  if (code === lastCode) { await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500); code = totp(DEMO_TOTP) }
  lastCode = code
  return code
}
export const nextTotp = freshTotp

/** Signs a demo staff member in through the console UI: email OTP from the sink, then TOTP. */
export async function staffSignIn(page: Page, base: string, phone: string) {
  const email = STAFF_EMAIL[phone]
  if (!email) throw new Error(`no seeded email for ${phone}`)
  await page.goto(`${base}/sign-in`)
  const started = Date.now() - 1500
  await page.locator("input[name=email]").fill(email)
  await page.getByRole("button", { name: /send code/i }).click()
  await expect(page.locator("input[name=otp]")).toBeVisible({ timeout: 60_000 })
  const code = await latestEmailOtp(page, email, started)
  await page.locator("input[name=otp]").fill(code)
  await page.getByRole("button", { name: /^verify$/i }).click()
  await expect(page.locator("input[name=totp]")).toBeVisible()
  // A code already used in this 30 s step (replay-protected, possibly by another suite on the same stack) is refused;
  // wait for the next step and try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator("input[name=totp]").fill(await freshTotp(page))
    await page.getByRole("button", { name: /^verify$/i }).click()
    const outcome = await Promise.race([
      page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 20_000 }).then(() => "ok" as const),
      page.locator("#totp-err").waitFor({ timeout: 20_000 }).then(() => "retry" as const),
    ])
    if (outcome === "ok") return
    lastCode = totp(DEMO_TOTP)
  }
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 20_000 })
}

/** Reuses one signed-in browser context per staff member and host across tests (the OTP resend cooldown is per phone). */
const contexts = new Map<string, BrowserContext>()
export async function staffPage(browser: import("@playwright/test").Browser, base: string, phone: string): Promise<Page> {
  const key = `${base}|${phone}`
  let ctx = contexts.get(key)
  if (!ctx) {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await staffSignIn(page, base, phone)
    contexts.set(key, ctx)
    return page
  }
  return ctx.pages()[0] ?? ctx.newPage()
}

/** Answers a step-up prompt if the console shows one. */
export async function maybeStepUp(page: Page) {
  const dlg = page.getByTestId("step-up")
  if (await dlg.isVisible().catch(() => false)) {
    await dlg.locator("input[name=totp]").fill(await freshTotp(page))
    await dlg.getByRole("button", { name: /confirm/i }).click()
    await expect(dlg).toBeHidden()
  }
}

// ---- API-side seeding (a customer request to work on) ----

export class ApiSession {
  cookies = new Map<string, string>()
  accessToken?: string
  readonly ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
  readonly deviceId = `e2e-console-${Math.random().toString(36).slice(2)}${Date.now()}`
  async req<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const h: Record<string, string> = { "content-type": "application/json", "x-device-id": this.deviceId, "x-forwarded-for": this.ip, ...extra }
    if (this.accessToken) h.authorization = `Bearer ${this.accessToken}`
    const res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T }
  }
  get = <T = any>(p: string) => this.req<T>("GET", p)
  post = <T = any>(p: string, b?: unknown, h?: Record<string, string>) => this.req<T>("POST", p, b ?? {}, h)
}

function solvePow(c: { challenge: string; salt: string; maxnumber: number; signature: string; algorithm: string }): string {
  for (let n = 0; n <= c.maxnumber; n++) if (createHash("sha256").update(c.salt + n).digest("hex") === c.challenge) return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString("base64")
  throw new Error("pow unsolved")
}

/** Mobile (bearer) customer session for seeding data the console then works on. */
export async function customerSession(page: Page, phone: string): Promise<ApiSession> {
  const s = new ApiSession()
  const since = Date.now() - 1500
  const body = { channel: "PHONE", value: phone, deviceId: s.deviceId, client: "MOBILE" }
  let r = await s.post("/v1/auth/otp/request", body)
  if (r.status === 428 && r.body.challenge) r = await s.post("/v1/auth/otp/request", { ...body, challenge: solvePow(r.body.challenge) })
  if (r.status !== 202) throw new Error(`otp ${r.status} ${JSON.stringify(r.body)}`)
  const code = await latestOtp(page, r.body.normalised, since)
  const v = await s.post("/v1/auth/otp/verify", { challengeId: r.body.challengeId, code, deviceId: s.deviceId, client: "MOBILE", profile: { givenNamesLatin: "Console", surnameLatin: "Tester" } })
  if (v.status !== 200) throw new Error(`verify ${v.status} ${JSON.stringify(v.body)}`)
  s.accessToken = v.body.tokens.accessToken
  return s
}

/**
 * A fresh NEW itinerary request (with an offer snapshot) from the demo customer +447700900010, submitted through the
 * customer API exactly as the mobile app would. Always fresh: an older snapshot's supplier offer may have expired, and
 * the API rightly refuses to send a quote whose validity would already be in the past.
 */
export async function ensureNewRequest(page: Page, phone = "+447700900010"): Promise<string> {
  const c = await customerSession(page, phone)
  const me = (await c.get("/v1/me")).body
  let travellers = (await c.get("/v1/me/travellers")).body as { id: string }[]
  if (!travellers.length) {
    const t = await c.post("/v1/me/travellers", { title: "MR", givenNames: "Console", surname: "Tester", dateOfBirth: "1990-04-02", genderOnDocument: "M", nationality: "GB", relationship: "SELF", document: { number: "123456789", issuingCountry: "GB", expiryDate: "2031-01-01" } })
    travellers = [t.body]
  }
  const date = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10)
  const s = await c.post("/v1/flight-searches", { tripType: "ONE_WAY", cabin: "ECONOMY", slices: [{ from: { city: "THR" }, to: { city: "LON" }, date, flexDays: 0 }], passengers: [{ type: "ADT" }], preferences: {} })
  let results: { id: string }[] = []
  for (let i = 0; i < 40 && !results.length; i++) {
    await page.waitForTimeout(700)
    const st = (await c.get(`/v1/flight-searches/${s.body.id}`)).body as { status: string; results: { id: string }[] }
    if (st.status !== "RUNNING") results = st.results
  }
  if (!results.length) throw new Error("seed search returned no results")
  const phoneId = (me.identities as { id: string; type: string }[]).find((x) => x.type === "PHONE")!.id
  const r = await c.post("/v1/flight-requests", { kind: "ITINERARY", searchId: s.body.id, itineraryId: results[0]!.id, travellers: [{ travellerId: travellers[0]!.id, passengerType: "ADT" }], contactIdentityId: phoneId, acknowledgements: { notABooking: true, privacy: true, selfTransfer: true }, acceptPriceChange: true }, { "idempotency-key": `seed-${Date.now()}` })
  if (r.status !== 201) throw new Error(`seed request ${r.status} ${JSON.stringify(r.body)}`)
  for (let i = 0; i < 30; i++) {
    const st = (await c.get(`/v1/flight-requests/${r.body.ref}`)).body as { status: string }
    if (st.status === "NEW") break
    await page.waitForTimeout(500)
  }
  return r.body.ref as string
}

/**
 * An API session for the staff member signed in on `page`, built from the browser's own cookies. Seeding data through
 * the API as that user needs no second OTP request, so it cannot spend the phone's resend cooldown (which doubles with
 * every request in the hour) and starve a later UI sign-in of the same phone. The second factor is confirmed again with
 * a fresh code, exactly as the console's step-up does.
 */
export async function apiSessionFrom(page: Page, base: string): Promise<Session> {
  const s = new Session("CONSOLE", new URL(base).host)
  for (const c of await page.context().cookies(base)) s.cookies.set(c.name, c.value)
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await s.post("/v1/auth/mfa/totp/verify", { type: "TOTP", code: await freshTotp(page) })
    if (r.status === 200) return s
    await page.waitForTimeout(31_000)
  }
  throw new Error("could not refresh the second factor for the API session")
}
