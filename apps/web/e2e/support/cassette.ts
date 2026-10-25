import type { Page, Request, Route } from "@playwright/test"

/**
 * Record/replay of the same-origin `/api/*` calls a page makes, so visual snapshots render fixed data (the Phase F
 * done-criterion needs deterministic screens; the live API's dates, references and result lists change every run).
 * Record once against the seeded stack (visual-capture spec), commit the JSON, replay in the snapshot specs.
 * Entries are keyed by language because the API localises labels from Accept-Language.
 */
export interface Entry { status: number; body: unknown }
export interface Cassette { capturedAt: string; /** Routes and references the snapshot specs visit. */ meta: Record<string, string>; entries: Record<string, Entry> }

const langOf = (r: Request) => ((r.headers()["accept-language"] ?? "en").startsWith("fa") ? "fa" : "en")
const keyOf = (lang: string, method: string, u: URL) => `${lang} ${method} ${u.pathname.replace(/^\/api/, "")}${u.search}`

export function record(page: Page, cassette: Cassette) {
  page.on("response", async (res) => {
    const req = res.request()
    const u = new URL(req.url())
    if (!u.pathname.startsWith("/api/") || u.pathname.endsWith("/events") || u.pathname.includes("/auth/")) return
    if (!(res.headers()["content-type"] ?? "").includes("json")) return
    try { cassette.entries[keyOf(langOf(req), req.method(), u)] = { status: res.status(), body: await res.json() } } catch { /* redirects, aborted requests */ }
  })
}

export interface ReplayOptions {
  lang: "en" | "fa"
  signedIn?: boolean
  /** Replace a recorded GET body (path + query as recorded, no language prefix), e.g. to show another payment state. */
  override?: Record<string, (recorded: unknown) => unknown>
}

/** Serves recorded responses, a stream that ends at once for SSE, and a clock frozen at capture time. Returns the unmatched calls. */
export async function replay(page: Page, cassette: Cassette, opts: ReplayOptions): Promise<string[]> {
  const misses: string[] = []
  await page.clock.setFixedTime(new Date(cassette.capturedAt))
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
    if (u.pathname.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "event: done\ndata: {}\n\n" })
    const rel = `${u.pathname.replace(/^\/api/, "")}${u.search}`
    if (rel === "/v1/me" && opts.signedIn === false) return json(401, { status: 401, code: "UNAUTHENTICATED", title: "Sign in required" })
    // Snapshots show the production sign-in page: the testing-phase box (ADR-0012) stays off.
    if (rel === "/v1/auth/test-sign-in") return json(200, { enabled: false })
    const hit = cassette.entries[`${opts.lang} ${req.method()} ${rel}`] ?? cassette.entries[`${opts.lang} ${req.method()} ${u.pathname.replace(/^\/api/, "")}`]
    if (hit) {
      const ov = opts.override?.[rel]
      return json(hit.status, ov ? ov(hit.body) : hit.body)
    }
    if (req.method() !== "GET") return json(200, {})
    misses.push(`${req.method()} ${rel}`)
    return json(404, { status: 404, code: "NOT_FOUND", title: "Not found" })
  })
  return misses
}
