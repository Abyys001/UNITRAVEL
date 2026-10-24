import { type NextRequest, NextResponse } from "next/server"

const LOCALES = ["en", "fa"]

/**
 * Locale routing (/en, /fa — chosen from cookie, then Accept-Language, ch. 29.1) and a nonce-based Content Security
 * Policy with no third-party scripts (ch. 28.4).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/fonts/") || pathname.startsWith("/media/") || pathname === "/favicon.ico" || pathname.startsWith("/s/") || /\.(png|svg|jpg|webp|avif|webm|mp4|txt|xml)$/.test(pathname)) return NextResponse.next()
  const seg = pathname.split("/")[1]
  if (!seg || !LOCALES.includes(seg)) {
    const pref = req.cookies.get("ut_locale")?.value ?? (req.headers.get("accept-language")?.toLowerCase().startsWith("fa") ? "fa" : "en")
    return NextResponse.redirect(new URL(`/${LOCALES.includes(pref) ? pref : "en"}${pathname === "/" ? "" : pathname}${req.nextUrl.search}`, req.url))
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const dev = process.env.NODE_ENV !== "production"
  // Uploads PUT straight to object storage with pre-signed URLs (ch. 14.9), so its origin is the one extra connect target.
  const storage = new URL(process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? "http://localhost:9010").origin
  // Stripe's script and frames are allowed on the pay page only (ADR-0007 P17, from Stripe's CSP guide for Embedded Checkout).
  const stripe = /^\/(en|fa)\/billing\/[^/]+\/pay\/?$/.test(pathname)
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${stripe ? " https://js.stripe.com" : ""}${dev ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${stripe ? " https://*.stripe.com" : ""}`, "media-src 'self'", "font-src 'self'", `connect-src 'self' ${storage}${stripe ? " https://api.stripe.com https://checkout.stripe.com" : ""}`,
    ...(stripe ? ["frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com"] : []),
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ")
  const headers = new Headers(req.headers)
  headers.set("x-nonce", nonce)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set("Content-Security-Policy", csp)
  res.cookies.set("ut_locale", seg, { path: "/", sameSite: "lax", maxAge: 365 * 86400 })
  return res
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] }
