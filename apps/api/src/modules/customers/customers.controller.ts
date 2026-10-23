import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { TravellerInput } from "@unitravel/contracts"

import { type Actor, Authenticated, Ctx, CurrentActor, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { CustomersService } from "./customers.service"

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
  update(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(TravellerInput.partial())) body: Partial<z.infer<typeof TravellerInput>>, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.customers.update(actor.userId, id, body, { requestId: ctx.id, ip: actor.ip })
  }

  @Delete(":id")
  @Authenticated()
  @HttpCode(204)
  async remove(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    await this.customers.remove(actor.userId, id)
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
