import type { Response } from "express"

import { randomToken } from "../../core/crypto"
import { env } from "../../core/env"
import { COOKIE_ACCESS, COOKIE_CSRF, COOKIE_REFRESH } from "../../core/http/auth.guard"
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
