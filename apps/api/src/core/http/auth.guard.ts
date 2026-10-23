import { randomUUID } from "node:crypto"

import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import type { Request, Response } from "express"

import type { Permission } from "@unitravel/contracts"

import { AccessService } from "../../modules/access/access.service"
import { ConfigService } from "../../modules/config/config.service"
import { SessionsService } from "../../modules/identity/sessions.service"
import { TokensService } from "../../modules/identity/tokens.service"
import { env } from "../env"
import { AppError } from "../errors"
import {
  type Actor, AUTHENTICATED_KEY, DEV_SURFACE_KEY, PERMISSIONS_KEY, PUBLIC_KEY, RATE_LIMIT_KEY, type RateLimitSpec, type RequestContext, STAFF_KEY, STEP_UP_KEY,
} from "./decorators"
import { RateLimiter } from "./rate-limit"

export const COOKIE_ACCESS = "ut_at"
export const COOKIE_REFRESH = "ut_rt"
export const COOKIE_CSRF = "ut_csrf"
export const COOKIE_ANON = "ut_anon"

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"])

function hostOf(url: string) {
  return new URL(url).host
}

/**
 * The request pipeline (ch. 20.4 steps 2–4): AuthGuard → PermVersion check → PermissionGuard, plus staff MFA,
 * Developer Panel host restriction, step-up and per-route rate limits. Hiding a button is never a security control.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly access: AccessService,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiter,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()])
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true
    const req = ctx.switchToHttp().getRequest<Request & { ctx: RequestContext; id?: string }>()
    const res = ctx.switchToHttp().getResponse<Response>()
    const isPublic = this.meta<boolean>(PUBLIC_KEY, ctx) ?? false
    const needsAuth = this.meta<boolean>(AUTHENTICATED_KEY, ctx) ?? false
    const perms = this.meta<Permission[]>(PERMISSIONS_KEY, ctx)
    const locale = req.headers["accept-language"]?.toString().startsWith("fa") ? "fa" : "en"
    req.ctx = { id: req.id ?? randomUUID(), locale, clientInfo: { platform: req.header("x-client-platform"), appVersion: req.header("x-app-version") } }

    // Anonymous searches are tied to a random first-party cookie (web) or the device id header (mobile).
    const anon = (req.cookies?.[COOKIE_ANON] as string | undefined) ?? req.header("x-device-id")
    if (anon && /^[A-Za-z0-9_-]{8,128}$/.test(anon)) req.ctx.anonKey = anon

    const bearer = req.header("authorization")?.match(/^Bearer (.+)$/)?.[1]
    const cookieToken = req.cookies?.[COOKIE_ACCESS] as string | undefined
    const token = bearer ?? cookieToken
    if (token) {
      try {
        req.ctx.actor = await this.resolveActor(token, req, !!bearer)
      } catch (err) {
        if (!isPublic) throw err
      }
    }
    if (!isPublic && !needsAuth && !perms) throw new AppError("FORBIDDEN", "Route has no permission declaration")
    if (!isPublic && !req.ctx.actor) throw new AppError("UNAUTHENTICATED")
    const actor = req.ctx.actor
    const auth = this.config.get("AUTH")
    // Developer Panel routes do not exist outside the dev host: answer 404 before any permission check (ch. 16.1).
    if (this.meta<boolean>(DEV_SURFACE_KEY, ctx)) {
      const host = (req.header("x-forwarded-host") ?? req.header("host") ?? "").split(",")[0]!.trim()
      if (host !== hostOf(env().PUBLIC_CONSOLE_DEV_URL) || (actor && actor.audience !== "console")) throw new AppError("NOT_FOUND")
      if (auth.ipAllowlistDev.length > 0 && !auth.ipAllowlistDev.includes(req.ip ?? "")) throw new AppError("NOT_FOUND")
    }
    if (perms && actor && !perms.some((p) => actor.permissions.has(p))) throw new AppError("FORBIDDEN", `Requires ${perms.join(" or ")}`)
    if (perms && !actor && !isPublic) throw new AppError("UNAUTHENTICATED")

    if (this.meta<boolean>(STAFF_KEY, ctx) && actor) {
      if (actor.audience === "web") throw new AppError("FORBIDDEN", "Staff endpoints are not available to website sessions")
      if (auth.staffSecondFactor && actor.mfaLevel < 1) throw new AppError("MFA_REQUIRED", "Verify your second factor")
    }
    if (this.meta<boolean>(STEP_UP_KEY, ctx) && actor) {
      const window = auth.stepUpWindowMinutes * 60_000
      if (!actor.mfaVerifiedAt || Date.now() - actor.mfaVerifiedAt.getTime() > window) throw new AppError("STEP_UP_REQUIRED", `Re-verify within the last ${auth.stepUpWindowMinutes} minutes`)
    }
    for (const spec of this.meta<RateLimitSpec[]>(RATE_LIMIT_KEY, ctx) ?? []) {
      const key = spec.key === "ip" ? req.ip ?? "?" : spec.key === "user" ? actor?.userId ?? req.ip ?? "?" : actor ? `u:${actor.userId}` : `ip:${req.ip}`
      await this.limiter.enforce(spec.name, key, spec.limit, spec.windowSeconds)
    }
    if (actor && cookieToken && !bearer && UNSAFE.has(req.method)) {
      // Double-submit CSRF token on top of SameSite=Lax (ch. 25.2).
      const header = req.header("x-csrf-token")
      if (!header || header !== req.cookies?.[COOKIE_CSRF]) throw new AppError("FORBIDDEN", "CSRF token missing or invalid")
    }
    void res
    return true
  }

  private async resolveActor(token: string, req: Request, isBearer: boolean): Promise<Actor> {
    const claims = await this.tokens.verifyAccess(token)
    if (isBearer && claims.aud !== "mobile") throw new AppError("UNAUTHENTICATED", "Bearer tokens are for the mobile app")
    if (!isBearer && claims.aud === "mobile") throw new AppError("UNAUTHENTICATED")
    const st = await this.sessions.guardState(claims.sid)
    if (!st || st.revoked || st.absoluteExpiresAt <= new Date()) throw new AppError("UNAUTHENTICATED", "Session ended")
    const auth = this.config.get("AUTH")
    if (st.client === "CONSOLE" && Date.now() - st.lastSeenAt.getTime() > auth.staffIdleMinutes * 60_000) {
      await this.sessions.revoke(claims.sid, "IDLE_TIMEOUT")
      throw new AppError("UNAUTHENTICATED", "Signed out after inactivity")
    }
    // Demotions take effect on the very next request: a stale perm_version is refused (ch. 10.5).
    const current = await this.access.currentPermVersion(claims.sub)
    if (current !== claims.pv) throw new AppError("PERMISSIONS_CHANGED", "Refresh your session")
    await this.sessions.touch(claims.sid)
    const permissions = new Set(claims.perms)
    return {
      userId: claims.sub, sessionId: claims.sid, audience: claims.aud, permissions, roles: [], permVersion: claims.pv,
      mfaLevel: Math.max(claims.mfa, st.mfaLevel), mfaVerifiedAt: st.mfaVerifiedAt, isStaff: this.access.isStaff(permissions),
      ip: req.ip ?? "", userAgent: req.header("user-agent") ?? "", locale: req.headers["accept-language"]?.toString().startsWith("fa") ? "fa" : "en",
    }
  }
}
