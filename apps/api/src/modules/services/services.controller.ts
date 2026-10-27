import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { CreateServiceRequestBody, CustomerServiceRequestView, MessageBody, ServiceCancelBody, ServiceRequestListQuery, ServiceRequestSummary, ServiceTransitionBody, StaffServiceRequestPage, StaffServiceRequestView } from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, Idempotent, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { ServicesService } from "./services.service"

const via = (a: Actor) => (a.audience === "mobile" ? "MOBILE" : a.audience === "console" ? "CONSOLE" : "WEB") as "WEB" | "MOBILE" | "CONSOLE"

/** Customer endpoints (ADR-0015): ownership is checked on every lookup and a miss is 404. A flag that is off answers FEATURE_DISABLED. */
@ApiTags("service-requests")
@Controller("v1/service-requests")
export class CustomerServiceRequestsController {
  constructor(private readonly services: ServicesService) {}

  @Post()
  @RequirePermission("service_request.create.own")
  @Idempotent()
  @RateLimit({ name: "customer-writes", limit: 60, windowSeconds: 3600, key: "user" })
  @ApiZodBody(CreateServiceRequestBody)
  create(@Body(zbody(CreateServiceRequestBody)) body: z.infer<typeof CreateServiceRequestBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.services.create(body, actor, { requestId: ctx.id, locale: ctx.locale, via: via(actor) })
  }

  @Get()
  @RequirePermission("service_request.read.own")
  @ApiZodResponse(200, ServiceRequestSummary.array())
  list(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.services.customerList(actor.userId, ctx.locale)
  }

  @Get(":ref")
  @RequirePermission("service_request.read.own")
  @ApiZodResponse(200, CustomerServiceRequestView)
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.services.customerDetail(ref, actor, ctx.locale)
  }

  @Post(":ref/cancel")
  @RequirePermission("service_request.read.own")
  @HttpCode(200)
  @ApiZodBody(ServiceCancelBody)
  @ApiZodResponse(200, CustomerServiceRequestView)
  async cancel(@Param("ref") ref: string, @Body(zbody(ServiceCancelBody)) body: z.infer<typeof ServiceCancelBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.services.customerCancel(ref, actor, body.reason)
    return this.services.customerDetail(ref, actor, ctx.locale)
  }

  @Post(":ref/messages")
  @RequirePermission("service_request.read.own")
  @RateLimit({ name: "customer-writes", limit: 60, windowSeconds: 3600, key: "user" })
  @ApiZodBody(MessageBody)
  message(@Param("ref") ref: string, @Body(zbody(MessageBody)) body: z.infer<typeof MessageBody>, @CurrentActor() actor: Actor) {
    return this.services.customerMessage(ref, actor, body.body, body.documentIds)
  }

  /** Accepts the quote that is currently sent; the customer never names a quote id, so an old or foreign one cannot be accepted. */
  @Post(":ref/quote/accept")
  @RequirePermission("service_request.read.own")
  @HttpCode(200)
  @ApiZodResponse(200, CustomerServiceRequestView)
  async accept(@Param("ref") ref: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.services.customerAccept(ref, actor)
    return this.services.customerDetail(ref, actor, ctx.locale)
  }
}

@ApiTags("admin-service-requests")
@Controller("v1/admin/service-requests")
@StaffOnly()
export class AdminServiceRequestsController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermission("service_request.read.any")
  @ApiZodResponse(200, StaffServiceRequestPage)
  list(@Query(zbody(ServiceRequestListQuery)) q: z.infer<typeof ServiceRequestListQuery>, @CurrentActor() actor: Actor) {
    return this.services.adminList(q, actor)
  }

  @Get(":ref")
  @RequirePermission("service_request.read.any")
  @ApiZodResponse(200, StaffServiceRequestView)
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.services.staffDetail(ref, actor)
  }

  /** A command, not a field edit (ch. 15.1): optimistic `expectedVersion`; the machine decides, per command, which permission is needed. */
  @Post(":ref/transition")
  @RequirePermission("service_request.write", "compliance.case.decide")
  @HttpCode(200)
  @ApiZodBody(ServiceTransitionBody)
  @ApiZodResponse(200, StaffServiceRequestView)
  transition(@Param("ref") ref: string, @Body(zbody(ServiceTransitionBody)) body: z.infer<typeof ServiceTransitionBody>, @CurrentActor() actor: Actor) {
    return this.services.staffCommand(ref, body.command, body.input, actor, body.expectedVersion)
  }

  @Post(":ref/messages")
  @RequirePermission("service_request.write")
  @ApiZodBody(MessageBody)
  message(@Param("ref") ref: string, @Body(zbody(MessageBody)) body: z.infer<typeof MessageBody>, @CurrentActor() actor: Actor) {
    return this.services.staffMessage(ref, actor, body.body, body.documentIds)
  }
}
