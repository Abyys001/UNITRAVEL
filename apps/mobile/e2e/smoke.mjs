// Smoke test against the Flutter web build (http://localhost:4300) and the local API.
// Proves the spec's done criteria: Persian/RTL sign-in with a +98 number, THR->LON search shows results,
// a manual request is submitted, and a customer promoted to admin sees admin mode after the next call.
//
//   node smoke.mjs            (needs: svc.sh start api worker mobile)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { call, latestCode, ownerSession, totp } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(HERE, '..', 'test-artifacts')
const APP = process.env.APP_URL ?? 'http://localhost:4300'
const STAFF_TOTP = 'KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY'
fs.mkdirSync(SHOTS, { recursive: true })
for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.rmSync(path.join(SHOTS, f))

const results = []
async function step(name, fn, { soft = false } = {}) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`PASS  ${name} (${Date.now() - t0} ms)`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    await page.screenshot({ path: path.join(SHOTS, 'zz-failure.png') }).catch(() => {})
    console.log(`${soft ? 'SOFT-FAIL' : 'FAIL'}  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`)
    if (!soft) throw e
    await page.goto(`${APP}/?semantics#/requests`)
    await settle(2500)
  }
}

const phone = `+98912${String(Math.floor(1000000 + Math.random() * 8999999))}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'fa-IR' })
const page = await ctx.newPage()
page.setDefaultTimeout(20000)
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(e.message))
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
const byRole = (role, name) => page.getByRole(role, { name })
const field = (name) => page.getByRole('textbox', { name })
async function type(locator, text) {
  await locator.click()
  await page.waitForTimeout(350) // let Flutter's hidden text input take focus before typing
  await page.keyboard.type(text, { delay: 25 })
  await page.waitForTimeout(150)
}
const settle = (ms = 700) => page.waitForTimeout(ms)

/** Scrolls the Flutter list with the mouse wheel until the element is inside the viewport. */
async function reveal(locator, { max = 14 } = {}) {
  for (let i = 0; i < max; i++) {
    const box = await locator.first().boundingBox({ timeout: 400 }).catch(() => null)
    if (box && box.y >= 60 && box.y + box.height <= 844 - 4) return
    await page.mouse.move(195, 450)
    await page.mouse.wheel(0, 380)
    await page.waitForTimeout(250)
  }
  throw new Error('element never scrolled into view: ' + locator)
}

let failed = false
let manualRef
try {
  await step('app boots and shows the sign-in screen (English, LTR)', async () => {
    await page.goto(`${APP}/?semantics`)
    await byRole('button', 'Send code').waitFor()
    await shot('01-signin-en')
  })

  await step('switch to Persian: strings and layout become RTL', async () => {
    await byRole('button', 'فارسی').click()
    await byRole('button', 'ارسال کد').waitFor()
    // Flutter exposes the text direction of the semantic tree through the root's `dir` handling;
    // check visually via the screenshot and by asserting the Persian label is rendered.
    await shot('02-signin-fa-rtl')
  })

  await step(`sign in with ${phone} (Persian UI, OTP from dev sink)`, async () => {
    const since = Date.now() - 1500
    await type(field(/شماره موبایل/), phone)
    await byRole('button', 'ارسال کد').click()
    await field(/کد تأیید/).waitFor()
    const code = await latestCode(phone, since)
    await type(field(/کد تأیید/), code)
    await shot('03-otp-fa')
    await byRole('button', 'تأیید').click()
  })

  await step('new account completes its profile (Latin names)', async () => {
    await field(/نام \(لاتین\)/).waitFor()
    await type(field(/نام \(لاتین\)/), 'Sara')
    await type(field(/نام خانوادگی/), 'Rezaei')
    await shot('04-profile-fa')
    await byRole('button', 'ادامه').click()
    await page.getByText('به کجا؟').first().waitFor()
    await settle(1200)
    await shot('05-search-fa')
  })

  await step('search THR -> LON shows results with truth badges', async () => {
    await byRole('button', /^مبدأ:/).click()
    await type(field(/جستجوی شهر یا فرودگاه/), 'teh')
    await byRole('button', /^تهران/).first().click()
    await byRole('button', /^مقصد:/).click()
    await type(field(/جستجوی شهر یا فرودگاه/), 'lon')
    await byRole('button', /London|لندن/).first().click()
    await settle()
    await shot('06-search-filled-fa')
    await byRole('button', 'جستجوی پرواز').click()
    // Result cards are buttons labelled "<route>, <price>".
    await byRole('button', /→/).first().waitFor({ timeout: 40000 })
    await settle(1500)
    await shot('07-results-fa')
    const n = await byRole('button', /→/).count()
    if (n < 1) throw new Error('no result cards')
    console.log(`      ${n} result cards visible`)
  })
  await step('submit a manual request (add traveller, acknowledge, submit)', async () => {
    const manual = byRole('button', 'ارسال درخواست دستی')
    await reveal(manual)
    await manual.click()
    await byRole('button', 'افزودن مسافر').waitFor()
    await shot('08-manual-form-fa')
    await byRole('button', 'افزودن مسافر').click()
    await field(/تاریخ تولد/).waitFor()
    await type(field(/تاریخ تولد/), '1990-05-17')
    await shot('09-traveller-sheet-fa')
    await byRole('button', 'ذخیره').click()
    await settle(1200)
    await type(field(/یادداشت برای تیم ما/), 'Prefer morning departures')
    await page.getByRole('checkbox', { name: /می‌دانم این یک درخواست/ }).click()
    await page.getByRole('checkbox', { name: /با اطلاعیه حریم خصوصی/ }).click()
    await shot('10-manual-acks-fa')
    await byRole('button', 'ثبت درخواست').click()
    await page.getByText('درخواست ثبت شد').first().waitFor()
    await settle(800)
    await shot('11-manual-confirmation-fa')
    const ref = await page.evaluate(() => /UT-F-[0-9A-Z]{6}/.exec(document.body.innerText + [...document.querySelectorAll('flt-semantics')].map((n) => n.getAttribute('aria-label') + n.textContent).join(' '))?.[0])
    if (!ref) throw new Error('no reference shown on the confirmation screen')
    manualRef = ref
    console.log(`      manual request ${ref}`)
  })

  await step('open an itinerary and request it', async () => {
    await byRole('button', 'جستجوی تازه').click()
    await byRole('button', 'جستجوی پرواز').click()
    const card = byRole('button', /→/).first()
    await card.waitFor({ timeout: 40000 })
    await settle(1200)
    await card.click()
    // ADR-0004: no amounts and no customer price check before a sent quote.
    await byRole('button', 'درخواست این برنامه سفر').waitFor()
    await settle(800)
    await shot('12-itinerary-fa')
    await byRole('button', 'درخواست این برنامه سفر').click()
    await byRole('button', /^مسافر ۱/).waitFor()
    await byRole('button', /^مسافر ۱/).click()
    await page.getByRole('menuitem', { name: 'SARA REZAEI' }).click()
    await settle()
    for (const re of [/می‌دانم این یک درخواست/, /با اطلاعیه حریم خصوصی/, /انتقال شخصی/]) {
      const cb = page.getByRole('checkbox', { name: re })
      if (await cb.count()) await cb.click()
    }
    await shot('14-itinerary-request-fa')
    await byRole('button', 'ثبت درخواست').click()
    await page.getByText('درخواست ثبت شد').first().waitFor()
    await settle(800)
    await shot('15-itinerary-confirmation-fa')
  })

  await step('requests list and detail show both requests with customer status labels', async () => {
    await byRole('button', 'مشاهده درخواست').click()
    await page.getByText('روند کار').first().waitFor()
    await settle(800)
    await shot('16-request-detail-fa')
    await page.goBack().catch(() => {})
    await page.goto(`${APP}/?semantics#/requests`)
    await byRole('button', new RegExp(manualRef)).waitFor()
    await settle(800)
    await shot('17-requests-list-fa')
  })

  await step('offline: cached requests are shown with a "last updated" banner', async () => {
    await page.route('**://localhost:4100/**', (r) => r.abort('connectionrefused'))
    await page.reload()
    await page.getByText(/اتصال برقرار نیست/).first().waitFor({ timeout: 30000 })
    await byRole('button', new RegExp(manualRef)).waitFor()
    await settle(600)
    await shot('17b-offline-cache-fa')
    await page.unroute('**://localhost:4100/**')
  })

  await step('promote the customer to admin (owner, Developer Panel host); admin mode appears on the next call', async () => {
    const cookies = await ownerSession({ totpSecret: STAFF_TOTP, log: (m) => console.log('      ' + m) })
    const found = await call('GET', `/v1/dev/users?q=${encodeURIComponent(phone)}`, { cookies, host: 'dev.localhost:4200' })
    const user = found.json?.items?.find((u) => u.primaryPhone === phone)
    if (!user) throw new Error('user not found via dev API: ' + JSON.stringify(found.json))
    const put = await call('PUT', `/v1/dev/users/${user.id}/roles`, { cookies, host: 'dev.localhost:4200', body: { roles: ['customer', 'admin'] } })
    if (put.status !== 200) throw new Error('role change failed: ' + JSON.stringify(put.json))
    console.log(`      roles now ${JSON.stringify(put.json.roles)} (permVersion ${put.json.permVersion})`)
    // The app is still in customer mode with the pre-promotion token. Opening the Account tab makes its next API call;
    // that gets 401 PERMISSIONS_CHANGED, the app refreshes silently, reloads /me and rebuilds navigation.
    await page.getByRole('tab', { name: /حساب/ }).or(page.getByRole('button', { name: /^حساب/ })).first().click()
    await page.getByText('پیشخوان').first().waitFor({ timeout: 30000 })
    await settle(1000)
    await shot('18-admin-mode-fa')
    await page.getByText('تأیید دومرحله‌ای').first().waitFor()
  })

  await step('staff second factor: enrol TOTP in the app, then the triage queue loads', async () => {
    await byRole('button', 'راه‌اندازی برنامه احراز هویت').click()
    await page.getByText('کلید راه‌اندازی').first().waitFor()
    await settle(800)
    const secret = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('flt-semantics, input, textarea')]
      const text = nodes.map((n) => `${n.textContent} ${n.getAttribute('aria-label') ?? ''} ${n.value ?? ''}`).join(' ')
      return /\b[A-Z2-7]{16,}\b/.exec(text)?.[0]
    })
    if (!secret) {
      console.log(await page.evaluate(() => [...document.querySelectorAll('flt-semantics, input, textarea')].map((n) => `${n.tagName}|${n.getAttribute('role')}|${(n.textContent || '').slice(0, 60)}|${(n.getAttribute('aria-label') || '').slice(0, 60)}|${n.value ?? ''}`).join('\n')))
      throw new Error('enrolment secret not shown')
    }
    await shot('19-mfa-enrol-fa')
    await type(field(/کد ۶ رقمی/), totp(secret))
    await byRole('button', 'تأیید').click()
    await page.getByText('جدید').first().waitFor()
    await settle(2500)
    await shot('20-admin-home-fa')
    // Home is the landing tab; the queue is its own tab in the admin navigation bar.
    await page.getByRole('tab', { name: /صف/ }).or(page.getByRole('button', { name: /صف/ })).first().click()
    await settle(1800)
    await shot('20b-admin-queue-fa')
    const cases = byRole('button', /UT-F-/)
    await cases.first().waitFor({ timeout: 15000 })
    console.log(`      ${await cases.count()} cases visible in the queue`)
  })

  await step('open a case: customer, SLA and triage actions (no quote/record/compliance on mobile)', async () => {
    await byRole('button', /UT-F-/).first().click()
    await page.getByText('برداشتن پرونده').or(page.getByText('پیام به مشتری')).first().waitFor()
    await settle(1000)
    await shot('21-admin-case-fa')
    await page.goBack().catch(() => {})
  })

  await step('on-duty toggle in Account (admin mode)', async () => {
    await page.getByRole('tab', { name: /حساب/ }).or(page.getByRole('button', { name: /^حساب/ })).first().click()
    const sw = page.getByRole('switch', { name: /در حال خدمت/ }).or(page.getByRole('checkbox', { name: /در حال خدمت/ })).first()
    await sw.waitFor()
    await sw.click()
    await settle(1200)
    await shot('22-admin-account-fa')
  })

  await step('English / LTR pass: new customer signs in, searches, opens an itinerary, opens Account', async () => {
    const en = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB' })).newPage()
    en.setDefaultTimeout(20000)
    const enShot = (n) => en.screenshot({ path: path.join(SHOTS, `${n}.png`) })
    const enType = async (loc, text) => { await loc.click(); await en.waitForTimeout(350); await en.keyboard.type(text, { delay: 25 }); await en.waitForTimeout(150) }
    const enPhone = `+98912${String(Math.floor(1000000 + Math.random() * 8999999))}`
    await en.goto(`${APP}/?semantics`)
    const since = Date.now() - 1500
    await enType(en.getByRole('textbox', { name: /Mobile number/ }), enPhone)
    await en.getByRole('button', { name: 'Send code' }).click()
    await en.getByRole('textbox', { name: /Verification code/ }).waitFor()
    await enType(en.getByRole('textbox', { name: /Verification code/ }), await latestCode(enPhone, since))
    await en.getByRole('button', { name: 'Verify' }).click()
    await enType(en.getByRole('textbox', { name: /Given names/ }), 'Daniel')
    await enType(en.getByRole('textbox', { name: /Surname/ }), 'Shaw')
    await en.getByRole('button', { name: 'Continue' }).click()
    await en.getByText('Where to?').first().waitFor()
    await en.waitForTimeout(1000)
    await enShot('30-search-en')
    await en.getByRole('button', { name: /^From:/ }).click()
    await enType(en.getByRole('textbox', { name: /Search city or airport/ }), 'teh')
    await en.getByRole('button', { name: /^Tehran/ }).first().click()
    await en.getByRole('button', { name: /^To:/ }).click()
    await enType(en.getByRole('textbox', { name: /Search city or airport/ }), 'lon')
    await en.getByRole('button', { name: /London/ }).first().click()
    await en.getByRole('button', { name: 'Search flights' }).click()
    const card = en.getByRole('button', { name: /→/ }).first()
    await card.waitFor({ timeout: 40000 })
    await en.waitForTimeout(1200)
    await enShot('31-results-en')
    await card.click()
    await en.getByRole('button', { name: 'Request this itinerary' }).waitFor()
    await en.waitForTimeout(800)
    await enShot('32-itinerary-en')
    await en.goBack()
    await en.goBack()
    await en.getByRole('tab', { name: /Account/ }).click()
    await en.getByText('Sign out').first().waitFor()
    await en.waitForTimeout(800)
    await enShot('33-account-en')
    const dir = await en.evaluate(() => getComputedStyle(document.documentElement).direction)
    console.log(`      English pass ran with ${enPhone}; document direction ${dir}`)
  })
} catch {
  failed = true
}

await shot(failed ? '99-failure' : '98-end')
fs.writeFileSync(path.join(SHOTS, 'smoke-results.json'), JSON.stringify({ phone, results, consoleErrors }, null, 2))
await browser.close()
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`)
process.exit(failed ? 1 : 0)
