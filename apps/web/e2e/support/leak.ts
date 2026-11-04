import type { Page } from "@playwright/test"

// Same list the API serialiser tests use (ADR-0004, ADR-0029 A9); a key added there is checked here too.
import { FORBIDDEN_CUSTOMER_KEYS } from "../../../api/src/testing/leak"
export { FORBIDDEN_CUSTOMER_KEYS }

// Shared by price-leak.spec.ts and stage23-flow.spec.ts (moved out of the spec so importing it does not register its tests twice).
const FORBIDDEN_TEXT = ["google.com/travel", "google.com/flights", "booking_token"] as const

export type LeakHit = { needle: string; at: string }

/** Pure. A key counts only as a JSON key (`"key":`), also when escaped inside an RSC string (`\"key\":`). */
export function scanForLeaks(text: string, keys: readonly string[] = FORBIDDEN_CUSTOMER_KEYS): LeakHit[] {
  const hits: LeakHit[] = []
  const snippet = (i: number) => text.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, " ")
  for (const k of keys) {
    const m = new RegExp(`\\\\*"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\\*"\\s*:`, "i").exec(text)
    if (m) hits.push({ needle: `"${k}":`, at: snippet(m.index) })
  }
  const lower = text.toLowerCase()
  for (const n of FORBIDDEN_TEXT) {
    const i = lower.indexOf(n)
    if (i >= 0) hits.push({ needle: n, at: snippet(i) })
  }
  return hits
}

// Same defaults as playwright.config.ts and helpers.ts.
const WEB_ORIGIN = new URL(process.env.WEB_URL ?? "http://localhost:4000").origin
export const API_ORIGIN = new URL(process.env.API_URL ?? "http://localhost:4100").origin

const TEXTUAL = /json|javascript|ecmascript|x-component|html|text\/plain/i

/** Collects what the browser receives for one test; `snap` records the rendered HTML of the current page. */
export function crawler(page: Page, apiOrigin: string, webOrigin = WEB_ORIGIN) {
  const bodies = new Map<string, string>()
  const consoleText: string[] = []
  const pending: Promise<void>[] = []
  const seenScripts = new Set<string>()
  page.on("console", (m) => { consoleText.push(`${m.type()}: ${m.text()}`) })
  page.on("pageerror", (e) => { consoleText.push(`pageerror: ${e.message}`) })
  page.on("response", (r) => {
    const u = new URL(r.url())
    if (!(u.origin === webOrigin || u.origin === apiOrigin)) return
    if (!TEXTUAL.test(r.headers()["content-type"] ?? "")) return
    if (/javascript|ecmascript/i.test(r.headers()["content-type"] ?? "")) seenScripts.add(u.pathname + u.search)
    pending.push(r.text().then((t) => { bodies.set(`${r.request().method()} ${u.pathname}${u.search} #${bodies.size}`, t) }, () => { /* body gone after a redirect or navigation */ }))
  })
  return {
    async snap(label: string) {
      await page.waitForLoadState("networkidle")
      bodies.set(`HTML ${label} ${page.url()}`, await page.content())
      // Chunks the browser served from cache never fire a response event, so fetch the ones the page references.
      const srcs = await page.locator("script[src]").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src))
      for (const src of srcs) {
        const u = new URL(src)
        if (u.origin !== webOrigin || seenScripts.has(u.pathname + u.search)) continue
        seenScripts.add(u.pathname + u.search)
        const r = await page.request.get(src)
        bodies.set(`JS ${u.pathname}`, await r.text())
      }
      await Promise.all(pending.splice(0))
    },
    leaks(): string[] {
      const all: [string, string][] = [...bodies, ...consoleText.map((c, i): [string, string] => [`console #${i}`, c])]
      return all.flatMap(([src, text]) => scanForLeaks(text).map((h) => `${src}: ${h.needle} near "${h.at}"`))
    },
    stats: () => ({ html: [...bodies.keys()].filter((k) => k.startsWith("HTML")).length, js: [...bodies.keys()].filter((k) => k.startsWith("JS ") || /\.js/.test(k)).length, json: [...bodies.keys()].filter((k) => k.startsWith("GET /api")).length }),
  }
}


