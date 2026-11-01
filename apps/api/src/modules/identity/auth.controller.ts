import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"

import { MfaVerifyBody, OtpRequestBody, OtpRequestResult, OtpVerifyBody, RefreshBody, TestSignInBody, TestSignInStatus, VerifyResult, WebAuthnVerifyBody } from "@unitravel/contracts"

import { isLocal, testSignInEnabled } from "../../core/env"
import { AppError } from "../../core/errors"
import { COOKIE_DEVICE, COOKIE_REFRESH } from "../../core/http/auth.guard"
import { type Actor, Authenticated, Ctx, CurrentActor, OptionalActor, Passive, Public, RateLimit, type RequestContext } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { clearDeviceCookie, clearSessionCookies, consoleHost, setDeviceCookie, setSessionCookies } from "./cookies"
import { MfaService } from "./mfa.service"
import { OtpService } from "./otp.service"
import { PowService } from "./pow.service"
import { SessionsService } from "./sessions.service"

type VerifyBodyClient = OtpVerifyBody["client"]

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
    return this.signedIn(r, body.client, req, res, ctx)
  }

  @Get("test-sign-in")
  @Public()
  @ApiZodResponse(200, TestSignInStatus)
  testSignInStatus() {
    return { enabled: testSignInEnabled() }
  }

  /** ADR-0012: email-only sign-in for the testing phase; 404 unless TEST_SIGN_IN=on, which production refuses at boot. */
  @Post("test-sign-in")
  @Public()
  @HttpCode(200)
  @RateLimit({ name: "test-sign-in", limit: 60, windowSeconds: 600, key: "ip" })
  @ApiZodBody(TestSignInBody)
  @ApiZodResponse(200, VerifyResult)
  async testSignIn(@Body(zbody(TestSignInBody)) body: TestSignInBody, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    if (!testSignInEnabled()) throw new AppError("NOT_FOUND")
    const r = await this.otp.testSignIn(body, { ip: req.ip ?? "", userAgent: req.header("user-agent"), requestId: ctx.id, locale: ctx.locale })
    return this.signedIn(r, body.client, req, res, ctx)
  }

  private async signedIn(r: Awaited<ReturnType<OtpService["verify"]>>, client: VerifyBodyClient, req: Request, res: Response, ctx: RequestContext) {
    if (r.tokens && client !== "MOBILE") setSessionCookies(res, r.tokens, client)
    if (r.tokens && client === "CONSOLE" && !r.mfaRequired && !r.mfaEnrolmentRequired) await this.remember(r.tokens.sessionId, req, res, ctx)
    return {
      isNewUser: r.isNewUser, needsProfile: r.needsProfile, mfaRequired: r.mfaRequired, mfaEnrolmentRequired: r.mfaEnrolmentRequired,
      tokens: r.tokens && client === "MOBILE" ? { accessToken: r.tokens.accessToken, accessExpiresAt: r.tokens.accessExpiresAt.toISOString(), refreshToken: r.tokens.refreshToken, refreshExpiresAt: r.tokens.refreshExpiresAt.toISOString() } : undefined,
    }
  }

  /** ADR-0022: called wherever a console session's second factor becomes satisfied. */
  private async remember(sessionId: string, req: Request, res: Response, ctx: RequestContext) {
    const host = consoleHost(req)
    if (!host) return
    const d = await this.sessions.trustDevice(sessionId, host, { ip: req.ip, userAgent: req.header("user-agent"), requestId: ctx.id })
    if (d) setDeviceCookie(res, d.token, d.expiresAt)
  }

  /** Refuses anything a browser would not send for its own console page: wrong host, cross-site origin, or no custom header (which forces a CORS preflight). */
  private deviceRequestHost(req: Request): string {
    const host = consoleHost(req)
    let origin = ""
    try { origin = new URL(req.header("origin") ?? "").host } catch { /* missing or malformed */ }
    if (!host || origin !== host || req.header("x-ut-device") !== "1") throw new AppError("UNAUTHENTICATED", "Device not recognised")
    return host
  }

  /** ADR-0022: a session has ended; a remembered device opens a new one without a sign-in. */
  @Post("device/resume")
  @Public()
  @Passive()
  @HttpCode(200)
  @RateLimit({ name: "device-resume", limit: 120, windowSeconds: 600, key: "ip" })
  async resumeDevice(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const host = this.deviceRequestHost(req)
    const presented = req.cookies?.[COOKIE_DEVICE] as string | undefined
    if (!presented) throw new AppError("UNAUTHENTICATED", "Device not recognised")
    try {
      const r = await this.sessions.resumeDevice(presented, host, { ip: req.ip, userAgent: req.header("user-agent"), requestId: ctx.id })
      setSessionCookies(res, r.tokens, "CONSOLE")
      if (r.device) setDeviceCookie(res, r.device.token, r.device.expiresAt)
      return { ok: true }
    } catch (err) {
      if (err instanceof AppError && err.code === "UNAUTHENTICATED") clearDeviceCookie(res)
      throw err
    }
  }

  /** Sign-out must work even after the session ended, when logout itself can no longer authenticate. */
  @Post("device/forget")
  @Public()
  @Passive()
  @HttpCode(204)
  @RateLimit({ name: "device-forget", limit: 60, windowSeconds: 600, key: "ip" })
  async forgetDevice(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    this.deviceRequestHost(req)
    const presented = req.cookies?.[COOKIE_DEVICE] as string | undefined
    if (presented) await this.sessions.forgetDevice(presented, { ip: req.ip, requestId: ctx.id })
    clearDeviceCookie(res)
  }

  /** The console's heartbeat while someone works without calling the API (a long form); the guard records the activity. */
  @Post("activity")
  @Authenticated()
  @HttpCode(204)
  activity() {
    return
  }

  @Post("refresh")
  @Public()
  @Passive()
  @HttpCode(200)
  @RateLimit({ name: "refresh", limit: 120, windowSeconds: 600, key: "ip" })
  async refresh(@Body(zbody(RefreshBody)) body: { refreshToken?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const fromCookie = req.cookies?.[COOKIE_REFRESH] as string | undefined
    const presented = body.refreshToken ?? fromCookie
    if (!presented) throw new AppError("UNAUTHENTICATED")
    const t = await this.sessions.refresh(presented, { ip: req.ip, userAgent: req.headers["user-agent"], requestId: ctx.id })
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
  async logout(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.signOut(actor, ctx.id)
    clearSessionCookies(res)
    clearDeviceCookie(res)
  }

  @Post("mfa/totp/enrol")
  @Authenticated()
  enrolTotp(@CurrentActor() actor: Actor) {
    return this.mfa.enrolTotp(actor.userId)
  }

  /** Local only: the current authenticator code for the signed-in user, so test sessions skip the authenticator app. */
  @Get("dev-sink/totp")
  @Authenticated()
  async devTotp(@CurrentActor() actor: Actor) {
    if (!isLocal() && !testSignInEnabled()) throw new AppError("NOT_FOUND")
    return (await this.mfa.currentTotp(actor.userId)) ?? { code: null }
  }

  /** Also the step-up path: a successful verification refreshes the step-up window (ch. 16.1). */
  @Post("mfa/totp/verify")
  @Authenticated()
  @HttpCode(200)
  @RateLimit({ name: "mfa-verify", limit: 10, windowSeconds: 600, key: "user" })
  async verifyTotp(@Body(zbody(MfaVerifyBody)) body: { code: string }, @CurrentActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const r = await this.mfa.verifyTotp(actor.userId, actor.sessionId, body.code, { ip: actor.ip, requestId: ctx.id })
    await this.remember(actor.sessionId, req, res, ctx)
    return r
  }

  @Post("mfa/webauthn/registration-options")
  @Authenticated()
  webauthnRegOptions(@CurrentActor() actor: Actor) {
    return this.mfa.webauthnRegistrationOptions(actor.userId)
  }

  @Post("mfa/webauthn/register")
  @Authenticated()
  async webauthnRegister(@Body(zbody(WebAuthnVerifyBody)) body: { response: Record<string, unknown> }, @CurrentActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const r = await this.mfa.webauthnRegister(actor.userId, actor.sessionId, body.response)
    await this.remember(actor.sessionId, req, res, ctx)
    return r
  }

  @Post("mfa/webauthn/authentication-options")
  @Authenticated()
  webauthnAuthOptions(@CurrentActor() actor: Actor) {
    return this.mfa.webauthnAuthOptions(actor.userId)
  }

  @Post("mfa/webauthn/authenticate")
  @Authenticated()
  @HttpCode(200)
  async webauthnAuthenticate(@Body(zbody(WebAuthnVerifyBody)) body: { response: Record<string, unknown> }, @CurrentActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Ctx() ctx: RequestContext) {
    const r = await this.mfa.webauthnAuthenticate(actor.userId, actor.sessionId, body.response)
    await this.remember(actor.sessionId, req, res, ctx)
    return r
  }
}
