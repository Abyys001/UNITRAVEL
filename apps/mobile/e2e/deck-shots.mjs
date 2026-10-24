// Control-deck screenshots: admin mode at phone size in light/dark x en/fa.
//   node deck-shots.mjs     (needs: svc.sh start api worker mobile; demo admin +447700900002, local only)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestCode, totp } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'test-artifacts', 'control-deck')
const APP = process.env.APP_URL ?? 'http://localhost:4300'
const STAFF_TOTP = 'KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY'
const PHONE = '+447700900002'
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f))

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page = await ctx.newPage()
page.setDefaultTimeout(20000)
const settle = (ms = 900) => page.waitForTimeout(ms)
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })
const field = (name) => page.getByRole('textbox', { name })
async function type(locator, text) {
  await locator.click()
  await page.waitForTimeout(350)
  await page.keyboard.type(text, { delay: 25 })
  await page.waitForTimeout(150)
}
const named = (re) => page.getByRole('button', { name: re }).or(page.getByRole('tab', { name: re })).or(page.getByRole('radio', { name: re })).or(page.getByRole('checkbox', { name: re })).first()
const scroll = async (dy) => { await page.mouse.move(195, 450); await page.mouse.wheel(0, dy); await settle(500) }

const L = {
  en: { signIn: /Send code/, phone: /Mobile number/, code: /Verification code/, verify: /^Verify$/, mfaCode: /6-digit code|Authenticator code|code/i, home: /Home/, queue: /Queue/, search: /Search/, alerts: /Alerts/, me: /Me/, settings: /Settings/, dark: /^Dark$/, light: /^Light$/, fa: /^فارسی$/, en: /^English$/ },
  fa: { home: /خانه/, queue: /صف/, search: /جستجو/, alerts: /هشدارها/, me: /حساب من/, settings: /تنظیمات/, dark: /^تیره$/, light: /^روشن$/, en: /^English$/ },
}

let ok = false
try {
  await page.goto(`${APP}/?semantics`)
  const since = Date.now() - 1500
  await type(field(L.en.phone), PHONE)
  await named(L.en.signIn).click()
  await field(L.en.code).waitFor()
  await type(field(L.en.code), await latestCode(PHONE, since))
  await named(L.en.verify).click()
  // Staff second factor (demo secret is seeded for the local admin).
  await page.getByRole('textbox', { name: /code/i }).first().waitFor({ timeout: 30000 })
  await type(page.getByRole('textbox', { name: /code/i }).first(), totp(STAFF_TOTP))
  await named(L.en.verify).click()
  await page.getByText('Control deck').first().waitFor({ timeout: 30000 })
  // Trend lines need two observed summaries: the shell refreshes every 60 s and stores one at least 2 min apart.
  await page.waitForTimeout(130000)

  async function pass(tag, l) {
    await shot(`${tag}-1-home`)
    await scroll(520)
    await shot(`${tag}-2-home-scrolled`)
    await scroll(-1200)
    await named(l.queue).click()
    await settle(1800)
    await shot(`${tag}-3-queue`)
    const first = page.getByRole('button', { name: /UT-[FC]-/ }).first()
    if (await first.count()) {
      await first.click()
      await settle(1800)
      await shot(`${tag}-4-case`)
      await scroll(600)
      await shot(`${tag}-5-case-scrolled`)
      await page.goBack().catch(() => {})
      await settle(900)
    }
    await named(l.search).click()
    await settle(900)
    await shot(`${tag}-6-search`)
    await named(l.home).click()
    await settle(900)
  }
  async function openSettings(l) {
    await named(l.settings).click()
    await settle(900)
  }
  async function closeSheet() { await page.mouse.click(195, 40); await settle(700) }

  await pass('en-light', L.fa === null ? L.en : { ...L.en, queue: /Queue/, search: /Search/ })
  await openSettings(L.en)
  await shot('en-light-7-settings')
  await named(L.en.dark).click()
  await settle(900)
  await shot('en-dark-7-settings')
  await closeSheet()
  await pass('en-dark', L.en)
  // Language switch from the same sheet.
  await openSettings(L.en)
  await named(L.en.fa).click()
  await settle(1200)
  await closeSheet()
  await pass('fa-dark', L.fa)
  await openSettings(L.fa)
  await named(L.fa.light).click()
  await settle(900)
  await shot('fa-light-7-settings')
  await closeSheet()
  await pass('fa-light', L.fa)
  ok = true
} catch (e) {
  console.log('FAIL', e.message)
  await shot('zz-failure').catch(() => {})
} finally {
  await browser.close()
}
console.log(ok ? 'deck screenshots done' : 'deck screenshots incomplete')
process.exit(ok ? 0 : 1)
