import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { FareStatus, FlightBuilderCaptureInput, FlightBuilderUsage, Iata, IsoDate, StaffFlightBuilderOption, UsageObservationInput, UsageObservationView } from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, RequirePermission, type RequestContext, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { FlightBuilderService } from "./flight-builder.service"

const OptionsQuery = z.object({
  from: Iata.optional(),
  to: Iata.optional(),
  date: IsoDate.optional(),
  status: FareStatus.optional(),
  current: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/**
 * ADR-0037: staff record what they saw on the Flight Builder panel. Nothing here calls the panel. Price, fare type basis and rules come
 * back only to callers holding `pricing.read.internal` (the service decides per call; the permission here only opens the route).
 */
@ApiTags("admin-flight-builder")
@Controller("v1/admin/flight-builder")
@StaffOnly()
export class FlightBuilderAdminController {
  constructor(private readonly fb: FlightBuilderService) {}

  @Post("options")
  @RequirePermission("catalog.capture")
  @ApiZodBody(FlightBuilderCaptureInput)
  @ApiZodResponse(201, StaffFlightBuilderOption)
  capture(@Body(zbody(FlightBuilderCaptureInput)) body: FlightBuilderCaptureInput, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.fb.capture(body, actor, ctx.id)
  }

  @Get("options")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, z.array(StaffFlightBuilderOption))
  list(@Query(zbody(OptionsQuery)) q: z.infer<typeof OptionsQuery>, @CurrentActor() actor: Actor) {
    return this.fb.options(q, actor)
  }

  @Get("options/:id")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, StaffFlightBuilderOption)
  get(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.fb.option(id, actor)
  }

  @Post("options/:id/retire")
  @RequirePermission("catalog.capture")
  @HttpCode(200)
  @ApiZodResponse(200, StaffFlightBuilderOption)
  retire(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.fb.retire(id, actor, ctx.id)
  }

  @Get("usage")
  @RequirePermission("catalog.read")
  @ApiZodResponse(200, FlightBuilderUsage)
  usage() {
    return this.fb.usage()
  }

  @Post("usage")
  @RequirePermission("catalog.capture")
  @ApiZodBody(UsageObservationInput)
  @ApiZodResponse(201, UsageObservationView)
  recordUsage(@Body(zbody(UsageObservationInput)) body: UsageObservationInput, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.fb.recordUsage(body, actor, ctx.id)
  }
}
