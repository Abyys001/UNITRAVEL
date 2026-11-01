import type { Request, Response } from "express"

import { randomToken } from "../../core/crypto"
import { env } from "../../core/env"
import { COOKIE_ACCESS, COOKIE_CSRF, COOKIE_DEVICE, COOKIE_REFRESH } from "../../core/http/auth.guard"
import type { IssuedTokens } from "./sessions.service"

/**
 * HTTP-only, Secure, SameSite=Lax cookies for web and console (ch. 25.2). Cookies carry no Domain attribute, so the
 * console's admin. and dev. hosts each get their own; the website proxies /api/* so cookies stay first-party.
 */
export function setSessionCookies(res: Response, t: IssuedTokens, client: "WEB" | "CONSOLE") {
  const secure = (client === "WEB" ? env().PUBLIC_WEB_URL : env().PUBLIC_CONSOLE_ADMIN_URL).startsWith("https")
  const base = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" }
  res.cookie(COOKIE_ACCESS, t.accessToken, { ...base, expires: t.refreshExpiresAt })
  res.cookie(COOKIE_REFRESH, t.refreshToken, { ...base, expires: t.refreshExpiresAt })
  res.cookie(COOKIE_CSRF, randomToken(18), { ...base, httpOnly: false, expires: t.refreshExpiresAt })
}

export function clearSessionCookies(res: Response) {
  for (const c of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF]) res.clearCookie(c, { path: "/" })
}

/** The remembered-device cookie goes only to the device routes, never to page JavaScript or other API calls (ADR-0022). */
const DEVICE_COOKIE_PATH = "/api/v1/auth/device"
/** Holds no secret: it only tells the page a resume is worth trying, so signed-out visitors make no request that must fail. */
const COOKIE_DEVICE_HINT = "ut_dh"

export function setDeviceCookie(res: Response, token: string, expires: Date) {
  const secure = env().PUBLIC_CONSOLE_ADMIN_URL.startsWith("https")
  res.cookie(COOKIE_DEVICE, token, { httpOnly: true, secure, sameSite: "strict", path: DEVICE_COOKIE_PATH, expires })
  res.cookie(COOKIE_DEVICE_HINT, "1", { httpOnly: false, secure, sameSite: "strict", path: "/", expires })
}

export function clearDeviceCookie(res: Response) {
  res.clearCookie(COOKIE_DEVICE, { path: DEVICE_COOKIE_PATH })
  res.clearCookie(COOKIE_DEVICE_HINT, { path: "/" })
}

/** The console host this request came through, or null when it came through anything else. */
export function consoleHost(req: Request): string | null {
  const host = (req.header("x-forwarded-host") ?? req.header("host") ?? "").split(",")[0]!.trim()
  return [env().PUBLIC_CONSOLE_ADMIN_URL, env().PUBLIC_CONSOLE_DEV_URL].some((u) => new URL(u).host === host) ? host : null
}
