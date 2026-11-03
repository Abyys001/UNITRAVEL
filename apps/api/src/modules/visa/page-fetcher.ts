import { Injectable, Logger } from "@nestjs/common"
import { z } from "zod"

import { env } from "../../core/env"

// ADR-0033 point 6: public official pages are read like a person would read them: robots.txt honoured, one identified
// user agent, a timeout and a size cap, no login, no bypass of anything (rule 2). Text is extracted, nothing is stored
// except what the run records (status, timing, size) and the quotes the gate keeps.

export const MAX_BYTES = 2_000_000
/** Characters of page text sent to the model per page; long pages keep their start, where entry rules usually sit. */
export const MAX_TEXT_CHARS = 60_000
const TIMEOUT_MS = 15_000

export interface FetchedPage {
  url: string
  title: string
  text: string
  /** Page's own last-update date when it states one (GOV.UK content API, HTTP Last-Modified, or a meta tag). */
  updatedAt: string | null
  /** Outbound links, for GOV.UK pages only (destination government sites it points to). */
  links: string[]
}

export interface FetchLog { url: string; status: string; ms: number; chars: number | null }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" }

/** Readable text from HTML: scripts, styles and markup removed, block elements become line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\r\u00A0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
}

export function htmlTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? htmlToText(m[1]!).slice(0, 300) : ""
}

/** Absolute https links in an HTML fragment. */
export function htmlLinks(html: string, base: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    try {
      const u = new URL(m[1]!, base)
      if (u.protocol === "https:") { u.hash = ""; out.add(u.toString()) }
    } catch { /* not a URL */ }
  }
  return [...out]
}

/**
 * Minimal robots.txt reading for our user agent and `*`: the longest matching Allow/Disallow prefix wins. A missing or
 * unreadable robots.txt means no restriction (the convention), a 401/403 on robots.txt means stay away.
 */
export function robotsAllows(robots: string, path: string, agent: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; prefix: string }> }> = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const field = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", prefix: value.replace(/\*$/, "") })
      lastWasAgent = false
    } else {
      lastWasAgent = false
    }
  }
  const name = agent.toLowerCase()
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && name.includes(a))) ?? groups.find((g) => g.agents.includes("*"))
  if (!group) return true
  let best: { allow: boolean; prefix: string } | null = null
  for (const r of group.rules) if (path.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r
  return best ? best.allow : true
}

const GovukContent = z.object({
  title: z.string(),
  public_updated_at: z.string().optional(),
  details: z.object({ parts: z.array(z.object({ slug: z.string(), title: z.string(), body: z.string() })).optional() }),
})

@Injectable()
export class PageFetcher {
  private readonly log = new Logger("VisaFetch")
  private readonly robotsCache = new Map<string, { at: number; text: string | null; blocked: boolean }>()

  userAgent(): string {
    return `UniTravelVisaResearch/1.0 (+${env().PUBLIC_WEB_URL}/visa)`
  }

  private async limited(url: string, accept: string): Promise<Response> {
    return fetch(url, { headers: { "user-agent": this.userAgent(), accept, "accept-language": "en-GB,en;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) })
  }

  private async bodyText(res: Response): Promise<string> {
    const len = Number(res.headers.get("content-length") ?? 0)
    if (len > MAX_BYTES) throw new Error("TOO_LARGE")
    const reader = res.body?.getReader()
    if (!reader) return ""
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("TOO_LARGE") }
      chunks.push(value)
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks))
  }

  async allowed(url: URL): Promise<boolean> {
    const origin = url.origin
    const cached = this.robotsCache.get(origin)
    let entry = cached && Date.now() - cached.at < 6 * 3600_000 ? cached : null
    if (!entry) {
      try {
        const res = await this.limited(`${origin}/robots.txt`, "text/plain")
        entry = { at: Date.now(), text: res.ok ? (await this.bodyText(res)).slice(0, 200_000) : null, blocked: res.status === 401 || res.status === 403 }
      } catch {
        entry = { at: Date.now(), text: null, blocked: false }
      }
      this.robotsCache.set(origin, entry)
    }
    if (entry.blocked) return false
    return entry.text ? robotsAllows(entry.text, url.pathname + url.search, "UniTravelVisaResearch") : true
  }

  /** GOV.UK foreign travel advice through the documented content API (no HTML scraping). */
  async govuk(countrySlug: string, log: FetchLog[]): Promise<FetchedPage | null> {
    const api = `https://www.gov.uk/api/content/foreign-travel-advice/${countrySlug}`
    const started = Date.now()
    try {
      const res = await this.limited(api, "application/json")
      if (!res.ok) { log.push({ url: api, status: `HTTP_${res.status}`, ms: Date.now() - started, chars: null }); return null }
      const body = GovukContent.parse(JSON.parse(await this.bodyText(res)))
      const parts = body.details.parts ?? []
      const entry = parts.find((p) => p.slug === "entry-requirements")
      if (!entry) { log.push({ url: api, status: "NO_ENTRY_SECTION", ms: Date.now() - started, chars: null }); return null }
      const page = `https://www.gov.uk/foreign-travel-advice/${countrySlug}/entry-requirements`
      const text = htmlToText(entry.body).slice(0, MAX_TEXT_CHARS)
      log.push({ url: api, status: "OK", ms: Date.now() - started, chars: text.length })
      return { url: page, title: `${body.title}: ${entry.title} (GOV.UK)`, text, updatedAt: body.public_updated_at ? new Date(body.public_updated_at).toISOString() : null, links: htmlLinks(entry.body, page) }
    } catch (err) {
      log.push({ url: api, status: err instanceof Error && err.message === "TOO_LARGE" ? "TOO_LARGE" : "ERROR", ms: Date.now() - started, chars: null })
      this.log.warn({ url: api, err: String(err) }, "GOV.UK fetch failed")
      return null
    }
  }

  async page(url: string, log: FetchLog[]): Promise<FetchedPage | null> {
    const started = Date.now()
    let u: URL
    try { u = new URL(url) } catch { log.push({ url, status: "BAD_URL", ms: 0, chars: null }); return null }
    if (u.protocol !== "https:") { log.push({ url, status: "NOT_HTTPS", ms: 0, chars: null }); return null }
    if (!(await this.allowed(u))) { log.push({ url, status: "ROBOTS_DISALLOWED", ms: Date.now() - started, chars: null }); return null }
    try {
      const res = await this.limited(url, "text/html,application/xhtml+xml,text/plain;q=0.8")
      if (!res.ok) { log.push({ url, status: `HTTP_${res.status}`, ms: Date.now() - started, chars: null }); return null }
      const type = res.headers.get("content-type") ?? ""
      if (!/text\/html|xhtml|text\/plain/.test(type)) { log.push({ url, status: "UNSUPPORTED_TYPE", ms: Date.now() - started, chars: null }); return null }
      const raw = await this.bodyText(res)
      const text = (type.includes("text/plain") ? raw : htmlToText(raw)).slice(0, MAX_TEXT_CHARS)
      const lastModified = res.headers.get("last-modified")
      const meta = /<meta[^>]+(?:property|name)="(?:article:modified_time|dcterms\.modified|last-modified)"[^>]+content="([^"]+)"/i.exec(raw)?.[1]
      const when = meta ?? lastModified
      const date = when ? new Date(when) : null
      log.push({ url, status: "OK", ms: Date.now() - started, chars: text.length })
      return { url: res.url || url, title: htmlTitle(raw) || u.hostname, text, updatedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null, links: [] }
    } catch (err) {
      log.push({ url, status: err instanceof Error && err.message === "TOO_LARGE" ? "TOO_LARGE" : err instanceof Error && err.name === "TimeoutError" ? "TIMEOUT" : "ERROR", ms: Date.now() - started, chars: null })
      return null
    }
  }
}

/**
 * Hosts that are government sites by their domain: `gov.xx`, `gov`, `gouv.xx`, `gob.xx`, `go.xx`, `govt.xx`, `admin.ch`
 * style ministry hosts are not guessable, so only these patterns count automatically; staff add the rest as trusted sources.
 */
export function isGovernmentHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === "www.gov.uk" || h.endsWith(".gov.uk")) return false // GOV.UK itself is tier 1 and handled separately
  return /(^|\.)(gov|gouv|gob|govt|go|gv|gub|regjeringen|admin)\.[a-z]{2}$/.test(h) || /\.gov$/.test(h) || /(^|\.)mfa\.[a-z]{2,3}$/.test(h)
}
