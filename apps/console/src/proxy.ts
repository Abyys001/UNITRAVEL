import { type NextRequest, NextResponse } from "next/server"

/** Which console surface a host serves (ch. 29.2): admin. → Admin Panel, dev. → Developer Panel. */
function surfaceOf(host: string): "admin" | "dev" | null {
  const name = host.split(":")[0]!.toLowerCase()
  const admin = new URL(process.env.PUBLIC_CONSOLE_ADMIN_URL ?? "http://admin.localhost:4200").hostname
  const dev = new URL(process.env.PUBLIC_CONSOLE_DEV_URL ?? "http://dev.localhost:4200").hostname
  return name === admin ? "admin" : name === dev ? "dev" : null
}

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })

/**
 * Maps the host to its route group and refuses routes from the other group, so the Developer Panel does not exist on
 * the admin host and vice versa (ch. 16.1, 29.2). Stricter CSP than the website: nonce scripts only, no
 * 'strict-dynamic', no third-party origins, no analytics (ch. 28.4).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const surface = surfaceOf(req.headers.get("host") ?? "")
  if (pathname.startsWith("/_next/") || pathname === "/icon.svg" || pathname === "/favicon.ico") return NextResponse.next()
  if (!surface) return notFound()
  if (pathname.startsWith("/api/")) {
    // Defence in depth only: the API itself answers 404 for /v1/dev/* unless the forwarded host is the dev host.
    if (surface === "admin" && pathname.startsWith("/api/v1/dev/")) return notFound()
    return NextResponse.next()
  }
  // The internal group prefixes are never addressable directly.
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/dev" || pathname.startsWith("/dev/")) return notFound()

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const dev = process.env.NODE_ENV !== "production"
  const csp = [
    "default-src 'none'", `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", `connect-src 'self'${dev ? " ws:" : ""}`, "manifest-src 'self'", "frame-ancestors 'none'", "frame-src 'none'",
    "base-uri 'none'", "form-action 'self'", "object-src 'none'", "worker-src 'none'",
  ].join("; ")
  const headers = new Headers(req.headers)
  headers.set("x-nonce", nonce)
  headers.set("x-surface", surface)
  // Next.js reads the nonce from the request's CSP header and stamps it on its own scripts.
  headers.set("Content-Security-Policy", csp)
  const url = req.nextUrl.clone()
  url.pathname = `/${surface}${pathname === "/" ? "" : pathname}`
  const res = NextResponse.rewrite(url, { request: { headers } })
  res.headers.set("Content-Security-Policy", csp)
  res.headers.set("Cache-Control", "no-store")
  return res
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] }
