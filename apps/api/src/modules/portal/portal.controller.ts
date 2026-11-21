import { Controller, Get, Param, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"

import { PortalOverview, TrackDetail, TrackSearchQuery, TrackSearchResult, UnreadCounts } from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, RateLimit, type RequestContext, RequirePermission } from "../../core/http/decorators"
import { ApiZodResponse, zbody } from "../../core/http/zod"
import { PortalService } from "./portal.service"

/** ADR-0040: the signed-in customer's portal views. Own records only; another customer's reference answers 404. */
@ApiTags("portal")
@Controller("v1")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get("me/overview")
  @RequirePermission("flight_request.read.own")
  @ApiZodResponse(200, PortalOverview)
  overview(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.portal.overview(actor, ctx.locale)
  }

  @Get("me/unread")
  @RequirePermission("flight_request.read.own")
  @ApiZodResponse(200, UnreadCounts)
  unread(@CurrentActor() actor: Actor) {
    return this.portal.unread(actor.userId)
  }

  /** Declared before `track/:ref` so it wins the match. */
  @Get("track/search")
  @RequirePermission("flight_request.read.own")
  @RateLimit({ name: "track-search", limit: 60, windowSeconds: 600, key: "user" })
  @ApiZodResponse(200, TrackSearchResult)
  search(@Query(zbody(TrackSearchQuery)) q: { q: string }, @CurrentActor() actor: Actor) {
    return this.portal.search(actor.userId, q.q)
  }

  @Get("track/:ref")
  @RequirePermission("flight_request.read.own")
  @ApiZodResponse(200, TrackDetail)
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.portal.track(ref, actor, ctx.locale)
  }
}
