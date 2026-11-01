import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Request } from "express"
import {
  CallListQuery, CallLogBody, CallLogPage, CallLogView, ClickToCallBody, CreateTicketBody, CustomerTicketSummary, CustomerTicketView, StaffReplyBody, StaffTicketCommandBody, StaffTicketListQuery, StaffTicketPage,
  StaffTicketView, TicketCreated, TicketReplyBody,
} from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Authenticated, Ctx, CurrentActor, Idempotent, OptionalActor, Public, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { CallsService } from "./calls.service"
import { SupportService } from "./support.service"

/** Public contact form and the signed-in customer's own tickets (plan J5). A foreign or unknown ticket is 404. */
@ApiTags("support")
@Controller("v1/support/tickets")
export class SupportTicketsController {
  constructor(private readonly support: SupportService) {}

  /** Open to everyone; a signed-in customer's ticket is tied to their account. Idempotent by Idempotency-Key; proof of work after a burst. */
  @Post()
  @Public()
  @HttpCode(201)
  @Idempotent()
  @ApiZodBody(CreateTicketBody)
  @ApiZodResponse(201, TicketCreated)
  create(@Body(zbody(CreateTicketBody)) body: CreateTicketBody, @Req() req: Request, @Ctx() ctx: RequestContext, @OptionalActor() actor?: Actor) {
    return this.support.create(body, { ip: req.ip ?? "", requestId: ctx.id, actor })
  }

  @Get()
  @Authenticated()
  @ApiZodResponse(200, CustomerTicketSummary.array())
  list(@CurrentActor() actor: Actor) {
    return this.support.customerList(actor.userId)
  }

  @Get(":ref")
  @Authenticated()
  @ApiZodResponse(200, CustomerTicketView)
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.support.customerDetail(ref, actor.userId)
  }

  @Post(":ref/messages")
  @Authenticated()
  @HttpCode(200)
  @RateLimit({ name: "support-reply", limit: 30, windowSeconds: 3600, key: "user" })
  @ApiZodBody(TicketReplyBody)
  @ApiZodResponse(200, CustomerTicketView)
  reply(@Param("ref") ref: string, @Body(zbody(TicketReplyBody)) body: TicketReplyBody, @CurrentActor() actor: Actor) {
    return this.support.customerReply(ref, actor, body.body)
  }
}

@ApiTags("admin-support")
@Controller("v1/admin/support/tickets")
@StaffOnly()
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermission("support.read")
  @ApiZodResponse(200, StaffTicketPage)
  list(@Query(zbody(StaffTicketListQuery)) q: StaffTicketListQuery, @CurrentActor() actor: Actor) {
    return this.support.staffList(q, actor)
  }

  @Get(":ref")
  @RequirePermission("support.read")
  @ApiZodResponse(200, StaffTicketView)
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.support.staffDetail(ref, actor)
  }

  /** `internal: true` stores a note nobody outside the team sees; otherwise the reply is emailed to the contact through the outbox. */
  @Post(":ref/replies")
  @RequirePermission("support.reply")
  @HttpCode(200)
  @ApiZodBody(StaffReplyBody)
  @ApiZodResponse(200, StaffTicketView)
  reply(@Param("ref") ref: string, @Body(zbody(StaffReplyBody)) body: StaffReplyBody, @CurrentActor() actor: Actor) {
    return this.support.staffReply(ref, actor, body.body, body.internal)
  }

  /** A command, not a field edit: the machine decides (assign, resolve, reopen, close). */
  @Post(":ref/commands")
  @RequirePermission("support.reply")
  @HttpCode(200)
  @ApiZodBody(StaffTicketCommandBody)
  @ApiZodResponse(200, StaffTicketView)
  command(@Param("ref") ref: string, @Body(zbody(StaffTicketCommandBody)) body: StaffTicketCommandBody, @CurrentActor() actor: Actor) {
    return this.support.staffCommand(ref, body, actor)
  }
}

@ApiTags("admin-support")
@Controller("v1/admin/calls")
@StaffOnly()
export class AdminCallsController {
  constructor(private readonly calls: CallsService) {}

  @Get()
  @RequirePermission("call.log")
  @ApiZodResponse(200, CallLogPage)
  list(@Query(zbody(CallListQuery)) q: CallListQuery) {
    return this.calls.list(q)
  }

  @Post()
  @RequirePermission("call.log")
  @HttpCode(201)
  @ApiZodBody(CallLogBody)
  @ApiZodResponse(201, CallLogView)
  record(@Body(zbody(CallLogBody)) body: CallLogBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.calls.record(body, actor, ctx.id)
  }

  /** Answers 501 NOT_CONFIGURED until the Bonline API is implemented (ADR-0019). */
  @Post("click-to-call")
  @RequirePermission("call.log")
  @HttpCode(200)
  @RateLimit({ name: "click-to-call", limit: 30, windowSeconds: 600, key: "user" })
  @ApiZodBody(ClickToCallBody)
  clickToCall(@Body(zbody(ClickToCallBody)) body: ClickToCallBody, @CurrentActor() actor: Actor) {
    return this.calls.clickToCall(body, actor)
  }
}

/** Signed vendor webhook: no session; the signature on the raw body is the authentication (ADR-0019). */
@ApiTags("webhooks")
@Controller("v1/webhooks")
export class BonlineWebhookController {
  constructor(private readonly calls: CallsService) {}

  @Post("bonline")
  @Public()
  @HttpCode(200)
  @RateLimit({ name: "bonline-webhook", limit: 600, windowSeconds: 60, key: "ip" })
  bonline(@Req() req: Request & { rawBody?: Buffer }, @Ctx() ctx: RequestContext) {
    if (!req.rawBody) throw new AppError("SIGNATURE_INVALID", "The raw request body is unavailable")
    return this.calls.ingest(req.rawBody, { "x-bonline-signature": req.header("x-bonline-signature") }, ctx.id)
  }
}
