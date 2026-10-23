import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common"

import type { Permission } from "@unitravel/contracts"

export const PUBLIC_KEY = "ut:public"
export const AUTHENTICATED_KEY = "ut:authenticated"
export const PERMISSIONS_KEY = "ut:permissions"
export const STEP_UP_KEY = "ut:stepup"
export const STAFF_KEY = "ut:staff"
export const DEV_SURFACE_KEY = "ut:dev"
export const RATE_LIMIT_KEY = "ut:ratelimit"
export const IDEMPOTENT_KEY = "ut:idempotent"
export const AUDIENCE_KEY = "ut:audience"

/** Routes without a declaration fail closed: a test enumerates all routes and asserts one of these (ch. 25.6). */
export const Public = () => SetMetadata(PUBLIC_KEY, true)
/** Any signed-in user; resource ownership is checked in the handler. */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true)
/** Any one of the listed permissions grants access. */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms)
/** Re-authentication within the step-up window (ch. 16.1). */
export const StepUp = () => SetMetadata(STEP_UP_KEY, true)
/** Staff endpoints require a verified second factor on the session (ch. 25.5). */
export const StaffOnly = () => SetMetadata(STAFF_KEY, true)
/** Developer Panel endpoints are reachable only through the dev host (ch. 16.1). */
export const DevSurface = () => SetMetadata(DEV_SURFACE_KEY, true)
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true)

export interface RateLimitSpec {
  name: string
  limit: number
  windowSeconds: number
  key: "ip" | "user" | "user_or_ip"
}
export const RateLimit = (...specs: RateLimitSpec[]) => SetMetadata(RATE_LIMIT_KEY, specs)

export interface Actor {
  userId: string
  sessionId: string
  audience: "web" | "console" | "mobile"
  permissions: Set<Permission>
  roles: string[]
  permVersion: number
  mfaLevel: number
  mfaVerifiedAt: Date | null
  isStaff: boolean
  ip: string
  userAgent: string
  locale: "en" | "fa"
}

export interface RequestContext {
  id: string
  actor?: Actor
  anonKey?: string
  locale: "en" | "fa"
  clientInfo: { platform?: string; appVersion?: string }
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<{ ctx: RequestContext }>()
  if (!req.ctx.actor) throw new Error("Actor missing on an authenticated route")
  return req.ctx.actor
})

export const OptionalActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor | undefined => {
  return ctx.switchToHttp().getRequest<{ ctx: RequestContext }>().ctx.actor
})

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => ctx.switchToHttp().getRequest<{ ctx: RequestContext }>().ctx)
