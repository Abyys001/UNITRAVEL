import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { AvailabilityBody, CARGO_COMMANDS, CargoCommandBodies, CargoQuoteBody, ContactAttemptBody, CreateCargoRequestBody, LaneUpsertBody, MessageBody, NoteBody, PartnerBody, TrackingEventBody } from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Ctx, CurrentActor, DevSurface, Idempotent, Public, RateLimit, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { AccessService } from "../access/access.service"
import { RequestsService } from "../requests/requests.service"
import { CargoService } from "./cargo.service"

const ifMatch = (v?: string) => (v ? Number(v.replace(/"/g, "")) : undefined)

@ApiTags("cargo")
@Controller("v1")
export class CustomerCargoController {
  constructor(private readonly cargo: CargoService, private readonly requests: RequestsService) {}

  @Get("cargo/lanes")
  @Public()
  lanes(@Ctx() ctx: RequestContext) {
    return this.cargo.publicLanes(ctx.locale)
  }

  /** "My requests": every flight and cargo request with its customer-facing status (ch. 11.5). */
  @Get("requests")
  @RequirePermission("flight_request.read.own", "cargo_request.read.own")
  async all(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    const [f, c] = await Promise.all([this.requests.customerList(actor.userId, ctx.locale), this.cargo.customerList(actor.userId, ctx.locale)])
    return [...f, ...c].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  }

  @Post("cargo-requests")
  @RequirePermission("cargo_request.create.own")
  @Idempotent()
  @RateLimit({ name: "customer-writes", limit: 60, windowSeconds: 3600, key: "user" })
  create(@Body(zbody(CreateCargoRequestBody)) body: z.infer<typeof CreateCargoRequestBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cargo.create(body, actor, { requestId: ctx.id, locale: ctx.locale })
  }

  @Get("cargo-requests")
  @RequirePermission("cargo_request.read.own")
  list(@CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cargo.customerList(actor.userId, ctx.locale)
  }

  @Get("cargo-requests/:ref")
  @RequirePermission("cargo_request.read.own")
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.cargo.customerDetail(ref, actor, ctx.locale)
  }

  @Post("cargo-requests/:ref/messages")
  @RequirePermission("cargo_request.read.own")
  message(@Param("ref") ref: string, @Body(zbody(MessageBody)) body: z.infer<typeof MessageBody>, @CurrentActor() actor: Actor) {
    return this.cargo.customerMessage(ref, actor, body.body, body.documentIds)
  }

  @Post("cargo-requests/:ref/quotes/:quoteId/accept")
  @RequirePermission("cargo_request.read.own")
  @HttpCode(200)
  async accept(@Param("ref") ref: string, @Param("quoteId", zbody(z.uuid())) quoteId: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.cargo.customerAccept(ref, quoteId, actor)
    return this.cargo.customerDetail(ref, actor, ctx.locale)
  }

  @Post("cargo-requests/:ref/cancel")
  @RequirePermission("cargo_request.read.own")
  @HttpCode(200)
  async cancel(@Param("ref") ref: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    await this.cargo.customerCancel(ref, actor)
    return this.cargo.customerDetail(ref, actor, ctx.locale)
  }
}

@ApiTags("admin-cargo")
@Controller("v1/admin/cargo")
@StaffOnly()
export class AdminCargoController {
  constructor(private readonly cargo: CargoService, private readonly access: AccessService) {}

  @Get("requests")
  @RequirePermission("cargo_request.read.any")
  list(@Query(zbody(z.object({ tab: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().optional() }))) q: { tab?: string; status?: string; limit: number; cursor?: string }) {
    return this.cargo.adminList(q)
  }

  @Get("requests/:ref")
  @RequirePermission("cargo_request.read.any")
  detail(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.cargo.staffDetail(ref, actor)
  }

  @Post("requests/:ref/commands/:command")
  @RequirePermission("cargo_request.transition", "compliance.case.decide")
  @HttpCode(200)
  async command(@Param("ref") ref: string, @Param("command") command: string, @Body() raw: unknown, @Headers("if-match") im: string | undefined, @CurrentActor() actor: Actor) {
    if (!(CARGO_COMMANDS as readonly string[]).includes(command)) throw new AppError("NOT_FOUND", "Unknown command")
    const body = CargoCommandBodies[command as keyof typeof CargoCommandBodies].parse(raw ?? {}) as Record<string, unknown>
    await this.cargo.staffCommand(ref, command as never, body, actor, ifMatch(im))
    return this.cargo.staffDetail(ref, actor)
  }

  @Post("requests/:ref/quotes")
  @RequirePermission("cargo_request.transition")
  quote(@Param("ref") ref: string, @Body(zbody(CargoQuoteBody)) body: z.infer<typeof CargoQuoteBody>, @CurrentActor() actor: Actor) {
    return this.cargo.draftQuote(ref, body as never, actor)
  }

  @Post("requests/:ref/tracking-events")
  @RequirePermission("cargo_request.transition")
  tracking(@Param("ref") ref: string, @Body(zbody(TrackingEventBody)) body: z.infer<typeof TrackingEventBody>, @CurrentActor() actor: Actor) {
    return this.cargo.trackingEvent(ref, body, actor)
  }

  @Post("requests/:ref/notes")
  @RequirePermission("flight_request.note.internal", "cargo_request.transition")
  note(@Param("ref") ref: string, @Body(zbody(NoteBody)) body: { body: string }, @CurrentActor() actor: Actor) {
    return this.cargo.note(ref, actor, body.body)
  }

  @Post("requests/:ref/messages")
  @RequirePermission("cargo_request.transition")
  message(@Param("ref") ref: string, @Body(zbody(MessageBody)) body: z.infer<typeof MessageBody>, @CurrentActor() actor: Actor) {
    return this.cargo.staffMessage(ref, actor, body.body, body.documentIds)
  }

  @Post("requests/:ref/contact-attempts")
  @RequirePermission("cargo_request.transition")
  contact(@Param("ref") ref: string, @Body(zbody(ContactAttemptBody)) body: z.infer<typeof ContactAttemptBody>, @CurrentActor() actor: Actor) {
    return this.cargo.contact(ref, actor, body)
  }

  @Post("requests/:ref/documents/generate")
  @RequirePermission("cargo_request.transition")
  @HttpCode(200)
  generate(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.cargo.generateDocuments(ref, actor)
  }

  @Get("partners")
  @RequirePermission("cargo_request.read.any")
  partners() {
    return this.cargo.partners()
  }

  @Post("partners")
  @RequirePermission("cargo_request.transition")
  createPartner(@Body(zbody(PartnerBody)) body: z.infer<typeof PartnerBody>, @CurrentActor() actor: Actor) {
    return this.cargo.upsertPartner(null, body, actor)
  }

  @Put("partners/:id")
  @RequirePermission("cargo_request.transition")
  updatePartner(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(PartnerBody)) body: z.infer<typeof PartnerBody>, @CurrentActor() actor: Actor) {
    return this.cargo.upsertPartner(id, body, actor)
  }

  @Get("availability")
  @RequirePermission("cargo_request.read.any")
  availability() {
    return this.cargo.availability()
  }

  @Post("availability")
  @RequirePermission("cargo_request.transition")
  addAvailability(@Body(zbody(AvailabilityBody)) body: z.infer<typeof AvailabilityBody>, @CurrentActor() actor: Actor) {
    return this.cargo.upsertAvailability(null, body, actor)
  }

  @Put("availability/:id")
  @RequirePermission("cargo_request.transition")
  updateAvailability(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(AvailabilityBody)) body: z.infer<typeof AvailabilityBody>, @CurrentActor() actor: Actor) {
    return this.cargo.upsertAvailability(id, body, actor)
  }

  @Get("lanes")
  @RequirePermission("cargo_request.read.any", "compliance.case.read")
  lanes() {
    return this.cargo.lanes()
  }

  /** Enabling an Iran lane needs owner + compliance approval with counsel's reference (ch. 14.2). */
  @Put("lanes/:id")
  @RequirePermission("compliance.case.decide", "user.role.assign.privileged")
  async updateLane(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(LaneUpsertBody.pick({ enabled: true, services: true, requiresComplianceApproval: true, volumetricDivisor: true, customerNotice: true, counselReference: true }))) body: never, @CurrentActor() actor: Actor) {
    const acc = await this.access.load(actor.userId)
    return this.cargo.updateLane(id, body, actor, acc.roles)
  }
}

/** Developer Panel view of lanes (configuration lives there; enabling Iran lanes still needs both approvals). */
@ApiTags("dev")
@Controller("v1/dev/cargo")
@DevSurface()
@StaffOnly()
export class DevCargoController {
  constructor(private readonly cargo: CargoService, private readonly access: AccessService) {}

  @Get("lanes")
  @RequirePermission("settings.write")
  lanes() {
    return this.cargo.lanes()
  }

  @Put("lanes/:id")
  @RequirePermission("settings.write")
  async update(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(LaneUpsertBody.pick({ enabled: true, services: true, requiresComplianceApproval: true, volumetricDivisor: true, customerNotice: true, counselReference: true }))) body: never, @CurrentActor() actor: Actor) {
    const acc = await this.access.load(actor.userId)
    return this.cargo.updateLane(id, body, actor, acc.roles)
  }
}
