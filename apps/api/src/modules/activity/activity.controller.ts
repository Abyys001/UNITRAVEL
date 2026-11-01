import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request } from "express"
import { z } from "zod"

import { ActivityBody, CustomerActivityView, CustomerListPage, CustomerListQuery } from "@unitravel/contracts"

import { type Actor, Authenticated, Ctx, CurrentActor, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { ActivityService } from "./activity.service"

/** Screen telemetry from the web and Flutter clients (ADR-0018). 204 whether or not a row was stored, so the client learns nothing about the opt-out. */
@ApiTags("me")
@Controller("v1/me/activity")
export class MeActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Post()
  @Authenticated()
  @HttpCode(204)
  @RateLimit({ name: "me-activity", limit: 120, windowSeconds: 60, key: "user" })
  @ApiZodBody(ActivityBody)
  async report(@Body(zbody(ActivityBody)) body: ActivityBody, @CurrentActor() actor: Actor, @Req() req: Request) {
    await this.activity.recordScreen(actor, body, { dnt: req.header("dnt"), gpc: req.header("sec-gpc") })
  }
}

@ApiTags("admin-customers")
@Controller("v1/admin/customers")
@StaffOnly()
export class AdminCustomerListController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @RequirePermission("customer.read")
  @ApiZodResponse(200, CustomerListPage)
  list(@Query(zbody(CustomerListQuery)) q: CustomerListQuery) {
    return this.activity.customers(q)
  }

  @Get(":id/activity")
  @RequirePermission("customer.read")
  @ApiZodResponse(200, CustomerActivityView)
  activityOf(@Param("id", zbody(z.uuid())) id: string, @Query(zbody(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }))) q: { limit: number; cursor?: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.activity.activityOf(id, q, actor, ctx.id)
  }
}
