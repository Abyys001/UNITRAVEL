import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request } from "express"

import { PublicTrackView, TrackItem, TrackLookupBody, TrackLookupResult, TrackVerifyBody } from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, Public, RateLimit, type RequestContext, RequirePermission } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { TrackService } from "./track.service"

@ApiTags("track")
@Controller("v1/track")
export class TrackController {
  constructor(private readonly track: TrackService) {}

  /** The signed-in customer's flight requests, cargo requests, service requests and invoices in one list, own rows only. */
  @Get()
  @RequirePermission("flight_request.read.own")
  @ApiZodResponse(200, TrackItem.array())
  mine(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.track.mine(actor.userId, ctx.locale)
  }

  /** Always 202 with the same body, whether or not the reference and phone matched. Limits and proof of work as OTP sign-in. */
  @Post("lookup")
  @Public()
  @HttpCode(202)
  @RateLimit({ name: "track-lookup", limit: 120, windowSeconds: 600, key: "ip" })
  @ApiZodBody(TrackLookupBody)
  @ApiZodResponse(202, TrackLookupResult)
  lookup(@Body(zbody(TrackLookupBody)) body: TrackLookupBody, @Req() req: Request, @Ctx() ctx: RequestContext) {
    return this.track.lookup(body, { ip: req.ip ?? "", locale: ctx.locale, requestId: ctx.id })
  }

  /** The status timeline only: no names, passport data, amounts or documents. */
  @Post("verify")
  @Public()
  @HttpCode(200)
  @RateLimit({ name: "track-verify", limit: 120, windowSeconds: 600, key: "ip" })
  @ApiZodBody(TrackVerifyBody)
  @ApiZodResponse(200, PublicTrackView)
  verify(@Body(zbody(TrackVerifyBody)) body: TrackVerifyBody, @Req() req: Request, @Ctx() ctx: RequestContext) {
    return this.track.verify(body, { ip: req.ip ?? "", locale: ctx.locale, requestId: ctx.id })
  }
}
