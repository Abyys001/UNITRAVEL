import { type NextRequest, NextResponse } from "next/server"

const LOCALES = ["en", "fa"]

/**
 * Locale routing (/en, /fa — chosen from cookie, then Accept-Language, ch. 29.1) and a nonce-based Content Security
 * Policy with no third-party scripts (ch. 28.4).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/fonts/") || pathname === "/favicon.ico" || pathname.startsWith("/s/") || /\.(png|svg|jpg|webp|txt|xml)$/.test(pathname)) return NextResponse.next()
  const seg = pathname.split("/")[1]
  if (!seg || !LOCALES.includes(seg)) {
    const pref = req.cookies.get("ut_locale")?.value ?? (req.headers.get("accept-language")?.toLowerCase().startsWith("fa") ? "fa" : "en")
    return NextResponse.redirect(new URL(`/${LOCALES.includes(pref) ? pref : "en"}${pathname === "/" ? "" : pathname}${req.nextUrl.search}`, req.url))
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const dev = process.env.NODE_ENV !== "production"
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ")
  const headers = new Headers(req.headers)
  headers.set("x-nonce", nonce)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set("Content-Security-Policy", csp)
  res.cookies.set("ut_locale", seg, { path: "/", sameSite: "lax", maxAge: 365 * 86400 })
  return res
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] }
