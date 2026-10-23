import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"

import { MfaVerifyBody, OtpRequestBody, OtpRequestResult, OtpVerifyBody, RefreshBody, VerifyResult, WebAuthnVerifyBody } from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { COOKIE_REFRESH } from "../../core/http/auth.guard"
import { type Actor, Authenticated, Ctx, CurrentActor, OptionalActor, Public, RateLimit, type RequestContext } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { clearSessionCookies, setSessionCookies } from "./cookies"
import { MfaService } from "./mfa.service"
import { OtpService } from "./otp.service"
import { PowService } from "./pow.service"
import { SessionsService } from "./sessions.service"

@ApiTags("auth")
@Controller("v1/auth")
export class AuthController {
  constructor(private readonly otp: OtpService, private readonly sessions: SessionsService, private readonly mfa: MfaService, private readonly pow: PowService) {}

  @Post("otp/request")
  @Public()
  @HttpCode(202)
  @ApiZodBody(OtpRequestBody)
  @ApiZodResponse(202, OtpRequestResult)
  request(@Body(zbody(OtpRequestBody)) body: OtpRequestBody, @Req() req: Request, @Ctx() ctx: RequestContext, @OptionalActor() actor?: Actor) {
    return this.otp.request(body, { ip: req.ip ?? "", userAgent: req.header("user-agent"), requestId: ctx.id, locale: ctx.locale, userId: actor?.userId })
  }

  @Get("pow")
  @Public()
  @RateLimit({ name: "pow", limit: 30, windowSeconds: 600, key: "ip" })
  challenge() {
    return this.pow.create()
  }

  @Post("otp/verify")
  @Public()
  @HttpCode(200)
  @ApiZodBody(OtpVerifyBody)
  @ApiZodResponse(200, VerifyResult)
  async verify(@Body(zbody(OtpVerifyBody)) body: OtpVerifyBody, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const r = await this.otp.verify(body, { ip: req.ip ?? "", userAgent: req.header("user-agent"), requestId: ctx.id, locale: ctx.locale })
    if (r.tokens && body.client !== "MOBILE") setSessionCookies(res, r.tokens, body.client)
    return {
      isNewUser: r.isNewUser, needsProfile: r.needsProfile, mfaRequired: r.mfaRequired, mfaEnrolmentRequired: r.mfaEnrolmentRequired,
      tokens: r.tokens && body.client === "MOBILE" ? { accessToken: r.tokens.accessToken, accessExpiresAt: r.tokens.accessExpiresAt.toISOString(), refreshToken: r.tokens.refreshToken, refreshExpiresAt: r.tokens.refreshExpiresAt.toISOString() } : undefined,
    }
  }

  @Post("refresh")
  @Public()
  @HttpCode(200)
  @RateLimit({ name: "refresh", limit: 120, windowSeconds: 600, key: "ip" })
  async refresh(@Body(zbody(RefreshBody)) body: { refreshToken?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const fromCookie = req.cookies?.[COOKIE_REFRESH] as string | undefined
    const presented = body.refreshToken ?? fromCookie
    if (!presented) throw new AppError("UNAUTHENTICATED")
    const t = await this.sessions.refresh(presented, { ip: req.ip, requestId: ctx.id })
    if (!body.refreshToken) {
      const s = await this.sessions.get(t.sessionId)
      setSessionCookies(res, t, s?.client === "CONSOLE" ? "CONSOLE" : "WEB")
      return { ok: true }
    }
    return { accessToken: t.accessToken, accessExpiresAt: t.accessExpiresAt.toISOString(), refreshToken: t.refreshToken, refreshExpiresAt: t.refreshExpiresAt.toISOString() }
  }

  @Post("logout")
  @Authenticated()
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(actor.sessionId, "LOGOUT")
    clearSessionCookies(res)
  }

  @Post("mfa/totp/enrol")
  @Authenticated()
  enrolTotp(@CurrentActor() actor: Actor) {
    return this.mfa.enrolTotp(actor.userId)
  }

  /** Also the step-up path: a successful verification refreshes the step-up window (ch. 16.1). */
  @Post("mfa/totp/verify")
  @Authenticated()
  @HttpCode(200)
  @RateLimit({ name: "mfa-verify", limit: 10, windowSeconds: 600, key: "user" })
  verifyTotp(@Body(zbody(MfaVerifyBody)) body: { code: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.mfa.verifyTotp(actor.userId, actor.sessionId, body.code, { ip: actor.ip, requestId: ctx.id })
  }

  @Post("mfa/webauthn/registration-options")
  @Authenticated()
  webauthnRegOptions(@CurrentActor() actor: Actor) {
    return this.mfa.webauthnRegistrationOptions(actor.userId)
  }

  @Post("mfa/webauthn/register")
  @Authenticated()
  webauthnRegister(@Body(zbody(WebAuthnVerifyBody)) body: { response: Record<string, unknown> }, @CurrentActor() actor: Actor) {
    return this.mfa.webauthnRegister(actor.userId, actor.sessionId, body.response)
  }

  @Post("mfa/webauthn/authentication-options")
  @Authenticated()
  webauthnAuthOptions(@CurrentActor() actor: Actor) {
    return this.mfa.webauthnAuthOptions(actor.userId)
  }

  @Post("mfa/webauthn/authenticate")
  @Authenticated()
  @HttpCode(200)
  webauthnAuthenticate(@Body(zbody(WebAuthnVerifyBody)) body: { response: Record<string, unknown> }, @CurrentActor() actor: Actor) {
    return this.mfa.webauthnAuthenticate(actor.userId, actor.sessionId, body.response)
  }
}
