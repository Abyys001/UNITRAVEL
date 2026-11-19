import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import {
  FlightBuilderSettingsPatch, FlightBuilderStatus, ProviderAuthorisationInput, ProviderAuthorisationRevokeInput, ProviderAuthorisationView, RefreshRequest, SyncRunView,
} from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, DevSurface, RequirePermission, type RequestContext, StaffOnly, StepUp } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { FlightBuilderJobsService } from "./flight-builder-jobs.service"
import { FlightBuilderService } from "./flight-builder.service"

/**
 * ADR-0037 Developer Panel API. Credentials use the existing `PUT v1/dev/providers/flight-builder/credentials`. Nothing here fetches the panel URL.
 * Suffixes differ from `:id/test`, `:id/runs` and `:id/usage` of the generic provider controller, so no route clashes.
 */
@ApiTags("dev")
@Controller("v1/dev/providers/flight-builder")
@DevSurface()
@StaffOnly()
export class FlightBuilderDevController {
  constructor(private readonly fb: FlightBuilderService, private readonly jobs: FlightBuilderJobsService) {}

  @Get("state")
  @RequirePermission("provider.config.read")
  @ApiZodResponse(200, FlightBuilderStatus)
  state() {
    return this.fb.state()
  }

  @Patch("settings")
  @RequirePermission("provider.config.write")
  @ApiZodBody(FlightBuilderSettingsPatch)
  @ApiZodResponse(200, FlightBuilderStatus)
  async patchSettings(@Body(zbody(FlightBuilderSettingsPatch)) body: FlightBuilderSettingsPatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const out = await this.fb.patchSettings(body, actor, ctx.id)
    await this.jobs.applySchedule()
    return out
  }

  @Post("authorisations")
  @RequirePermission("provider.authorisation.record")
  @StepUp()
  @ApiZodBody(ProviderAuthorisationInput)
  @ApiZodResponse(201, ProviderAuthorisationView)
  authorise(@Body(zbody(ProviderAuthorisationInput)) body: ProviderAuthorisationInput, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.fb.recordAuthorisation(body, actor, ctx.id)
  }

  @Post("authorisations/:id/revoke")
  @RequirePermission("provider.authorisation.record")
  @StepUp()
  @HttpCode(200)
  @ApiZodBody(ProviderAuthorisationRevokeInput)
  @ApiZodResponse(200, ProviderAuthorisationView)
  async revoke(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(ProviderAuthorisationRevokeInput)) body: z.infer<typeof ProviderAuthorisationRevokeInput>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const out = await this.fb.revokeAuthorisation(id, body.reason, actor, ctx.id)
    // Revoking may close the gate for a scheduled sync that was already on; settings stay as they are, the next run records BLOCKED.
    return out
  }

  @Get("sync-runs")
  @RequirePermission("provider.config.read")
  @ApiZodResponse(200, z.array(SyncRunView))
  syncRuns() {
    return this.fb.syncRuns()
  }

  /** Validates the scope, writes a BLOCKED run and answers 409 SOURCE_NOT_AUTHORISED or NO_ADAPTER. No provider is called. */
  @Post("refresh")
  @RequirePermission("provider.config.write")
  @StepUp()
  @HttpCode(200)
  @ApiZodBody(RefreshRequest)
  async refresh(@Body(zbody(RefreshRequest)) body: RefreshRequest, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.fb.refresh(body, actor, ctx.id)
  }
}
