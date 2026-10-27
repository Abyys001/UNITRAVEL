import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import type { Response } from "express"
import { z } from "zod"

import { AttachScanBody, ConfirmIdentityBody, DecideVerificationBody, TravellerInput, TravellerPatch, UpdateDetailsBody } from "@unitravel/contracts"

import { type Actor, Authenticated, Ctx, CurrentActor, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { CustomersService } from "./customers.service"
import { IdentityVerificationService } from "./identity-verification.service"

@ApiTags("travellers")
@Controller("v1/me/travellers")
export class TravellersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Authenticated()
  list(@CurrentActor() actor: Actor) {
    return this.customers.list(actor.userId)
  }

  @Post()
  @Authenticated()
  create(@Body(zbody(TravellerInput)) body: z.infer<typeof TravellerInput>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.create(actor.userId, body, { requestId: ctx.id, ip: actor.ip })
  }

  @Patch(":id")
  @Authenticated()
  update(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(TravellerPatch)) body: TravellerPatch, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.update(actor.userId, id, body, { requestId: ctx.id, ip: actor.ip })
  }

  @Delete(":id")
  @Authenticated()
  @HttpCode(204)
  async remove(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    await this.customers.remove(actor.userId, id)
  }
}

@ApiTags("travellers")
@Controller("v1/me")
export class MyDetailsController {
  constructor(private readonly customers: CustomersService) {}

  /** My details: profile, optional address, verified contact methods and my own traveller profile with its verification (ADR-0005). */
  @Get("details")
  @Authenticated()
  details(@CurrentActor() actor: Actor) {
    return this.customers.details(actor.userId)
  }

  @Patch("details")
  @Authenticated()
  update(@Body(zbody(UpdateDetailsBody)) body: z.infer<typeof UpdateDetailsBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.updateDetails(actor.userId, body, { requestId: ctx.id, ip: actor.ip })
  }

  /** Links a clean PASSPORT_SCAN upload to the traveller's document; a replacement is a material change. */
  @Post("travellers/:id/identity/scan")
  @Authenticated()
  @HttpCode(200)
  attachScan(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(AttachScanBody)) body: z.infer<typeof AttachScanBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.attachScan(actor.userId, id, body.documentId, { requestId: ctx.id, ip: actor.ip })
  }

  /** Review then confirm: moves the document to SUBMITTED for staff review. */
  @Post("travellers/:id/identity/confirm")
  @Authenticated()
  @HttpCode(200)
  confirm(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(ConfirmIdentityBody)) body: z.infer<typeof ConfirmIdentityBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.confirmIdentity(actor.userId, id, body.reviewHash, { requestId: ctx.id, ip: actor.ip })
  }
}

@ApiTags("admin")
@Controller("v1/admin/verifications")
@StaffOnly()
export class AdminVerificationsController {
  constructor(private readonly verification: IdentityVerificationService) {}

  @Get()
  @RequirePermission("identity.verify")
  queue() {
    return this.verification.queue()
  }

  /** Fields next to the scan reference; the scan opens through the audited download route and the passport number through Reveal. */
  @Get(":id")
  @RequirePermission("identity.verify")
  detail(@Param("id", zbody(z.uuid())) id: string) {
    return this.verification.detail(id)
  }

  /** The scan as bytes for inline display (audited; sandboxed so it can never run as a page). */
  @Get(":id/scan")
  @RequirePermission("identity.verify")
  async scan(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const { body, mime } = await this.verification.scanBytes(id, actor, ctx.id)
    res.status(200).set({ "content-type": mime, "content-disposition": "inline", "x-content-type-options": "nosniff", "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'" }).send(body)
  }

  @Post(":id/decide")
  @RequirePermission("identity.verify")
  @HttpCode(200)
  decide(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(DecideVerificationBody)) body: z.infer<typeof DecideVerificationBody>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.verification.decide(id, body, actor, ctx.id)
  }
}

@ApiTags("admin")
@Controller("v1/admin/customers")
@StaffOnly()
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get(":id")
  @RequirePermission("customer.read.pii")
  context(@Param("id", zbody(z.uuid())) id: string) {
    return this.customers.context(id)
  }

  /** Passport numbers are masked until Reveal, which is logged (customer.read.documents). */
  @Post("travellers/:travellerId/reveal-document")
  @RequirePermission("customer.read.documents")
  @HttpCode(200)
  reveal(@Param("travellerId", zbody(z.uuid())) travellerId: string, @Body(zbody(z.object({ ref: z.string().optional() }))) body: { ref?: string }, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.reveal(travellerId, actor, ctx.id, body.ref)
  }
}
