import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import {
  ApifyApplyCapResult, ApifyIntegrationTest, BudgetEstimate, CatalogCoverage, CatalogPauseBody, CatalogResultsResponse, CatalogSettingsPatch, CatalogSettingsResponse, CatalogUsage,
  RecheckStart, RecheckStatus, SlotRefreshConfirm, SlotRefreshQuote, WatchRouteInput, WatchRoutePatch, WatchRoute, WatchRoutesResponse,
} from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, RequirePermission, type RequestContext, StaffOnly, StepUp } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { CatalogAdminService } from "./catalog-admin.service"
import { CatalogRefreshService } from "./catalog-refresh.service"

const who = (a: Actor) => ({ userId: a.userId, ip: a.ip })
const uuid = zbody(z.uuid())

/**
 * ADR-0034: the catalog admin API. Reads need `catalog.read` (prices are staff-side); anything that changes settings or spends the
 * Apify budget needs `catalog.manage`, and a spend also needs a fresh second factor.
 */
@ApiTags("admin-catalog")
@Controller("v1/admin/catalog")
@StaffOnly()
export class CatalogAdminController {
  constructor(private readonly admin: CatalogAdminService, private readonly refresh: CatalogRefreshService) {}

  @Get("usage")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, CatalogUsage)
  usage() {
    return this.admin.usage()
  }

  @Get("coverage")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, CatalogCoverage)
  coverage() {
    return this.admin.coverage()
  }

  @Get("settings")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, CatalogSettingsResponse)
  settings() {
    return this.admin.settingsView()
  }

  @Patch("settings")
  @RequirePermission("catalog.manage")
  @ApiZodBody(CatalogSettingsPatch)
  @ApiZodResponse(200, CatalogSettingsResponse)
  patchSettings(@Body(zbody(CatalogSettingsPatch)) body: CatalogSettingsPatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.admin.patchSettings(body, who(actor), ctx.id)
  }

  /** The budget calculator: the merged settings through the same estimate, nothing saved. */
  @Post("estimate")
  @RequirePermission("catalog.read")
  @HttpCode(200)
  @ApiZodBody(CatalogSettingsPatch)
  @ApiZodResponse(200, BudgetEstimate)
  estimate(@Body(zbody(CatalogSettingsPatch)) body: CatalogSettingsPatch) {
    return this.admin.previewEstimate(body)
  }

  @Get("routes")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, WatchRoutesResponse)
  async routes() {
    return { routes: await this.admin.listRoutes() }
  }

  @Post("routes")
  @RequirePermission("catalog.manage")
  @ApiZodBody(WatchRouteInput)
  @ApiZodResponse(201, WatchRoute)
  createRoute(@Body(zbody(WatchRouteInput)) body: z.infer<typeof WatchRouteInput>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.admin.createRoute(body, who(actor), ctx.id)
  }

  @Patch("routes/:id")
  @RequirePermission("catalog.manage")
  @ApiZodBody(WatchRoutePatch)
  @ApiZodResponse(200, WatchRoute)
  patchRoute(@Param("id", uuid) id: string, @Body(zbody(WatchRoutePatch)) body: z.infer<typeof WatchRoutePatch>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.admin.patchRoute(id, body, who(actor), ctx.id)
  }

  @Post("pause")
  @RequirePermission("catalog.manage")
  @HttpCode(200)
  @ApiZodBody(CatalogPauseBody)
  @ApiZodResponse(200, CatalogUsage)
  pause(@Body(zbody(CatalogPauseBody)) _body: z.infer<typeof CatalogPauseBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.admin.pause(who(actor), ctx.id)
  }

  @Post("resume")
  @RequirePermission("catalog.manage")
  @HttpCode(200)
  @ApiZodResponse(200, CatalogUsage)
  resume(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.admin.resume(who(actor), ctx.id)
  }

  /** Step 1 of "refresh this slot now": the cost against the admin reserve, and a confirm token. Spends nothing. */
  @Post("slots/:id/refresh/quote")
  @RequirePermission("catalog.manage")
  @HttpCode(200)
  @ApiZodResponse(200, SlotRefreshQuote)
  quote(@Param("id", uuid) id: string, @CurrentActor() actor: Actor) {
    return this.refresh.quoteSlotRefresh(id, actor.userId)
  }

  @Post("slots/:id/refresh")
  @RequirePermission("catalog.manage")
  @StepUp()
  @HttpCode(202)
  @ApiZodBody(SlotRefreshConfirm)
  @ApiZodResponse(202, RecheckStart)
  refreshNow(@Param("id", uuid) id: string, @Body(zbody(SlotRefreshConfirm)) body: z.infer<typeof SlotRefreshConfirm>, @CurrentActor() actor: Actor) {
    return this.refresh.confirmSlotRefresh(id, body.confirmToken, actor.userId)
  }

  @Get("slots/:id/results")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, CatalogResultsResponse)
  async results(@Param("id", uuid) id: string) {
    return { results: await this.admin.slotResults(id) }
  }

  /** Progress of a refresh-now or revalidation run. */
  @Get("jobs/:jobId")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, RecheckStatus)
  job(@Param("jobId", uuid) jobId: string) {
    return this.refresh.revalidateStatus(jobId)
  }

  /** One live run for this result's route-date(s), charged to the admin reserve; the fresh rows are written back to the slot. */
  @Post("results/:id/revalidate")
  @RequirePermission("catalog.manage")
  @StepUp()
  @HttpCode(202)
  @ApiZodResponse(202, RecheckStart)
  revalidate(@Param("id", uuid) id: string) {
    return this.refresh.revalidateResult(id)
  }
}

/** Developer Panel: Apify integration checks. `provider.config.*` because they act on the stored credential and the account. */
@ApiTags("admin-integrations")
@Controller("v1/admin/integrations/apify")
@StaffOnly()
export class ApifyIntegrationController {
  constructor(private readonly admin: CatalogAdminService) {}

  @Post("test")
  @RequirePermission("provider.config.read")
  @HttpCode(200)
  @ApiZodResponse(200, ApifyIntegrationTest)
  test() {
    return this.admin.testApify()
  }

  /** Sets Apify's own monthly cap to the catalog budget. Audited, needs a fresh second factor, and is pressed by the owner only. */
  @Post("apply-cap")
  @RequirePermission("provider.config.write")
  @StepUp()
  @HttpCode(200)
  @ApiZodResponse(200, ApifyApplyCapResult)
  applyCap(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.admin.applyCap(who(actor), ctx.id)
  }
}
