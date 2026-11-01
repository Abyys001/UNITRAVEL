// Captures app screens for the marketing pages from the Flutter web build on disk; :4300 does not need to run.
// Needs the local API. Language comes from a rewritten /v1/me response, so no account data changes.
//   OUT=<dir> ROUTES=/search:search,/services:services node scripts/app-teaser/screens.mjs
// Project rule: never capture flight results or prices; local results come from the fake adapter. The test phone number is
// also removed from the rewritten /v1/me and /v1/me/details.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const WEB = path.join(ROOT, 'apps/mobile/build/web')
const { chromium } = createRequire(path.join(ROOT, 'apps/mobile/e2e/'))('playwright-core')
const OUT = process.env.OUT ?? path.join(ROOT, 'apps/web/public/media/app/screens')
const ROUTES = (process.env.ROUTES ?? '/search:search,/services:services,/services/new/hotels:hotels').split(',').map((r) => r.split(':'))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf' }

fs.mkdirSync(OUT, { recursive: true })
// Pages fulfilled from disk count as non-local, so Chromium would otherwise block their calls to the local API.
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] })
for (const lang of ['en', 'fa']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: lang === 'fa' ? 'fa-IR' : 'en-GB', serviceWorkers: 'block' })
  await ctx.route('http://localhost:4300/**', (route) => {
    const u = decodeURIComponent(new URL(route.request().url()).pathname)
    const f = path.join(WEB, u === '/' ? 'index.html' : u)
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] ?? 'application/octet-stream', body: fs.readFileSync(f) })
  })
  await ctx.route('http://localhost:4100/v1/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    return route.fulfill({ response: res, json: { ...(await res.json()), preferredLocale: lang, calendar: lang === 'fa' ? 'JALALI' : 'GREGORIAN', phone: null, phoneVerified: false } })
  })
  await ctx.route('http://localhost:4100/v1/me/details', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    const body = await res.json()
    return route.fulfill({ response: res, json: { ...body, identities: (body.identities ?? []).filter((i) => i.type !== 'PHONE') } })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.goto('http://localhost:4300/?semantics=1#/signin')
  await page.waitForTimeout(3500)
  await page.mouse.move(195, 500); await page.mouse.wheel(0, 420); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /neda@/ }).click()
  await page.waitForTimeout(3500)
  for (const [route, name] of ROUTES) {
    await page.evaluate((h) => { location.hash = h }, route)
    await page.waitForTimeout(2600)
    await page.mouse.move(195, 20)
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, `${name}-${lang}.png`) })
    if (!process.env.KEEP_PNG) {
      const png = path.join(OUT, `${name}-${lang}.png`)
      const webp = spawnSync('python3', ['-c', "import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert('RGB');i.resize((780,1688),Image.LANCZOS).save(sys.argv[2],quality=84,method=6)", png, png.replace(/png$/, 'webp')])
      if (webp.status !== 0) throw new Error(String(webp.stderr))
      fs.rmSync(png)
    }
  }
  await ctx.close()
}
await browser.close()
