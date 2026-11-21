import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"

import { CargoTrackingSettingsBody, CargoTrackingSettingsView, CargoTrackingSyncResult } from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, DevSurface, type RequestContext, RequirePermission, StaffOnly, StepUp } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { CarrierTrackingService } from "./carrier-tracking.service"

/** Developer Panel: TrackingMore on or off, its key (write-only) and the DPIA switch for deployed hosts (ADR-0040 D5). */
@ApiTags("dev")
@Controller("v1/dev/cargo-tracking")
@DevSurface()
@StaffOnly()
export class DevCargoTrackingController {
  constructor(private readonly carrier: CarrierTrackingService) {}

  @Get()
  @RequirePermission("provider.config.read")
  @ApiZodResponse(200, CargoTrackingSettingsView)
  view() {
    return this.carrier.view()
  }

  /** The key is stored encrypted and never returned; sending none keeps the stored one. */
  @Put()
  @RequirePermission("provider.config.write")
  @StepUp()
  @ApiZodBody(CargoTrackingSettingsBody)
  @ApiZodResponse(200, CargoTrackingSettingsView)
  update(@Body(zbody(CargoTrackingSettingsBody)) body: CargoTrackingSettingsBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.carrier.update(body, actor, ctx.id)
  }
}

/** Staff refresh of one shipment's carrier checkpoints (the poll job does the same on a schedule). */
@ApiTags("admin-cargo")
@Controller("v1/admin/cargo")
@StaffOnly()
export class AdminCarrierTrackingController {
  constructor(private readonly carrier: CarrierTrackingService) {}

  @Post("requests/:ref/carrier-sync")
  @RequirePermission("cargo_request.transition")
  @HttpCode(200)
  @ApiZodResponse(200, CargoTrackingSyncResult)
  sync(@Param("ref") ref: string) {
    return this.carrier.syncByRef(ref)
  }
}
