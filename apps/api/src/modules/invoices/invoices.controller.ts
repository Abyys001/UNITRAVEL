import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common"
import { ApiTags } from "@nestjs/swagger"
import { z } from "zod"

import { InvoiceCancelBody, InvoiceStatus } from "@unitravel/contracts"

import { type Actor, CurrentActor, RequirePermission, StaffOnly } from "../../core/http/decorators"
import { zbody } from "../../core/http/zod"
import { InvoicesService } from "./invoices.service"

/** Documents & billing for the signed-in customer: own invoices and quotations, 404 for anything else (ADR-0006 C9). */
@ApiTags("billing")
@Controller("v1/billing")
export class CustomerBillingController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get("documents")
  @RequirePermission("flight_request.read.own", "cargo_request.read.own")
  documents(@CurrentActor() actor: Actor) {
    return this.invoices.billing(actor.userId)
  }

  @Get("invoices/:number")
  @RequirePermission("flight_request.read.own", "cargo_request.read.own")
  invoice(@Param("number") number: string, @CurrentActor() actor: Actor) {
    return this.invoices.customerInvoice(number, actor.userId)
  }
}

const READ = ["flight_request.read.any", "cargo_request.read.any", "commercial_document.issue"] as const

@ApiTags("admin-invoices")
@Controller("v1/admin")
@StaffOnly()
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get("invoices")
  @RequirePermission(...READ)
  list(@Query(zbody(z.object({ status: InvoiceStatus.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }))) q: { status?: z.infer<typeof InvoiceStatus>; limit: number }, @CurrentActor() actor: Actor) {
    return this.invoices.staffList(q, actor)
  }

  @Get("invoices/:id")
  @RequirePermission(...READ)
  detail(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.invoices.staffById(id, actor)
  }

  @Get("requests/:ref/invoices")
  @RequirePermission(...READ)
  forRequest(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.invoices.staffForRequest(ref, actor)
  }

  @Post("requests/:ref/invoices")
  @RequirePermission("commercial_document.issue")
  create(@Param("ref") ref: string, @CurrentActor() actor: Actor) {
    return this.invoices.createDraft(ref, actor)
  }

  @Post("invoices/:id/issue")
  @RequirePermission("commercial_document.issue")
  @HttpCode(200)
  issue(@Param("id", zbody(z.uuid())) id: string, @CurrentActor() actor: Actor) {
    return this.invoices.issue(id, actor)
  }

  @Post("invoices/:id/cancel")
  @RequirePermission("commercial_document.issue")
  @HttpCode(200)
  cancel(@Param("id", zbody(z.uuid())) id: string, @Body(zbody(InvoiceCancelBody)) body: z.infer<typeof InvoiceCancelBody>, @CurrentActor() actor: Actor) {
    return this.invoices.cancel(id, body, actor)
  }
}
