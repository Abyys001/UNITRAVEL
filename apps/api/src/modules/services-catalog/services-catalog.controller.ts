import { Body, Controller, Get, Header, Param, Patch, Post } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { CreateServiceCatalogItemBody, PublicServiceCatalogItem, ServiceCatalogItem, UpdateServiceCatalogItemBody } from "@unitravel/contracts"

import { type Actor, Ctx, CurrentActor, Public, type RequestContext, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { ApiZodBody, ApiZodResponse, zbody } from "../../core/http/zod"
import { ServicesCatalogService } from "./services-catalog.service"

/** Customer-facing list of active add-on services; prices only where staff allowed it. */
@ApiTags("services-catalog")
@Controller("v1/services-catalog")
export class PublicServicesCatalogController {
  constructor(private readonly catalog: ServicesCatalogService) {}

  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=60")
  @ApiZodResponse(200, PublicServiceCatalogItem.array())
  list() {
    return this.catalog.publicList()
  }
}

@ApiTags("admin-services-catalog")
@Controller("v1/admin/services-catalog")
@StaffOnly()
export class AdminServicesCatalogController {
  constructor(private readonly catalog: ServicesCatalogService) {}

  @Get()
  @RequirePermission("service_catalog.manage")
  @ApiZodResponse(200, ServiceCatalogItem.array())
  list() {
    return this.catalog.staffList()
  }

  /** Active items with default prices for the quote editor, which only needs `pricing.write`. */
  @Get("options")
  @RequirePermission("pricing.write")
  @ApiZodResponse(200, ServiceCatalogItem.array())
  options() {
    return this.catalog.activeForQuotes()
  }

  @Post()
  @RequirePermission("service_catalog.manage")
  @ApiZodBody(CreateServiceCatalogItemBody)
  @ApiZodResponse(201, ServiceCatalogItem)
  create(@Body(zbody(CreateServiceCatalogItemBody)) body: CreateServiceCatalogItemBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.catalog.create(body, actor, { requestId: ctx.id })
  }

  @Patch(":id")
  @RequirePermission("service_catalog.manage")
  @ApiZodBody(UpdateServiceCatalogItemBody)
  @ApiZodResponse(200, ServiceCatalogItem)
  update(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(UpdateServiceCatalogItemBody)) body: UpdateServiceCatalogItemBody, @CurrentActor() actor: Actor, @Ctx() ctx: RequestContext) {
    return this.catalog.update(id, body, actor, { requestId: ctx.id })
  }
}
