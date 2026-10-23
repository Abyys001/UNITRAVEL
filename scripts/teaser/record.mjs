// Records the product teaser scenes against the local stack (scripts/svc.sh start api worker web console mobile).
// One continuous story: the customer's request in scene 05 is claimed and quoted by the admin in 08–09 and accepted
// in 10. Output: media/teaser/clips/<scene>.webm plus offsets.json (seconds of blank lead-in to cut per clip).
// Usage: node scripts/teaser/record.mjs [scene-id ...]
import { createHmac } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const OUT = path.join(ROOT, "media/teaser/clips")
const STATE = path.join(ROOT, "media/teaser/.state")
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(STATE, { recursive: true })

const WEB = "http://localhost:4000"
const ADMIN = "http://admin.localhost:4200"
const DEV = "http://dev.localhost:4200"
const MOBILE = "http://localhost:4300"
const API = "http://localhost:4100"
const CUSTOMER = "+447700900010"
const STAFF = { admin: "+447700900002", compliance: "+447700900004", developer: "+447700900005", cargo: "+447700900003" }
const DEMO_TOTP = "KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY"
const VIEW = { width: 1920, height: 1080 }
// Pages lay out as if 1600×900 but render at full 1080p; the cursor lives outside the zoomed body.
const ZOOM = "(() => { const z = () => { if (document.body) document.body.style.zoom = \"1.2\" }; if (document.readyState === \"loading\") addEventListener(\"DOMContentLoaded\", z); else z() })()"
const VIDEO = { width: 1920, height: 1080 }

const only = new Set(process.argv.slice(2))
const offsetsFile = path.join(OUT, "offsets.json")
const offsets = fs.existsSync(offsetsFile) ? JSON.parse(fs.readFileSync(offsetsFile, "utf8")) : {}
const storyFile = path.join(STATE, "story.json")
const story = fs.existsSync(storyFile) ? JSON.parse(fs.readFileSync(storyFile, "utf8")) : {}
const saveStory = () => fs.writeFileSync(storyFile, JSON.stringify(story, null, 2))

const browser = await chromium.launch()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- helpers ----------
function totp(secret, at = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0, value = 0
  const key = []
  for (const c of secret) { value = (value << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { key.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)))
  const h = createHmac("sha1", Buffer.from(key)).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0")
}

async function latestOtp(phone, after) {
  for (let i = 0; i < 60; i++) {
    const msgs = await (await fetch(`${API}/v1/dev-sink/sms`)).json()
    const m = msgs.find((x) => x.to === phone && /\d{6}/.test(x.body) && Date.parse(x.at) >= after)
    if (m) return m.body.match(/(\d{6})/)[1]
    await sleep(400)
  }
  throw new Error(`no OTP for ${phone}`)
}

/** A visible cursor with a click pulse: Playwright videos do not show the pointer. */
const CURSOR = `(() => {
  const mk = () => {
    if (document.getElementById("__c")) return
    const c = document.createElement("div"); c.id = "__c"
    c.style.cssText = "position:fixed;left:-40px;top:-40px;width:22px;height:22px;border-radius:50%;background:rgba(201,141,91,.35);border:2px solid #C98D5B;box-shadow:0 0 0 4px rgba(15,34,56,.12);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:width .12s,height .12s,background .12s"
    document.documentElement.appendChild(c)
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px" }, true)
    addEventListener("mousedown", () => { c.style.width = "34px"; c.style.height = "34px"; c.style.background = "rgba(201,141,91,.6)" }, true)
    addEventListener("mouseup", () => { c.style.width = "22px"; c.style.height = "22px"; c.style.background = "rgba(201,141,91,.35)" }, true)
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mk); else mk()
})()`

let mouse = { x: 800, y: 450 }
async function glide(page, x, y, steps = 28) {
  await page.mouse.move(x, y, { steps })
  mouse = { x, y }
}
async function point(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const b = await locator.boundingBox()
  await glide(page, b.x + b.width / 2, b.y + b.height / 2)
  await sleep(180)
}
async function tap(page, locator) {
  await point(page, locator)
  await page.mouse.down(); await sleep(70); await page.mouse.up()
}
async function typeInto(page, locator, text, delay = 45) {
  await tap(page, locator)
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type(text, { delay })
}
async function smoothScroll(page, dy, ms = 1400) {
  const steps = Math.max(8, Math.round(ms / 40))
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(ms / steps) }
}

/** Signs in once (off camera) and stores the cookie jar for the recorded contexts. */
async function webState() {
  const file = path.join(STATE, "web.json")
  if (fs.existsSync(file)) {
    const probe = await browser.newContext({ storageState: file })
    const ok = (await probe.request.get(`${WEB}/api/v1/me`)).ok()
    await probe.close()
    if (ok) return file
  }
  const ctx = await browser.newContext({ viewport: VIEW })
  const page = await ctx.newPage()
  await page.goto(`${WEB}/en/sign-in`)
  const started = Date.now() - 1500
  await page.locator("input[inputmode=tel]").fill(CUSTOMER)
  await page.locator("form button[type=submit]").click()
  await page.locator("input[autocomplete=one-time-code]").fill(await latestOtp(CUSTOMER, started))
  await page.locator("form button[type=submit]").click()
  await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 20_000 })
  // Every traveller needs passport details before a quote can be accepted (scene 10); add them off camera.
  const csrf = (await ctx.cookies()).find((c) => c.name === "ut_csrf")?.value ?? ""
  const travellers = await (await page.request.get(`${WEB}/api/v1/me/travellers`)).json()
  for (const t of travellers.filter((x) => !x.documentComplete)) {
    await page.request.patch(`${WEB}/api/v1/me/travellers/${t.id}`, { headers: { "x-csrf-token": csrf }, data: { document: { type: "PASSPORT", number: `X${String(Date.now()).slice(-8)}`, issuingCountry: t.nationality ?? "GB", expiryDate: "2032-06-30" } } })
  }
  await ctx.storageState({ path: file })
  await ctx.close()
  return file
}

async function staffState(base, phone, name) {
  const file = path.join(STATE, `${name}.json`)
  const ctx = await browser.newContext({ viewport: VIEW })
  const page = await ctx.newPage()
  await page.goto(`${base}/sign-in`)
  const started = Date.now() - 1500
  await page.locator("input[name=phone]").fill(phone)
  await page.getByRole("button", { name: /send code/i }).click()
  await page.locator("input[name=otp]").waitFor({ timeout: 60_000 })
  await page.locator("input[name=otp]").fill(await latestOtp(phone, started))
  await page.getByRole("button", { name: /^verify$/i }).click()
  await page.locator("input[name=totp]").waitFor()
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator("input[name=totp]").fill(totp(DEMO_TOTP))
    await page.getByRole("button", { name: /^verify$/i }).click()
    const ok = await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15_000 }).then(() => true, () => false)
    if (ok) break
    await sleep(30_000 - (Date.now() % 30_000) + 600)
  }
  await ctx.storageState({ path: file })
  await ctx.close()
  return file
}

/** Records one scene; `ready()` marks the first useful frame so the blank lead-in can be cut. */
async function scene(id, opts, body) {
  if (only.size && !only.has(id)) return
  console.log(`● ${id}`)
  const dir = path.join(OUT, `.tmp-${id}`)
  fs.rmSync(dir, { recursive: true, force: true })
  const ctx = await browser.newContext({ viewport: opts.viewport ?? VIEW, deviceScaleFactor: opts.scale ?? 1, storageState: opts.state, locale: opts.locale ?? "en-GB", recordVideo: { dir, size: opts.video ?? VIDEO } })
  await ctx.addInitScript(CURSOR)
  if (opts.zoom !== false) await ctx.addInitScript(ZOOM)
  const page = await ctx.newPage()
  page.setDefaultTimeout(40_000)
  const t0 = Date.now()
  let start = 0
  const ready = async () => { await sleep(250); start = (Date.now() - t0) / 1000 }
  try {
    await body(page, ready)
  } finally {
    const video = page.video()
    await ctx.close()
    const src = await video.path()
    fs.renameSync(src, path.join(OUT, `${id}.webm`))
    fs.rmSync(dir, { recursive: true, force: true })
    offsets[id] = start
    fs.writeFileSync(offsetsFile, JSON.stringify(offsets, null, 2))
    console.log(`  saved ${id}.webm (lead-in ${start.toFixed(2)} s, total ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
}

// ---------- scenes ----------
const needWeb = !only.size || ["03-search", "04-itinerary", "05-request", "10-accept", "13-cargo"].some((s) => only.has(s))
const web = needWeb ? await webState() : path.join(STATE, "web.json")

await scene("02-home", {}, async (page, ready) => {
  await page.goto(`${WEB}/en`)
  await page.getByRole("heading", { level: 1 }).waitFor()
  await glide(page, 1100, 300, 1)
  await ready()
  await sleep(1200)
  await glide(page, 520, 360, 40)
  await sleep(1800)
  await smoothScroll(page, 760, 2600)
  await sleep(2200)
  await smoothScroll(page, 520, 1800)
  await sleep(1600)
  await smoothScroll(page, -1280, 2200)
  await sleep(800)
})

await scene("03-search", { state: web }, async (page, ready) => {
  await page.goto(`${WEB}/en`)
  await page.getByRole("button", { name: "Search flights" }).waitFor()
  await glide(page, 1200, 520, 1)
  await ready()
  await sleep(900)
  await point(page, page.getByRole("combobox", { name: "From" }))
  await sleep(600)
  await point(page, page.getByRole("combobox", { name: "To" }))
  await sleep(500)
  await tap(page, page.getByRole("button", { name: "Search flights" }))
  const cards = page.locator("main li a").filter({ hasText: "£" })
  await cards.first().waitFor({ timeout: 40_000 })
  await glide(page, 1180, 300, 30)
  await sleep(2600)
  await point(page, cards.first())
  await sleep(1600)
  await smoothScroll(page, 520, 2400)
  await sleep(1400)
  await point(page, cards.nth(2))
  await sleep(1400)
  await smoothScroll(page, -520, 1600)
  await sleep(1600)
  story.searchUrl = page.url()
  saveStory()
})

await scene("04-itinerary", { state: web }, async (page, ready) => {
  await page.goto(story.searchUrl ?? `${WEB}/en`)
  const cards = page.locator("main li a").filter({ hasText: "£" })
  if (!story.searchUrl) await page.getByRole("button", { name: "Search flights" }).click()
  await cards.first().waitFor({ timeout: 40_000 })
  // The gateway self-transfer shows the most: separate tickets, overland start, connection advice.
  const pick = cards.filter({ hasText: /separate/i }).first()
  const target = (await pick.count()) ? pick : cards.first()
  await glide(page, 900, 420, 1)
  await ready()
  await sleep(700)
  await tap(page, target)
  await page.getByRole("heading", { name: "Itinerary" }).waitFor()
  await glide(page, 760, 360, 30)
  await sleep(2600)
  await smoothScroll(page, 420, 2200)
  await sleep(2200)
  await tap(page, page.getByRole("button", { name: /Re-check price/ }))
  await page.getByRole("status").waitFor({ timeout: 25_000 })
  await sleep(2600)
  story.itineraryUrl = page.url()
  saveStory()
})

await scene("05-request", { state: web }, async (page, ready) => {
  await page.goto(story.itineraryUrl)
  await page.getByRole("heading", { name: "Itinerary" }).waitFor()
  await glide(page, 1200, 760, 1)
  await ready()
  await sleep(500)
  await tap(page, page.getByRole("button", { name: /Request this itinerary/ }))
  await page.waitForURL(/request\/new/)
  await page.waitForLoadState("networkidle")
  const traveller = page.locator("section").filter({ has: page.getByRole("heading", { name: "Who is travelling" }) }).locator("li input[type=checkbox]").first()
  await traveller.waitFor()
  await sleep(700)
  await tap(page, traveller)
  await sleep(500)
  for (const box of await page.locator("section.bg-sand input[type=checkbox]").all()) { await tap(page, box); await sleep(350) }
  await sleep(500)
  await tap(page, page.getByRole("button", { name: "Send request" }))
  const ref = page.locator("p.font-mono")
  await ref.waitFor({ timeout: 25_000 })
  story.ref = (await ref.textContent()).trim()
  saveStory()
  await glide(page, 800, 330, 30)
  await sleep(3200)
})

await scene("06-persian", {}, async (page, ready) => {
  await page.goto(`${WEB}/fa`)
  await page.getByRole("heading", { level: 1 }).waitFor()
  await glide(page, 400, 300, 1)
  await ready()
  await sleep(1400)
  await tap(page, page.getByRole("button", { name: "جست‌وجوی پرواز" }))
  await page.locator("main li a").filter({ hasText: "£" }).first().waitFor({ timeout: 40_000 })
  await glide(page, 700, 420, 30)
  await sleep(2200)
  await smoothScroll(page, 380, 1600)
  await sleep(1200)
})

await scene("07-mobile", { viewport: { width: 390, height: 844 }, scale: 2, video: { width: 390, height: 844 }, zoom: false }, async (page, ready) => {
  const phone = `+98912${String(Math.floor(1000000 + Math.random() * 8999999))}`
  const type = async (loc, text) => { await tap(page, loc); await sleep(350); await page.keyboard.type(text, { delay: 35 }); await sleep(150) }
  // Sign-in happens before the cut point, so the clip opens on the search screen.
  await page.goto(`${MOBILE}/?semantics`)
  const since = Date.now() - 1500
  await type(page.getByRole("textbox", { name: /Mobile number/ }), phone)
  await page.getByRole("button", { name: "Send code" }).click()
  await page.getByRole("textbox", { name: /Verification code/ }).waitFor()
  await type(page.getByRole("textbox", { name: /Verification code/ }), await latestOtp(phone, since))
  await page.getByRole("button", { name: "Verify" }).click()
  await type(page.getByRole("textbox", { name: /Given names/ }), "Parisa")
  await type(page.getByRole("textbox", { name: /Surname/ }), "Moradi")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByText("Where to?").first().waitFor()
  await sleep(1200)
  await ready()
  await tap(page, page.getByRole("button", { name: /^From:/ }))
  await type(page.getByRole("textbox", { name: /Search city or airport/ }), "teh")
  await tap(page, page.getByRole("button", { name: /^Tehran/ }).first())
  await tap(page, page.getByRole("button", { name: /^To:/ }))
  await type(page.getByRole("textbox", { name: /Search city or airport/ }), "lon")
  await tap(page, page.getByRole("button", { name: /London/ }).first())
  await sleep(400)
  await tap(page, page.getByRole("button", { name: "Search flights" }))
  const card = page.getByRole("button", { name: /→.*£/ }).first()
  await card.waitFor({ timeout: 40_000 })
  await sleep(1800)
  await tap(page, card)
  await page.getByText("Total price").first().waitFor()
  await sleep(2400)
})

const needAdmin = !only.size || ["08-queue", "09-quote"].some((s) => only.has(s))
const admin = needAdmin ? await staffState(ADMIN, STAFF.admin, "admin") : path.join(STATE, "admin.json")

await scene("08-queue", { state: admin }, async (page, ready) => {
  await page.goto(`${ADMIN}/queues?tab=new`)
  const table = page.getByTestId("queue-table")
  await table.locator("tbody tr").first().waitFor()
  await glide(page, 900, 300, 1)
  await ready()
  await sleep(1600)
  for (const k of ["j", "j", "k"]) { await page.keyboard.press(k); await sleep(650) }
  await sleep(700)
  const row = table.locator(`tr[data-ref="${story.ref}"]`)
  if (await row.count()) await tap(page, row.getByRole("link").first())
  else await page.goto(`${ADMIN}/requests/${story.ref}`)
  await page.getByTestId("ref").waitFor()
  await sleep(1500)
  await page.keyboard.press("c")
  await page.getByTestId("assignee").filter({ hasText: "Assigned to you" }).waitFor({ timeout: 15_000 })
  await sleep(2400)
})

await scene("09-quote", { state: admin }, async (page, ready) => {
  await page.goto(`${ADMIN}/requests/${story.ref}`)
  await page.getByTestId("ref").waitFor()
  await glide(page, 800, 400, 1)
  await ready()
  await sleep(1200)
  await point(page, page.getByTestId("actions"))
  await sleep(1500)
  await tap(page, page.getByTestId("open-quote-builder"))
  await page.getByRole("button", { name: "+ From snapshot" }).waitFor()
  await sleep(600)
  await tap(page, page.getByRole("button", { name: "+ From snapshot" }))
  const option = page.getByTestId("option-0")
  await option.waitFor()
  await sleep(1400)
  const flagged = option.locator("select[aria-invalid=true]")
  if (await flagged.count()) { await point(page, flagged.first()); await sleep(1200) }
  for (let guard = 0; guard < 20 && (await flagged.count()) > 0; guard++) {
    const sel = flagged.first()
    await point(page, sel)
    await sel.selectOption({ index: 1 })
    await sleep(450)
  }
  await typeInto(page, option.getByLabel("Service fee"), "25.00")
  await sleep(600)
  await tap(page, page.getByRole("button", { name: "Preview" }))
  await page.getByTestId("quote-preview").waitFor()
  await sleep(1600)
  await tap(page, page.getByRole("button", { name: "Send quote" }))
  await page.getByTestId("status").filter({ hasText: "QUOTED" }).waitFor({ timeout: 25_000 })
  await sleep(1800)
})

await scene("10-accept", { state: web }, async (page, ready) => {
  await page.goto(`${WEB}/en/requests/${story.ref}`)
  const accept = page.getByRole("button", { name: "Accept this option" }).first()
  await accept.waitFor({ timeout: 25_000 })
  await glide(page, 600, 300, 1)
  await ready()
  await sleep(1000)
  await point(page, accept)
  await sleep(1800)
  await tap(page, accept)
  await sleep(4200)
  await smoothScroll(page, -600, 1200)
  await sleep(1600)
})

const compliance = !only.size || only.has("11-compliance") ? await staffState(ADMIN, STAFF.compliance, "compliance") : path.join(STATE, "compliance.json")
await scene("11-compliance", { state: compliance }, async (page, ready) => {
  await page.goto(`${ADMIN}/compliance?status=OPEN`)
  let rows = page.getByTestId("cases").locator("tbody tr")
  if (!(await rows.first().waitFor({ timeout: 8000 }).then(() => true, () => false))) { await page.goto(`${ADMIN}/compliance?status=`); rows = page.getByTestId("cases").locator("tbody tr"); await rows.first().waitFor() }
  await glide(page, 900, 260, 1)
  await ready()
  await sleep(1600)
  await tap(page, rows.first().getByRole("link").first())
  await page.getByText("What triggered it").waitFor()
  await glide(page, 760, 420, 30)
  await sleep(2600)
  await smoothScroll(page, 420, 1600)
  await sleep(1400)
  await page.goto(`${ADMIN}/compliance/lists`)
  await page.getByRole("heading", { name: "Sanctions lists" }).waitFor()
  await glide(page, 700, 360, 30)
  await sleep(2600)
})

const developer = !only.size || only.has("12-dev") ? await staffState(DEV, STAFF.developer, "developer") : path.join(STATE, "developer.json")
await scene("12-dev", { state: developer }, async (page, ready) => {
  await page.goto(`${DEV}/config/engine`)
  await page.getByTestId("validation").waitFor()
  await glide(page, 900, 300, 1)
  await ready()
  await sleep(1400)
  const weight = page.locator('input[name="weights.price"]')
  await point(page, weight)
  const v = Number(await weight.inputValue())
  await weight.fill(String(Math.round((v + 0.05) * 100) / 100))
  await sleep(900)
  await tap(page, page.getByRole("button", { name: "Simulate", exact: true }))
  await page.getByTestId("simulation").filter({ hasText: "Draft" }).waitFor({ timeout: 60_000 })
  await point(page, page.getByTestId("simulation"))
  await sleep(2600)
  await page.goto(`${DEV}/audit`)
  await page.locator("h1").waitFor()
  await glide(page, 800, 380, 30)
  await sleep(2400)
})

const cargo = !only.size || only.has("13-cargo") ? await staffState(ADMIN, STAFF.cargo, "cargo") : path.join(STATE, "cargo.json")
await scene("13-cargo", { state: cargo }, async (page, ready) => {
  await page.goto(`${ADMIN}/queues?tab=cargo&ctab=open`)
  const first = page.getByTestId("queue-table").locator("tbody tr").first()
  await first.waitFor()
  await glide(page, 900, 300, 1)
  await ready()
  await sleep(1000)
  await tap(page, first.getByRole("link").first())
  await page.getByTestId("goods").waitFor()
  await glide(page, 760, 420, 30)
  await sleep(2000)
  await smoothScroll(page, 360, 1400)
  await sleep(1200)
})

await browser.close()
console.log("done", story)
